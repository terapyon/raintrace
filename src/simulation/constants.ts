/**
 * 許容誤差と閾値（tech-spec §6.6、spec 03 §3.11）。値を変えるときは tech-spec も改訂する
 */

/** 質量保存の許容誤差の係数。許容誤差 = (初期水量 + 投入水量の累計) × この値 */
export const MASS_TOLERANCE_REL = 1e-9

/** 平衡状態の水面標高と、体積から求めた理論値との差の許容値（m） */
export const SURFACE_ELEVATION_TOLERANCE_M = 0.01

/** 水深・水面の比較の許容値 epsilon（m）。流れの閾値 θ と同じ値 */
export const DEPTH_EPSILON_M = 1e-5

/** 流れの閾値 θ（m）。水面差がこれ以下の近傍には流さない（R03-3） */
export const FLOW_THRESHOLD_M = 1e-5

/** 流量の係数 c。1 セルから 8 近傍へ出る流量の係数の和 k·Σw の値（R03-1） */
export const DIFFUSION_C = 0.5

/** 浸水面積に数える水深の下限（m）。base-spec §30 の描画閾値 */
export const FLOODED_DEPTH_M = 0.01

/** 越流の判定の余裕（m）。窪地の最低点の水面標高が spill 標高 − この値に達したら通知する（R03-6） */
export const SPILL_TOLERANCE_M = 0.01

/** 質量保存の許容誤差（m³）。totalInputM3 は初期水量と投入水量の累計の和 */
export function massTolerance(totalInputM3: number): number {
  return totalInputM3 * MASS_TOLERANCE_REL
}
