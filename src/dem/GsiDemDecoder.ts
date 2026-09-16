/**
 * 地理院の標高 PNG の復号（tech-spec §7.2）。x = 2^16·R + 2^8·G + B、単位 0.01m。
 * x < 2^23 は h = 0.01x、x = 2^23 は無効値、x > 2^23 は h = 0.01(x − 2^24)
 */

export const GSI_NA = 2 ** 23
const GSI_WRAP = 2 ** 24
const GSI_UNIT_M = 0.01

export interface DecodedDem {
  elevation: Float32Array // 無効セルは 0（参照しない。NaN を持ち込まない）
  validMask: Uint8Array // 1 = 有効、0 = 無効
}

/** RGBA のバイト列（1 画素 4 バイト）を復号する。アルファは見ない */
export function decodeGsiDem(rgba: Uint8Array | Uint8ClampedArray): DecodedDem {
  const pixels = rgba.length >> 2
  const elevation = new Float32Array(pixels)
  const validMask = new Uint8Array(pixels)
  for (let p = 0; p < pixels; p++) {
    const o = p * 4
    const x = (rgba[o] ?? 0) * 65536 + (rgba[o + 1] ?? 0) * 256 + (rgba[o + 2] ?? 0)
    if (x === GSI_NA) continue
    elevation[p] = (x < GSI_NA ? x : x - GSI_WRAP) * GSI_UNIT_M
    validMask[p] = 1
  }
  return { elevation, validMask }
}
