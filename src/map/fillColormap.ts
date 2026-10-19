import { FILL_THRESHOLD_M } from '../dem/fillHistory/constants'
import {
  FILL_CUT_STOPS,
  FILL_DELTA_ALPHA,
  FILL_DELTA_FULL_M,
  FILL_EDGE_COLOR,
  FILL_EDGE_SELECTED_COLOR,
  FILL_RISE_STOPS,
  hexToRgb,
} from './overlayColors'

const EDGE = hexToRgb(FILL_EDGE_COLOR)
const EDGE_SELECTED = hexToRgb(FILL_EDGE_SELECTED_COLOR)

/**
 * 盛土の履歴の標高差（今 − 昔。ずれを補正した値）の RGBA（size × size、行優先。spec 09 §4.2）。
 * |Δ| が閾値（5 m）未満・NaN は透明。増えた（Δ ≥ 5）は赤系、減った（Δ ≤ −5）は青系で、+5 で薄く +20 以上で濃い。
 * 候補の縁のセル（4 近傍に別の label がある候補のセル）は濃い灰、selectedId の候補の縁は黄
 */
export function fillDeltaRgba(
  delta: Float32Array,
  labels: Int32Array,
  size: number,
  selectedId: number | null,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(size * size * 4)
  const labelAt = (row: number, col: number): number | null =>
    row < 0 || col < 0 || row >= size || col >= size ? null : (labels[row * size + col] ?? 0)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const index = row * size + col
      const o = index * 4
      const label = labels[index] ?? 0
      if (label > 0) {
        const edge = [
          labelAt(row - 1, col),
          labelAt(row + 1, col),
          labelAt(row, col - 1),
          labelAt(row, col + 1),
        ].some((other) => other !== null && other !== label)
        if (edge) {
          const [r, g, b] = label === selectedId ? EDGE_SELECTED : EDGE
          rgba[o] = r
          rgba[o + 1] = g
          rgba[o + 2] = b
          rgba[o + 3] = 255
          continue
        }
      }
      const d = delta[index] ?? Number.NaN
      if (!(Math.abs(d) >= FILL_THRESHOLD_M)) continue
      const stops = d > 0 ? FILL_RISE_STOPS : FILL_CUT_STOPS
      const t = Math.min(
        1,
        (Math.abs(d) - FILL_THRESHOLD_M) / (FILL_DELTA_FULL_M - FILL_THRESHOLD_M),
      )
      const [from, to] = [stops[0] ?? [0, 0, 0], stops[1] ?? [0, 0, 0]]
      rgba[o] = Math.round(from[0] + (to[0] - from[0]) * t)
      rgba[o + 1] = Math.round(from[1] + (to[1] - from[1]) * t)
      rgba[o + 2] = Math.round(from[2] + (to[2] - from[2]) * t)
      rgba[o + 3] = FILL_DELTA_ALPHA
    }
  }
  return rgba
}
