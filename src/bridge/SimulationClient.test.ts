import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainToWorkerMessage, TerrainPayload, WorkerToMainMessage } from '../shared/protocol'
import { SimulationClient, type WorkerPort } from './SimulationClient'

type Listener = (event: MessageEvent<WorkerToMainMessage>) => void
type ErrorListener = (event: Event) => void

class FakeWorker implements WorkerPort {
  readonly posted: MainToWorkerMessage[] = []
  readonly listeners = new Set<Listener>()
  readonly errorListeners = new Set<ErrorListener>()
  terminated = false

  postMessage(message: MainToWorkerMessage): void {
    this.posted.push(message)
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
}

function setup() {
  const worker = new FakeWorker()
  const client = new SimulationClient(() => worker)
  return { worker, client }
}

const fakeTerrain = { geo: { size: 1 } } as unknown as TerrainPayload

afterEach(() => {
  vi.useRealTimers()
})

describe('SimulationClient の ping', () => {
  it('ping を送り、同じ id の pong が返ると解決する', async () => {
    const { worker, client } = setup()
    const done = client.ping()
    expect(worker.posted).toEqual([{ type: 'ping', id: 1 }])
    worker.reply({ type: 'pong', id: 1 })
    await expect(done).resolves.toBeUndefined()
  })

  it('違う id の pong では解決せず、期限を過ぎると失敗する', async () => {
    vi.useFakeTimers()
    const { worker, client } = setup()
    const done = client.ping(5000)
    worker.reply({ type: 'pong', id: 999 })
    vi.advanceTimersByTime(5000)
    await expect(done).rejects.toThrow('5000ms')
  })

  it('ping のたびに id が増える', () => {
    const { worker, client } = setup()
    void client.ping().catch(() => {})
    void client.ping().catch(() => {})
    expect(worker.posted.flatMap((m) => (m.type === 'ping' ? [m.id] : []))).toEqual([1, 2])
    client.dispose()
  })

  it('dispose で Worker を終了し、受信をやめる', () => {
    const { worker, client } = setup()
    client.dispose()
    expect(worker.terminated).toBe(true)
    expect(worker.listeners.size).toBe(0)
    expect(worker.errorListeners.size).toBe(0)
  })

  it('dispose で待っている ping を失敗させ、タイマーを残さない', async () => {
    vi.useFakeTimers()
    const { client } = setup()
    const done = client.ping()
    client.dispose()
    await expect(done).rejects.toThrow('破棄')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('SimulationClient の dispose の後', () => {
  it('dispose の後の ping と loadTerrain は worker で失敗し、Worker を作り直さない', async () => {
    const { workers, client } = setupMany()
    client.dispose()
    await expect(client.ping()).rejects.toMatchObject({ reason: 'worker' })
    await expect(client.loadTerrain(0, 0, 500)).rejects.toMatchObject({ reason: 'worker' })
    expect(workers).toHaveLength(1)
  })

  it('異常終了の後に dispose しても、次の要求で Worker を作り直さない', async () => {
    const { workers, client } = setupMany()
    nth(workers, 0).crash()
    client.dispose()
    await expect(client.ping()).rejects.toMatchObject({ reason: 'worker' })
    expect(workers).toHaveLength(1)
  })
})

describe('SimulationClient の地形の読み込み', () => {
  it('同じ requestId の terrainLoaded で解決し、terrain に保持する。進捗も伝える', async () => {
    const { worker, client } = setup()
    const progress: [number, number][] = []
    const done = client.loadTerrain(139.7, 35.6, 500, (d, s) => progress.push([d, s]))
    expect(worker.posted.at(-1)).toMatchObject({
      type: 'loadTerrain',
      lon: 139.7,
      lat: 35.6,
      sizeM: 500,
    })
    const requestId = worker.lastRequestId()
    worker.reply({ type: 'terrainProgress', requestId, done: 1, started: 4 })
    worker.reply({ type: 'terrainLoaded', requestId, terrain: fakeTerrain })
    await expect(done).resolves.toBe(fakeTerrain)
    expect(client.terrain).toBe(fakeTerrain)
    expect(progress).toEqual([[1, 4]])
  })

  it('terrainFailed では理由つきで失敗する', async () => {
    const { worker, client } = setup()
    const done = client.loadTerrain(0, 0, 500)
    worker.reply({
      type: 'terrainFailed',
      requestId: worker.lastRequestId(),
      reason: 'no-data',
      message: '',
    })
    await expect(done).rejects.toMatchObject({ reason: 'no-data' })
  })

  it('新しい読み込みは古いものを superseded で失敗させ、古い結果は無視する', async () => {
    const { worker, client } = setup()
    const first = client.loadTerrain(0, 0, 500)
    const firstId = worker.lastRequestId()
    const second = client.loadTerrain(1, 1, 500)
    await expect(first).rejects.toMatchObject({ reason: 'superseded' })
    worker.reply({ type: 'terrainLoaded', requestId: firstId, terrain: fakeTerrain })
    // 推奨 2: superseded で失敗した要求の terrainLoaded でも、terrain は最後に成功した地形になる
    expect(client.terrain).toBe(fakeTerrain)
    worker.reply({ type: 'terrainLoaded', requestId: worker.lastRequestId(), terrain: fakeTerrain })
    await expect(second).resolves.toBe(fakeTerrain)
  })

  it('推奨 2: 古い要求の terrainLoaded で terrain が更新された後、後続の要求が失敗しても戻らない', async () => {
    const { worker, client } = setup()
    const first = client.loadTerrain(0, 0, 500)
    const firstId = worker.lastRequestId()
    const second = client.loadTerrain(1, 1, 500)
    const secondId = worker.lastRequestId()
    await expect(first).rejects.toMatchObject({ reason: 'superseded' })

    worker.reply({ type: 'terrainLoaded', requestId: firstId, terrain: fakeTerrain })
    expect(client.terrain).toBe(fakeTerrain)

    worker.reply({ type: 'terrainFailed', requestId: secondId, reason: 'no-data', message: '' })
    await expect(second).rejects.toMatchObject({ reason: 'no-data' })
    expect(client.terrain).toBe(fakeTerrain)
  })
})

/** 作った Worker をすべて記録する。onCreate で作った直後の Worker に手を加えられる */
function setupMany(onCreate?: (worker: FakeWorker) => void) {
  const workers: FakeWorker[] = []
  const client = new SimulationClient(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    onCreate?.(worker)
    return worker
  })
  return { workers, client }
}

function nth(workers: readonly FakeWorker[], index: number): FakeWorker {
  const worker = workers[index]
  if (worker === undefined) throw new Error(`${index + 1} 番目の Worker がありません`)
  return worker
}

describe('SimulationClient の Worker の異常終了', () => {
  it('待っている ping と読み込みを worker で失敗させ、その Worker を終了して受信をやめる。タイマーも残さない', async () => {
    vi.useFakeTimers()
    const { worker, client } = setup()
    const ping = client.ping()
    const load = client.loadTerrain(0, 0, 500)
    worker.crash()
    await expect(ping).rejects.toMatchObject({ reason: 'worker' })
    await expect(load).rejects.toMatchObject({ reason: 'worker' })
    expect(worker.terminated).toBe(true)
    expect(worker.listeners.size).toBe(0)
    expect(worker.errorListeners.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('異常終了しただけでは、新しい Worker を作らない', () => {
    const { workers } = setupMany()
    nth(workers, 0).crash()
    expect(workers).toHaveLength(1)
  })

  it('読み込み中の異常終了は worker で失敗し、次の loadTerrain で起動し直した Worker が応える', async () => {
    const { workers, client } = setupMany()
    const first = client.loadTerrain(0, 0, 500)
    nth(workers, 0).crash()
    await expect(first).rejects.toMatchObject({ reason: 'worker' })
    const second = client.loadTerrain(0, 0, 500)
    expect(workers).toHaveLength(2)
    const next = nth(workers, 1)
    next.reply({ type: 'terrainLoaded', requestId: next.lastRequestId(), terrain: fakeTerrain })
    await expect(second).resolves.toBe(fakeTerrain)
    expect(client.terrain).toBe(fakeTerrain)
  })

  it('起動し直した Worker がまた異常終了しても、同じように扱う', async () => {
    const { workers, client } = setupMany()
    nth(workers, 0).crash()
    const ping = client.ping()
    expect(workers).toHaveLength(2)
    nth(workers, 1).crash()
    await expect(ping).rejects.toMatchObject({ reason: 'worker' })
    expect(nth(workers, 1).terminated).toBe(true)
    expect(workers).toHaveLength(2)
    void client.ping().catch(() => {})
    expect(workers).toHaveLength(3)
    expect(nth(workers, 2).posted.at(-1)).toMatchObject({ type: 'ping' })
    client.dispose()
  })

  it('作るたびにすぐ異常終了する Worker でも、読み込みは速やかに失敗し、作り直しが回り続けない', async () => {
    const { workers, client } = setupMany((worker) => queueMicrotask(() => worker.crash()))
    // 起動時の Worker が異常終了するのを待つ
    await Promise.resolve()
    expect(workers).toHaveLength(1)
    await expect(client.loadTerrain(0, 0, 500)).rejects.toMatchObject({ reason: 'worker' })
    expect(workers).toHaveLength(2)
    // 要求が無ければ、それ以上は作らない（マイクロタスクを流すだけで確かめる。実時間は待たない）
    await Promise.resolve()
    expect(workers).toHaveLength(2)
  })

  it('起動し直すときに factory が同期的に投げると、loadTerrain は worker で失敗する。次の要求で factory が成功すれば解決する', async () => {
    let shouldThrow = false
    const workers: FakeWorker[] = []
    const client = new SimulationClient(() => {
      if (shouldThrow) throw new Error('CSP で読み込めません')
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    nth(workers, 0).crash()
    shouldThrow = true
    await expect(client.loadTerrain(0, 0, 500)).rejects.toMatchObject({ reason: 'worker' })
    expect(workers).toHaveLength(1)

    shouldThrow = false
    const done = client.loadTerrain(0, 0, 500)
    expect(workers).toHaveLength(2)
    const next = nth(workers, 1)
    next.reply({ type: 'terrainLoaded', requestId: next.lastRequestId(), terrain: fakeTerrain })
    await expect(done).resolves.toBe(fakeTerrain)
  })
})
