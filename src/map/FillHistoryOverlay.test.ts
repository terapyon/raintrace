// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FillHistoryPayload, TerrainGeo } from '../shared/protocol'
import { FillHistoryOverlay } from './FillHistoryOverlay'
import { FILL_LAYER_IDS } from './layerIds'

class FakeImageData {
  data: Uint8ClampedArray
  constructor(data: Uint8ClampedArray) {
    this.data = data
  }
}

/** jsdom は canvas 未対応なので、putImageData・getImageData だけを持つ偽の 2D コンテキストを使う */
function stubCanvas(): void {
  vi.stubGlobal('ImageData', FakeImageData)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        putImageData: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(44 * 22 * 4) }),
        fillRect: vi.fn(),
        fillText: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  )
}

interface FakeMap {
  map: MapLibreMap
  layers: string[]
  sources: Map<string, unknown>
  images: Set<string>
}

function fakeMap(): FakeMap {
  const layers: string[] = []
  const sources = new Map<string, unknown>()
  const images = new Set<string>()
  const map = {
    addSource: (id: string, source: unknown) => sources.set(id, source),
    removeSource: (id: string) => sources.delete(id),
    getSource: (id: string) => sources.get(id),
    addLayer: (layer: { id: string }) => layers.push(layer.id),
    removeLayer: (id: string) => layers.splice(layers.indexOf(id), 1),
    getLayer: (id: string) => (layers.includes(id) ? { id } : undefined),
    setPaintProperty: vi.fn(),
    hasImage: (name: string) => images.has(name),
    addImage: (name: string) => images.add(name),
  } as unknown as MapLibreMap
  return { map, layers, sources, images }
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
  terrainId: 1,
  pastElevation: new Float32Array(4),
  deltaCorrected: Float32Array.of(10, 0, 0, 0),
  candidateLabels: Int32Array.of(1, 0, 0, 0),
  candidateLabelsCount: 1,
  offsetM: 0,
  candidates: [{ id: 1, centroid: { lon: 0.5, lat: 0.5 } }],
  a54Polygons: [
    {
      rings: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
      a54Type: 'valley',
    },
  ],
  landformPolygons: [{ rings: [[[0, 0]]], code: '11004' }],
  a54Available: true,
  landformAvailable: true,
} as unknown as FillHistoryPayload

const IDS = Object.values(FILL_LAYER_IDS)

describe('FillHistoryOverlay（spec 09 §4.2）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('restore で 4 つのレイヤーを足し直す（ベースマップの切り替え）', () => {
    stubCanvas()
    const fake = fakeMap()
    const overlay = new FillHistoryOverlay(fake.map, (run) => run(), '出典')
    overlay.show(RESULT, GEO, null)
    for (const id of IDS) expect(fake.layers).toContain(id)
    // スタイルの入れ替えでレイヤー・ソース・画像が消える
    fake.layers.length = 0
    fake.sources.clear()
    fake.images.clear()
    overlay.restore()
    for (const id of IDS) expect(fake.layers).toContain(id)
    expect(fake.images.has('fill-label-1')).toBe(true)
    // 冪等: もう一度呼んでも二重にならない
    overlay.restore()
    expect(fake.layers.filter((id) => id === FILL_LAYER_IDS.delta)).toHaveLength(1)
  })

  it('A54 のソースに出典を渡す', () => {
    stubCanvas()
    const fake = fakeMap()
    new FillHistoryOverlay(fake.map, (run) => run(), '出典の文言').show(RESULT, GEO, null)
    expect(fake.sources.get(FILL_LAYER_IDS.a54)).toMatchObject({ attribution: '出典の文言' })
  })

  it('clear で 4 つのレイヤーとソースを外し、restore しても戻らない', () => {
    stubCanvas()
    const fake = fakeMap()
    const overlay = new FillHistoryOverlay(fake.map, (run) => run(), '出典')
    overlay.show(RESULT, GEO, null)
    overlay.clear()
    expect(fake.layers).toEqual([])
    expect(fake.sources.size).toBe(0)
    overlay.restore()
    expect(fake.layers).toEqual([])
  })

  it('地図の読み込みを待つ間に clear されたら、描かない', () => {
    stubCanvas()
    const fake = fakeMap()
    let pending: (() => void) | null = null
    const overlay = new FillHistoryOverlay(
      fake.map,
      (run) => {
        pending = run
      },
      '出典',
    )
    overlay.show(RESULT, GEO, null)
    overlay.clear()
    ;(pending as (() => void) | null)?.()
    expect(fake.layers).toEqual([])
  })

  it('setSelected は印の色を塗り直す', () => {
    stubCanvas()
    const fake = fakeMap()
    const overlay = new FillHistoryOverlay(fake.map, (run) => run(), '出典')
    overlay.show(RESULT, GEO, null)
    overlay.setSelected(1)
    expect(fake.map.setPaintProperty).toHaveBeenCalledWith(
      FILL_LAYER_IDS.markers,
      'circle-color',
      expect.anything(),
    )
  })
})
