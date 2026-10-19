import { describe, expect, it, vi } from 'vitest'
import {
  CollapseError,
  type CollapseRequest,
  CompareError,
  type CompareProgress,
  type SimulationClient,
} from '../bridge/SimulationClient'
import type {
  CollapsePayload,
  CompareSide,
  DammedSiteSummary,
  FillHistoryPayload,
  TerrainPayload,
} from '../shared/protocol'
import { createAppStore } from '../state/appStore'
import { memoryStorage } from '../state/memoryStorage.test-support'
import { createSettingsStore } from '../state/settingsStore'
import { CollapseSession, compareSummary } from './collapseSession'
import type { FillHistorySession } from './fillHistorySession'
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

const tick = () => new Promise((r) => setTimeout(r, 0))

const CENTER = { lon: 139.7, lat: 35.6 }
const geo = { size: 2, cellSizeM: 2, originX: 0, originY: 0, z: 17 } as TerrainPayload['geo']
const base = {
  id: 'base',
  geo,
  elevation: Float32Array.of(10, 10, 10, 10),
  validMask: Uint8Array.of(1, 1, 1, 1),
  labels: new Int32Array(4),
} as unknown as TerrainPayload
const after = {
  id: 'after',
  geo,
  elevation: Float32Array.of(10, 11, 10, 10),
  validMask: Uint8Array.of(1, 1, 1, 1),
  labels: Int32Array.of(0, 0, 7, 7),
} as unknown as TerrainPayload
const dam: DammedSiteSummary = {
  depressionId: 7,
  capacityM3: 12,
  addedCapacityM3: 10,
  maxDepthM: 0.6,
  areaM2: 8,
  spillElevation: 10.6,
  spill: { lon: 139.7, lat: 35.6 },
}
const fill = {
  terrainId: 5,
  deltaCorrected: Float32Array.of(2, -1, 3, 0),
  candidateLabels: Int32Array.of(4, 4, 9, 0),
} as unknown as FillHistoryPayload

const payload = (terrainId = 5): CollapsePayload => ({
  terrainId,
  candidateId: 4,
  ratio: 1,
  presetId: 'near',
  after,
  removed: new Float32Array(4),
  deposit: new Float32Array(4),
  collapsedM3: 8,
  depositedM3: 7,
  outsideM3: 1,
  dams: [dam],
  before: null,
  culvert: null,
})

const side = (depth: number[], maxDepth: number): CompareSide =>
  ({
    depth: Float32Array.from(depth),
    stats: { maxDepth, floodedArea: 4, storedWater: 3, outflowWater: 2, step: 9 },
  }) as unknown as CompareSide

function setup() {
  const collapses: Array<ReturnType<typeof deferred<CollapsePayload>>> = []
  const collapseProgress: Array<(f: number) => void> = []
  const compares: Array<ReturnType<typeof deferred<{ before: CompareSide; after: CompareSide }>>> =
    []
  const compareProgress: Array<(p: CompareProgress) => void> = []
  const swaps: Array<ReturnType<typeof deferred<void>>> = []
  const client = {
    baseTerrainId: null as number | null,
    terrain: null as TerrainPayload | null,
    collapse: vi.fn((_req: CollapseRequest, onProgress?: (f: number) => void) => {
      const d = deferred<CollapsePayload>()
      collapses.push(d)
      if (onProgress !== undefined) collapseProgress.push(onProgress)
      return d.promise
    }),
    swapTerrain: vi.fn((terrain: TerrainPayload) => {
      const d = deferred<void>()
      swaps.push(d)
      return d.promise.then(() => {
        client.terrain = terrain
      })
    }),
    compareCollapse: vi.fn(
      (
        _b: TerrainPayload,
        _a: TerrainPayload,
        _rain: unknown,
        onProgress: (p: CompareProgress) => void,
      ) => {
        const d = deferred<{ before: CompareSide; after: CompareSide }>()
        compares.push(d)
        compareProgress.push(onProgress)
        return d.promise
      },
    ),
    cancelCompare: vi.fn(() => {
      compares.at(-1)?.reject(new CompareError('cancelled', 'x'))
    }),
    onCrash: (l: () => void) => {
      crashListeners.push(l)
      return () => {}
    },
  }
  const crashListeners: Array<() => void> = []
  type Listener = (t: TerrainPayload | null, info: { variant: boolean }) => void
  const terrainListeners: Listener[] = []
  const simulation = {
    onTerrain: (l: Listener) => {
      terrainListeners.push(l)
      return () => {}
    },
    terrainReady: vi.fn(),
  }
  let fillResult: FillHistoryPayload | null = fill
  const fillHistory = { result: () => fillResult }
  const app = createAppStore()
  const settings = createSettingsStore(memoryStorage())
  const session = new CollapseSession(
    client as unknown as SimulationClient,
    app,
    simulation as unknown as SimulationSession,
    fillHistory as unknown as FillHistorySession,
    settings,
  )
  const container = { dataset: {} as DOMStringMap }
  const showTerrain = vi.fn()
  session.attachMap({ container: container as unknown as HTMLElement, showTerrain })

  /** 地点を選んで読み込んだ（TerrainSession.select → load と同じ順） */
  const load = (id = 5) => {
    app.getState().selectPoint(CENTER.lon, CENTER.lat)
    for (const l of terrainListeners) l(null, { variant: false })
    client.baseTerrainId = id
    client.terrain = base
    for (const l of terrainListeners) l(base, { variant: false })
    app.getState().setFillHistoryEnabled(true)
    app.getState().setFillHistoryResult('ready', {
      offsetM: 0,
      candidates: [],
      a54Available: true,
      landformAvailable: false,
    })
  }
  /** 候補 4 を開いて計算し、結果まで進める。ready の直後に崩れた後への差し替えが始まる（返事は呼び出し側が返す） */
  const computeOnly = () => {
    load()
    app.getState().selectFillCandidate(4)
    app.getState().openCollapse(4)
    const done = session.compute()
    collapses.at(-1)?.resolve(payload())
    return done
  }
  /** 計算して、自動の差し替え（崩れた後）が済むまで進める */
  const ready = async () => {
    const before = swaps.length
    const done = computeOnly()
    await vi.waitFor(() => expect(swaps.length).toBe(before + 1))
    swaps.at(-1)?.resolve()
    await done
  }
  /** 崩れた後を表示する（差し替えの返事まで進める） */
  const showAfter = async () => {
    if (app.getState().collapse.view === 'after') return
    const done = session.setView('after')
    swaps.at(-1)?.resolve()
    await done
  }
  return {
    client,
    crash: () => {
      for (const l of crashListeners) l()
    },
    simulation,
    app,
    settings,
    session,
    collapses,
    collapseProgress,
    compares,
    compareProgress,
    swaps,
    container,
    showTerrain,
    load,
    ready,
    computeOnly,
    showAfter,
    setFill: (r: FillHistoryPayload | null) => {
      fillResult = r
    },
  }
}

describe('CollapseSession', () => {
  it('openCollapse → compute で computing → ready、summary に体積と dams', async () => {
    const { client, app, session, collapses, collapseProgress, swaps, container, load } = setup()
    load()
    app.getState().selectFillCandidate(4)
    app.getState().openCollapse(4)
    expect(app.getState().collapse).toMatchObject({
      candidateId: 4,
      ratio: 1,
      status: 'idle',
      view: 'before',
    })
    app.getState().setCollapseRatio(0.5)
    const done = session.compute()
    expect(app.getState().collapse.status).toBe('computing')
    const request = client.collapse.mock.calls[0]?.[0]
    expect(request).toMatchObject({ terrainId: 5, terrain: base, candidateId: 4, ratio: 0.5 })
    // 候補 4 のセルだけ、割合 × max(0, ΔZ)
    expect(Array.from(request?.removed ?? [])).toEqual([1, 0, 0, 0])
    collapseProgress[0]?.(0.3)
    expect(app.getState().collapse.progress).toBe(0.3)
    collapses[0]?.resolve({ ...payload(), ratio: 0.5 })
    // ready になると、崩れた後へ自動で切り替える（spec 10 §1.3 手順 3）
    await vi.waitFor(() => expect(swaps).toHaveLength(1))
    expect(client.swapTerrain).toHaveBeenLastCalledWith(after)
    swaps[0]?.resolve()
    await done
    expect(container.dataset.collapseView).toBe('after')
    expect(session.result()?.after).toBe(after)
    expect(app.getState().collapse).toMatchObject({
      status: 'ready',
      view: 'after',
      summary: {
        candidateId: 4,
        ratio: 0.5,
        collapsedM3: 8,
        depositedM3: 7,
        outsideM3: 1,
        dams: [dam],
      },
    })
  })

  it('結果の terrainId が今の基の地形でなければ捨てる', async () => {
    const { client, app, session, collapses, load } = setup()
    load()
    app.getState().openCollapse(4)
    const done = session.compute()
    client.baseTerrainId = 6
    collapses[0]?.resolve(payload(5))
    await done
    expect(session.result()).toBeNull()
    expect(app.getState().collapse.status).not.toBe('ready')
  })

  it('計算の失敗は failed。置き換わった失敗は状態を変えない', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, session, collapses, load } = setup()
    load()
    app.getState().openCollapse(4)
    let done = session.compute()
    collapses[0]?.reject(new CollapseError('internal', 'x'))
    await done
    expect(app.getState().collapse.status).toBe('failed')
    // 失敗の後はやり直せる
    done = session.compute()
    expect(app.getState().collapse.status).toBe('computing')
    collapses[1]?.reject(new CollapseError('superseded', 'x'))
    await done
    expect(app.getState().collapse.status).toBe('computing')
    error.mockRestore()
  })

  it('計算中に別の地点を選ぶと、結果を捨てて閉じる（Review Focus 1）', async () => {
    const { client, app, session, collapses, load } = setup()
    load()
    app.getState().openCollapse(4)
    const done = session.compute()
    load(8)
    collapses[0]?.resolve(payload(5))
    await done
    expect(session.result()).toBeNull()
    expect(app.getState().collapse).toMatchObject({ candidateId: null, status: 'idle' })
    // 地点の変更では差し替えない（新しい地形の読み込みが勝つ）
    expect(client.swapTerrain).not.toHaveBeenCalled()
  })

  it('崩れた後を表示中に別の地点を選ぶと、差し替えずに閉じ、data-collapse-view は before', async () => {
    const { client, app, session, container, ready, showAfter, load } = setup()
    await ready()
    await showAfter()
    expect(container.dataset.collapseView).toBe('after')
    load(8)
    expect(client.swapTerrain).toHaveBeenCalledTimes(1)
    expect(session.result()).toBeNull()
    expect(app.getState().collapse.view).toBe('before')
    expect(container.dataset.collapseView).toBe('before')
  })

  it('setView(after) は差し替え → variant の terrainReady → 地図を動かさずに描き直す。before で基に戻す', async () => {
    const { client, simulation, app, session, swaps, container, showTerrain, ready } = setup()
    await ready()
    const toBefore = session.setView('before')
    swaps.at(-1)?.resolve()
    await toBefore
    app.getState().setTerrainEpoch('past')
    expect(container.dataset.collapseView).toBe('before')
    const done = session.setView('after')
    expect(client.swapTerrain).toHaveBeenLastCalledWith(after)
    // 差し替えの途中は swapping（Task 10 が再生と比べる操作を止める。Task 6 のレビュー M1）
    expect(app.getState().collapse.swapping).toBe(true)
    expect(app.getState().collapse.view).toBe('before')
    swaps.at(-1)?.resolve()
    await done
    expect(simulation.terrainReady).toHaveBeenLastCalledWith(after, CENTER, { variant: true })
    expect(showTerrain).toHaveBeenLastCalledWith(after)
    expect(app.getState().collapse).toMatchObject({ view: 'after', swapping: false })
    expect(app.getState().terrainEpoch).toBe('now')
    expect(container.dataset.collapseView).toBe('after')

    const back = session.setView('before')
    expect(client.swapTerrain).toHaveBeenLastCalledWith(base)
    swaps.at(-1)?.resolve()
    await back
    expect(simulation.terrainReady).toHaveBeenLastCalledWith(base, CENTER, { variant: true })
    expect(showTerrain).toHaveBeenLastCalledWith(base)
    expect(app.getState().collapse.view).toBe('before')
    expect(container.dataset.collapseView).toBe('before')
  })

  it('基の地形は最後の variant でない地形。差し替えの後の client.terrain は使わない（ruling R8）', async () => {
    const { client, ready, showAfter, session } = setup()
    await ready()
    await showAfter()
    expect(client.terrain).toBe(after)
    void session.setView('before')
    expect(client.swapTerrain).toHaveBeenLastCalledWith(base)
  })

  it('崩れた後を表示中に盛土の履歴を切ると、基の地形に戻す（swapTerrain が基の地形で呼ばれる）', async () => {
    const { client, simulation, app, session, swaps, container, ready, showAfter } = setup()
    await ready()
    await showAfter()
    app.getState().setFillHistoryEnabled(false)
    expect(session.result()).toBeNull()
    expect(app.getState().collapse).toMatchObject({ candidateId: null, view: 'before' })
    expect(client.swapTerrain).toHaveBeenLastCalledWith(base)
    expect(app.getState().collapse.swapping).toBe(true)
    swaps.at(-1)?.resolve()
    await tick()
    expect(simulation.terrainReady).toHaveBeenLastCalledWith(base, CENTER, { variant: true })
    expect(app.getState().collapse.swapping).toBe(false)
    expect(container.dataset.collapseView).toBe('before')
  })

  it('崩れた後を表示中に別の候補を選ぶと、基の地形に戻す', async () => {
    const { client, app, ready, showAfter } = setup()
    await ready()
    await showAfter()
    app.getState().selectFillCandidate(9)
    expect(app.getState().collapse.candidateId).toBeNull()
    expect(client.swapTerrain).toHaveBeenLastCalledWith(base)
  })

  it('崩れた後への差し替えの途中で閉じたら、崩れた後にしない', async () => {
    const { client, simulation, app, swaps, container, computeOnly } = setup()
    // ready 直後の自動の差し替えの途中で閉じる
    const done = computeOnly()
    await vi.waitFor(() => expect(swaps).toHaveLength(1))
    app.getState().closeCollapse()
    swaps[0]?.resolve()
    await done
    expect(simulation.terrainReady).not.toHaveBeenCalledWith(after, CENTER, { variant: true })
    // 差し替えた後の地形が基に戻るよう、基の地形でも差し替える
    expect(client.swapTerrain).toHaveBeenLastCalledWith(base)
    swaps[1]?.resolve()
    await tick()
    expect(app.getState().collapse.view).toBe('before')
    expect(container.dataset.collapseView).toBe('before')
  })

  it('ready になる前に閉じたら、崩れた後へ切り替えない', async () => {
    const { client, app, session, collapses, load } = setup()
    load()
    app.getState().selectFillCandidate(4)
    app.getState().openCollapse(4)
    const done = session.compute()
    app.getState().closeCollapse()
    collapses[0]?.resolve(payload())
    await done
    expect(client.swapTerrain).not.toHaveBeenCalled()
    expect(app.getState().collapse.view).toBe('before')
  })

  it('setCollapseRatio で結果を捨てて idle に戻り、view も before に戻す', async () => {
    const { client, app, session, ready, showAfter } = setup()
    await ready()
    await showAfter()
    app.getState().setCollapseRatio(0.25)
    expect(session.result()).toBeNull()
    expect(app.getState().collapse).toMatchObject({
      candidateId: 4,
      ratio: 0.25,
      status: 'idle',
      summary: null,
      view: 'before',
    })
    expect(client.swapTerrain).toHaveBeenLastCalledWith(base)
  })

  it('setCollapsePreset でも結果を捨てる。計算中の応答も捨てる', async () => {
    const { app, session, collapses, load } = setup()
    load()
    app.getState().openCollapse(4)
    const done = session.compute()
    app.getState().setCollapsePreset('far')
    collapses[0]?.resolve(payload())
    await done
    expect(session.result()).toBeNull()
    expect(app.getState().collapse).toMatchObject({ presetId: 'far', status: 'idle' })
  })

  it('compare は基の地形・崩れた後・今の雨の設定で比べ、done と summary を入れる', async () => {
    const { client, app, session, compares, compareProgress, settings, ready } = setup()
    await ready()
    settings.getState().setRainfall({
      intensityMmPerH: 50,
      durationMin: 60,
      radiusM: 100,
      wholeRange: true,
    })
    const done = session.compare()
    const call = client.compareCollapse.mock.calls[0]
    expect(call?.[0]).toBe(base)
    expect(call?.[1]).toBe(after)
    expect(call?.[2]).toMatchObject({ intensityMmPerH: 50, durationS: 3600, wholeRange: true })
    expect(app.getState().collapse.compare).toMatchObject({ status: 'running', side: 'before' })
    // 崩れる前の残り 10 秒で 半分 → 崩れる前の全体は 20 秒。崩れた後も同じだけと見て足す
    compareProgress[0]?.({ side: 'before', fraction: 0.5, remainingS: 10 })
    expect(app.getState().collapse.compare).toMatchObject({
      side: 'before',
      progress: 0.5,
      remainingS: 30,
    })
    compareProgress[0]?.({ side: 'after', fraction: 0.25, remainingS: 15 })
    expect(app.getState().collapse.compare).toMatchObject({
      side: 'after',
      progress: 0.25,
      remainingS: 15,
    })
    const result = { before: side([0, 0, 0, 0.5], 0.5), after: side([0, 0, 0.3, 0.8], 0.8) }
    compares[0]?.resolve(result)
    await done
    expect(session.compareResult()).toBe(result)
    expect(app.getState().collapse.compare).toMatchObject({
      status: 'done',
      side: null,
      summary: { damMaxDepthM: expect.closeTo(0.8), newWaterAreaM2: 4 },
      // 比べたときの雨の設定と範囲の大きさ（比べ直しの知らせに使う）
      settings: {
        intensityMmPerH: 50,
        durationMin: 60,
        radiusM: 100,
        wholeRange: true,
        sizeM: settings.getState().area.sizeM,
      },
    })
  })

  it('compare の途中で cancelCompare → compare.status は idle、summary は null', async () => {
    const { client, app, session, ready } = setup()
    await ready()
    const done = session.compare()
    session.cancelCompare()
    await done
    expect(client.cancelCompare).toHaveBeenCalled()
    expect(app.getState().collapse.compare).toMatchObject({ status: 'idle', summary: null })
    expect(session.compareResult()).toBeNull()
  })

  it('比べる計算の途中で閉じると、取り消す', async () => {
    const { client, app, session, ready } = setup()
    await ready()
    const done = session.compare()
    app.getState().closeCollapse()
    await done
    expect(client.cancelCompare).toHaveBeenCalled()
    expect(app.getState().collapse.compare.status).toBe('idle')
  })

  it('崩れた後を表示中に Worker が異常終了したら、差し替えずに閉じ、before に戻す', async () => {
    const { client, app, session, swaps, container, showTerrain, ready, crash } = setup()
    await ready()
    expect(app.getState().collapse.view).toBe('after')
    const swapsBefore = swaps.length
    crash()
    await Promise.resolve()
    expect(app.getState().collapse).toMatchObject({
      candidateId: null,
      status: 'idle',
      view: 'before',
      swapping: false,
    })
    expect(container.dataset.collapseView).toBe('before')
    // 新しい Worker には地形が無いので、差し替えは頼まない。地図は基の地形で描き直す
    expect(swaps).toHaveLength(swapsBefore)
    expect(client.swapTerrain).toHaveBeenCalledTimes(swapsBefore)
    expect(showTerrain).toHaveBeenLastCalledWith(base)
    expect(session.result()).toBeNull()
  })

  it('崩れた後への差し替えの途中で異常終了したら、差し替えの返事を待たずに before に戻す', async () => {
    const { app, swaps, container, computeOnly, crash } = setup()
    const done = computeOnly()
    await vi.waitFor(() => expect(swaps).toHaveLength(1))
    expect(app.getState().collapse.swapping).toBe(true)
    crash()
    expect(app.getState().collapse).toMatchObject({ view: 'before', swapping: false })
    // 異常終了で差し替えの依頼は失敗する
    swaps[0]?.reject(new Error('worker'))
    await done
    expect(app.getState().collapse.view).toBe('before')
    expect(container.dataset.collapseView).toBe('before')
  })

  it('比べる計算の失敗は failed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { app, session, compares, ready } = setup()
    await ready()
    const done = session.compare()
    compares[0]?.reject(new CompareError('internal', 'x'))
    await done
    expect(app.getState().collapse.compare.status).toBe('failed')
    error.mockRestore()
  })

  it('onChange は結果ができた・消えたこと、比べた結果ができたことを知らせる', async () => {
    const { app, session, compares, ready } = setup()
    const seen = vi.fn()
    session.onChange(seen)
    await ready()
    expect(seen).toHaveBeenCalledTimes(1)
    const done = session.compare()
    compares[0]?.resolve({ before: side([0, 0, 0, 0], 0), after: side([0, 0, 0, 0], 0) })
    await done
    expect(seen).toHaveBeenCalledTimes(2)
    app.getState().closeCollapse()
    expect(seen).toHaveBeenCalledTimes(3)
    expect(session.result()).toBeNull()
  })
})

describe('compareSummary', () => {
  it('CompareSummary: newWaterAreaM2 と damMaxDepthM を深さの配列から正しく出す', () => {
    // セルの面積は 2 m × 2 m = 4 m²。新しく 1 cm 以上になったのはセル 1 と 2（セル 3 は前から 1 cm 以上）
    const before = side([0, 0.005, 0, 0.02], 0.02)
    const afterSide = side([0, 0.01, 0.4, 0.9], 0.9)
    const summary = compareSummary({ before, after: afterSide }, after, [dam])
    expect(summary.newWaterAreaM2).toBe(8)
    // せき止められた場所（labels が 7 のセル 2・3）の崩れた後の水深の最大
    expect(summary.damMaxDepthM).toBeCloseTo(0.9)
    expect(summary.before).toEqual({
      maxDepth: 0.02,
      floodedArea: 4,
      storedWater: 3,
      outflowWater: 2,
    })
    expect(summary.after.maxDepth).toBe(0.9)
  })

  it('せき止められた場所が無ければ damMaxDepthM は null', () => {
    const s = side([0, 0, 0, 0], 0)
    expect(compareSummary({ before: s, after: s }, after, []).damMaxDepthM).toBeNull()
  })
})
