// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollapsePayload, TerrainGeo } from '../shared/protocol'
import { CollapseOverlay } from './CollapseOverlay'
import { COLLAPSE_LAYER_IDS } from './layerIds'

class FakeImageData {
  data: Uint8ClampedArray
  constructor(data: Uint8ClampedArray) {
    this.data = data
  }
}

function fakeMap() {
  const layers: string[] = []
  const sources = new Map<string, unknown>()
  const map = {
    addSource: (id: string, source: unknown) => sources.set(id, source),
    removeSource: (id: string) => sources.delete(id),
    getSource: (id: string) => sources.get(id),
    addLayer: (layer: { id: string }) => layers.push(layer.id),
    removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
  } as unknown as MapLibreMap
  return { map, layers, sources }
}

const GEO = {
  size: 2,
  corners: [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
} as unknown as TerrainGeo

const RESULT = {
  after: { labels: Int32Array.of(5, 0, 0, 0) },
  removed: Float32Array.of(0, 0, 1, 0),
  deposit: Float32Array.of(0, 1, 0, 0),
  dams: [{ depressionId: 5, spill: { lon: 0.5, lat: 0.5 } }],
} as unknown as CollapsePayload

const IDS = Object.values(COLLAPSE_LAYER_IDS)

describe('CollapseOverlay（spec 10 §5.4）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function setup() {
    vi.stubGlobal('ImageData', FakeImageData)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => ({ putImageData: vi.fn() }) as unknown as CanvasRenderingContext2D,
    )
    const fake = fakeMap()
    return { fake, overlay: new CollapseOverlay(fake.map, (run) => run()) }
  }

  it('restore で 3 つのレイヤーを足し直す（ベースマップの切り替え）', () => {
    const { fake, overlay } = setup()
    overlay.show(RESULT, GEO)
    overlay.showCompare(Float32Array.of(0, 0, 0, 0), Float32Array.of(1, 0, 0, 0), GEO)
    for (const id of IDS) expect(fake.layers).toContain(id)
    fake.layers.length = 0
    fake.sources.clear()
    overlay.restore()
    for (const id of IDS) expect(fake.layers).toContain(id)
    overlay.restore()
    expect(fake.layers.filter((id) => id === COLLAPSE_LAYER_IDS.deposit)).toHaveLength(1)
  })

  it('比べる前は新しい水のレイヤーが無い。clearCompare で消える', () => {
    const { fake, overlay } = setup()
    overlay.show(RESULT, GEO)
    expect(fake.layers).not.toContain(COLLAPSE_LAYER_IDS.newWater)
    overlay.showCompare(Float32Array.of(0, 0, 0, 0), Float32Array.of(1, 0, 0, 0), GEO)
    overlay.clearCompare()
    expect(fake.layers).not.toContain(COLLAPSE_LAYER_IDS.newWater)
    expect(fake.layers).toContain(COLLAPSE_LAYER_IDS.dams)
  })

  it('clear で全部外し、restore しても戻らない', () => {
    const { fake, overlay } = setup()
    overlay.show(RESULT, GEO)
    overlay.clear()
    overlay.restore()
    expect(fake.layers).toEqual([])
    expect(fake.sources.size).toBe(0)
  })

  it('地図の読み込みを待つ間に clear されたら、描かない', () => {
    vi.stubGlobal('ImageData', FakeImageData)
    const fake = fakeMap()
    let pending: (() => void) | null = null
    const overlay = new CollapseOverlay(fake.map, (run) => {
      pending = run
    })
    overlay.show(RESULT, GEO)
    overlay.clear()
    ;(pending as (() => void) | null)?.()
    expect(fake.layers).toEqual([])
  })
})
