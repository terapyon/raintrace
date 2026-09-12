import type { GridRange } from '../../src/dem/gridRange.ts'
import { worldSizePx } from '../../src/dem/tileMath.ts'

/** 4 × 4 の行列の積 a × b（列優先。MapLibre の mainMatrix と同じ並び）。倍精度で計算する（計画 D7） */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0)
      out[col * 4 + row] = sum
    }
  }
  return out
}

/**
 * 格子の局所座標（u = 列 + 0.5、v = 行 + 0.5、h = m）→ メルカトル（0〜1、z は等角の単位）。
 * x = (originX + u) / W、y = (originY + v) / W、z = h × metersToMercator（W は z のワールドの画素数）
 */
export function gridModelMatrix(
  range: Pick<GridRange, 'originX' | 'originY' | 'z'>,
  metersToMercator: number,
): Float64Array {
  const world = worldSizePx(range.z)
  const m = new Float64Array(16)
  m[0] = 1 / world
  m[5] = 1 / world
  m[10] = metersToMercator
  m[12] = range.originX / world
  m[13] = range.originY / world
  m[15] = 1
  return m
}

/** 点を行列で投影し、CSS 画素の位置を返す。カメラの後ろ（w ≤ 0）は null */
export function projectToScreen(
  matrix: ArrayLike<number>,
  point: readonly [number, number, number],
  width: number,
  height: number,
): { x: number; y: number } | null {
  const [x, y, z] = point
  const at = (row: number): number =>
    (matrix[row] ?? 0) * x +
    (matrix[4 + row] ?? 0) * y +
    (matrix[8 + row] ?? 0) * z +
    (matrix[12 + row] ?? 0)
  const w = at(3)
  if (w <= 0) return null
  return { x: ((at(0) / w + 1) / 2) * width, y: ((1 - at(1) / w) / 2) * height }
}
