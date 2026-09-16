/**
 * 水面の格子のメッシュ（spec 05 §3.1）。頂点は格子の局所座標（列, 行）だけを持ち、位置と高さは頂点シェーダが
 * 付ける。メッシュは地形ごとに 1 度だけ作り、毎フレーム作り直さない。S の spike/src/gridMesh.ts から、B の縁と
 * 無効セルのマスクを除いて移した（無効セルは水深 0 なので、1 cm 未満を捨てる規則で描かれない）
 */
export function gridVertices(n: number): Float32Array {
  const out = new Float32Array(n * n * 2)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = (row * n + col) * 2
      out[i] = col
      out[i + 1] = row
    }
  }
  return out
}

/** 四角形ごとに三角形 2 枚。頂点番号は行優先の (行 × n + 列)。1000 m（N = 1031）で約 212 万枚なので 32 bit の番号 */
export function gridIndices(n: number): Uint32Array {
  const out = new Uint32Array((n - 1) * (n - 1) * 6)
  let k = 0
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = row * n + col
      const b = a + 1
      const d = a + n
      const e = d + 1
      out[k++] = a
      out[k++] = d
      out[k++] = b
      out[k++] = b
      out[k++] = d
      out[k++] = e
    }
  }
  return out
}
