// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollapsePayload, TerrainGeo } from '../shared/protocol'
import { CollapseOverlay } from './CollapseOverlay'
import { COLLAPSE_LAYER_IDS } from './layerIds'
import { COLLAPSE_CULVERT_BLOCKED_COLOR, COLLAPSE_CULVERT_OPEN_COLOR } from './overlayColors'

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
  culvert: null,
} as unknown as CollapsePayload

const OPTS = { markerCount: Number.POSITIVE_INFINITY, view: 'after' } as const
const CULVERT = {
  line: [
    [0, 0],
    [1, 1],
  ],
  lengthM: 100,
  blocked: false,
}
const WITH_CULVERT = { ...RESULT, culvert: CULVERT } as unknown as CollapsePayload
const BLOCKED = {
  ...RESULT,
  culvert: { ...CULVERT, blocked: true },
} as unknown as CollapsePayload
const IDS = [COLLAPSE_LAYER_IDS.deposit, COLLAPSE_LAYER_IDS.dams]

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

  /** addLayer に渡された定義も控えて返す */
  function setupCapturing() {
    const { fake, overlay: _ } = setup()
    const added: Array<{ id: string; paint: Record<string, unknown> }> = []
    const base = fake.map.addLayer.bind(fake.map)
    fake.map.addLayer = ((layer: { id: string; paint: Record<string, unknown> }) => {
      added.push(layer)
      return base(layer as never)
    }) as never
    return { fake, added, overlay: new CollapseOverlay(fake.map, (run) => run()) }
  }

  it('restore で 2 つのレイヤーを足し直す（ベースマップの切り替え）', () => {
    const { fake, overlay } = setup()
    overlay.show(RESULT, GEO, OPTS)
    for (const id of IDS) expect(fake.layers).toContain(id)
    expect(fake.sources.get(COLLAPSE_LAYER_IDS.dams)).toMatchObject({
      data: { features: [{ geometry: { coordinates: [0.5, 0.5] } }] },
    })
    fake.layers.length = 0
    fake.sources.clear()
    overlay.restore()
    for (const id of IDS) expect(fake.layers).toContain(id)
    overlay.restore()
    expect(fake.layers.filter((id) => id === COLLAPSE_LAYER_IDS.deposit)).toHaveLength(1)
  })

  it('あふれ出し点の印は上位 5 か所だけ（輪郭は全部）', () => {
    const { fake, overlay } = setup()
    const many = {
      ...RESULT,
      dams: Array.from({ length: 8 }, (_, i) => ({
        depressionId: i + 1,
        spill: { lon: i, lat: 0 },
      })),
    } as unknown as CollapsePayload
    overlay.show(many, GEO, { markerCount: 5, view: 'after' })
    const data = (fake.sources.get(COLLAPSE_LAYER_IDS.dams) as { data: { features: unknown[] } })
      .data
    expect(data.features).toHaveLength(5)
  })

  it('clear で全部外し、restore しても戻らない', () => {
    const { fake, overlay } = setup()
    overlay.show(RESULT, GEO, OPTS)
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
    overlay.show(RESULT, GEO, OPTS)
    overlay.clear()
    ;(pending as (() => void) | null)?.()
    expect(fake.layers).toEqual([])
  })

  it('水路ありの結果を view before で描くと、collapse-culvert だけを足す', () => {
    const { fake, overlay } = setup()
    overlay.show(WITH_CULVERT, GEO, { markerCount: 5, view: 'before' })
    expect(fake.layers).toEqual([COLLAPSE_LAYER_IDS.culvert])
    expect(fake.sources.get(COLLAPSE_LAYER_IDS.culvert)).toMatchObject({
      data: { geometry: { type: 'LineString', coordinates: CULVERT.line } },
    })
  })

  it('view after・blocked で、線の paint が ふさがった の色と破線', () => {
    const { fake, added, overlay } = setupCapturing()
    overlay.show(BLOCKED, GEO, OPTS)
    expect(added.find((l) => l.id === COLLAPSE_LAYER_IDS.culvert)?.paint).toMatchObject({
      'line-color': COLLAPSE_CULVERT_BLOCKED_COLOR,
      'line-dasharray': [2, 2],
      'line-width': 3,
    })
    expect(fake.layers).toContain(COLLAPSE_LAYER_IDS.deposit)
  })

  it('通っている水路は 実線の通っている色（blocked でも view before なら）', () => {
    for (const [result, view] of [
      [WITH_CULVERT, 'after'],
      [BLOCKED, 'before'],
    ] as const) {
      const { added, overlay } = setupCapturing()
      overlay.show(result, GEO, { markerCount: 5, view })
      const paint = added.find((l) => l.id === COLLAPSE_LAYER_IDS.culvert)?.paint
      expect(paint?.['line-color']).toBe(COLLAPSE_CULVERT_OPEN_COLOR)
      expect(paint?.['line-dasharray']).toBeUndefined()
    }
  })

  it('水路なしの結果では collapse-culvert を足さない', () => {
    const { fake, overlay } = setup()
    overlay.show({ ...RESULT, culvert: null } as unknown as CollapsePayload, GEO, OPTS)
    expect(fake.layers).not.toContain(COLLAPSE_LAYER_IDS.culvert)
    const b = setup()
    b.overlay.show(RESULT, GEO, { markerCount: 5, view: 'before' })
    expect(b.fake.layers).toEqual([])
  })

  it('restore で水路の線も足し直す', () => {
    const { fake, overlay } = setup()
    overlay.show(WITH_CULVERT, GEO, OPTS)
    fake.layers.length = 0
    fake.sources.clear()
    overlay.restore()
    expect(fake.layers).toContain(COLLAPSE_LAYER_IDS.culvert)
  })
})
