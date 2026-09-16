import type { WaterLut } from '../renderer/waterTextures'
import { interpolateStops, type Rgb } from './colormap'

export type WaterPalette = 'stepped' | 'continuous'

/** 描画閾値（base-spec §30）。これ未満は透明 */
export const WATER_VISIBLE_M = 0.01
/** 段階表示の帯の幅と数（5cm × 20 = 1m。tech-spec §6.6）。1m 以上は最後の 1 色 */
export const WATER_BAND_M = 0.05
export const WATER_BANDS = 20
const CONTINUOUS_STEPS = 100
/** 帯の境目の余裕。Float32 の 0.35 などは真の値より僅かに小さい */
const BAND_EPSILON_M = 1e-6
export const WATER_ALPHA = 210
/** 2D の水深のレイヤーの raster-opacity（WaterOverlay）。3D の水面の不透明度にも掛ける（計画で決めたこと 17） */
export const WATER_LAYER_OPACITY = 0.9

// 単一色相の青の明度の変化(色覚特性によらず順序が読める。tech-spec §9.5)。浅いほど明るい
const WATER_STOPS: readonly Rgb[] = [
  [198, 219, 239],
  [107, 174, 214],
  [33, 113, 181],
  [8, 48, 107],
]
/** 1m 以上 */
const DEEP_WATER: Rgb = [8, 29, 60]

export function steppedIndex(depthM: number): number {
  return Math.min(WATER_BANDS, Math.floor((depthM + BAND_EPSILON_M) / WATER_BAND_M))
}

export function continuousIndex(depthM: number): number {
  return Math.min(CONTINUOUS_STEPS, Math.floor((depthM + BAND_EPSILON_M) * CONTINUOUS_STEPS))
}

/** 帯ごとの色（r, g, b の並び）。最後の帯は 1m 以上。補間は標高の配色と同じ関数（colormap.ts） */
function buildLut(size: number): Uint8Array {
  const lut = new Uint8Array(size * 3)
  for (let k = 0; k < size; k++) {
    lut.set(k === size - 1 ? DEEP_WATER : interpolateStops(WATER_STOPS, k / (size - 2)), k * 3)
  }
  return lut
}

const PALETTES: Record<WaterPalette, { lut: Uint8Array; index: (depthM: number) => number }> = {
  stepped: { lut: buildLut(WATER_BANDS + 1), index: steppedIndex },
  continuous: { lut: buildLut(CONTINUOUS_STEPS + 1), index: continuousIndex },
}

/**
 * 3D の水面（シェーダ）の LUT と帯の求め方。2D の steppedIndex・continuousIndex と同じ帯、同じ色、同じ見え方の
 * 不透明度にする（spec 05 §3.1「配色は 04 の 2D 表示と同じ」）
 */
export function waterLutSpec(palette: WaterPalette): WaterLut {
  const { lut } = PALETTES[palette]
  const common = {
    rgb: lut,
    epsilonM: BAND_EPSILON_M,
    alpha: (WATER_ALPHA / 255) * WATER_LAYER_OPACITY,
    minDepthM: WATER_VISIBLE_M,
  }
  // 5 cm 刻みは 20 帯 × 5 cm = 1 m なので、1 m あたり WATER_BANDS 帯（1 / WATER_BAND_M と書くと浮動小数点で境目がずれうる）
  return palette === 'stepped'
    ? { ...common, bandsPerM: WATER_BANDS, maxIndex: WATER_BANDS }
    : { ...common, bandsPerM: CONTINUOUS_STEPS, maxIndex: CONTINUOUS_STEPS }
}

/** 水深の色。描画閾値の未満と NaN は null（透明） */
export function waterColorAt(
  palette: WaterPalette,
  depthM: number,
): [number, number, number] | null {
  if (!(depthM >= WATER_VISIBLE_M)) return null
  const { lut, index } = PALETTES[palette]
  const k = index(depthM) * 3
  return [lut[k] ?? 0, lut[k + 1] ?? 0, lut[k + 2] ?? 0]
}

/**
 * 水深を RGBA に書く（毎フレーム、262,144 セル）。セルごとの配列の確保をせず、LUT から直接書く
 * （02 の申し送り P5）。描画閾値の未満は透明にし、前のフレームの色を残さない
 */
export function waterRgba(
  water: ArrayLike<number>,
  palette: WaterPalette,
  out: Uint8ClampedArray,
): void {
  const { lut, index } = PALETTES[palette]
  for (let i = 0, o = 0; i < water.length; i++, o += 4) {
    const d = water[i] ?? 0
    if (!(d >= WATER_VISIBLE_M)) {
      out[o + 3] = 0
      continue
    }
    const k = index(d) * 3
    out[o] = lut[k] ?? 0
    out[o + 1] = lut[k + 1] ?? 0
    out[o + 2] = lut[k + 2] ?? 0
    out[o + 3] = WATER_ALPHA
  }
}

/** 凡例の背景（CSS）。段階表示は帯の境目をそのまま、連続表示はなめらかに */
export function waterLegendCss(palette: WaterPalette): string {
  if (palette === 'continuous') {
    const stops = [0, 0.25, 0.5, 0.75, 0.99, 1].map((d) => {
      const [r, g, b] = waterColorAt('continuous', Math.max(WATER_VISIBLE_M, d)) ?? DEEP_WATER
      return `rgb(${r} ${g} ${b}) ${(d * 100).toFixed(0)}%`
    })
    return `linear-gradient(to right, ${stops.join(', ')})`
  }
  const { lut } = PALETTES.stepped
  const width = 100 / (WATER_BANDS + 1)
  const stops: string[] = []
  for (let k = 0; k <= WATER_BANDS; k++) {
    const color = `rgb(${lut[k * 3]} ${lut[k * 3 + 1]} ${lut[k * 3 + 2]})`
    stops.push(`${color} ${(k * width).toFixed(2)}% ${((k + 1) * width).toFixed(2)}%`)
  }
  return `linear-gradient(to right, ${stops.join(', ')})`
}
