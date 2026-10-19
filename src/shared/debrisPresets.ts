// 崩れた土砂の「流れやすさ」のプリセットの表。Worker は id でパラメータを引き、UI はここの label を並べる。

export interface DebrisParams {
  /** PCM の摩擦係数 μ（論文の推奨 0.04〜0.8） */
  mu: number
  /** PCM の質量と抗力の比 M/D（m。推奨 20〜150） */
  massToDragM: number
  /** ランダムウォークの発散の指数（推奨 1.3〜3.0） */
  divergence: number
  /** 同じ向きに進み続ける重み（推奨 1.5〜2.0） */
  persistence: number
  /** 積もった土の斜面の限界の角度（度） */
  reposeDeg: number
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
  params: { mu: 0.6, massToDragM: 20, divergence: 2, persistence: 1.5, reposeDeg: 30 },
}

const FAR: DebrisPreset = {
  id: 'far',
  label: '遠くまで流れる',
  description: '水を含んだ土が谷を流れ下る（熱海の例）',
  params: { mu: 0.12, massToDragM: 100, divergence: 1.3, persistence: 2, reposeDeg: 8.5 },
}

export const DEBRIS_PRESETS: readonly DebrisPreset[] = [NEAR, FAR]

export const DEFAULT_DEBRIS_PRESET_ID = NEAR.id

/** id に合うプリセット。無い id は既定のプリセット。 */
export function debrisPreset(id: string): DebrisPreset {
  return DEBRIS_PRESETS.find((p) => p.id === id) ?? NEAR
}
