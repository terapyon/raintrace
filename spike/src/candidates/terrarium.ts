import type { ElevationSampler } from '../types'

const SIZE = 256
const OFFSET_M = 32768
const DEM_Z = 17

/** 高さ（m）を Terrarium（(R × 256 + G + B / 256) − 32768）の RGBA に書く。刻みは 1/256 m で切り捨て */
export function encodeTerrarium(h: number, out: Uint8ClampedArray, offset: number): void {
  const v = Math.min(65535.99, Math.max(0, h + OFFSET_M))
  const whole = Math.floor(v)
  out[offset] = Math.floor(whole / 256)
  out[offset + 1] = whole % 256
  out[offset + 2] = Math.floor((v - whole) * 256)
  out[offset + 3] = 255
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - OFFSET_M
}

/**
 * ズーム z（17 以下）のタイルを、z17 のサンプラーから作る。画素の中心に当たる z17 の画素を 1 点で取る
 * （計画 D5。本番の A は z15 以下で粗い DEM を使うので、これは A の最良の場合）。無効値は 0m（spec 05 §4）
 */
export function terrariumTile(
  sample: ElevationSampler,
  z: number,
  x: number,
  y: number,
): Uint8ClampedArray<ArrayBuffer> {
  if (z > DEM_Z) throw new RangeError(`ズーム ${z} は ${DEM_Z} を超えています`)
  const scale = 2 ** (DEM_Z - z)
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let py = 0; py < SIZE; py++) {
    const gy = Math.floor((y * SIZE + py + 0.5) * scale)
    for (let px = 0; px < SIZE; px++) {
      const gx = Math.floor((x * SIZE + px + 0.5) * scale)
      encodeTerrarium(sample(gx, gy) ?? 0, rgba, (py * SIZE + px) * 4)
    }
  }
  return rgba
}
