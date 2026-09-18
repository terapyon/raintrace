import type { TerrainPayload } from '../shared/protocol'

export type Rgb = readonly [number, number, number]

// 標高: 色覚特性に配慮した連続色（cividis に近い 5 点を線形補間。tech-spec §9.5）
const ELEVATION_STOPS: readonly Rgb[] = [
  [0, 32, 77],
  [65, 77, 107],
  [124, 123, 120],
  [188, 175, 111],
  [255, 234, 70],
]

// 窪地の満水時の深さ: 5cm 刻み。04 の水深（青系）と取り違えないよう赤紫の系統にする（spec 02 §6.1）
export const DEPRESSION_BANDS: readonly Rgb[] = [
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

/**
 * 色の点の列を t（0〜1。範囲の外は端に丸める）で線形補間し、out の offset から r・g・b の 3 要素を書き込む。
 * interpolateStops と elevationRgba（セルごとに配列を作らない）の両方がこれを呼ぶ（spec 06 §5.2、N5）
 */
function interpolateStopsInto(
  stops: readonly Rgb[],
  t: number,
  out: Uint8ClampedArray,
  offset: number,
): void {
  const clamped = Math.min(1, Math.max(0, t))
  const position = clamped * (stops.length - 1)
  const lower = Math.min(stops.length - 2, Math.floor(position))
  const f = position - lower
  const a = stops[lower] ?? BLACK
  const b = stops[lower + 1] ?? a
  out[offset] = Math.round(a[0] + (b[0] - a[0]) * f)
  out[offset + 1] = Math.round(a[1] + (b[1] - a[1]) * f)
  out[offset + 2] = Math.round(a[2] + (b[2] - a[2]) * f)
}

/** 色の点の列を t（0〜1。範囲の外は端に丸める）で線形補間する。標高と水深の配色で共有する */
export function interpolateStops(stops: readonly Rgb[], t: number): Rgb {
  const out = new Uint8ClampedArray(3)
  interpolateStopsInto(stops, t, out, 0)
  return [out[0] ?? 0, out[1] ?? 0, out[2] ?? 0]
}

export function elevationColor(t: number): Rgb {
  return interpolateStops(ELEVATION_STOPS, t)
}

/** 5cm 刻みの帯の番号（0 から）。Float32 の丸めを吸収する余裕を持たせる。最後の帯で頭打ち */
export function depthBand(depthM: number): number {
  const band = Math.floor((depthM + DEPTH_TOLERANCE_M) / DEPTH_BAND_M)
  return Math.min(DEPRESSION_BANDS.length - 1, Math.max(0, band))
}

/**
 * 標高を範囲内の最低〜最高で色分けした RGBA（無効セルは透明）。1000 m（約 106 万セル）ではメインスレッドの
 * 長いタスクの主因だったので（04 の 75 ms）、セルごとに配列（elevationColor の戻り値と set の引数）を作らない。
 * 色の式は interpolateStops と同じ（interpolateStopsInto を共有する）ので、出力はビット単位で同じ
 * （colormap.test.ts が旧版と突き合わせる。spec 06 §5.2）
 */
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
    const t = span > 0 ? ((elevation[i] ?? min) - min) / span : 0
    const o = i * 4
    interpolateStopsInto(ELEVATION_STOPS, t, rgba, o)
    rgba[o + 3] = ELEVATION_ALPHA
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
    // セルごとに配列を作らない（spec 06 §5.2）
    const o = i * 4
    rgba[o] = color[0]
    rgba[o + 1] = color[1]
    rgba[o + 2] = color[2]
    rgba[o + 3] = DEPRESSION_ALPHA
  }
  return rgba
}

/** 窪地の配色の凡例の背景（CSS）。帯の境目をそのまま（02 の申し送り L4） */
export function depressionLegendCss(): string {
  const width = 100 / DEPRESSION_BANDS.length
  const stops = DEPRESSION_BANDS.map(
    ([r, g, b], k) =>
      `rgb(${r} ${g} ${b}) ${(k * width).toFixed(2)}% ${((k + 1) * width).toFixed(2)}%`,
  )
  return `linear-gradient(to right, ${stops.join(', ')})`
}
