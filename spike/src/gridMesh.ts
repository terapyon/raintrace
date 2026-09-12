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
  const quads = (count - 1) * (count - 1)
  const out = new Uint32Array(quads * 6)
  let k = 0
  for (let row = start; row < start + count - 1; row++) {
    for (let col = start; col < start + count - 1; col++) {
      const a = row * verticesPerSide + col
      const b = a + 1
      const d = a + verticesPerSide
      const e = d + 1
      out.set([a, d, b, b, d, e], k)
      k += 6
    }
  }
  return out
}
