/**
 * 水面のテクスチャ（spec 05 §3.1）。標高・水深は R32F（Float32 の N × N、行優先・北から。texelFetch(列, 行) が
 * シミュレーションの配列の 行 × N + 列 を読む。flipY なし）、色は 1 行の RGBA の LUT。
 * waterVertexHeightM・lutIndex はシェーダ（waterShaders.ts）と同じ式で、テストで式を固定する
 */

/** 水深の色の LUT と帯の求め方（map/waterColormap.ts の waterLutSpec が作る） */
export interface WaterLut {
  /**
   * 帯ごとの色（r, g, b の並び。(maxIndex + 1) × 3）。**読み取り専用**。map/waterColormap.ts の
   * PALETTES が持つ配列をそのまま指す（複製しない）ので、書き換えると 2D の配色まで壊れる。
   * テクスチャへ上げるだけにする（Task 7 のレビューの指摘）
   */
  rgb: Uint8Array
  /** 1 m あたりの帯の数（5 cm 刻みは 20、連続は 100） */
  bandsPerM: number
  maxIndex: number
  /** 帯の境目の余裕（Float32 の 0.35 などは真の値より僅かに小さい） */
  epsilonM: number
  /** 画素の不透明度（0〜1） */
  alpha: number
  /** これ未満の水深は描かない（base-spec §30） */
  minDepthM: number
}

export function packLutRgba(rgb: Uint8Array): Uint8Array {
  const count = rgb.length / 3
  const out = new Uint8Array(count * 4)
  for (let k = 0; k < count; k++) {
    out[k * 4] = rgb[k * 3] ?? 0
    out[k * 4 + 1] = rgb[k * 3 + 1] ?? 0
    out[k * 4 + 2] = rgb[k * 3 + 2] ?? 0
    out[k * 4 + 3] = 255
  }
  return out
}

/** 頂点の高さ（m）。高さ = (標高 + 水深) × 倍率。1 cm 未満の水深は足さない（WATER_VERTEX と同じ式） */
export function waterVertexHeightM(
  elevationM: number,
  depthM: number,
  exaggeration: number,
  minDepthM: number,
): number {
  return (elevationM + (depthM >= minDepthM ? depthM : 0)) * exaggeration
}

/** 水深の帯（WATER_FRAGMENT と同じ式） */
export function lutIndex(depthM: number, lut: WaterLut): number {
  return Math.min(lut.maxIndex, Math.floor((depthM + lut.epsilonM) * lut.bandsPerM))
}
