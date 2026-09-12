/**
 * 格子の頂点（列, 行）。ring なら外周に 1 列ずつ足し、−1〜n にする（B の縁。計画 D17）。
 * 頂点の位置と高さはシェーダが texelFetch で求めるので、頂点はセル番号だけを持つ（spec 05 §3.1）
 */
export function gridVertices(n: number, ring: boolean): Float32Array {
  const offset = ring ? 1 : 0
  const m = n + 2 * offset
  const out = new Float32Array(m * m * 2)
  for (let row = 0; row < m; row++) {
    for (let col = 0; col < m; col++) {
      const i = (row * m + col) * 2
      out[i] = col - offset
      out[i + 1] = row - offset
    }
  }
  return out
}

/** 一辺 verticesPerSide 個の頂点の配置のうち、行・列が start〜start + count − 1 の頂点で張る三角形 */
export function gridIndices(verticesPerSide: number, start: number, count: number): Uint32Array {
  return maskedGridIndices(verticesPerSide, start, count, () => true)
}

/**
 * gridIndices と同じ配置だが、4 隅のいずれかが isValid(col, row) === false の四角形は三角形を作らない
 * （B の無効セルの対策。地形・水面が無効セルにかかるスライバーを描かないようにする）
 */
export function maskedGridIndices(
  verticesPerSide: number,
  start: number,
  count: number,
  isValid: (col: number, row: number) => boolean,
): Uint32Array {
  const out: number[] = []
  for (let row = start; row < start + count - 1; row++) {
    for (let col = start; col < start + count - 1; col++) {
      if (
        !isValid(col, row) ||
        !isValid(col + 1, row) ||
        !isValid(col, row + 1) ||
        !isValid(col + 1, row + 1)
      ) {
        continue
      }
      const a = row * verticesPerSide + col
      const b = a + 1
      const d = a + verticesPerSide
      const e = d + 1
      out.push(a, d, b, b, d, e)
    }
  }
  return Uint32Array.from(out)
}

/**
 * 縁つきの頂点配置（`gridVertices(n, true)`、offset=1）の頂点番号（col, row）を受け取り、
 * `maskedGridIndices` にそのまま渡せる isValid を返す。縁（範囲の外、セル番号が [0, n) の外）は
 * 常に有効（TERRAIN_VERTEX の ring 判定で高さが常に 0 になるため対象外）。範囲の中は `validMask` を見る。
 * B・B-raw の地形（縁あり／なし）・水面のどの index 呼び出しからも同じ判定になるよう、ここに集約する
 * （B と B-raw で無効セルの扱いがずれないように。中間の判定の反映レビュー対応）
 */
export function ringCellValid(
  n: number,
  validMask: Uint8Array,
): (col: number, row: number) => boolean {
  return (col: number, row: number): boolean => {
    const cx = col - 1
    const cy = row - 1
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return true
    return validMask[cy * n + cx] === 1
  }
}
