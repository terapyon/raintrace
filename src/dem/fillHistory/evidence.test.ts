import { describe, expect, it } from 'vitest'
import { pixelToLonLat } from '../tileMath.ts'
import { classifyEvidence, type EvidencePolygon, rasterizePolygons } from './evidence.ts'
import type { CandidateStats } from './findCandidates.ts'
import type { GridFrame } from './resamplePast.ts'

const SIZE = 20
const Z = 17
const frame: GridFrame = { z: Z, originX: 100000, originY: 50000, size: SIZE, cellSizeM: 1 }

/** 格子の画素座標（セル単位、端を含む）の矩形を経緯度の環にする */
function ring(c0: number, r0: number, c1: number, r1: number) {
  const p = (c: number, r: number) => {
    const { lon, lat } = pixelToLonLat(frame.originX + c, frame.originY + r, Z)
    return [lon, lat] as const
  }
  return [p(c0, r0), p(c1, r0), p(c1, r1), p(c0, r1), p(c0, r0)]
}

function poly(
  c0: number,
  r0: number,
  c1: number,
  r1: number,
  a54Type?: EvidencePolygon['a54Type'],
): EvidencePolygon {
  return a54Type ? { rings: [ring(c0, r0, c1, r1)], a54Type } : { rings: [ring(c0, r0, c1, r1)] }
}

/** 先頭 n セル（row 0 の左から）が id=1 の候補 */
function candidate(cellCount: number): { labels: Int32Array; c: CandidateStats } {
  const labels = new Int32Array(SIZE * SIZE)
  for (let i = 0; i < cellCount; i++) labels[i] = 1
  const c: CandidateStats = {
    id: 1,
    cellCount,
    areaM2: cellCount,
    maxRiseM: 6,
    volumeM3: 0,
    centroid: { col: 0, row: 0 },
    bbox: { col0: 0, row0: 0, col1: SIZE - 1, row1: 0 },
  }
  return { labels, c }
}

describe('rasterizePolygons', () => {
  it('正方形のポリゴンの中のセルだけが 1 になる。穴の中は 0', () => {
    const outer = ring(2, 2, 12, 12)
    const hole = ring(5, 5, 9, 9)
    const out = rasterizePolygons(frame, [{ rings: [outer, hole] }, poly(15, 15, 18, 18)])
    const at = (c: number, r: number) => out[r * SIZE + c]
    expect(at(2, 2)).toBe(1)
    expect(at(11, 11)).toBe(1)
    expect(at(12, 12)).toBe(0)
    expect(at(1, 5)).toBe(0)
    expect(at(6, 6)).toBe(0) // 穴
    expect(at(16, 16)).toBe(2) // 2 つ目のポリゴンは番号 2
  })

  it('格子の外にはみ出すポリゴンも例外にならない', () => {
    const out = rasterizePolygons(frame, [poly(-10, -10, 3, 3)])
    expect(out[0]).toBe(1)
    expect(out[3 * SIZE + 3]).toBe(0)
  })
})

describe('classifyEvidence', () => {
  it('候補の 10% が A54 と重なれば strong、9% なら重ならない', () => {
    const { labels, c } = candidate(100)
    const polygons = [poly(0, 0, 10, 1, 'valley')]
    const mask = rasterizePolygons(frame, polygons)
    // 左 10 セルが A54 → ちょうど 10%
    expect(classifyEvidence(labels, [c], { mask, polygons }, null).get(1)).toMatchObject({
      level: 'strong',
      sources: ['a54'],
      a54Type: 'valley',
    })
    const polygons9 = [poly(0, 0, 9, 1, 'valley')]
    const mask9 = rasterizePolygons(frame, polygons9)
    // 9 セルだけ → 9%
    expect(
      classifyEvidence(labels, [c], { mask: mask9, polygons: polygons9 }, null).get(1)?.level,
    ).toBe('limited')
  })

  it('最も多く重なった A54 の型を a54Type にする', () => {
    const { labels, c } = candidate(100)
    const polygons = [poly(0, 0, 3, 1, 'valley'), poly(3, 0, 20, 1, 'side')]
    const mask = rasterizePolygons(frame, polygons)
    expect(classifyEvidence(labels, [c], { mask, polygons }, null).get(1)?.a54Type).toBe('side')
  })

  it('人工地形だけ → moderate、両方 → strong で sources は 2 つ、無し → limited', () => {
    const { labels, c } = candidate(100)
    const lf = new Int32Array(SIZE * SIZE)
    lf[5] = 1
    expect(classifyEvidence(labels, [c], null, lf).get(1)).toEqual({
      level: 'moderate',
      sources: ['landform'],
    })
    expect(classifyEvidence(labels, [c], null, new Int32Array(SIZE * SIZE)).get(1)).toEqual({
      level: 'limited',
      sources: [],
    })
    const polygons = [poly(0, 0, 20, 1, 'unclassified')]
    const mask = rasterizePolygons(frame, polygons)
    expect(classifyEvidence(labels, [c], { mask, polygons }, lf).get(1)).toEqual({
      level: 'strong',
      sources: ['a54', 'landform'],
      a54Type: 'unclassified',
    })
  })

  it('A54 が null（読めなかった）でも例外にならず、人工地形で判定する', () => {
    const { labels, c } = candidate(100)
    const lf = new Int32Array(SIZE * SIZE).fill(1)
    expect(classifyEvidence(labels, [c], null, lf).get(1)?.level).toBe('moderate')
    expect(classifyEvidence(labels, [c], null, null).get(1)?.level).toBe('limited')
  })
})
