import type { MainToWorkerMessage, WorkerToMainMessage } from '../shared/protocol'

/** SimulationClient が使う Worker の機能。テストでは偽物に差し替える */
export interface WorkerPort {
  postMessage(message: MainToWorkerMessage): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerToMainMessage>) => void,
  ): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerToMainMessage>) => void,
  ): void
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

interface PendingPing {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** メインスレッドで Worker を所有する（tech-spec §5.1）。01 では疎通の確認だけを行う */
export class SimulationClient {
  private readonly worker: WorkerPort
  private readonly pending = new Map<number, PendingPing>()
  private nextId = 1

  private readonly onMessage = (event: MessageEvent<WorkerToMainMessage>): void => {
    const message = event.data
    switch (message.type) {
      case 'pong': {
        const entry = this.pending.get(message.id)
        if (entry !== undefined) {
          this.pending.delete(message.id)
          clearTimeout(entry.timer)
          entry.resolve()
        }
        break
      }
    }
  }

  constructor(createWorker: () => WorkerPort = createSimulationWorker) {
    this.worker = createWorker()
    this.worker.addEventListener('message', this.onMessage)
  }

  /** ping を送り、pong が返れば解決する。timeoutMs 以内に返らなければ失敗する */
  ping(timeoutMs = PING_TIMEOUT_MS): Promise<void> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Worker が ${timeoutMs}ms 以内に応答しませんでした`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.worker.postMessage({ type: 'ping', id })
    })
  }

  /** Worker を終了する。待っている ping は失敗させ、タイマーを残さない */
  dispose(): void {
    this.worker.removeEventListener('message', this.onMessage)
    this.worker.terminate()
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('SimulationClient は破棄されました'))
    }
    this.pending.clear()
  }
}
