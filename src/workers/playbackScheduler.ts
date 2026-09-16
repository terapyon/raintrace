import type { PlaybackSpeed } from '../shared/protocol'
import type { StepStats } from '../simulation/types'

/** tick の目標の周期（毎秒 60 回）と、1 tick の時間予算（spec 04 §5.2、R04-5） */
export const TICK_INTERVAL_MS = 1000 / 60
export const TICK_BUDGET_MS = 12
/** 実行速度（step／秒）を測る窓 */
export const RATE_WINDOW_MS = 1000

/** スケジューラが使う時計・タイマー・エンジン・送信。テストでは偽物に差し替える */
export interface SchedulerPorts {
  now(): number
  setTimer(run: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
  /** エンジンを 1 step 進める */
  step(): StepStats
  /** frame を送る。返却済みのバッファが無くて送れなければ false（新しいバッファは確保しない） */
  sendFrame(stats: StepStats, stepsPerSecond: number): boolean
  /**
   * 計測用（spec 06 §3。計測用のビルドの Worker だけが渡す。計画で決めたこと 1）。tick の中の 1 step の所要時間（ms）。
   * 時間は tick がすでに読んでいる now() の差で求め、now() の呼び出し回数を増やさない。stepOnce の 1 step は数えない
   */
  onStepTime?: (ms: number) => void
}

/**
 * 再生ループのスケジューラ（spec 04 §5.2）。純粋なクラスで、時計とタイマーを注入する。
 * 速度は 1 tick あたりの step 数の上限（端数は次の tick へ繰り越す）、「最速」は上限なし。
 * どちらも時間予算で打ち切り、予算を残して tick を終える（その間に pause・returnBuffer を処理できる）
 */
export class PlaybackScheduler {
  private readonly ports: SchedulerPorts
  private speed: PlaybackSpeed = 1
  private credit = 0
  private timer: unknown = null
  private running = false
  private pending: StepStats | null = null
  private windowStart = 0
  private windowSteps = 0
  private rate = 0

  constructor(ports: SchedulerPorts) {
    this.ports = ports
  }

  get isRunning(): boolean {
    return this.running
  }

  get stepsPerSecond(): number {
    return this.rate
  }

  /** 速度を変える。それまでの端数は捨てる */
  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed
    this.credit = 0
  }

  /** 再生を始める（再開も同じ）。最初の tick はすぐに回す。実行速度は 0 から測り直す */
  play(): void {
    if (this.running) return
    this.running = true
    this.credit = 0
    this.rate = 0
    this.windowStart = this.ports.now()
    this.windowSteps = 0
    this.schedule(0)
  }

  /** 止める。止まっている間の frame（Step・Reset・矢印の切り替え）の実行速度は 0 */
  pause(): void {
    this.running = false
    this.rate = 0
    if (this.timer !== null) {
      this.ports.clearTimer(this.timer)
      this.timer = null
    }
  }

  /** 一時停止中に 1 step 進め、その結果を送る。再生中は何もしない */
  stepOnce(): void {
    if (this.running) return
    this.offer(this.ports.step())
  }

  /** 送る統計を示す。バッファが無ければ保留し、返却を待つ（平衡で止まった frame も必ず届く） */
  offer(stats: StepStats): void {
    this.pending = stats
    this.flush()
  }

  /** バッファが返却された。保留中の frame があれば送る */
  bufferReturned(): void {
    this.flush()
  }

  /** 保留中の frame を捨てる（reset・地形の差し替え） */
  discardPending(): void {
    this.pending = null
  }

  private flush(): void {
    if (this.pending === null) return
    if (this.ports.sendFrame(this.pending, this.rate)) this.pending = null
  }

  private schedule(delayMs: number): void {
    this.timer = this.ports.setTimer(() => this.tick(), delayMs)
  }

  private tick(): void {
    this.timer = null
    if (!this.running) return
    const start = this.ports.now()
    const cap = this.cap()
    const onStepTime = this.ports.onStepTime
    let steps = 0
    let last: StepStats | null = null
    // 計測中の step の始まり（その直前に読んだ now()）。step の後に最初に読む now() で閉じる。NaN は計測中でない
    let stepStart = Number.NaN
    // 先に予算を調べるので、1 step が予算を超えても 1 tick に 1 step は回る。
    // now() を読むのは steps < cap のときだけ（書き換える前の `steps < cap && now() - start < 予算` と同じ回数）
    while (steps < cap) {
      const now = this.ports.now()
      if (onStepTime !== undefined && !Number.isNaN(stepStart)) onStepTime(now - stepStart)
      stepStart = Number.NaN
      if (now - start >= TICK_BUDGET_MS) break
      stepStart = now
      last = this.ports.step()
      steps++
      if (last.settled) {
        // 平衡の後に回しても何も変わらないので、自動で止める（R04-5）
        this.running = false
        break
      }
    }
    const measuredAt = this.measure(steps)
    // 上限か平衡でループを抜けた最後の step は、実行速度の窓で読んだ now() で閉じる
    if (onStepTime !== undefined && !Number.isNaN(stepStart)) onStepTime(measuredAt - stepStart)
    // 平衡で止まったら実行速度は 0（平衡の frame と、その後の表示に再生中の値を載せない）
    if (!this.running) this.rate = 0
    if (last !== null) this.offer(last)
    if (this.running) {
      this.schedule(Math.max(0, TICK_INTERVAL_MS - (this.ports.now() - start)))
    }
  }

  /** この tick の step 数の上限。端数だけを繰り越す（予算で届かなかった分は繰り越さない） */
  private cap(): number {
    if (this.speed === 'max') return Number.POSITIVE_INFINITY
    this.credit += this.speed
    const cap = Math.floor(this.credit)
    this.credit -= cap
    return cap
  }

  /** 実行速度の窓を進める。読んだ now() を返す（tick が最後の step の時間を閉じるのに使う） */
  private measure(steps: number): number {
    this.windowSteps += steps
    const now = this.ports.now()
    const elapsed = now - this.windowStart
    if (elapsed >= RATE_WINDOW_MS) {
      this.rate = (this.windowSteps * 1000) / elapsed
      this.windowStart = now
      this.windowSteps = 0
    }
    return now
  }
}
