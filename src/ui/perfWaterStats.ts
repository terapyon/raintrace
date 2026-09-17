/**
 * probe=water の判定（spec 06 §3、R06-7、計画で決めたこと 15）。S の spike/src/capture.ts の measureWater の
 * 考え方を移し、地形が正当に隠す分を分けるために「持ち上げた水面」の描き方を足した。純粋な関数だけを置く
 */

/** bearing を揺らす量（度）。遠くの画素の移動をちらつきと取り違えないよう、内側を削ってから比べる（S の計画 D9） */
export const JITTER_DEG = [0, 0.002, -0.002] as const
export const ERODE_PX = 2
/** 持ち上げる高さ（m。垂直強調の前）。弦の沈み込みの最大（z15 で 2.46 cm）の 4 倍 */
export const LIFT_M = 0.1
/** S の判定の閾値（持ち上げ比の最小、ちらつき率の最大） */
export const VISIBLE_PASS = 0.98
export const FLICKER_PASS = 0.01
/** これより水面の画素が少ない視点は評価しない（05 の Task 13 の落とし穴: カメラが強調した地形の中） */
export const MIN_FOOTPRINT_PX = 500
export const MIN_CAMERA_CLEARANCE_M = 1

/** 判定用の色（マゼンタ）の画素を 1 にしたマスク（RGBA の並び） */
export function magentaMask(rgba: Uint8Array): Uint8Array {
  const mask = new Uint8Array(Math.floor(rgba.length / 4))
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4
    mask[i] = (rgba[o] ?? 0) > 200 && (rgba[o + 1] ?? 255) < 80 && (rgba[o + 2] ?? 0) > 200 ? 1 : 0
  }
  return mask
}

/** 4 近傍で times 回削る（端の 1 画素は 0） */
export function erode(mask: Uint8Array, width: number, height: number, times: number): Uint8Array {
  let current = mask
  for (let t = 0; t < times; t++) {
    const next = new Uint8Array(current.length)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        next[i] =
          current[i] === 1 &&
          current[i - 1] === 1 &&
          current[i + 1] === 1 &&
          current[i - width] === 1 &&
          current[i + width] === 1
            ? 1
            : 0
      }
    }
    current = next
  }
  return current
}

export function countMask(mask: Uint8Array): number {
  let count = 0
  for (const value of mask) count += value
  return count
}

export interface WaterMeasure {
  /** 深度テストなしの水面の画素（1 cm 以上の水面が画面に占める画素） */
  footprintPx: number
  /** 深度テストありで見えた画素（揺らしの 1 つ目） */
  visiblePx: number
  /** 深度テストありで、水面を LIFT_M 持ち上げたときに見えた画素 */
  liftedPx: number
  /** spec 06 §3 の定義: 見えた / footprint（地形が正当に隠す分を含む） */
  visibleRatio: number | null
  /** 見えた / 持ち上げたときに見えた（沈み込みだけを見る。判定に使う） */
  unoccludedRatio: number | null
  interiorPx: number
  /** 削った footprint の内側で、揺らしの間に見え方が変わった画素の割合 */
  flickerRatio: number | null
}

export function measureWaterMasks(input: {
  width: number
  height: number
  footprint: Uint8Array
  visible: readonly Uint8Array[]
  lifted: Uint8Array
}): WaterMeasure {
  const footprintPx = countMask(input.footprint)
  const first = input.visible[0] ?? new Uint8Array(input.footprint.length)
  const visiblePx = countMask(first)
  const liftedPx = countMask(input.lifted)
  const interior = erode(input.footprint, input.width, input.height, ERODE_PX)
  let interiorPx = 0
  let changed = 0
  for (let i = 0; i < interior.length; i++) {
    if (interior[i] !== 1) continue
    interiorPx++
    if (input.visible.some((mask) => mask[i] !== first[i])) changed++
  }
  return {
    footprintPx,
    visiblePx,
    liftedPx,
    visibleRatio: footprintPx === 0 ? null : Math.min(1, visiblePx / footprintPx),
    unoccludedRatio: liftedPx === 0 ? null : Math.min(1, visiblePx / liftedPx),
    interiorPx,
    flickerRatio: interiorPx === 0 ? null : changed / interiorPx,
  }
}

export type WaterVerdict = 'pass' | 'fail' | 'not-evaluable'

export function judgeWater(
  measure: WaterMeasure,
  cameraClearanceM: number | null,
): { verdict: WaterVerdict; reason: string } {
  if (measure.footprintPx < MIN_FOOTPRINT_PX) {
    return {
      verdict: 'not-evaluable',
      reason: `水面が画面にほとんど無い（${measure.footprintPx} px）。カメラが強調した地形の中か、水平線すれすれ`,
    }
  }
  if (cameraClearanceM !== null && cameraClearanceM < MIN_CAMERA_CLEARANCE_M) {
    return {
      verdict: 'not-evaluable',
      reason: `カメラと地面の差が ${cameraClearanceM.toFixed(2)} m`,
    }
  }
  const { unoccludedRatio, flickerRatio } = measure
  if (unoccludedRatio === null || flickerRatio === null) {
    return { verdict: 'not-evaluable', reason: '持ち上げた水面か内側の画素が無い' }
  }
  const pass = unoccludedRatio >= VISIBLE_PASS && flickerRatio <= FLICKER_PASS
  return {
    verdict: pass ? 'pass' : 'fail',
    reason: `持ち上げ比 ${unoccludedRatio.toFixed(4)}・ちらつき ${(flickerRatio * 100).toFixed(3)}%`,
  }
}
