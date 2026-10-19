import { describe, expect, it, vi } from 'vitest'
import { FillHistoryLoadError, type SimulationClient } from '../bridge/SimulationClient'
import type { FillHistoryPayload, TerrainPayload } from '../shared/protocol'
import { createAppStore } from '../state/appStore'
import { FillHistorySession } from './fillHistorySession'
import type { SimulationSession } from './simulationSession'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const payload = (terrainId: number): FillHistoryPayload =>
  ({
    terrainId,
    offsetM: 0.4,
    candidates: [{ id: 1 }],
    a54Available: true,
    landformAvailable: false,
  }) as unknown as FillHistoryPayload

function setup() {
  const terrainA = { id: 'A' } as unknown as TerrainPayload
  const terrainB = { id: 'B' } as unknown as TerrainPayload
  const calls: Array<ReturnType<typeof deferred<FillHistoryPayload>>> = []
  const client = {
    terrainId: null as number | null,
    computeFillHistory: vi.fn(() => {
      const d = deferred<FillHistoryPayload>()
      calls.push(d)
      return d.promise
    }),
  }
  const terrainListeners: Array<(t: TerrainPayload | null) => void> = []
  const simulation = {
    onTerrain: (l: (t: TerrainPayload | null) => void) => {
      terrainListeners.push(l)
      return () => {}
    },
  }
  const app = createAppStore()
  const session = new FillHistorySession(
    client as unknown as SimulationClient,
    app,
    simulation as unknown as SimulationSession,
  )
  const load = (terrain: TerrainPayload, id: number) => {
    client.terrainId = id
    for (const l of terrainListeners) l(terrain)
  }
  const clear = () => {
    for (const l of terrainListeners) l(null)
  }
  return { client, calls, app, session, load, clear, terrainA, terrainB }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('FillHistorySession', () => {
  it('オンにすると今の地形で依頼し、結果で ready と summary を入れる', async () => {
    const { client, calls, app, session, load, terrainA } = setup()
    load(terrainA, 5)
    app.getState().setFillHistoryEnabled(true)
    expect(client.computeFillHistory).toHaveBeenCalledWith(5, terrainA)
    expect(app.getState().fillHistory.status).toBe('loading')
    const results: Array<FillHistoryPayload | null> = []
    session.onResult((r) => results.push(r))
    const result = payload(5)
    calls[0]?.resolve(result)
    await tick()
    expect(session.result()).toBe(result)
    expect(results).toEqual([result])
    expect(app.getState().fillHistory).toMatchObject({
      status: 'ready',
      summary: { offsetM: 0.4, candidates: [{ id: 1 }], a54Available: true },
    })
  })

  it('オフのままなら、地形を読み込んでも computeFillHistory を呼ばない', () => {
    const { client, load, terrainA } = setup()
    load(terrainA, 5)
    expect(client.computeFillHistory).not.toHaveBeenCalled()
  })

  it('計算中に新しい地形が来たら、古い応答を捨て、新しい地形で依頼し直す', async () => {
    const { client, calls, app, session, load, clear, terrainA, terrainB } = setup()
    app.getState().setFillHistoryEnabled(true)
    load(terrainA, 5)
    clear()
    load(terrainB, 7)
    expect(client.computeFillHistory).toHaveBeenLastCalledWith(7, terrainB)
    // 古い依頼の応答（旧 terrainId）が後から届く
    calls[0]?.resolve(payload(5))
    await tick()
    expect(session.result()).toBeNull()
    expect(app.getState().fillHistory.status).toBe('loading')
    // 新しい地形なのに旧 terrainId の応答が現在の依頼として届いても捨てる
    calls[1]?.resolve(payload(5))
    await tick()
    expect(session.result()).toBeNull()
    expect(app.getState().fillHistory.status).toBe('loading')
    // 新しい依頼の応答だけが通る
    app.getState().setFillHistoryEnabled(false)
    app.getState().setFillHistoryEnabled(true)
    calls[2]?.resolve(payload(7))
    await tick()
    expect(session.result()?.terrainId).toBe(7)
    expect(app.getState().fillHistory.status).toBe('ready')
  })

  it('計算中にオフにしたら、応答が来ても描かない（result は null のまま）', async () => {
    const { calls, app, session, load, terrainA } = setup()
    app.getState().setFillHistoryEnabled(true)
    load(terrainA, 5)
    app.getState().setFillHistoryEnabled(false)
    calls[0]?.resolve(payload(5))
    await tick()
    expect(session.result()).toBeNull()
    expect(app.getState().fillHistory.status).toBe('off')
  })

  it('unavailable・no-overlap の失敗はその status に、network・internal・worker は failed に', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const expected = {
      unavailable: 'unavailable',
      'no-overlap': 'no-overlap',
      network: 'failed',
      internal: 'failed',
      worker: 'failed',
    } as const
    for (const [reason, status] of Object.entries(expected)) {
      const { calls, app, load, terrainA } = setup()
      app.getState().setFillHistoryEnabled(true)
      load(terrainA, 5)
      calls[0]?.reject(new FillHistoryLoadError(reason as keyof typeof expected, 'x'))
      await tick()
      expect(app.getState().fillHistory.status).toBe(status)
    }
    error.mockRestore()
  })

  it('置き換わった（superseded）依頼の失敗は状態を変えない', async () => {
    const { calls, app, load, terrainA } = setup()
    app.getState().setFillHistoryEnabled(true)
    load(terrainA, 5)
    calls[0]?.reject(new FillHistoryLoadError('superseded', 'x'))
    await tick()
    expect(app.getState().fillHistory.status).toBe('loading')
  })
})
