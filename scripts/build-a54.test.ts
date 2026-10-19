import { describe, expect, it } from 'vitest'
import {
  convertFeature,
  type GeoJsonFeature,
  roundCoord,
  simplifyRing,
  tilesForFeature,
} from './build-a54.ts'

const square = (x0: number, y0: number, x1: number, y1: number) => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
]

const polygon = (a54: string | number, coordinates: number[][][]): GeoJsonFeature => ({
  type: 'Feature',
  properties: { A54_001: a54, A54_002: '12' },
  geometry: { type: 'Polygon', coordinates },
})

describe('convertFeature', () => {
  it('A54_001 を種別に変える（"1" は谷埋め型、"2" は腹付け型、"9" は区分なし）', () => {
    const ring = square(140, 35, 140.001, 35.001)
    expect(convertFeature(polygon('1', [ring]))[0]?.type).toBe('valley')
    expect(convertFeature(polygon('2', [ring]))[0]?.type).toBe('side')
    expect(convertFeature(polygon('9', [ring]))[0]?.type).toBe('unclassified')
  })

  it('MultiPolygon は複数の地物に分ける', () => {
    const feature: GeoJsonFeature = {
      type: 'Feature',
      properties: { A54_001: '1' },
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[square(140, 35, 140.001, 35.001)], [square(141, 36, 141.001, 36.001)]],
      },
    }
    expect(convertFeature(feature)).toHaveLength(2)
  })

  it('他の属性を捨て、座標を小数 5 桁に丸める', () => {
    const [f] = convertFeature(polygon('1', [square(140.123456789, 35.987654321, 140.2, 36)]))
    expect(Object.keys(f ?? {}).sort()).toEqual(['rings', 'type'])
    expect(f?.rings[0]?.[0]).toEqual([140.12346, 35.98765])
    expect(roundCoord(140.123454)).toBe(140.12345)
  })

  it('谷埋め・腹付け・区分なし以外の値は捨てる', () => {
    expect(convertFeature(polygon('3', [square(140, 35, 140.1, 35.1)]))).toEqual([])
  })
})

describe('simplifyRing', () => {
  it('許容誤差より小さい凹凸を落とし、閉じたまま 4 点以上を保つ', () => {
    const ring = [
      [0, 0],
      [0.5, 0.000001],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]
    const out = simplifyRing(ring, 1e-5)
    expect(out).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ])
  })

  it('許容誤差より大きい頂点は残す', () => {
    const ring = [
      [0, 0],
      [0.5, 0.01],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0],
    ]
    expect(simplifyRing(ring, 1e-5)).toHaveLength(6)
  })

  it('潰れて 4 点に満たない輪は null', () => {
    expect(
      simplifyRing(
        [
          [0, 0],
          [1, 0],
          [0, 0],
        ],
        1e-5,
      ),
    ).toBeNull()
  })
})

describe('tilesForFeature', () => {
  it('z10 のタイルの内側に収まる地物は 1 枚', () => {
    const [f] = convertFeature(polygon('1', [square(139.7, 35.6, 139.701, 35.601)]))
    expect(f && tilesForFeature(f)).toEqual([{ x: 909, y: 403 }])
  })

  it('外接矩形がタイルの境をまたぐと両方を返す', () => {
    // z10 の x 境界: 経度 139.921875（x = 909 と 910 の境）
    const [f] = convertFeature(polygon('1', [square(139.92, 35.6, 139.925, 35.601)]))
    const xs = (f ? tilesForFeature(f) : []).map((t) => t.x).sort()
    expect(xs).toEqual([909, 910])
  })
})
