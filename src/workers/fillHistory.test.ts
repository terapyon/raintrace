import { describe, expect, it } from 'vitest'
import type { DemTileData } from '../dem/DemGrid'
import type { FetchDemTile } from '../dem/demSelection'
import { lonLatToPixel, pixelToLonLat } from '../dem/tileMath'
import type { TerrainGeo } from '../shared/protocol'
import { computeFillHistory, FillHistoryError } from './fillHistory'

const SIZE = 64
const Z = 17
// 熱海付近
const ORIGIN = lonLatToPixel(139.0706, 35.1224, Z)
const geo = (level: 1 | 2 | 3 = 1): TerrainGeo => ({
  level,
  z: Z,
  originX: Math.floor(ORIGIN.x),
  originY: Math.floor(ORIGIN.y),
  size: SIZE,
  cellSizeM: 2,
  corners: {} as TerrainGeo['corners'],
  breakdown: {},
  invalidRatio: 0,
})

const flatTile = (value: number): DemTileData => ({
  elevation: new Float32Array(256 * 256).fill(value),
  validMask: new Uint8Array(256 * 256).fill(1),
})
const fetchFlat: FetchDemTile = async () => ({ status: 'ok', data: flatTile(10) })
const fetchMissing: FetchDemTile = async () => ({ status: 'missing' })
const noJson = async (): Promise<unknown | null> => null

type Box = [number, number, number, number, number] // col0, row0, col1, row1, 上げる高さ

/** 昔は一面 10 m。今は台（Box）の分だけ高い */
function terrain(boxes: Box[]) {
  const elevation = new Float32Array(SIZE * SIZE).fill(10)
  for (const [c0, r0, c1, r1, rise] of boxes) {
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) elevation[r * SIZE + c] = 10 + rise
  }
  return { elevation, validMask: new Uint8Array(SIZE * SIZE).fill(1) }
}

const input = (level: 1 | 2 | 3, boxes: Box[]) => ({
  terrainId: 7,
  geo: geo(level),
  ...terrain(boxes),
})

describe('computeFillHistory', () => {
  it('段 3 の地形は unavailable', async () => {
    const p = computeFillHistory(input(3, []), { fetchDem: fetchFlat, fetchJson: noJson })
    await expect(p).rejects.toMatchObject({ reason: 'unavailable' })
    await expect(p).rejects.toBeInstanceOf(FillHistoryError)
  })

  it('dem_png がすべて 404 なら no-overlap', async () => {
    await expect(
      computeFillHistory(input(1, []), { fetchDem: fetchMissing, fetchJson: noJson }),
    ).rejects.toMatchObject({ reason: 'no-overlap' })
  })

  it('人工地形の取得が失敗しても、標高差と候補は返り landformAvailable は false', async () => {
    const r = await computeFillHistory(input(1, [[20, 20, 40, 40, 8]]), {
      fetchDem: fetchFlat,
      fetchJson: async (url) => {
        if (url.includes('landform')) throw new Error('boom')
        return null
      },
    })
    expect(r.landformAvailable).toBe(false)
    expect(r.a54Available).toBe(true)
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0]?.evidence).toBe('limited')
  })

  it('A54 のタイルが 404 なら地物なしで a54Available は true、失敗なら false', async () => {
    const ok = await computeFillHistory(input(1, []), { fetchDem: fetchFlat, fetchJson: noJson })
    expect(ok.a54Available).toBe(true)
    expect(ok.a54Polygons).toEqual([])
    const bad = await computeFillHistory(input(1, []), {
      fetchDem: fetchFlat,
      fetchJson: async (url) => {
        if (url.startsWith('/data/a54/')) throw new Error('boom')
        return null
      },
    })
    expect(bad.a54Available).toBe(false)
    const malformed = await computeFillHistory(input(1, []), {
      fetchDem: fetchFlat,
      fetchJson: async (url) => (url.startsWith('/data/a54/') ? { nope: 1 } : null),
    })
    expect(malformed.a54Available).toBe(false)
  })

  it('台のある地形で候補が 1 つ返り、中心の経緯度が台の中心', async () => {
    const g = geo(1)
    const r = await computeFillHistory(input(1, [[20, 20, 40, 40, 8]]), {
      fetchDem: fetchFlat,
      fetchJson: noJson,
    })
    expect(r.candidates).toHaveLength(1)
    const expected = pixelToLonLat(g.originX + 30, g.originY + 30, Z)
    expect(r.candidates[0]?.centroid.lon).toBeCloseTo(expected.lon, 8)
    expect(r.candidates[0]?.centroid.lat).toBeCloseTo(expected.lat, 8)
    expect(r.terrainId).toBe(7)
    expect(r.offsetM).toBeCloseTo(0, 3)
  })

  it('候補の並びは根拠が強い順、次に体積の大きい順', async () => {
    const g = geo(1)
    // 大きい台 A（左上）と小さい台 B（右下）。B だけ A54 に重ねて strong にする
    const boxes: Box[] = [
      [2, 2, 22, 22, 8],
      [40, 40, 52, 52, 8],
    ]
    const a = pixelToLonLat(g.originX + 38, g.originY + 38, Z)
    const b = pixelToLonLat(g.originX + 54, g.originY + 54, Z)
    const a54 = {
      features: [
        {
          type: 'side',
          rings: [
            [
              [a.lon, a.lat],
              [b.lon, a.lat],
              [b.lon, b.lat],
              [a.lon, b.lat],
              [a.lon, a.lat],
            ],
          ],
        },
      ],
    }
    const r = await computeFillHistory(input(1, boxes), {
      fetchDem: fetchFlat,
      fetchJson: async (url) => (url.startsWith('/data/a54/') ? a54 : null),
    })
    expect(r.candidates.map((c) => c.evidence)).toEqual(['strong', 'limited'])
    expect(r.candidates[0]?.a54Type).toBe('side')
    expect(r.candidates[0]?.volumeM3).toBeLessThan(r.candidates[1]?.volumeM3 ?? 0)
    expect(r.a54Polygons).toHaveLength(1)
  })

  it('境をまたいで複数の A54 タイルに入っている同じ地物は 1 つにまとめる', async () => {
    // 範囲が z10 タイルの境（z17 で 32768 画素ごと）をまたぐ位置に置く
    const g = { ...geo(1), originX: 3 * 32768 - SIZE / 2 }
    const a = pixelToLonLat(g.originX + 10, g.originY + 10, Z)
    const b = pixelToLonLat(g.originX + 30, g.originY + 30, Z)
    const feature = {
      type: 'valley',
      rings: [
        [
          [a.lon, a.lat],
          [b.lon, a.lat],
          [b.lon, b.lat],
          [a.lon, b.lat],
          [a.lon, a.lat],
        ],
      ],
    }
    let a54Fetches = 0
    const r = await computeFillHistory(
      { ...input(1, []), geo: g },
      {
        fetchDem: fetchFlat,
        fetchJson: async (url) => {
          if (!url.startsWith('/data/a54/')) return null
          a54Fetches++
          return { features: [feature] }
        },
      },
    )
    expect(a54Fetches).toBe(2) // 2 枚のタイルに同じ地物が入っている
    expect(r.a54Polygons).toHaveLength(1)
  })

  it('人工地形のタイルがすべて 404 なら landformAvailable は false（A54 は true のまま）', async () => {
    const r = await computeFillHistory(input(1, []), { fetchDem: fetchFlat, fetchJson: noJson })
    expect(r.landformAvailable).toBe(false)
    expect(r.a54Available).toBe(true)
  })

  it('人工地形の一部のタイルだけ 404 なら地物なしとして landformAvailable は true', async () => {
    let first = true
    const r = await computeFillHistory(input(1, []), {
      fetchDem: fetchFlat,
      fetchJson: async (url) => {
        if (!url.includes('landform')) return null
        if (first) {
          first = false
          return { features: [] }
        }
        return null
      },
    })
    expect(r.landformAvailable).toBe(true)
  })

  it('盛土地・埋立地のコードは根拠（中）になり、切土地のコードは根拠にならない', async () => {
    const g = geo(1)
    const boxes: Box[] = [
      [2, 2, 22, 22, 8], // A
      [40, 40, 52, 52, 8], // B
    ]
    const square = (c0: number, r0: number, c1: number, r1: number) => {
      const p = pixelToLonLat(g.originX + c0, g.originY + r0, Z)
      const q = pixelToLonLat(g.originX + c1, g.originY + r1, Z)
      return [
        [
          [p.lon, p.lat],
          [q.lon, p.lat],
          [q.lon, q.lat],
          [p.lon, q.lat],
          [p.lon, p.lat],
        ],
      ]
    }
    const tile = {
      features: [
        {
          properties: { code: '11004' },
          geometry: { type: 'Polygon', coordinates: square(0, 0, 24, 24) },
        },
        {
          properties: { code: '11003' },
          geometry: { type: 'Polygon', coordinates: square(38, 38, 54, 54) },
        },
        {
          properties: { code: '999999' },
          geometry: { type: 'Polygon', coordinates: square(0, 0, 64, 64) },
        },
      ],
    }
    const r = await computeFillHistory(input(1, boxes), {
      fetchDem: fetchFlat,
      fetchJson: async (url) => (url.includes('landform') ? tile : null),
    })
    const byRise = [...r.candidates].sort((x, y) => y.areaM2 - x.areaM2)
    expect(byRise[0]?.evidence).toBe('moderate') // A（大きい台）
    expect(byRise[1]?.evidence).toBe('limited') // B
    expect(r.landformPolygons.map((p) => p.code).sort()).toEqual(['11003', '11004'])
  })
})
