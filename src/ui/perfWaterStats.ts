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
/**
 * 判定に要る最小の標本（Task 27 のレビュー I2）。ちらつき: n 画素で変化 0 のときの真の率の 95% の上限は約 3 / n
 * （3 の法則）なので、「1% 以下」と言うには 300 画素が要る。持ち上げ比: 2000 画素なら 2% の余裕が 40 画素になり、
 * 縁のラスタライズや読みの間のずれ（数十画素）より十分大きい
 */
export const MIN_INTERIOR_PX = 300
export const MIN_LIFTED_PX = 2000
/**
 * 読みの間の食い違いの許容（footprint に対する割合。Task 27 のレビュー I3・I4）。深度テストなしの footprint は
 * 深度テストありの見えた画素を画素ごとに含むはずで、最初と最後の footprint は同じはず。超えたら読みごとに
 * フレームか描画の経路が違う
 */
export const MAX_INCONSISTENT_RATIO = 0.005
/** 読みの間のカメラの中心の標高（transform.elevation）の変化の許容（m）。超えたら地形の読み込みで視点が動いた */
export const MAX_CAMERA_DRIFT_M = 0.01

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
  /** 深度テストなしの水面の画素（1 cm 以上の水面が画面に占める画素。最初の読み） */
  footprintPx: number
  /** 最後にもう一度読んだ footprint の画素 */
  footprintEndPx: number
  /** 最初と最後の footprint で値が違う画素（XOR）。0 でなければ読みの間に画面が変わった */
  footprintDriftPx: number
  /** 深度テストありで見えた画素（揺らしの 1 つ目） */
  visiblePx: number
  /** 深度テストありで、水面を LIFT_M 持ち上げたときに見えた画素 */
  liftedPx: number
  /** 見えた ∧ 持ち上げで見えた */
  visibleAndLiftedPx: number
  /** 見えた ∧ ¬footprint。深度テストの有無だけの違いなら 0（0 でなければ読みごとに描画が違う） */
  visibleNotFootprintPx: number
  /** 見えた ∧ ¬持ち上げで見えた。持ち上げで隠れることは幾何では起きないので、測りの雑音の床 */
  visibleNotLiftedPx: number
  /** spec 06 §3 の定義: 見えた / footprint（地形が正当に隠す分を含む。上限で切らない） */
  visibleRatio: number | null
  /** 持ち上げ比: (見えた ∧ 持ち上げで見えた) / 持ち上げで見えた（沈み込みだけを見る。判定に使う） */
  unoccludedRatio: number | null
  /** 雑音: (見えた ∧ ¬持ち上げで見えた) / 持ち上げで見えた */
  noiseRatio: number | null
  interiorPx: number
  /** 削った footprint の内側で、揺らしの間に見え方が変わった画素の割合 */
  flickerRatio: number | null
}

export function measureWaterMasks(input: {
  width: number
  height: number
  footprint: Uint8Array
  /** 最後にもう一度読んだ footprint（読みの間のずれを見る） */
  footprintEnd: Uint8Array
  visible: readonly Uint8Array[]
  lifted: Uint8Array
}): WaterMeasure {
  const { footprint, footprintEnd, lifted } = input
  const footprintPx = countMask(footprint)
  const first = input.visible[0] ?? new Uint8Array(footprint.length)
  const visiblePx = countMask(first)
  const liftedPx = countMask(lifted)
  let footprintDriftPx = 0
  let visibleAndLiftedPx = 0
  let visibleNotFootprintPx = 0
  let visibleNotLiftedPx = 0
  for (let i = 0; i < footprint.length; i++) {
    if (footprint[i] !== footprintEnd[i]) footprintDriftPx++
    if (first[i] !== 1) continue
    if (lifted[i] === 1) visibleAndLiftedPx++
    else visibleNotLiftedPx++
    if (footprint[i] !== 1) visibleNotFootprintPx++
  }
  const interior = erode(footprint, input.width, input.height, ERODE_PX)
  let interiorPx = 0
  let changed = 0
  for (let i = 0; i < interior.length; i++) {
    if (interior[i] !== 1) continue
    interiorPx++
    if (input.visible.some((mask) => mask[i] !== first[i])) changed++
  }
  return {
    footprintPx,
    footprintEndPx: countMask(footprintEnd),
    footprintDriftPx,
    visiblePx,
    liftedPx,
    visibleAndLiftedPx,
    visibleNotFootprintPx,
    visibleNotLiftedPx,
    visibleRatio: footprintPx === 0 ? null : visiblePx / footprintPx,
    unoccludedRatio: liftedPx === 0 ? null : visibleAndLiftedPx / liftedPx,
    noiseRatio: liftedPx === 0 ? null : visibleNotLiftedPx / liftedPx,
    interiorPx,
    flickerRatio: interiorPx === 0 ? null : changed / interiorPx,
  }
}

export type WaterVerdict = 'pass' | 'fail' | 'not-evaluable'

/**
 * 判定。評価できない視点（not-evaluable、表では「判定できず」）を不合格と読まない。
 * cameraDriftM は読みの間のカメラの中心の標高の変化（最大 − 最小、m）
 */
export function judgeWater(
  measure: WaterMeasure,
  cameraClearanceM: number | null,
  cameraDriftM = 0,
): { verdict: WaterVerdict; reason: string } {
  const notEvaluable = (reason: string) => ({ verdict: 'not-evaluable' as const, reason })
  if (measure.footprintPx < MIN_FOOTPRINT_PX) {
    return notEvaluable(
      `水面が画面にほとんど無い（${measure.footprintPx} px）。カメラが強調した地形の中か、水平線すれすれ`,
    )
  }
  if (cameraClearanceM !== null && cameraClearanceM < MIN_CAMERA_CLEARANCE_M) {
    return notEvaluable(`カメラと地面の差が ${cameraClearanceM.toFixed(2)} m`)
  }
  const tolerancePx = measure.footprintPx * MAX_INCONSISTENT_RATIO
  if (measure.visibleNotFootprintPx > tolerancePx) {
    return notEvaluable(
      `見えた ∧ ¬footprint が ${measure.visibleNotFootprintPx} px（読みごとに描画が違う）`,
    )
  }
  if (measure.footprintDriftPx > tolerancePx) {
    return notEvaluable(
      `最初と最後の footprint が ${measure.footprintDriftPx} px 違う（読みの間に画面が変わった）`,
    )
  }
  if (cameraDriftM > MAX_CAMERA_DRIFT_M) {
    return notEvaluable(`読みの間にカメラの中心の標高が ${cameraDriftM.toFixed(3)} m 変わった`)
  }
  if (measure.liftedPx < MIN_LIFTED_PX) {
    return notEvaluable(`標本が薄い（持ち上げで見えた ${measure.liftedPx} px < ${MIN_LIFTED_PX}）`)
  }
  if (measure.interiorPx < MIN_INTERIOR_PX) {
    return notEvaluable(`標本が薄い（内側 ${measure.interiorPx} px < ${MIN_INTERIOR_PX}）`)
  }
  const { unoccludedRatio, flickerRatio, noiseRatio } = measure
  if (unoccludedRatio === null || flickerRatio === null || noiseRatio === null) {
    return notEvaluable('持ち上げた水面か内側の画素が無い')
  }
  const summary = `持ち上げ比 ${unoccludedRatio.toFixed(4)}・雑音 ${noiseRatio.toFixed(4)}・ちらつき ${(flickerRatio * 100).toFixed(3)}%`
  if (Math.abs(unoccludedRatio - VISIBLE_PASS) < noiseRatio) {
    return notEvaluable(`${summary}（閾値との差が雑音より小さい）`)
  }
  const pass = unoccludedRatio >= VISIBLE_PASS && flickerRatio <= FLICKER_PASS
  return { verdict: pass ? 'pass' : 'fail', reason: summary }
}
