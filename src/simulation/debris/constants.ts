/**
 * 土砂の計算（spec 10 §3.2）の定数。値を変えるときは spec と計画も改訂する
 */

/** かさの係数。崩れた土の体積 × この値 が運ばれて積もる（R10-3。1 か所にだけ置く） */
export const DEBRIS_BULKING = 1

/** 崩れたセル 1 つから出す粒の数 */
export const PARTICLES_PER_CELL = 4

/** 粒の経路のランダムウォークの乱数の種（同じ入力なら同じ結果） */
export const DEBRIS_SEED = 20261019

/** 重力加速度（m/s²） */
export const GRAVITY = 9.81

/**
 * せき止められた場所とみなす条件（R12）。崩れる前より増えた容量が
 * max(DAM_MIN_ADDED_M3, DAM_MIN_RATIO × 崩れた後の容量) を超え、かつ窪地の面積が DAM_MIN_AREA_M2 以上。
 * 積もった土の表面の小さな凹み（実地で 10〜240 m³ のものが 100 か所以上）を除くための下限
 */
export const DAM_MIN_ADDED_M3 = 100
export const DAM_MIN_RATIO = 0.1
export const DAM_MIN_AREA_M2 = 200
