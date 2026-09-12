import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeWorker, frameMessage, statsAt } from '../bridge/fakeWorker.test-support'
import { SimulationClient } from '../bridge/SimulationClient'
import { lonLatToPixel } from '../dem/tileMath'
import type { TerrainPayload } from '../shared/protocol'
import { createSimulationStore } from '../state/simulationStore'
import { SimulationSession, STATS_INTERVAL_MS } from './simulationSession'

afterEach(() => {
  vi.useRealTimers()
})

const CENTER = { lon: 139.7016, lat: 35.658 }
const pc = lonLatToPixel(CENTER.lon, CENTER.lat, 17)
const geo = {
  level: 1,
  z: 17,
  originX: Math.floor(pc.x) - 256,
  originY: Math.floor(pc.y) - 256,
  size: 512,
  cellSizeM: 0.98,
} as TerrainPayload['geo']
const terrain = { geo } as TerrainPayload

function setup() {
  const worker = new FakeWorker()
  const client = new SimulationClient(() => worker)
  const store = createSimulationStore()
  const session = new SimulationSession(client, store)
  void client.loadTerrain(CENTER.lon, CENTER.lat, 500)
  const terrainId = worker.loaded(terrain)
  session.terrainReady(terrain, CENTER)
  return { worker, client, store, session, terrainId }
}

describe('SimulationSession: 命令（spec 04 §3）', () => {
  it('start は降雨中心をグリッドの北西端からの m にして送り、再生中にする', () => {
    const { worker, store, session } = setup()
    session.start(100, 10)
    expect(worker.posted.at(-1)).toEqual({
      type: 'start',
      rain: {
        x: (pc.x - geo.originX) * geo.cellSizeM,
        y: (pc.y - geo.originY) * geo.cellSizeM,
        radiusM: 10,
        amountMm: 100,
      },
    })
    expect(store.getState().status).toBe('running')
  })

  it('地形が無ければ start しない', () => {
    const { worker, store, session } = setup()
    session.terrainCleared()
    session.start(100, 10)
    expect(worker.posted.some((m) => m.type === 'start')).toBe(false)
    expect(store.getState().status).toBe('idle')
  })

  it('pause・resume・reset・setSpeed はストアにも反映する', () => {
    const { store, session } = setup()
    session.start(100, 10)
    session.pause()
    expect(store.getState().status).toBe('paused')
    session.resume()
    expect(store.getState().status).toBe('running')
    session.setSpeed('max')
    expect(store.getState().speed).toBe('max')
    session.reset()
    expect(store.getState()).toMatchObject({ status: 'idle', stats: null })
  })
})

describe('SimulationSession: 地形の読み込み中は再生の命令を送らない（レビューの裁定 2）', () => {
  it('読み込み中（terrainCleared の後）は resume・step を送らない', () => {
    const { worker, session } = setup()
    session.terrainCleared()
    session.resume()
    session.step()
    expect(worker.posted.some((m) => m.type === 'resume' || m.type === 'step')).toBe(false)
  })

  it('読み込み中でも pause・reset・setSpeed は送る', () => {
    const { worker, session } = setup()
    session.terrainCleared()
    session.pause()
    session.reset()
    session.setSpeed('max')
    expect(worker.posted.map((m) => m.type)).toEqual(
      expect.arrayContaining(['pause', 'reset', 'setSpeed']),
    )
  })
})

describe('SimulationSession: Worker の作り直しの後の速度の立て直し（コントローラーの追加の裁定）', () => {
  it('異常終了で作り直した Worker は速度 1 で始まるので、terrainReady のたびに今の速度を送り直す', () => {
    const worker = new FakeWorker()
    const client = new SimulationClient(() => worker)
    const store = createSimulationStore()
    const session = new SimulationSession(client, store)
    session.setSpeed('max')
    worker.crash()
    void client.loadTerrain(CENTER.lon, CENTER.lat, 500)
    worker.loaded(terrain)
    session.terrainReady(terrain, CENTER)
    expect(worker.posted.at(-1)).toEqual({ type: 'setSpeed', speed: 'max' })
  })
})

describe('SimulationSession: frame → ストア', () => {
  it('再生中の統計は 10Hz に間引く（最初はすぐ、次は間隔の終わりに最新のもの）', () => {
    vi.useFakeTimers()
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    worker.reply(frameMessage(terrainId, 1))
    worker.reply(frameMessage(terrainId, 2))
    worker.reply(frameMessage(terrainId, 3))
    expect(store.getState().stats?.step).toBe(1)
    vi.advanceTimersByTime(STATS_INTERVAL_MS)
    expect(store.getState().stats?.step).toBe(3)
  })

  it('settled の frame で「平衡」にし、その統計を間引かずに入れる', () => {
    vi.useFakeTimers()
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    worker.reply(frameMessage(terrainId, 1))
    worker.reply(frameMessage(terrainId, 40, { stats: statsAt(40, { settled: true }) }))
    expect(store.getState()).toMatchObject({ status: 'settled', stats: { step: 40 } })
    vi.advanceTimersByTime(STATS_INTERVAL_MS)
    expect(store.getState().stats?.step).toBe(40)
  })

  it('越流イベントは間引かずに一覧へ足す', () => {
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    const events = [{ type: 'spill' as const, step: 9, depressionId: 4, spillElevation: 12.7 }]
    worker.reply(frameMessage(terrainId, 9, { stats: statsAt(9, { events }) }))
    expect(store.getState().spills).toEqual([{ depressionId: 4, spillElevation: 12.7, step: 9 }])
  })

  it('止まっている間の frame（Step・Reset）はすぐに入れる。idle の間は settled でも状態を変えない', () => {
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    session.pause()
    worker.reply(frameMessage(terrainId, 11))
    expect(store.getState().stats?.step).toBe(11)
    session.reset()
    worker.reply(frameMessage(terrainId, 12, { stats: statsAt(12, { settled: true }) }))
    expect(store.getState().status).toBe('idle')
  })

  it('地点の読み込みを始めた後の frame は入れない', () => {
    const { worker, store, session, terrainId } = setup()
    session.terrainCleared()
    worker.reply(frameMessage(terrainId, 3))
    expect(store.getState().stats).toBeNull()
  })

  it('simFailed は理由をストアに入れ、idle に戻す', () => {
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    worker.reply({
      type: 'simFailed',
      terrainId,
      reason: 'no-elevation-at-rain-center',
      message: '',
    })
    expect(store.getState()).toMatchObject({
      status: 'idle',
      error: 'no-elevation-at-rain-center',
    })
  })

  it('simFailed が届く前に間引き待ちだった統計を、後から上書きしない（間引きを止める）', () => {
    vi.useFakeTimers()
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    worker.reply(frameMessage(terrainId, 1))
    worker.reply(frameMessage(terrainId, 2))
    worker.reply({
      type: 'simFailed',
      terrainId,
      reason: 'no-elevation-at-rain-center',
      message: '',
    })
    expect(store.getState().stats).toBeNull()
    vi.advanceTimersByTime(STATS_INTERVAL_MS)
    expect(store.getState().stats).toBeNull()
  })

  it('Worker が異常終了すると worker のエラーにする（「再読み込み」を出す。spec 04 §10）', () => {
    const { worker, store, session } = setup()
    session.start(100, 10)
    worker.crash()
    expect(store.getState()).toMatchObject({ status: 'idle', error: 'worker' })
  })
})
