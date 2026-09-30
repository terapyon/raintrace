/**
 * 許容誤差・閾値・流れの式の定数（tech-spec §6.6、spec 03 §3.11、spec 08 §3.12）。値を変えるときは tech-spec も改訂する
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

/**
 * 面を通れる水の深さ h_f の閾値（m）。これ以下の面の流量は 0（spec 08 §3.4）。R03-3 の θ（水面差の閾値）を
 * 「面を通れる水深の閾値」に読み替えたもの。値は同じ 1e-5 m
 */
export const DRY_DEPTH_M = 1e-5

/** 重力加速度（m/s²） */
export const GRAVITY = 9.81

/** Manning の粗度係数（s/m^(1/3)。R08-3 で全体に 1 つの値に固定。テストは EngineOptions で差し替える） */
export const MANNING_N = 0.03

/** 時間刻みの係数 α。dt = min(DT_MAX_S, α·Δx / max(√(g·h_max), u_max))（spec 08 §3.3。M0 で 0.7 から下げた） */
export const CFL_ALPHA = 0.5

/** de Almeida ほか（2012）の θ 重み付け（spec 08 §3.2。M0 で採用。EngineOptions には出さない） */
export const THETA = 0.8

/** 時間刻みの上限（s。spec 08 §3.3。降り始めの表示の細かさを決める） */
export const DT_MAX_S = 1

/** フルード数の上限。|q| ≤ FROUDE_MAX·h_f·√(g·h_f)（spec 08 §3.5） */
export const FROUDE_MAX = 1

/** 自動停止: 雨が終わっていて、すべての面の流速がこれ未満なら settled（m/s。R08-6、§13.2 の Q1 = (a)） */
export const SETTLE_VELOCITY_M_PER_S = 0.01

/** 自動停止の上限: 雨がやんでからこの時間（s）で止める（6 時間。R08-6） */
export const SETTLE_CAP_S = 21_600

/** 水の流れの矢印を出す流速の下限（m/s。spec 08 §3.10） */
export const ARROW_MIN_VELOCITY_M_PER_S = 0.005

/** 浸水面積に数える水深の下限（m）。base-spec §30 の描画閾値 */
export const FLOODED_DEPTH_M = 0.01

/** 越流の判定の余裕（m）。窪地の最低点の水面標高が spill 標高 − この値に達したら通知する（R03-6） */
export const SPILL_TOLERANCE_M = 0.01

/** 質量保存の許容誤差（m³）。totalInputM3 は初期水量と投入水量の累計の和 */
export function massTolerance(totalInputM3: number): number {
  return totalInputM3 * MASS_TOLERANCE_REL
}
