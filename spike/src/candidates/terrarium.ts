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
 * z17 の連続座標（x・y は「角」の位置。DEMData.sampleBilinear と同じ単位）の高さを、z17 のサンプラー
 * （セル gx の中心、連続座標 gx + 0.5 の値を返す）から双線形で求める。角の座標を先にセルの中心の座標系へ
 * 直す（x − 0.5）。無効値は 0m として補間する（spec 05 §4。レビュー Important 2 の修正）
 */
function sampleZ17Corner(sample: ElevationSampler, x: number, y: number): number {
  const cx = Math.floor(x - 0.5)
  const cy = Math.floor(y - 0.5)
  const tx = x - 0.5 - cx
  const ty = y - 0.5 - cy
  const z00 = sample(cx, cy) ?? 0
  const z10 = sample(cx + 1, cy) ?? 0
  const z01 = sample(cx, cy + 1) ?? 0
  const z11 = sample(cx + 1, cy + 1) ?? 0
  return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty
}

/**
 * ズーム z（17 以下）のタイルを、z17 のサンプラーから作る。MapLibre の DEMData は画素 px の値を
 * 「タイルの角からの連続座標 px（セルではなく頂点）の高さ」として読む（sampleBilinear は整数座標で
 * 生の画素をそのまま返す）ので、出力の画素 px には、z17 の連続座標 (x × 256 + px) × scale の高さを
 * `sampleZ17Corner` で求めて書く（計画 D5 改訂。本番の A は z15 以下で粗い DEM を使うので、これは A
 * の最良の場合）。z17 でも角はセルとセルの中間（重みは常に 0.5）になるので、常に周囲 4 セルの平均になる
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
    const gy = (y * SIZE + py) * scale
    for (let px = 0; px < SIZE; px++) {
      const gx = (x * SIZE + px) * scale
      encodeTerrarium(sampleZ17Corner(sample, gx, gy), rgba, (py * SIZE + px) * 4)
    }
  }
  return rgba
}
