// 崩れた土砂の「流れやすさ」のプリセットの表。Worker は id でパラメータを引き、UI はここの label を並べる。

export interface DebrisParams {
  /** PCM の摩擦係数 μ（論文の推奨 0.04〜0.8） */
  mu: number
  /** PCM の質量と抗力の比 M/D（m。推奨 20〜150） */
  massToDragM: number
  /** ランダムウォークの発散の指数 a（推奨 1.3〜3.0）。大きいほど横へ広がる（γᵢ ≥ γmax^a の近傍が候補） */
  divergence: number
  /** 同じ向きに進み続ける重み（推奨 1.5〜2.0） */
  persistence: number
  /** 積もった土の斜面の限界の角度（度） */
  reposeDeg: number
  /** ランダムウォークの斜面の閾値 βthres（度。論文の土石流の推奨 20〜40）。これより急なら最急の近傍だけへ進む */
  slopeThresholdDeg: number
  /** 粒の最初の速さ（m/s。論文は最初のセルで止まらないように初速を与える） */
  initialVelocityMS: number
}

export interface DebrisPreset {
  id: string
  label: string
  description: string
  params: DebrisParams
}

const NEAR: DebrisPreset = {
  id: 'near',
  label: '近くで止まる',
  description: '崩れた土がすぐ下の谷や川をふさぐ（酒々井の例）',
  params: {
    mu: 0.6,
    massToDragM: 20,
    divergence: 1.3,
    persistence: 1.5,
    reposeDeg: 30,
    slopeThresholdDeg: 40,
    initialVelocityMS: 1,
  },
}

const FAR: DebrisPreset = {
  id: 'far',
  label: '遠くまで流れる',
  description: '水を含んだ土が谷を流れ下る（熱海の例）',
  params: {
    // 熱海・伊豆山（1000 m）で、0.12 では源から約 100 m で止まり、谷筋を流れ下らなかった。0.08 以下で約 570 m 下流まで届く
    // （0.04〜0.07 でほぼ同じ）。境目から離して 0.06 にした（docs/perf/2026-10-19-fill-collapse.md）
    mu: 0.06,
    massToDragM: 100,
    divergence: 2,
    persistence: 2,
    reposeDeg: 8.5,
    slopeThresholdDeg: 20,
    initialVelocityMS: 1,
  },
}

export const DEBRIS_PRESETS: readonly DebrisPreset[] = [NEAR, FAR]

export const DEFAULT_DEBRIS_PRESET_ID = NEAR.id

/** id に合うプリセット。無い id は既定のプリセット。 */
export function debrisPreset(id: string): DebrisPreset {
  return DEBRIS_PRESETS.find((p) => p.id === id) ?? NEAR
}
