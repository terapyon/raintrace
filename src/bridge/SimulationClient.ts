import type {
  MainToWorkerMessage,
  TerrainErrorReason,
  TerrainPayload,
  WorkerToMainMessage,
} from '../shared/protocol'

/** SimulationClient が使う Worker の機能。テストでは偽物に差し替える */
export interface WorkerPort {
  postMessage(message: MainToWorkerMessage): void
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

export class TerrainLoadError extends Error {
  readonly reason: TerrainErrorReason
  constructor(reason: TerrainErrorReason, message: string) {
    super(message)
    this.reason = reason
  }
}

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
 * 読み込んだ地形の配列はここに持ち、React やストアには載せない
 */
export class SimulationClient {
  terrain: TerrainPayload | null = null
  private worker: WorkerPort
  private readonly createWorker: () => WorkerPort
  private readonly pendingPings = new Map<number, PendingPing>()
  private pendingTerrain: PendingTerrain | null = null
  private readonly crashListeners = new Set<() => void>()
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
          this.pendingTerrain.onProgress?.(message.done, message.started)
        }
        break
      case 'terrainLoaded': {
        const pending = this.takeTerrain(message.requestId)
        if (pending !== null) {
          this.terrain = message.terrain
          pending.resolve(message.terrain)
        }
        break
      }
      case 'terrainFailed':
        this.takeTerrain(message.requestId)?.reject(
          new TerrainLoadError(message.reason, message.message),
        )
        break
    }
  }

  private readonly onError = (): void => {
    this.failAll(new TerrainLoadError('worker', 'Worker が異常終了しました'))
    for (const listener of this.crashListeners) listener()
  }

  constructor(createWorker: () => WorkerPort = createSimulationWorker) {
    this.createWorker = createWorker
    this.worker = this.start()
  }

  /** ping を送り、pong が返れば解決する。timeoutMs 以内に返らなければ失敗する */
  ping(timeoutMs = PING_TIMEOUT_MS): Promise<void> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingPings.delete(id)
        reject(new Error(`Worker が ${timeoutMs}ms 以内に応答しませんでした`))
      }, timeoutMs)
      this.pendingPings.set(id, { resolve, reject, timer })
      this.worker.postMessage({ type: 'ping', id })
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
    const requestId = this.nextId++
    return new Promise((resolve, reject) => {
      this.pendingTerrain = { requestId, resolve, reject, onProgress }
      this.worker.postMessage({ type: 'loadTerrain', requestId, lon, lat, sizeM })
    })
  }

  /** Worker の異常終了を通知する。戻り値を呼ぶと通知をやめる */
  onCrash(listener: () => void): () => void {
    this.crashListeners.add(listener)
    return () => {
      this.crashListeners.delete(listener)
    }
  }

  /** Worker を起動し直す。待っている要求は 'worker' で失敗させる（spec 02 §7） */
  restart(): void {
    this.stop(new TerrainLoadError('worker', 'Worker を起動し直しました'))
    this.worker = this.start()
  }

  /** Worker を終了する。待っている要求は失敗させ、タイマーを残さない */
  dispose(): void {
    this.stop(new TerrainLoadError('worker', 'SimulationClient は破棄されました'))
  }

  private start(): WorkerPort {
    const worker = this.createWorker()
    worker.addEventListener('message', this.onMessage)
    worker.addEventListener('error', this.onError)
    worker.addEventListener('messageerror', this.onError)
    return worker
  }

  private stop(error: TerrainLoadError): void {
    this.worker.removeEventListener('message', this.onMessage)
    this.worker.removeEventListener('error', this.onError)
    this.worker.removeEventListener('messageerror', this.onError)
    this.worker.terminate()
    this.failAll(error)
  }

  private takeTerrain(requestId: number): PendingTerrain | null {
    const pending = this.pendingTerrain
    if (pending === null || pending.requestId !== requestId) return null
    this.pendingTerrain = null
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
  }
}
