import { describe, expect, it } from 'vitest'
import {
  groundResolutionM,
  lonLatToPixel,
  pixelToLonLat,
  tilesInPixelRect,
  worldSizePx,
  wrapLongitude,
} from './tileMath.ts'

describe('wrapLongitude', () => {
  it.each([
    [-180, -180],
    [180, -180],
    [540, -180],
    [-540, -180],
  ])('経度 %f は %f（[−180, 180) に収める）', (lon, expected) => {
    expect(wrapLongitude(lon)).toBe(expected)
  })

  // ±180 の足し引きで下の桁が丸まる（139.7 は 139.70000000000005 になる）ので、近さで比べる
  it('経度 499.7 は 139.7（世界のコピーの上の経度）', () => {
    expect(wrapLongitude(499.7)).toBeCloseTo(139.7, 9)
  })

  it('経度 139.7 は 139.7 のまま（範囲の中は早期に返すので、式の丸めが乗らない）', () => {
    expect(wrapLongitude(139.7)).toBe(139.7)
  })

  it('NaN はそのまま伝わる（Worker の inServiceArea が false にする）', () => {
    expect(wrapLongitude(Number.NaN)).toBeNaN()
  })
})

describe('lonLatToPixel と pixelToLonLat', () => {
  it('経度 0・緯度 0 は z0 の世界の中心', () => {
    expect(lonLatToPixel(0, 0, 0)).toEqual({ x: 128, y: 128 })
  })

  it('z が 1 増えるとピクセル座標は 2 倍', () => {
    const a = lonLatToPixel(139.7671, 35.6812, 16)
    const b = lonLatToPixel(139.7671, 35.6812, 17)
    expect(b.x).toBeCloseTo(a.x * 2, 6)
    expect(b.y).toBeCloseTo(a.y * 2, 6)
  })

  it.each([
    [139.7671, 35.6812],
    [127.6809, 26.2124],
    [141.6739, 45.4153],
  ])('経度 %f・緯度 %f を往復させても 1e-9 度以内で戻る', (lon, lat) => {
    const p = lonLatToPixel(lon, lat, 17)
    const back = pixelToLonLat(p.x, p.y, 17)
    expect(back.lon).toBeCloseTo(lon, 9)
    expect(back.lat).toBeCloseTo(lat, 9)
  })
})

describe('groundResolutionM', () => {
  it('赤道の z0 は 156543.03m', () => {
    expect(groundResolutionM(0, 0)).toBeCloseTo(156543.03392804097, 6)
  })

  it('北緯 35° の z17 は約 0.978m（誤差 0.001m 以内）', () => {
    expect(Math.abs(groundResolutionM(35, 17) - 0.978)).toBeLessThan(0.001)
  })

  it('世界の幅は 256 × 2^z ピクセル', () => {
    expect(worldSizePx(17)).toBe(256 * 131072)
  })
})

describe('tilesInPixelRect', () => {
  it('範囲にかかるタイルを行優先で列挙する', () => {
    const tiles = tilesInPixelRect({ x0: 2660, y0: 1300, x1: 3172, y1: 1812 }, 17)
    expect(tiles).toHaveLength(9)
    expect(tiles[0]).toEqual({ z: 17, x: 10, y: 5 })
    expect(tiles[1]).toEqual({ z: 17, x: 11, y: 5 })
    expect(tiles[8]).toEqual({ z: 17, x: 12, y: 7 })
  })

  it('タイルの境界ちょうどの範囲は 1 枚', () => {
    expect(tilesInPixelRect({ x0: 256, y0: 256, x1: 512, y1: 512 }, 3)).toEqual([
      { z: 3, x: 1, y: 1 },
    ])
  })

  it('端が小数でも、少しでもかかるタイルは含める', () => {
    expect(tilesInPixelRect({ x0: 0, y0: 0, x1: 256.5, y1: 10 }, 3)).toEqual([
      { z: 3, x: 0, y: 0 },
      { z: 3, x: 1, y: 0 },
    ])
  })

  it('空の範囲は空の配列', () => {
    expect(tilesInPixelRect({ x0: 10, y0: 0, x1: 10, y1: 10 }, 3)).toEqual([])
  })
})
