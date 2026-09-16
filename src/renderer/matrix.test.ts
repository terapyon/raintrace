import { describe, expect, it } from 'vitest'
import { gridModelMatrix, multiplyMat4, transformPoint } from './matrix'

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
/** 列優先（MapLibre の mainMatrix と同じ並び）の平行移動と拡大 */
const translate = (x: number, y: number, z: number): number[] => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
]
const scale = (s: number): number[] => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]

describe('行列（spec 05 §3.1 の行列の設計）', () => {
  it('単位行列を掛けても変わらない', () => {
    const m = translate(1, 2, 3)
    expect(Array.from(multiplyMat4(m, IDENTITY))).toEqual(m)
    expect(Array.from(multiplyMat4(IDENTITY, m))).toEqual(m)
  })

  it('a × b は b を先に掛ける（列優先）', () => {
    const [x, y, z] = transformPoint(multiplyMat4(translate(10, 0, 0), scale(2)), [1, 1, 1])
    expect([x, y, z]).toEqual([12, 2, 2])
  })

  it('モデル行列は格子の局所座標（列 + 0.5、行 + 0.5、m）をメルカトル（0〜1、z は等角の単位）へ移す', () => {
    const grid = { originX: 29_000_000, originY: 13_000_000, worldSizePx: 256 * 2 ** 17 }
    const metersToMercator = 3.0e-8
    const model = gridModelMatrix(grid, metersToMercator)
    const [x, y, z, w] = transformPoint(model, [10.5, 20.5, 3])
    expect(x).toBeCloseTo((grid.originX + 10.5) / grid.worldSizePx, 15)
    expect(y).toBeCloseTo((grid.originY + 20.5) / grid.worldSizePx, 15)
    expect(z).toBeCloseTo(3 * metersToMercator, 20)
    expect(w).toBe(1)
  })

  it('mainMatrix × モデル行列（倍精度）で局所座標を投影すると、メルカトルの点を mainMatrix で投影したものと一致する', () => {
    // 透視投影を含む、値の大きい適当な行列（列優先）
    const main = [
      2.1e7, 3.3e5, -1.2e5, -1.2e5, -2.4e5, 1.8e7, 4.0e6, 4.0e6, 0, -9.1e6, 2.2e7, 2.2e7, -1.86e7,
      -1.28e7, -5.1e6, -5.0e6,
    ]
    const grid = { originX: 29_101_000, originY: 12_904_000, worldSizePx: 256 * 2 ** 17 }
    const metersToMercator = 3.1e-8
    const combined = multiplyMat4(main, gridModelMatrix(grid, metersToMercator))
    const local: [number, number, number] = [256.5, 300.5, 40]
    const mercator: [number, number, number] = [
      (grid.originX + local[0]) / grid.worldSizePx,
      (grid.originY + local[1]) / grid.worldSizePx,
      local[2] * metersToMercator,
    ]
    const a = transformPoint(combined, local)
    const b = transformPoint(main, mercator)
    for (let i = 0; i < 4; i++) {
      expect(Math.abs((a[i] ?? 0) - (b[i] ?? 0))).toBeLessThanOrEqual(
        Math.abs(b[i] ?? 0) * 1e-12 + 1e-6,
      )
    }
  })

  it('メルカトル座標を float32 の頂点に入れると、隣のセルとの差が約 1 セルずれる（局所座標にする理由）', () => {
    const world = 256 * 2 ** 17
    const x0 = (139.7016 + 180) / 360 // 渋谷の経度のメルカトル x
    const x1 = x0 + 1 / world // 隣のセル（z17）
    const error = Math.abs(Math.fround(x1) - Math.fround(x0) - 1 / world)
    expect(error).toBeGreaterThan(0.4 / world)
  })
})
