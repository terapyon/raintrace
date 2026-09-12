import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerrainPayload } from '../shared/protocol'
import { FakeWorker, frameMessage, simFailedMessage } from './fakeWorker.test-support'
import { LOAD_STALL_TIMEOUT_MS, SimulationClient } from './SimulationClient'

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

/** 地形を読み込み済みのクライアント。requestId が terrainId になる */
function loadedSetup() {
  const { worker, client } = setup()
  void client.loadTerrain(0, 0, 500)
  const terrainId = worker.loaded(fakeTerrain)
  return { worker, client, terrainId }
}

describe('SimulationClient の再生（spec 04 §5）', () => {
  it('再生の命令をそのまま送る。start・reset の runId もそのまま送る（タスクレビューの追加の裁定）', () => {
    const { worker, client } = loadedSetup()
    const rain = { x: 1, y: 2, radiusM: 10, amountMm: 100 }
    client.start(rain, 1)
    client.pause()
    client.resume()
    client.step()
    client.reset(2)
    client.setSpeed('max')
    client.setArrows(true, 20)
    expect(worker.posted.slice(-7)).toEqual([
      { type: 'start', rain, runId: 1 },
      { type: 'pause' },
      { type: 'resume' },
      { type: 'step' },
      { type: 'reset', runId: 2 },
      { type: 'setSpeed', speed: 'max' },
      { type: 'setArrows', visible: true, spacingM: 20 },
    ])
  })

  it('frame の runId をそのまま FrameView に、simFailed の runId をそのままリスナーに渡す', () => {
    const { worker, client, terrainId } = loadedSetup()
    const runIds: number[] = []
    client.onFrame((frame) => runIds.push(frame.runId))
    worker.reply(frameMessage(terrainId, 1, { runId: 7 }))
    expect(runIds).toEqual([7])

    const failed: number[] = []
    client.onSimFailed((_reason, runId) => failed.push(runId))
    worker.reply(simFailedMessage(terrainId, { runId: 9 }))
    expect(failed).toEqual([9])
  })

  it('frame の水深を渡し、手元の古いバッファを transfer つきの returnBuffer で返す（tech-spec §5.2）', () => {
    const { worker, client, terrainId } = loadedSetup()
    const steps: number[] = []
    client.onFrame((frame) => steps.push(frame.water[0] ?? -1))
    const first = frameMessage(terrainId, 1)
    worker.reply(first)
    expect(client.water?.[0]).toBe(1)
    expect(worker.posted.some((m) => m.type === 'returnBuffer')).toBe(false)
    worker.reply(frameMessage(terrainId, 2))
    expect(steps).toEqual([1, 2])
    expect(client.water?.[0]).toBe(2)
    expect(worker.posted.at(-1)).toEqual({ type: 'returnBuffer', buffer: first.water })
    expect(worker.transferred).toContain(first.water)
  })

  it('frame の購読者が例外を投げても、手元の古いバッファは返す（返さないと Worker のバッファが尽きて再生が止まる。最終レビューの軽微）', () => {
    const { worker, client, terrainId } = loadedSetup()
    const first = frameMessage(terrainId, 1)
    worker.reply(first)
    client.onFrame(() => {
      throw new Error('購読者の失敗')
    })
    expect(() => worker.reply(frameMessage(terrainId, 2))).toThrow('購読者の失敗')
    expect(client.water?.[0]).toBe(2)
    expect(worker.posted.at(-1)).toEqual({ type: 'returnBuffer', buffer: first.water })
    expect(worker.transferred).toContain(first.water)
  })

  it('前の地形の frame は渡さず、バッファだけを返す', () => {
    const { worker, client, terrainId } = loadedSetup()
    const listener = vi.fn()
    client.onFrame(listener)
    const stale = frameMessage(terrainId - 1, 5)
    worker.reply(stale)
    expect(listener).not.toHaveBeenCalled()
    expect(client.water).toBeNull()
    expect(worker.posted.at(-1)).toEqual({ type: 'returnBuffer', buffer: stale.water })
  })

  it('新しい地形を読み込むと terrainId が変わり、前の地形の水深を捨てる', () => {
    const { worker, client, terrainId } = loadedSetup()
    worker.reply(frameMessage(terrainId, 1))
    void client.loadTerrain(1, 1, 250)
    const next = worker.loaded(fakeTerrain)
    expect(client.terrainId).toBe(next)
    expect(client.water).toBeNull()
  })

  it('simFailed は今の地形のものだけを知らせる', () => {
    const { worker, client, terrainId } = loadedSetup()
    const reasons: string[] = []
    client.onSimFailed((reason) => reasons.push(reason))
    worker.reply(simFailedMessage(terrainId - 1))
    worker.reply(simFailedMessage(terrainId, { reason: 'no-elevation-at-rain-center' }))
    expect(reasons).toEqual(['no-elevation-at-rain-center'])
  })

  it('今の地形の simFailed は手元の水深を返して消す（前の実行の水を出し続けない。タスク 4 レビューの裁定 1）', () => {
    const { worker, client, terrainId } = loadedSetup()
    const frame = frameMessage(terrainId, 3)
    worker.reply(frame)
    expect(client.water).not.toBeNull()
    worker.reply(simFailedMessage(terrainId))
    expect(client.water).toBeNull()
    expect(worker.posted.at(-1)).toEqual({ type: 'returnBuffer', buffer: frame.water })
    expect(worker.transferred).toContain(frame.water)
  })

  it('前の地形の simFailed では手元の水深を返さない', () => {
    const { worker, client, terrainId } = loadedSetup()
    const frame = frameMessage(terrainId, 3)
    worker.reply(frame)
    worker.reply(simFailedMessage(terrainId - 1))
    expect(client.water).not.toBeNull()
    expect(worker.posted.some((m) => m.type === 'returnBuffer')).toBe(false)
  })
})

describe('SimulationClient の異常終了の通知と番犬（02 の申し送り）', () => {
  it('異常終了で crash を知らせる。その後の再生の命令は送らず、Worker も起動し直さない', () => {
    const { workers, client } = setupMany()
    const crashes = vi.fn()
    client.onCrash(crashes)
    nth(workers, 0).crash()
    expect(crashes).toHaveBeenCalledTimes(1)
    client.start({ x: 0, y: 0, radiusM: 1, amountMm: 1 }, 1)
    client.reset(2)
    expect(workers).toHaveLength(1)
    expect(nth(workers, 0).posted.some((m) => m.type === 'start')).toBe(false)
  })

  it('読み込みの進捗が 30 秒止まると worker で失敗し、Worker を終了して crash を知らせる。進捗があれば延びる', async () => {
    vi.useFakeTimers()
    const { worker, client } = setup()
    const crashes = vi.fn()
    client.onCrash(crashes)
    const load = client.loadTerrain(0, 0, 500)
    const requestId = worker.lastRequestId()
    vi.advanceTimersByTime(LOAD_STALL_TIMEOUT_MS - 1)
    worker.reply({ type: 'terrainProgress', requestId, done: 1, started: 4 })
    vi.advanceTimersByTime(LOAD_STALL_TIMEOUT_MS - 1)
    expect(crashes).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await expect(load).rejects.toMatchObject({ reason: 'worker' })
    expect(worker.terminated).toBe(true)
    expect(crashes).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('読み込みが済めば番犬を外す', async () => {
    vi.useFakeTimers()
    const { worker, client } = setup()
    const load = client.loadTerrain(0, 0, 500)
    worker.loaded(fakeTerrain)
    await load
    expect(vi.getTimerCount()).toBe(0)
  })
})
