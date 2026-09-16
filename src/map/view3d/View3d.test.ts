import { describe, expect, it, vi } from 'vitest'
import type { MapController } from '../MapController'
import { DEFAULT_VIEW3D_OPTIONS } from './options'
import { View3d } from './View3d'

/**
 * View3d.afterRender の R1 のガード専用のテスト。実際の MapLibre の Map は使わず、render・moveend・
 * webglcontextlost を捕まえるだけの最小の偽物にする（Terrain3d の生成は addProtocol の登録だけで、
 * map には触れないので、map を偽物にしても View3d のコンストラクタは通る）
 */
function createHarness(): {
  controller: MapController
  render: () => void
  setLoaded: (value: boolean) => void
  getContainer: ReturnType<typeof vi.fn>
} {
  const handlers = new Map<string, () => void>()
  let loaded = true
  const dataset: Record<string, string> = {}
  const getContainer = vi.fn(() => ({ dataset }))
  const map = {
    on: (event: string, handler: () => void) => handlers.set(event, handler),
    off: vi.fn(),
    isMoving: () => false,
    getContainer,
    getZoom: vi.fn(() => 16),
    getPitch: vi.fn(() => 60),
  }
  const controller = {
    map,
    isLoaded: () => loaded,
    whenLoaded: (run: () => void) => run(),
  } as unknown as MapController
  const render = (): void => {
    const handler = handlers.get('render')
    if (handler === undefined) throw new Error('render ハンドラが登録されていません')
    handler()
  }
  return { controller, render, setLoaded: (value: boolean) => (loaded = value), getContainer }
}

describe('View3d.afterRender（R1: スタイルの読み込み中は境界の判定を待つ）', () => {
  it('読み込み中（ベースマップの切り替え・コンテキスト喪失の間）は checkBoundary を呼ばず、保留を残す', () => {
    const { controller, render, setLoaded, getContainer } = createHarness()
    const view = new View3d(controller, {
      options: DEFAULT_VIEW3D_OPTIONS,
      basemap: 'pale',
      exaggeration: 1,
      palette: 'stepped',
      onRendering: () => {},
    })
    const anyView = view as unknown as {
      boundaryCheckPending: boolean
      checkBoundary: (...args: unknown[]) => void
    }
    const checkBoundary = vi.spyOn(anyView, 'checkBoundary').mockImplementation(() => {})
    // moveend を経ず、境界の判定が保留になっている状態を直接作る（setEnabled 経由だと show3d が
    // Terrain3d.show 越しに map.addSource 等へ触れてしまい、この偽物の map では表現できないため）
    anyView.boundaryCheckPending = true

    setLoaded(false)
    render()
    // MapLibre なら checkBoundary の先（Terrain3d.show/hide 経由の setTerrain・addSource）で
    // 「Style is not done loading.」を投げる場面。ガードが先に return するので、それすら起きない
    expect(getContainer).not.toHaveBeenCalled()
    expect(checkBoundary).not.toHaveBeenCalled()
    expect(anyView.boundaryCheckPending).toBe(true)

    // 読み込みが済んだ次の render で、保留していた判定を取り上げる
    setLoaded(true)
    render()
    expect(getContainer).toHaveBeenCalled()
    expect(checkBoundary).toHaveBeenCalledTimes(1)
  })

  it('読み込み中は writeMarks も測定もせず、読み込みが済めば通常どおり動く（保留が無ければ checkBoundary も呼ばない）', () => {
    const { controller, render, setLoaded, getContainer } = createHarness()
    const view = new View3d(controller, {
      options: DEFAULT_VIEW3D_OPTIONS,
      basemap: 'pale',
      exaggeration: 1,
      palette: 'stepped',
      onRendering: () => {},
    })
    const anyView = view as unknown as {
      boundaryCheckPending: boolean
      checkBoundary: (...args: unknown[]) => void
    }
    const checkBoundary = vi.spyOn(anyView, 'checkBoundary').mockImplementation(() => {})

    setLoaded(false)
    render()
    expect(getContainer).not.toHaveBeenCalled()

    setLoaded(true)
    render()
    // 保留（boundaryCheckPending）が立っていなければ、読み込みが済んでも判定はしない
    expect(getContainer).toHaveBeenCalled()
    expect(checkBoundary).not.toHaveBeenCalled()
  })
})

describe('View3d.dispose（横断レビュー m4: コンテキスト喪失の間に外す）', () => {
  it('スタイルが無い（喪失の間）ときは地形を外さず（setTerrain を呼ばず）、スタイルに依らない後始末は済ませる', () => {
    const { controller, setLoaded } = createHarness()
    // MapLibre 6.6.0 は喪失で style.destroy() の後 style = null にするが、map.terrain は残す。そのため
    // getTerrain() は地形を返し、setTerrain(null) は先頭の this.style._checkLoaded() で TypeError を投げる。
    // getLayer・getSource は this.style?. なので undefined を返す（removeLayer・removeSource には進まない）
    const map = controller.map as unknown as Record<string, unknown>
    const setTerrain = vi.fn(() => {
      throw new TypeError("Cannot read properties of null (reading '_checkLoaded')")
    })
    Object.assign(map, {
      getTerrain: () => ({ source: 'terrain-3d-dem', exaggeration: 1 }),
      setTerrain,
      getLayer: () => undefined,
      getSource: () => undefined,
      removeLayer: vi.fn(),
      removeSource: vi.fn(),
      easeTo: vi.fn(),
    })
    const view = new View3d(controller, {
      options: DEFAULT_VIEW3D_OPTIONS,
      basemap: 'pale',
      exaggeration: 1,
      palette: 'stepped',
      onRendering: () => {},
    })
    const internals = view as unknown as {
      rendering: string
      water: { dispose: () => void } | null
      terrain3d: { dispose: () => void }
    }
    internals.rendering = '3d'
    const water = { dispose: vi.fn() }
    internals.water = water
    const terrainDispose = vi.spyOn(internals.terrain3d, 'dispose')

    setLoaded(false)
    expect(() => view.dispose()).not.toThrow()

    expect(setTerrain).not.toHaveBeenCalled()
    // 購読・水面・タイルの生成（Terrain3d.dispose）はスタイルに依らず手放す
    expect(map.off).toHaveBeenCalledWith('render', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('moveend', expect.any(Function))
    expect(map.off).toHaveBeenCalledWith('webglcontextlost', expect.any(Function))
    expect(water.dispose).toHaveBeenCalledTimes(1)
    expect(internals.water).toBeNull()
    expect(terrainDispose).toHaveBeenCalledTimes(1)
  })
})
