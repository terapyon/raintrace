import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeWorker } from '../bridge/fakeWorker.test-support'
import { SimulationClient } from '../bridge/SimulationClient'
import type { MapController } from '../map/MapController'
import type { View3dInit } from '../map/view3d/View3d'
import type { TerrainPayload } from '../shared/protocol'
import { createAppStore } from '../state/appStore'
import { memoryStorage } from '../state/memoryStorage.test-support'
import { createSettingsStore } from '../state/settingsStore'
import { createSimulationStore } from '../state/simulationStore'
import { SimulationSession } from './simulationSession'
import { type View3dFactory, type View3dLike, View3dSession } from './view3dSession'

afterEach(() => {
  vi.restoreAllMocks()
})

const CENTER = { lon: 139.7016, lat: 35.658 }
const terrain = { geo: { size: 4 } } as unknown as TerrainPayload
/** Promise の続き（then・finally の連なり）を確実に流し終えるため、1 回マクロタスクを待つ */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function fakeView() {
  return {
    setTerrain: vi.fn(),
    setEnabled: vi.fn(),
    setExaggeration: vi.fn(),
    setBasemap: vi.fn(),
    setWater: vi.fn(),
    setPalette: vi.fn(),
    restore: vi.fn(),
    dispose: vi.fn(),
  } satisfies View3dLike
}

function setup(load?: () => Promise<View3dFactory>) {
  const client = new SimulationClient(() => new FakeWorker())
  const settings = createSettingsStore(memoryStorage())
  const simulation = new SimulationSession(client, createSimulationStore(), settings)
  const app = createAppStore()
  const view = fakeView()
  const inits: View3dInit[] = []
  const loader =
    load ??
    vi.fn(
      async (): Promise<View3dFactory> => (_controller, init) => {
        inits.push(init)
        return view
      },
    )
  const session = new View3dSession(simulation, app, settings, loader)
  const restyle: (() => void)[] = []
  const controller = {
    onRestyle: (listener: () => void) => {
      restyle.push(listener)
      return () => {}
    },
  } as unknown as MapController
  const detach = session.attach(controller)
  return { settings, simulation, app, view, inits, loader, restyle, detach }
}

describe('View3dSession（3D の遅延読み込みとつなぎ。spec 05 §3.6・§3.8）', () => {
  it('3D に切り替えると 3D のコードを 1 回だけ読み込み、有効にする。2D に戻すと無効にする', async () => {
    const { app, view, loader } = setup()
    app.getState().setViewMode('3d')
    expect(app.getState().view3dStatus).toBe('loading')
    await vi.waitFor(() => expect(view.setEnabled).toHaveBeenCalledWith(true))
    app.getState().setViewMode('2d')
    expect(view.setEnabled).toHaveBeenLastCalledWith(false)
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(view.setEnabled).toHaveBeenLastCalledWith(true))
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('View3d が知らせる描き方を 3D の状態にし、3D で描いている間だけ 2D の水深の canvas を隠す', async () => {
    const { simulation, app, inits } = setup()
    const canvas = vi.spyOn(simulation, 'setDepthCanvasVisible')
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(inits).toHaveLength(1))
    inits[0]?.onRendering('3d')
    expect(app.getState().view3dStatus).toBe('3d')
    expect(canvas).toHaveBeenLastCalledWith(false)
    inits[0]?.onRendering('fallback-2d')
    expect(app.getState().view3dStatus).toBe('fallback-2d')
    expect(canvas).toHaveBeenLastCalledWith(true)
  })

  it('作る前に読み込んだ地形を作るときに渡し、その後の変化も渡す', async () => {
    const { simulation, app, view } = setup()
    simulation.terrainReady(terrain, CENTER)
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(view.setTerrain).toHaveBeenCalledWith(terrain))
    simulation.terrainCleared()
    expect(view.setTerrain).toHaveBeenLastCalledWith(null)
  })

  it('境界より粗くて 2D に落ちている間（fallback-2d）に選び直した地形も渡す（View3d が 3D に戻して視点を合わせる）', async () => {
    const { simulation, app, view, inits } = setup()
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(inits).toHaveLength(1))
    inits[0]?.onRendering('fallback-2d')
    simulation.terrainReady(terrain, CENTER)
    expect(view.setTerrain).toHaveBeenLastCalledWith(terrain)
  })

  it('垂直強調とベースマップ: 作るときに今の値を渡し、変化も渡す（§3.2 の 1 つの値）', async () => {
    const { settings, app, view, inits } = setup()
    settings.getState().setDisplay({ verticalExaggeration: 5 })
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(inits).toHaveLength(1))
    expect(inits[0]).toMatchObject({ exaggeration: 5, basemap: 'pale' })
    settings.getState().setDisplay({ verticalExaggeration: 10 })
    expect(view.setExaggeration).toHaveBeenLastCalledWith(10)
    settings.getState().setMap({ basemap: 'photo' })
    expect(view.setBasemap).toHaveBeenLastCalledWith('photo')
  })

  it('読み込みの最中に 2D に戻したら有効にせず、状態は off', async () => {
    const view = fakeView()
    let finish: (factory: View3dFactory) => void = () => {}
    const load = vi.fn(
      () =>
        new Promise<View3dFactory>((resolve) => {
          finish = resolve
        }),
    )
    const { app } = setup(load)
    app.getState().setViewMode('3d')
    app.getState().setViewMode('2d')
    expect(app.getState().view3dStatus).toBe('off')
    finish(() => view)
    await flush()
    expect(load).toHaveBeenCalledTimes(1)
    expect(view.setEnabled).not.toHaveBeenCalledWith(true)
  })

  it('読み込みに失敗したら状態は error。もう一度 3D にすると読み込み直す', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi.fn(() => Promise.reject(new Error('chunk')))
    const { app } = setup(load)
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(app.getState().view3dStatus).toBe('error'))
    expect(error).toHaveBeenCalled()
    app.getState().setViewMode('2d')
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })

  it('onRestyle（ベースマップの切り替え・コンテキストの復帰）で restore を呼ぶ', async () => {
    const { app, view, restyle } = setup()
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(view.setEnabled).toHaveBeenCalledWith(true))
    for (const listener of restyle) listener()
    expect(view.restore).toHaveBeenCalledTimes(1)
  })

  it('3D の間に外すと View3d を破棄し、2D の水深の canvas を戻す（StrictMode は付け外しを 2 回行う）', async () => {
    const { simulation, app, view, inits, detach } = setup()
    const canvas = vi.spyOn(simulation, 'setDepthCanvasVisible')
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(inits).toHaveLength(1))
    inits[0]?.onRendering('3d')
    detach()
    expect(view.dispose).toHaveBeenCalledTimes(1)
    expect(canvas).toHaveBeenLastCalledWith(true)
  })

  it('3D のコードを読み込んでいる最中に外すと、setEnabled も dispose も呼ばれず、状態は変わらない（Task 4 の申し送りの反映）', async () => {
    const view = fakeView()
    let finish: (factory: View3dFactory) => void = () => {}
    const load = vi.fn(
      () =>
        new Promise<View3dFactory>((resolve) => {
          finish = resolve
        }),
    )
    const { app, detach } = setup(load)
    app.getState().setViewMode('3d')
    expect(app.getState().view3dStatus).toBe('loading')
    detach()
    expect(app.getState().view3dStatus).toBe('loading')
    finish(() => view)
    await flush()
    expect(view.setEnabled).not.toHaveBeenCalled()
    expect(view.dispose).not.toHaveBeenCalled()
  })

  it(
    '読み込みの最中に外して付け直すと、後の attach が作り、先の読み込みの結果は捨てる' +
      '（Task 4 の申し送りの反映）',
    async () => {
      const finishers: ((factory: View3dFactory) => void)[] = []
      const load = vi.fn(
        () =>
          new Promise<View3dFactory>((resolve) => {
            finishers.push(resolve)
          }),
      )
      const client = new SimulationClient(() => new FakeWorker())
      const settings = createSettingsStore(memoryStorage())
      const simulation = new SimulationSession(client, createSimulationStore(), settings)
      const app = createAppStore()
      const session = new View3dSession(simulation, app, settings, load)
      const controllerA = { onRestyle: () => () => {} } as unknown as MapController
      const controllerB = { onRestyle: () => () => {} } as unknown as MapController
      const detachA = session.attach(controllerA)
      app.getState().setViewMode('3d')
      expect(load).toHaveBeenCalledTimes(1)
      detachA()
      session.attach(controllerB)
      expect(load).toHaveBeenCalledTimes(2)

      const viewA = fakeView()
      const viewB = fakeView()
      const created: View3dLike[] = []
      finishers[0]?.((_controller, _init) => {
        created.push(viewA)
        return viewA
      })
      finishers[1]?.((_controller, _init) => {
        created.push(viewB)
        return viewB
      })
      await flush()

      // 先の読み込み（controllerA 向け）は、届いたときには controller が入れ替わっているので
      // create() が呼ばれない（View3dLike が作られない）。後の attach（controllerB）だけが作る
      expect(created).toEqual([viewB])
      expect(viewA.setEnabled).not.toHaveBeenCalled()
      expect(viewB.setEnabled).toHaveBeenCalledWith(true)
    },
  )

  it('水深と配色を渡す（作るときに今の値、その後の変化）', async () => {
    const { simulation, settings, app, view, inits } = setup()
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(inits).toHaveLength(1))
    expect(inits[0]?.palette).toBe('stepped')
    expect(view.setWater).toHaveBeenCalledWith(null)
    settings.getState().setDisplay({ waterDepthPalette: 'continuous' })
    expect(view.setPalette).toHaveBeenLastCalledWith('continuous')
    simulation.terrainCleared()
    expect(view.setWater).toHaveBeenLastCalledWith(null)
  })
})
