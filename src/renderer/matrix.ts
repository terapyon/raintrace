/**
 * 4 × 4 の行列（列優先。MapLibre の mainMatrix と同じ並び）。倍精度で計算し、GPU に渡す直前に Float32 にする
 * （spec 05 §3.1 の行列の設計。メルカトル座標をそのまま float32 の頂点に入れると約 1 セルで精度が尽きる）
 */
export function multiplyMat4(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
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

/** 格子の置き場所。originX・originY は北西端のグローバルピクセル、worldSizePx はそのズームのワールドの画素数 */
export interface GridPlacement {
  originX: number
  originY: number
  worldSizePx: number
}

/**
 * モデル行列: 格子の局所座標（u = 列 + 0.5、v = 行 + 0.5、h = m）→ メルカトル（0〜1、z は等角の単位）。
 * x = (originX + u) / W、y = (originY + v) / W、z = h × metersToMercator
 */
export function gridModelMatrix(grid: GridPlacement, metersToMercator: number): Float64Array {
  const m = new Float64Array(16)
  m[0] = 1 / grid.worldSizePx
  m[5] = 1 / grid.worldSizePx
  m[10] = metersToMercator
  m[12] = grid.originX / grid.worldSizePx
  m[13] = grid.originY / grid.worldSizePx
  m[15] = 1
  return m
}

/** 点 (x, y, z, 1) に行列を掛ける */
export function transformPoint(
  m: ArrayLike<number>,
  p: readonly [number, number, number],
): [number, number, number, number] {
  const at = (row: number): number =>
    (m[row] ?? 0) * p[0] + (m[4 + row] ?? 0) * p[1] + (m[8 + row] ?? 0) * p[2] + (m[12 + row] ?? 0)
  return [at(0), at(1), at(2), at(3)]
}
