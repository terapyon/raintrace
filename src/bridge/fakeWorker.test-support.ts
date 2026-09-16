import type {
  FrameMessage,
  MainToWorkerMessage,
  SimFailedMessage,
  TerrainPayload,
  WorkerToMainMessage,
} from '../shared/protocol'
import type { WorkerPort } from './SimulationClient'

type Listener = (event: MessageEvent<WorkerToMainMessage>) => void
type ErrorListener = (event: Event) => void

/** テスト用の Worker の偽物（SimulationClient と、それを使う UI のテストで共有する） */
export class FakeWorker implements WorkerPort {
  readonly posted: MainToWorkerMessage[] = []
  /** postMessage の transfer に渡されたもの */
  readonly transferred: Transferable[] = []
  readonly listeners = new Set<Listener>()
  readonly errorListeners = new Set<ErrorListener>()
  terminated = false

  postMessage(message: MainToWorkerMessage, transfer: Transferable[] = []): void {
    this.posted.push(message)
    this.transferred.push(...transfer)
  }
  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: Listener | ErrorListener,
  ): void {
    if (type === 'message') this.listeners.add(listener as Listener)
    else this.errorListeners.add(listener as ErrorListener)
  }
  removeEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: Listener | ErrorListener,
  ): void {
    if (type === 'message') this.listeners.delete(listener as Listener)
    else this.errorListeners.delete(listener as ErrorListener)
  }
  terminate(): void {
    this.terminated = true
  }
  reply(message: WorkerToMainMessage): void {
    for (const listener of this.listeners) listener(new MessageEvent('message', { data: message }))
  }
  crash(): void {
    for (const listener of this.errorListeners) listener(new Event('error'))
  }
  lastRequestId(): number {
    const last = this.posted.at(-1)
    if (last?.type !== 'loadTerrain')
      throw new Error('最後のメッセージが loadTerrain ではありません')
    return last.requestId
  }
  /** 最後の loadTerrain に地形を返し、その requestId を返す */
  loaded(terrain: TerrainPayload): number {
    const requestId = this.lastRequestId()
    this.reply({ type: 'terrainLoaded', requestId, terrain })
    return requestId
  }
}

export function statsAt(
  step: number,
  overrides: Partial<FrameMessage['stats']> = {},
): FrameMessage['stats'] {
  return {
    step,
    totalWater: 0,
    storedWater: 0,
    outflowWater: 0,
    maxDepth: 0,
    floodedArea: 0,
    settled: false,
    massError: 0,
    events: [],
    ...overrides,
  }
}

/** 水深が 4 セルすべて step の frame。runId は既定で 1（テストの多くは start・reset を 1 回だけ呼ぶ） */
export function frameMessage(
  terrainId: number,
  step: number,
  overrides: Partial<FrameMessage> = {},
): FrameMessage {
  return {
    type: 'frame',
    terrainId,
    step,
    water: new Float32Array(4).fill(step).buffer,
    arrows: null,
    stats: statsAt(step),
    stepsPerSecond: 60,
    runId: 1,
    ...overrides,
  }
}

/** runId は既定で 1（frameMessage と同じ） */
export function simFailedMessage(
  terrainId: number,
  overrides: Partial<SimFailedMessage> = {},
): SimFailedMessage {
  return {
    type: 'simFailed',
    terrainId,
    reason: 'internal',
    message: '',
    runId: 1,
    ...overrides,
  }
}
