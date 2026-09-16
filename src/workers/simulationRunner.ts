import type { SimFailureReason, SimulationCommand, WorkerToMainMessage } from '../shared/protocol'
import { TsSimulationEngine } from '../simulation/TsSimulationEngine'
import type { Depression, TerrainGrid } from '../simulation/terrain/types'
import type { RainfallInput, SimulationEvent, StepStats } from '../simulation/types'
import { thinFlowArrows } from './flowArrows'
import { PlaybackScheduler } from './playbackScheduler'

/** Runner が使う送信・時計・タイマー。Worker では self.postMessage・performance.now・setTimeout */
export interface RunnerPorts {
  post(message: WorkerToMainMessage, transfer: Transferable[]): void
  now(): number
  setTimer(run: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
  /** 計測用（spec 06 §3）。PlaybackScheduler にそのまま渡す。計測用のビルドの Worker だけが渡す */
  onStepTime?: (ms: number) => void
}

/** 雨を置く前と reset の直後の統計 */
export const ZERO_STATS: StepStats = {
  step: 0,
  totalWater: 0,
  storedWater: 0,
  outflowWater: 0,
  maxDepth: 0,
  floodedArea: 0,
  settled: false,
  massError: 0,
  events: [],
}

/** 再生中に矢印を計算する間隔の下限（ms）。表示は 10Hz（spec 04 §6.2） */
export const ARROW_INTERVAL_MS = 100

/** 転送バッファの枚数（ダブルバッファ。tech-spec §5.2） */
const BUFFER_COUNT = 2

interface Loaded {
  terrainId: number
  width: number
  height: number
  cellSizeM: number
  bytes: number
  /** 手元にある（転送していない）バッファ */
  free: ArrayBuffer[]
}

/**
 * Worker の中の再生（spec 04 §5）。エンジン・転送バッファ・矢印を持ち、命令を処理する。
 * 時間の扱いは PlaybackScheduler に任せる。メッセージの送信と時計は注入する（テストで差し替える）
 */
export class SimulationRunner {
  private readonly ports: RunnerPorts
  private readonly engine = new TsSimulationEngine()
  private readonly scheduler: PlaybackScheduler
  private loaded: Loaded | null = null
  /** まだ送っていない越流イベント（見送った frame の分を含む） */
  private events: SimulationEvent[] = []
  private lastStats: StepStats = ZERO_STATS
  private arrowsVisible = false
  private arrowSpacingM = 10
  /** 表示・間隔が変わった、または地形・水が変わった。次の frame で必ず矢印を送る */
  private arrowsDirty = false
  private arrowsAt = Number.NEGATIVE_INFINITY
  /**
   * 直前に受けた start・reset の runId。メイン（SimulationSession）だけが振る番号で、ここでは作らない。
   * frame・simFailed にそのまま載せて返す（タスクレビューの重要な指摘・追加の裁定）
   */
  private runId = 0

  constructor(ports: RunnerPorts) {
    this.ports = ports
    this.scheduler = new PlaybackScheduler({
      now: ports.now,
      setTimer: ports.setTimer,
      clearTimer: ports.clearTimer,
      step: () => this.step(),
      sendFrame: (stats, stepsPerSecond) => this.sendFrame(stats, stepsPerSecond),
      // exactOptionalPropertyTypes のため、無いときは項目ごと渡さない
      ...(ports.onStepTime === undefined ? {} : { onStepTime: ports.onStepTime }),
    })
  }

  /** 読み込んだ地形をエンジンに渡し、転送バッファを 2 枚作る。前の地形の再生は止める */
  loadTerrain(terrainId: number, grid: TerrainGrid, depressions: readonly Depression[]): void {
    this.suspend()
    const { width, height, cellSizeM } = grid
    // エンジンは標高とマスクを複製して持つ（03）。呼び出し側（Worker）は grid を捨て、二重に持たない
    this.engine.loadTerrain(grid.elevation, grid.validMask, { width, height, cellSizeM })
    // setDepressions は loadTerrain の後に呼ぶ（loadTerrain が窪地の一覧を消す）。越流イベントの対象は
    // 表示と同じ significant のもの（R02-3）。エンジンは絞らないので、ここで絞る
    this.engine.setDepressions(depressions.filter((d) => d.significant))
    const bytes = width * height * Float32Array.BYTES_PER_ELEMENT
    this.loaded = {
      terrainId,
      width,
      height,
      cellSizeM,
      bytes,
      free: Array.from({ length: BUFFER_COUNT }, () => new ArrayBuffer(bytes)),
    }
    this.events = []
    this.lastStats = ZERO_STATS
    this.arrowsDirty = true
    // 新しい地形では、実行はまだ始まっていない（コントローラー追加の裁定）
    this.runId = 0
  }

  /** 再生を止め、保留中の frame を捨てる（新しい地点の読み込みの開始、地形の差し替え） */
  suspend(): void {
    this.scheduler.pause()
    this.scheduler.discardPending()
  }

  handle(command: SimulationCommand): void {
    switch (command.type) {
      case 'start':
        this.start(command.rain, command.runId)
        break
      case 'pause':
        this.scheduler.pause()
        break
      case 'resume':
        if (this.loaded !== null) this.scheduler.play()
        break
      case 'step':
        if (this.loaded !== null) this.scheduler.stepOnce()
        break
      case 'reset':
        this.reset(command.runId)
        break
      case 'setSpeed':
        this.scheduler.setSpeed(command.speed)
        break
      case 'setArrows':
        this.setArrows(command.visible, command.spacingM)
        break
      case 'returnBuffer':
        this.returnBuffer(command.buffer)
        break
    }
  }

  private start(rain: RainfallInput, runId: number): void {
    // 失敗（simFailed）もこの新しい実行のものとして runId を載せるので、addRainfall を試す前に控える
    this.runId = runId
    const loaded = this.loaded
    if (loaded === null) return
    this.suspend()
    this.engine.reset()
    this.events = []
    this.lastStats = ZERO_STATS
    try {
      this.engine.addRainfall(rain)
    } catch (error) {
      // エラーは name で判別して protocol の理由に写す（03 の申し送り L6。文言はメインの strings.ts が出す）
      const reason: SimFailureReason =
        error instanceof Error && error.name === 'NoElevationAtRainCenterError'
          ? 'no-elevation-at-rain-center'
          : 'internal'
      this.ports.post(
        {
          type: 'simFailed',
          terrainId: loaded.terrainId,
          reason,
          message: String(error),
          runId: this.runId,
        },
        [],
      )
      return
    }
    this.arrowsDirty = true
    this.scheduler.play()
  }

  private reset(runId: number): void {
    this.runId = runId
    if (this.loaded === null) return
    this.suspend()
    this.engine.reset()
    this.events = []
    this.lastStats = ZERO_STATS
    this.arrowsDirty = true
    // 水を消した状態（step 0）を表示に届ける
    this.scheduler.offer(ZERO_STATS)
  }

  private setArrows(visible: boolean, spacingM: number): void {
    // メインが送る値だが、Worker に届く命令は信用しない（04 の A7 と同じ）
    if (!(Number.isFinite(spacingM) && spacingM > 0)) return
    this.arrowsVisible = visible
    this.arrowSpacingM = spacingM
    this.arrowsDirty = true
    // 止まっている間の切り替えも、すぐに表示へ反映する（今の状態の frame を送り直す）
    if (this.loaded !== null && !this.scheduler.isRunning) this.scheduler.offer(this.lastStats)
  }

  private step(): StepStats {
    const stats = this.engine.step()
    for (const event of stats.events) this.events.push(event)
    this.lastStats = stats
    return stats
  }

  private sendFrame(stats: StepStats, stepsPerSecond: number): boolean {
    const loaded = this.loaded
    if (loaded === null) return true
    const buffer = loaded.free.pop()
    if (buffer === undefined) return false
    // waterDepth() は step のたびに別の配列に入れ替わるので、送る直前に呼び直す（03 の申し送り）。
    // Float64 の水深を単精度に書き写す（TypedArray の set が要素ごとに変換する）
    new Float32Array(buffer).set(this.engine.waterDepth())
    const arrows = this.arrowsFor(loaded)
    const events = this.events
    this.events = []
    const transfer: Transferable[] = [buffer]
    if (arrows !== null) transfer.push(arrows.buffer)
    // 転送した buffer と arrows には、この後触れない（tech-spec §5.2）
    this.ports.post(
      {
        type: 'frame',
        terrainId: loaded.terrainId,
        step: stats.step,
        water: buffer,
        arrows,
        stats: { ...stats, events },
        stepsPerSecond,
        runId: this.runId,
      },
      transfer,
    )
    return true
  }

  /** この frame で送る矢印。null は前のまま（計画で決めたこと 3） */
  private arrowsFor(loaded: Loaded): Float32Array<ArrayBuffer> | null {
    if (!this.arrowsVisible) {
      if (!this.arrowsDirty) return null
      this.arrowsDirty = false
      return new Float32Array(0)
    }
    const now = this.ports.now()
    if (!this.arrowsDirty && this.scheduler.isRunning && now - this.arrowsAt < ARROW_INTERVAL_MS) {
      return null
    }
    this.arrowsDirty = false
    this.arrowsAt = now
    // flowVectors() は呼ぶたびに 2 × N² を確保する（03 の申し送り P3）。表示されていて frame を送るときだけ呼ぶ
    const v = this.engine.flowVectors()
    return thinFlowArrows(
      v.x,
      v.y,
      loaded.width,
      loaded.height,
      loaded.cellSizeM,
      this.arrowSpacingM,
    )
  }

  private returnBuffer(buffer: ArrayBuffer): void {
    const loaded = this.loaded
    // 前の地形の大きさのバッファは捨てる。手元に置くのは最大 2 枚
    if (loaded === null || buffer.byteLength !== loaded.bytes) return
    if (loaded.free.length >= BUFFER_COUNT) return
    loaded.free.push(buffer)
    this.scheduler.bufferReturned()
  }
}
