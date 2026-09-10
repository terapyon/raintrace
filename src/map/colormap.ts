import type { TerrainPayload } from '../shared/protocol'

type Rgb = readonly [number, number, number]

// 標高: 色覚特性に配慮した連続色（cividis に近い 5 点を線形補間。tech-spec §9.5）
const ELEVATION_STOPS: readonly Rgb[] = [
  [0, 32, 77],
  [65, 77, 107],
  [124, 123, 120],
  [188, 175, 111],
  [255, 234, 70],
]

// 窪地の満水時の深さ: 5cm 刻み。04 の水深（青系）と取り違えないよう赤紫の系統にする（spec 02 §6.1）
const DEPRESSION_BANDS: readonly Rgb[] = [
  [253, 224, 221],
  [252, 197, 192],
  [250, 159, 181],
  [247, 104, 161],
  [221, 52, 151],
  [174, 1, 126],
  [122, 1, 119],
  [73, 0, 106],
]

export const DEPTH_BAND_M = 0.05
// analyzeDepressions.ts の同名の定数と揃えている（map は simulation を実行時に import しないので、値をここにも持つ。
// 2 つが同じ値であることは colormap.test.ts が確かめる）
export const DEPTH_TOLERANCE_M = 1e-3
const ELEVATION_ALPHA = 200
const DEPRESSION_ALPHA = 220
const BLACK: Rgb = [0, 0, 0]

export function elevationColor(t: number): Rgb {
  const clamped = Math.min(1, Math.max(0, t))
  const position = clamped * (ELEVATION_STOPS.length - 1)
  const lower = Math.min(ELEVATION_STOPS.length - 2, Math.floor(position))
  const f = position - lower
  const a = ELEVATION_STOPS[lower] ?? BLACK
  const b = ELEVATION_STOPS[lower + 1] ?? a
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/** 5cm 刻みの帯の番号（0 から）。Float32 の丸めを吸収する余裕を持たせる。最後の帯で頭打ち */
export function depthBand(depthM: number): number {
  const band = Math.floor((depthM + DEPTH_TOLERANCE_M) / DEPTH_BAND_M)
  return Math.min(DEPRESSION_BANDS.length - 1, Math.max(0, band))
}

/** 標高を範囲内の最低〜最高で色分けした RGBA（無効セルは透明） */
export function elevationRgba(
  elevation: Float32Array,
  validMask: Uint8Array,
  min: number,
  max: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(elevation.length * 4)
  const span = max - min
  for (let i = 0; i < elevation.length; i++) {
    if (validMask[i] !== 1) continue
    const [r, g, b] = elevationColor(span > 0 ? ((elevation[i] ?? min) - min) / span : 0)
    rgba.set([r, g, b, ELEVATION_ALPHA], i * 4)
  }
  return rgba
}

/** 表示対象の窪地の中を、満水時の深さ（F − Z）の帯で塗った RGBA（ほかは透明） */
export function depressionRgba(
  fill: Float32Array,
  elevation: Float32Array,
  labels: Int32Array,
  depressions: TerrainPayload['depressions'],
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(fill.length * 4)
  for (let i = 0; i < fill.length; i++) {
    const label = labels[i] ?? 0
    // 窪地の id は 1 から順（types.ts）
    if (label === 0 || !depressions[label - 1]?.significant) continue
    const depth = (fill[i] ?? 0) - (elevation[i] ?? 0)
    if (depth <= 0) continue
    const color = DEPRESSION_BANDS[depthBand(depth)] ?? BLACK
    rgba.set([color[0], color[1], color[2], DEPRESSION_ALPHA], i * 4)
  }
  return rgba
}
