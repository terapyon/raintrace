/**
 * 水面の格子のメッシュ（spec 05 §3.1）。頂点は格子の局所座標（列, 行）だけを持ち、位置と高さは頂点シェーダが
 * 付ける。メッシュは地形ごとに 1 度だけ作り、毎フレーム作り直さない。S の spike/src/gridMesh.ts から、B の縁と
 * 無効セルのマスクを除いて移した（無効セルは水深 0 なので、1 cm 未満を捨てる規則で描かれない）。
 *
 * 格子は区画（patch）に分ける（spec 06 §5.2、Task 17a）。1 つの大きな索引バッファ（1000 m で Uint32 の 25 MB）を
 * 1 フレームで GPU に上げると 60〜80 ms の長いタスクになるので、区画ごとに作って数フレームに分けて上げる。
 * 区画は隣と縁の頂点を共有する（同じ (列, 行) の頂点を両方が持つ）ので、継ぎ目に隙間はできない
 */

/** 1 区画の一辺のセル数。頂点は (255 + 1)² = 65,536 個までなので Uint16 の索引に収まる */
export const PATCH_CELLS = 255

export interface GridPatch {
  /** 区画の北西の頂点の格子全体での列・行 */
  col0: number
  row0: number
  /** 区画のセルの列数・行数（頂点は (cols + 1) × (rows + 1) 個） */
  cols: number
  rows: number
}

/** N × N 頂点の格子のセル（N − 1）²を、行優先（北から、西から）に patchCells 四方の区画に分ける */
export function gridPatches(n: number, patchCells: number = PATCH_CELLS): GridPatch[] {
  const cells = n - 1
  const patches: GridPatch[] = []
  for (let row0 = 0; row0 < cells; row0 += patchCells) {
    for (let col0 = 0; col0 < cells; col0 += patchCells) {
      patches.push({
        col0,
        row0,
        cols: Math.min(patchCells, cells - col0),
        rows: Math.min(patchCells, cells - row0),
      })
    }
  }
  return patches
}

/** 区画の頂点（(cols + 1) × (rows + 1) 個、格子全体の (列, 行)。行優先） */
export function patchVertices(patch: GridPatch): Float32Array {
  const width = patch.cols + 1
  const out = new Float32Array(width * (patch.rows + 1) * 2)
  let k = 0
  for (let r = 0; r <= patch.rows; r++) {
    for (let c = 0; c < width; c++) {
      out[k++] = patch.col0 + c
      out[k++] = patch.row0 + r
    }
  }
  return out
}

/** 区画の三角形 (a, d, b)(b, d, e)。頂点番号は区画の中の行優先 (r × (cols + 1) + c) */
export function patchIndices(patch: GridPatch): Uint16Array {
  const width = patch.cols + 1
  const out = new Uint16Array(patch.cols * patch.rows * 6)
  let k = 0
  for (let r = 0; r < patch.rows; r++) {
    for (let c = 0; c < patch.cols; c++) {
      const a = r * width + c
      const b = a + 1
      const d = a + width
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

/** 区画の頂点と索引のバイト数（転送の量の見積もり。patchVertices・patchIndices の長さと一致する） */
export function patchBytes(patch: GridPatch): number {
  const vertices = (patch.cols + 1) * (patch.rows + 1)
  return vertices * 2 * Float32Array.BYTES_PER_ELEMENT + patch.cols * patch.rows * 6 * 2
}
