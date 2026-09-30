import { DEFAULT_PLAYBACK_SPEED, type PlaybackSpeed } from '../shared/protocol'
import type { StepStats } from '../simulation/types'

/** tick の目標の周期（毎秒 60 回）と、1 tick の時間予算（spec 04 §5.2、R04-5） */
export const TICK_INTERVAL_MS = 1000 / 60
export const TICK_BUDGET_MS = 12
/** 実行速度（step／秒）と実際の倍率を測る窓 */
export const RATE_WINDOW_MS = 1000
/**
 * 目標に届いたとみなす誤差（s）。倍率 × 実時間の経過の浮動小数点の丸め（60 倍 × 1/60 秒 = 1.0000000000000002 秒）で、
 * 目標にちょうど届いた後に余分な 1 step を回さない
 */
const TARGET_EPSILON_S = 1e-9

/** スケジューラが使う時計・タイマー・エンジン・送信。テストでは偽物に差し替える */
export interface SchedulerPorts {
  now(): number
  setTimer(run: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
  /** エンジンを 1 step 進める */
  step(): StepStats
  /**
   * frame を送る。返却済みのバッファが無くて送れなければ false（新しいバッファは確保しない）。
   * stepsPerSecond は step／秒、simSecondsPerSecond は実時間 1 秒あたりに進んだシミュレーションの秒（実際の倍率）
   */
  sendFrame(stats: StepStats, stepsPerSecond: number, simSecondsPerSecond: number): boolean
  /**
   * 計測用（spec 06 §3。計測用のビルドの Worker だけが渡す）。tick の中の 1 step の所要時間（ms）。
   * 時間は tick がすでに読んでいる now() の差で求め、now() の呼び出し回数を増やさない。stepOnce の 1 step は数えない
   */
  onStepTime?: (ms: number) => void
}

/**
 * 再生ループのスケジューラ（spec 04 §5.2、spec 08 §6.1）。純粋なクラスで、時計とタイマーを注入する。
 * 速度は実時間の倍率: tick ごとに「倍率 × 前の tick からの実時間の経過」を目標の時刻に足し、シミュレーションの時刻が
 * 目標に届くまで step を回す（目標を越えるのは最大 1 step の dt。越えた分は次の tick から差し引く）。「最速」は目標を
 * 持たない。どちらも時間予算で打ち切り、届かなかった分は繰り越さない。予算を残して tick を終える
 * （その間に pause・returnBuffer を処理できる）
 */
export class PlaybackScheduler {
  private readonly ports: SchedulerPorts
  private speed: PlaybackSpeed = DEFAULT_PLAYBACK_SPEED
  private timer: unknown = null
  private running = false
  private pending: StepStats | null = null
  /** 最後に見た統計の経過時間（s） */
  private simTime = 0
  /** 倍率の再生で、この時刻まで進める（s） */
  private target = 0
  /** 前の tick（play の直後は 1 tick 前とみなした時刻）の now() */
  private lastTickAt = 0
  private windowStart = 0
  private windowSteps = 0
  private windowSimSeconds = 0
  private rate = 0
  private simRate = 0

  constructor(ports: SchedulerPorts) {
    this.ports = ports
  }

  get isRunning(): boolean {
    return this.running
  }

  get stepsPerSecond(): number {
    return this.rate
  }

  /** 実際の倍率（実時間 1 秒あたりに進んだシミュレーションの秒） */
  get simSecondsPerSecond(): number {
    return this.simRate
  }

  /** 速度を変える。目標を今の時刻に戻す（越えた分・貯めた分を捨てる。計画で決めたこと 17） */
  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed
    this.target = this.simTime
  }

  /** 時刻と目標を 0 に戻す（エンジンの reset・地形の差し替えと一緒に呼ぶ） */
  rewind(): void {
    this.simTime = 0
    this.target = 0
  }

  /** 再生を始める（再開も同じ）。最初の tick はすぐに回し、1 tick 分の実時間を進めたとみなす */
  play(): void {
    if (this.running) return
    this.running = true
    this.rate = 0
    this.simRate = 0
    const now = this.ports.now()
    this.windowStart = now
    this.windowSteps = 0
    this.windowSimSeconds = 0
    this.lastTickAt = now - TICK_INTERVAL_MS
    this.target = this.simTime
    this.schedule(0)
  }

  /** 止める。止まっている間の frame（Step・Reset・矢印の切り替え）の実行速度と実際の倍率は 0 */
  pause(): void {
    this.running = false
    this.rate = 0
    this.simRate = 0
    if (this.timer !== null) {
      this.ports.clearTimer(this.timer)
      this.timer = null
    }
  }

  /** 一時停止中に 1 step（その時の dt）進め、その結果を送る。再生中は何もしない */
  stepOnce(): void {
    if (this.running) return
    this.offer(this.ports.step())
  }

  /** 送る統計を示す。バッファが無ければ保留し、返却を待つ（自動停止の frame も必ず届く）。時刻は統計から取る */
  offer(stats: StepStats): void {
    this.simTime = stats.timeS
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
    if (this.ports.sendFrame(this.pending, this.rate, this.simRate)) this.pending = null
  }

  private schedule(delayMs: number): void {
    this.timer = this.ports.setTimer(() => this.tick(), delayMs)
  }

  private tick(): void {
    this.timer = null
    if (!this.running) return
    const start = this.ports.now()
    const speed = this.speed
    if (speed !== 'max') this.target += (speed * (start - this.lastTickAt)) / 1000
    this.lastTickAt = start
    const onStepTime = this.ports.onStepTime
    const simBefore = this.simTime
    let steps = 0
    let last: StepStats | null = null
    // 計測中の step の始まり（その直前に読んだ now()）。step の後に最初に読む now() で閉じる。NaN は計測中でない
    let stepStart = Number.NaN
    // 先に予算を調べるので、1 step が予算を超えても 1 tick に 1 step は回る
    while (speed === 'max' || this.simTime < this.target - TARGET_EPSILON_S) {
      const now = this.ports.now()
      if (onStepTime !== undefined && !Number.isNaN(stepStart)) onStepTime(now - stepStart)
      stepStart = Number.NaN
      if (now - start >= TICK_BUDGET_MS) {
        // 時間予算で目標に届かなかった分は繰り越さない（spec 08 §6.1）
        if (speed !== 'max') this.target = this.simTime
        break
      }
      stepStart = now
      last = this.ports.step()
      this.simTime = last.timeS
      steps++
      if (last.stopReason !== null) {
        // 自動停止（settled・cap。spec 08 §3.9）の後に回しても何も変わらないので、自動で止める
        this.running = false
        break
      }
    }
    const measuredAt = this.measure(steps, this.simTime - simBefore)
    // 目標か自動停止でループを抜けた最後の step は、実行速度の窓で読んだ now() で閉じる
    if (onStepTime !== undefined && !Number.isNaN(stepStart)) onStepTime(measuredAt - stepStart)
    // 自動停止したら実行速度と実際の倍率は 0（停止の frame と、その後の表示に再生中の値を載せない）
    if (!this.running) {
      this.rate = 0
      this.simRate = 0
    }
    if (last !== null) this.offer(last)
    if (this.running) {
      this.schedule(Math.max(0, TICK_INTERVAL_MS - (this.ports.now() - start)))
    }
  }

  /** 実行速度と実際の倍率の窓を進める。読んだ now() を返す（tick が最後の step の時間を閉じるのに使う） */
  private measure(steps: number, simSeconds: number): number {
    this.windowSteps += steps
    this.windowSimSeconds += simSeconds
    const now = this.ports.now()
    const elapsed = now - this.windowStart
    if (elapsed >= RATE_WINDOW_MS) {
      this.rate = (this.windowSteps * 1000) / elapsed
      this.simRate = (this.windowSimSeconds * 1000) / elapsed
      this.windowStart = now
      this.windowSteps = 0
      this.windowSimSeconds = 0
    }
    return now
  }
}
