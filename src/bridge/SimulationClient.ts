import type {
  ArrowSpacingM,
  FrameMessage,
  MainToWorkerMessage,
  PlaybackSpeed,
  SimFailureReason,
  SimulationCommand,
  TerrainErrorReason,
  TerrainPayload,
  WorkerToMainMessage,
} from '../shared/protocol'

/** SimulationClient が使う Worker の機能。テストでは偽物に差し替える */
export interface WorkerPort {
  postMessage(message: MainToWorkerMessage, transfer?: Transferable[]): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerToMainMessage>) => void,
  ): void
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerToMainMessage>) => void,
  ): void
  removeEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void
  terminate(): void
}

/** Vite が Worker をバンドルできるよう、new Worker(new URL(...)) をこの形のまま書く */
export function createSimulationWorker(): WorkerPort {
  return new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), {
    type: 'module',
    name: 'simulation',
  })
}

export const PING_TIMEOUT_MS = 5000
/** 読み込みの進捗がこの時間止まったら、Worker が止まったとみなす（02 の申し送り L14） */
export const LOAD_STALL_TIMEOUT_MS = 30_000

export class TerrainLoadError extends Error {
  readonly reason: TerrainErrorReason
  constructor(reason: TerrainErrorReason, message: string) {
    super(message)
    this.reason = reason
  }
}

/** メインが受け取った frame。water は次の frame が届くまで手元に置く。runId は FrameMessage と同じ */
export interface FrameView {
  water: Float32Array<ArrayBuffer>
  arrows: Float32Array | null
  stats: FrameMessage['stats']
  stepsPerSecond: number
  runId: number
}

type RainfallInput = Extract<SimulationCommand, { type: 'start' }>['rain']

interface PendingPing {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface PendingTerrain {
  requestId: number
  resolve: (terrain: TerrainPayload) => void
  reject: (error: TerrainLoadError) => void
  onProgress: ((done: number, started: number) => void) | undefined
}

/**
 * メインスレッドで Worker を所有する（tech-spec §5.1）。アプリで 1 つだけ作る（01 の申し送り H2）。
 * 読み込んだ地形と最新の水深の配列はここに持ち、React やストアには載せない
 */
export class SimulationClient {
  terrain: TerrainPayload | null = null
  /** terrain を読み込んだ loadTerrain の requestId。frame・simFailed の terrainId と比べる */
  terrainId: number | null = null
  /** 最新の frame の水深。次の frame が届くまで、表示とセル情報に使う（tech-spec §5.2） */
  water: Float32Array<ArrayBuffer> | null = null
  private worker: WorkerPort
  private readonly createWorker: () => WorkerPort
  private readonly pendingPings = new Map<number, PendingPing>()
  private pendingTerrain: PendingTerrain | null = null
  private readonly frameListeners = new Set<(frame: FrameView) => void>()
  private readonly simFailedListeners = new Set<(reason: SimFailureReason, runId: number) => void>()
  private readonly crashListeners = new Set<() => void>()
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private crashed = false
  private disposed = false
  private nextId = 1

  private readonly onMessage = (event: MessageEvent<WorkerToMainMessage>): void => {
    const message = event.data
    switch (message.type) {
      case 'pong': {
        const entry = this.pendingPings.get(message.id)
        if (entry !== undefined) {
          this.pendingPings.delete(message.id)
          clearTimeout(entry.timer)
          entry.resolve()
        }
        break
      }
      case 'terrainProgress':
        if (this.pendingTerrain?.requestId === message.requestId) {
          this.armWatchdog()
          this.pendingTerrain.onProgress?.(message.done, message.started)
        }
        break
      case 'terrainLoaded': {
        // Worker は要求を順に処理するので terrainLoaded は単調に届き、this.terrain は Worker のエンジンが
        // 持つ地形と同じ「最後に成功した地形」になる。画面の読み込みの状態とは別
        this.terrain = message.terrain
        this.terrainId = message.requestId
        // 前の地形の水深は捨てる（大きさが違いうる。Worker は新しい地形のバッファを 2 枚作る）
        this.water = null
        this.takeTerrain(message.requestId)?.resolve(message.terrain)
        break
      }
      case 'terrainFailed':
        this.takeTerrain(message.requestId)?.reject(
          new TerrainLoadError(message.reason, message.message),
        )
        break
      case 'frame':
        this.receiveFrame(message)
        break
      case 'simFailed':
        if (message.terrainId === this.terrainId) {
          // 失敗した start はエンジンを reset 済みで、step 0 の frame を送ってこない。前の実行の水深を
          // 出し続けないよう手元のバッファを消し、Worker にも返す（大きさは同じ地形なので合う）
          // （タスク 4 のレビューの裁定 1）
          if (this.water !== null) {
            const buffer = this.water.buffer
            this.water = null
            this.command({ type: 'returnBuffer', buffer }, [buffer])
          }
          for (const listener of this.simFailedListeners) listener(message.reason, message.runId)
        }
        break
    }
  }

  private readonly onError = (): void => {
    // 'error' は Worker の未捕捉の例外でも発火し、Worker が止まったとは限らない。
    // 'messageerror'（返ってきたメッセージを構造化複製できなかった場合）も同じ扱いにする。
    // どちらも作り直しの契機にして扱いを決定的にする
    this.crash(new TerrainLoadError('worker', 'Worker が異常終了しました'))
  }

  constructor(createWorker: () => WorkerPort = createSimulationWorker) {
    this.createWorker = createWorker
    this.worker = this.spawnWorker()
  }

  /** ping を送り、pong が返れば解決する。timeoutMs 以内に返らなければ失敗する */
  ping(timeoutMs = PING_TIMEOUT_MS): Promise<void> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      // Worker の生成が例外を投げても、タイマーや待ちを残さないよう先に取る
      const worker = this.port()
      const timer = setTimeout(() => {
        this.pendingPings.delete(id)
        reject(new Error(`Worker が ${timeoutMs}ms 以内に応答しませんでした`))
      }, timeoutMs)
      this.pendingPings.set(id, { resolve, reject, timer })
      worker.postMessage({ type: 'ping', id })
    })
  }

  /** 地点の周囲の地形を読み込む。前の読み込みは superseded で失敗させる（spec 02 §4.3） */
  loadTerrain(
    lon: number,
    lat: number,
    sizeM: number,
    onProgress?: (done: number, started: number) => void,
  ): Promise<TerrainPayload> {
    this.pendingTerrain?.reject(
      new TerrainLoadError('superseded', '新しい地点の読み込みに置き換わりました'),
    )
    // port() が投げた場合に、reject 済みの古い entry を pendingTerrain に残さない
    this.pendingTerrain = null
    this.clearWatchdog()
    const requestId = this.nextId++
    return new Promise((resolve, reject) => {
      const worker = this.port()
      this.pendingTerrain = { requestId, resolve, reject, onProgress }
      worker.postMessage({ type: 'loadTerrain', requestId, lon, lat, sizeM })
      this.armWatchdog()
    })
  }

  /** runId は SimulationSession が振る通し番号。そのまま Worker へ渡す（タスクレビューの追加の裁定） */
  start(rain: RainfallInput, runId: number): void {
    this.command({ type: 'start', rain, runId })
  }
  pause(): void {
    this.command({ type: 'pause' })
  }
  resume(): void {
    this.command({ type: 'resume' })
  }
  step(): void {
    this.command({ type: 'step' })
  }
  /** runId は start と同じ（タスクレビューの追加の裁定） */
  reset(runId: number): void {
    this.command({ type: 'reset', runId })
  }
  setSpeed(speed: PlaybackSpeed): void {
    this.command({ type: 'setSpeed', speed })
  }
  setArrows(visible: boolean, spacingM: ArrowSpacingM): void {
    this.command({ type: 'setArrows', visible, spacingM })
  }

  onFrame(listener: (frame: FrameView) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  onSimFailed(listener: (reason: SimFailureReason, runId: number) => void): () => void {
    this.simFailedListeners.add(listener)
    return () => {
      this.simFailedListeners.delete(listener)
    }
  }

  /** Worker の異常終了（読み込みの番犬を含む）を知らせる。再生中なら画面を「再読み込み」にする（spec 04 §10） */
  onCrash(listener: () => void): () => void {
    this.crashListeners.add(listener)
    return () => {
      this.crashListeners.delete(listener)
    }
  }

  /** Worker を終了する。待っている要求は失敗させ、タイマーを残さない。破棄した後は Worker を作り直さない */
  dispose(): void {
    this.disposed = true
    this.stop(new TerrainLoadError('worker', 'SimulationClient は破棄されました'))
  }

  private receiveFrame(message: FrameMessage): void {
    if (message.terrainId !== this.terrainId) {
      // 前の地形の frame（地点を変えた直後に届く）。表示せずにバッファだけ返す
      this.command({ type: 'returnBuffer', buffer: message.water }, [message.water])
      return
    }
    const previous = this.water
    const water = new Float32Array(message.water)
    this.water = water
    const frame: FrameView = {
      water,
      arrows: message.arrows,
      stats: message.stats,
      stepsPerSecond: message.stepsPerSecond,
      runId: message.runId,
    }
    for (const listener of this.frameListeners) listener(frame)
    // 表示とセル情報は新しい方を読むので、古い方を返す。返した後は previous に触れない（tech-spec §5.2）
    if (previous !== null) {
      this.command({ type: 'returnBuffer', buffer: previous.buffer }, [previous.buffer])
    }
  }

  /**
   * 再生の命令を送る。異常終了・破棄の後は送らず、Worker も起動し直さない。
   * 新しい Worker には地形が無いので、再読み込みは地点の選び直し（読み込み）で行う（spec 04 §10）
   */
  private command(message: SimulationCommand, transfer: Transferable[] = []): void {
    if (this.crashed || this.disposed) return
    this.worker.postMessage(message, transfer)
  }

  /**
   * 要求を送る Worker。異常終了の後は、次の要求（ping・loadTerrain）のときに起動し直す（spec 02 §7）。
   * すぐに起動し直すと、スクリプトを読めない Worker（CSP で塞がれた場合など）で作り直しが止まらない。
   * 破棄した後は、異常終了の後の dispose でも Worker を作り直さない
   */
  private port(): WorkerPort {
    if (this.disposed) {
      throw new TerrainLoadError('worker', 'SimulationClient は破棄されました')
    }
    if (this.crashed) {
      try {
        this.worker = this.spawnWorker()
        this.crashed = false
      } catch (error) {
        // 起動を同期的に投げる factory（CSP で塞がれた場合など）でも、crashed は true のままにし、
        // 次の要求でまた起動を試みる
        throw new TerrainLoadError('worker', `Worker を起動できませんでした: ${String(error)}`)
      }
    }
    return this.worker
  }

  /** Worker を作って配線する（コンストラクタと、異常終了の後の作り直しで使う） */
  private spawnWorker(): WorkerPort {
    const worker = this.createWorker()
    worker.addEventListener('message', this.onMessage)
    worker.addEventListener('error', this.onError)
    worker.addEventListener('messageerror', this.onError)
    return worker
  }

  /** 異常終了として扱う。Worker を終了し、待っている要求を失敗させ、次の要求で起動し直す */
  private crash(error: TerrainLoadError): void {
    this.stop(error)
    this.crashed = true
    this.water = null
    for (const listener of this.crashListeners) listener()
  }

  private stop(error: TerrainLoadError): void {
    this.worker.removeEventListener('message', this.onMessage)
    this.worker.removeEventListener('error', this.onError)
    this.worker.removeEventListener('messageerror', this.onError)
    this.worker.terminate()
    this.failAll(error)
  }

  /** 読み込みの番犬を張り直す。進捗が止まった Worker は次のメッセージも処理できないので、異常終了と同じ扱い */
  private armWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined
      this.crash(
        new TerrainLoadError(
          'worker',
          `読み込みが ${LOAD_STALL_TIMEOUT_MS / 1000} 秒進みませんでした`,
        ),
      )
    }, LOAD_STALL_TIMEOUT_MS)
  }

  private clearWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = undefined
  }

  private takeTerrain(requestId: number): PendingTerrain | null {
    const pending = this.pendingTerrain
    if (pending === null || pending.requestId !== requestId) return null
    this.pendingTerrain = null
    this.clearWatchdog()
    return pending
  }

  private failAll(error: TerrainLoadError): void {
    for (const entry of this.pendingPings.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pendingPings.clear()
    this.pendingTerrain?.reject(error)
    this.pendingTerrain = null
    this.clearWatchdog()
  }
}
