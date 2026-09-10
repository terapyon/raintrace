import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainToWorkerMessage, WorkerToMainMessage } from '../shared/protocol'
import { SimulationClient, type WorkerPort } from './SimulationClient'

type Listener = (event: MessageEvent<WorkerToMainMessage>) => void

class FakeWorker implements WorkerPort {
  readonly posted: MainToWorkerMessage[] = []
  readonly listeners = new Set<Listener>()
  terminated = false

  postMessage(message: MainToWorkerMessage): void {
    this.posted.push(message)
  }
  addEventListener(_type: 'message', listener: Listener): void {
    this.listeners.add(listener)
  }
  removeEventListener(_type: 'message', listener: Listener): void {
    this.listeners.delete(listener)
  }
  terminate(): void {
    this.terminated = true
  }
  reply(message: WorkerToMainMessage): void {
    for (const listener of this.listeners) listener(new MessageEvent('message', { data: message }))
  }
}

function setup() {
  const worker = new FakeWorker()
  const client = new SimulationClient(() => worker)
  return { worker, client }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('SimulationClient', () => {
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
