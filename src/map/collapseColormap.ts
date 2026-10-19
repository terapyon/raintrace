import {
  COLLAPSE_DAM_COLOR,
  COLLAPSE_DAM_FILL_ALPHA,
  COLLAPSE_DEPOSIT_ALPHA,
  COLLAPSE_DEPOSIT_FULL_M,
  COLLAPSE_DEPOSIT_MIN_M,
  COLLAPSE_DEPOSIT_STOPS,
  COLLAPSE_NEW_WATER_ALPHA,
  COLLAPSE_NEW_WATER_COLOR,
  COLLAPSE_SCAR_ALPHA,
  COLLAPSE_SCAR_COLOR,
  hexToRgb,
} from './overlayColors'

const SCAR = hexToRgb(COLLAPSE_SCAR_COLOR)
const DAM = hexToRgb(COLLAPSE_DAM_COLOR)
const NEW_WATER = hexToRgb(COLLAPSE_NEW_WATER_COLOR)
/** 水深の写しは Float32。エンジンの判定（1 cm 以上）と合うよう、閾値も Float32 に丸めて比べる */
const FLOODED = Math.fround(0.01)
const DEPOSIT_MIN = Math.fround(COLLAPSE_DEPOSIT_MIN_M)

/**
 * 崩れた土の積もった厚さと崩れた跡の RGBA（size × size、行優先。spec 10 §5.4）。
 * 厚さ 0.01 m 以上は茶（厚いほど濃く、5 m で最大）、崩れた跡（removed > 0）は偶奇の市松で薄い灰（斜線風）。
 * 積もったセルが優先。それ以外・NaN は透明
 */
export function collapseDepositRgba(
  deposit: Float32Array,
  removed: Float32Array,
  size: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(size * size * 4)
  const [from, to] = [
    COLLAPSE_DEPOSIT_STOPS[0] ?? [0, 0, 0],
    COLLAPSE_DEPOSIT_STOPS[1] ?? [0, 0, 0],
  ]
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const index = row * size + col
      const o = index * 4
      const thickness = deposit[index] ?? 0
      if (thickness >= DEPOSIT_MIN) {
        const t = Math.min(
          1,
          (thickness - COLLAPSE_DEPOSIT_MIN_M) / (COLLAPSE_DEPOSIT_FULL_M - COLLAPSE_DEPOSIT_MIN_M),
        )
        rgba[o] = Math.round(from[0] + (to[0] - from[0]) * t)
        rgba[o + 1] = Math.round(from[1] + (to[1] - from[1]) * t)
        rgba[o + 2] = Math.round(from[2] + (to[2] - from[2]) * t)
        rgba[o + 3] = COLLAPSE_DEPOSIT_ALPHA
      } else if ((removed[index] ?? 0) > 0 && (row + col) % 2 === 0) {
        rgba[o] = SCAR[0]
        rgba[o + 1] = SCAR[1]
        rgba[o + 2] = SCAR[2]
        rgba[o + 3] = COLLAPSE_SCAR_ALPHA
      }
    }
  }
  return rgba
}

/** せき止められた窪地（labels が ids のどれか）のセルを薄く塗り、輪郭のセル（4 近傍に窪地の外がある）は濃く塗る */
export function paintDamOutlines(
  rgba: Uint8ClampedArray,
  labels: Int32Array,
  ids: ReadonlySet<number>,
  size: number,
): void {
  const inDam = (row: number, col: number): boolean =>
    row >= 0 && col >= 0 && row < size && col < size && ids.has(labels[row * size + col] ?? 0)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!inDam(row, col)) continue
      const o = (row * size + col) * 4
      const edge =
        !inDam(row - 1, col) || !inDam(row + 1, col) || !inDam(row, col - 1) || !inDam(row, col + 1)
      if (!edge) {
        rgba[o] = DAM[0]
        rgba[o + 1] = DAM[1]
        rgba[o + 2] = DAM[2]
        rgba[o + 3] = COLLAPSE_DAM_FILL_ALPHA
        continue
      }
      rgba[o] = DAM[0]
      rgba[o + 1] = DAM[1]
      rgba[o + 2] = DAM[2]
      rgba[o + 3] = 255
    }
  }
}

/** 新しく溜まった水（崩れた後 ≥ 0.01 m かつ前 < 0.01 m）の RGBA（濃い青紫） */
export function newWaterRgba(
  before: Float32Array,
  after: Float32Array,
  size: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    if ((after[i] ?? 0) >= FLOODED && (before[i] ?? 0) < FLOODED) {
      const o = i * 4
      rgba[o] = NEW_WATER[0]
      rgba[o + 1] = NEW_WATER[1]
      rgba[o + 2] = NEW_WATER[2]
      rgba[o + 3] = COLLAPSE_NEW_WATER_ALPHA
    }
  }
  return rgba
}
