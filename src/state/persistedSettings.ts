/** localStorage に保存する UI 設定（tech-spec §8.3）。検証は型ガードを手で書く（spec 04 §7） */

export const SETTINGS_KEY = 'raintrace.settings'

export const RANGE_SIZES = [250, 500, 1000] as const
export type RangeSizeM = (typeof RANGE_SIZES)[number]
export const ARROW_SPACINGS = [10, 20] as const
export const VERTICAL_EXAGGERATIONS = [1, 2, 5, 10] as const
export const WATER_PALETTES = ['stepped', 'continuous'] as const
export const BASEMAPS = ['std', 'pale', 'photo'] as const
export type Basemap = (typeof BASEMAPS)[number]
export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]

/** 入力の範囲（spec 04 §9、R04-6） */
export const AMOUNT_MM = { min: 1, max: 1000 } as const
export const RADIUS_MIN_M = 1
export const maxRadiusM = (sizeM: RangeSizeM): number => sizeM / 2

export interface PersistedSettings {
  schemaVersion: 1
  rainfall: { amountMm: number; radiusM: number }
  area: { sizeM: RangeSizeM }
  display: {
    verticalExaggeration: (typeof VERTICAL_EXAGGERATIONS)[number]
    waterDepthPalette: (typeof WATER_PALETTES)[number]
    /** 水の流れの矢印（spec 04 §6.2） */
    showFlowVectors: boolean
    /** 水の流れと地形の流向の矢印の間隔（計画で決めたこと 10） */
    flowVectorSpacingM: (typeof ARROW_SPACINGS)[number]
  }
  map: { basemap: Basemap; theme: ThemeMode }
  disclaimerAcknowledgedAt: string | null
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  schemaVersion: 1,
  rainfall: { amountMm: 100, radiusM: 10 },
  area: { sizeM: 500 },
  display: {
    verticalExaggeration: 2,
    waterDepthPalette: 'stepped',
    showFlowVectors: true,
    flowVectorSpacingM: 10,
  },
  map: { basemap: 'pale', theme: 'system' },
  disclaimerAcknowledgedAt: null,
}

export function isValidAmountMm(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= AMOUNT_MM.min &&
    value <= AMOUNT_MM.max
  )
}

export function isValidRadiusM(value: unknown, sizeM: RangeSizeM): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= RADIUS_MIN_M &&
    value <= maxRadiusM(sizeM)
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const oneOf = <T>(list: readonly T[], value: unknown): value is T => list.includes(value as T)

/**
 * 矢印の間隔の保存値・perfHook が渡す値（5・10・20）。5 は選べる値から外れたが（R06-11 の裁定）、
 * 保存済みの値と計測だけの URL（arrowsM=5）からは今も届きうるので、検証の入力の型に残す
 */
const ARROW_SPACING_INPUTS = [5, ...ARROW_SPACINGS] as const

/**
 * 矢印の間隔を選べる値に丸める。5（選択肢から外れた値）は 10 として読む（移行）。
 * ARROW_SPACING_INPUTS で検証した後の値だけを渡す（parsePersistedSettings と perfHook.ts が呼ぶ。
 * R06-11 の裁定 (a2): すべての範囲で矢印の 1 辺の本数の上限を 50 にする。計画で決めたこと 19）
 */
export function clampArrowSpacing(
  value: (typeof ARROW_SPACING_INPUTS)[number],
): (typeof ARROW_SPACINGS)[number] {
  return value === 5 ? 10 : value
}

/**
 * 保存値を検証する。形・型・範囲のどれかが不正、または schemaVersion が 1 でなければ null
 * （呼び出し側が既定値に戻す。schemaVersion のマイグレーションはしない。外した選択肢の値
 * （矢印の間隔 5）だけ 10 に読み替える。tech-spec §8.3。R06-11）
 */
export function parsePersistedSettings(value: unknown): PersistedSettings | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  const { rainfall, area, display, map, disclaimerAcknowledgedAt } = value
  if (!isRecord(rainfall) || !isRecord(area) || !isRecord(display) || !isRecord(map)) return null
  const { sizeM } = area
  if (!oneOf(RANGE_SIZES, sizeM)) return null
  const { amountMm, radiusM } = rainfall
  if (!isValidAmountMm(amountMm) || !isValidRadiusM(radiusM, sizeM)) return null
  const { verticalExaggeration, waterDepthPalette, showFlowVectors, flowVectorSpacingM } = display
  if (
    !oneOf(VERTICAL_EXAGGERATIONS, verticalExaggeration) ||
    !oneOf(WATER_PALETTES, waterDepthPalette) ||
    typeof showFlowVectors !== 'boolean' ||
    !oneOf(ARROW_SPACING_INPUTS, flowVectorSpacingM)
  ) {
    return null
  }
  const { basemap, theme } = map
  if (!oneOf(BASEMAPS, basemap) || !oneOf(THEME_MODES, theme)) return null
  if (
    disclaimerAcknowledgedAt !== null &&
    (typeof disclaimerAcknowledgedAt !== 'string' ||
      Number.isNaN(Date.parse(disclaimerAcknowledgedAt)))
  ) {
    return null
  }
  return {
    schemaVersion: 1,
    rainfall: { amountMm, radiusM },
    area: { sizeM },
    display: {
      verticalExaggeration,
      waterDepthPalette,
      showFlowVectors,
      flowVectorSpacingM: clampArrowSpacing(flowVectorSpacingM),
    },
    map: { basemap, theme },
    disclaimerAcknowledgedAt,
  }
}
