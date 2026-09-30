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
/** 継続時間の選択肢（分。spec 08 §4.1、R08-7） */
export const DURATIONS_MIN = [10, 20, 30, 60, 120, 180, 360] as const
export type DurationMin = (typeof DURATIONS_MIN)[number]

/** 入力の範囲（spec 08 §4.1・§6.3、R08-7。半径は R04-6 のまま） */
export const INTENSITY_MM_PER_H = { min: 1, max: 300 } as const
export const RADIUS_MIN_M = 1
export const maxRadiusM = (sizeM: RangeSizeM): number => sizeM / 2

/** 雨の設定（spec 08 §6.4） */
export interface RainfallSettings {
  /** 時間雨量（mm/h）。1〜300 の整数 */
  intensityMmPerH: number
  durationMin: DurationMin
  /** 円の半径（m）。範囲全体に降らせる間は使わないが、値は残す */
  radiusM: number
  /** 範囲全体に降らせる（R08-4） */
  wholeRange: boolean
}

export interface PersistedSettings {
  schemaVersion: 2
  rainfall: RainfallSettings
  area: { sizeM: RangeSizeM }
  display: {
    verticalExaggeration: (typeof VERTICAL_EXAGGERATIONS)[number]
    waterDepthPalette: (typeof WATER_PALETTES)[number]
    /** 水の流れの矢印（spec 04 §6.2） */
    showFlowVectors: boolean
    /** 水の流れと地形の流向の矢印の間隔（計画で決めたこと 10） */
    flowVectorSpacingM: (typeof ARROW_SPACINGS)[number]
    /** 流出しているセルの表示（spec 07 §5.3）。v0.2.0 の保存値には無いので、欠けていれば true で補う */
    showOutflowCells: boolean
  }
  map: { basemap: Basemap; theme: ThemeMode }
  disclaimerAcknowledgedAt: string | null
}

/** 既定の雨（100 mm/h × 1 時間、半径 10 m、円。spec 08 §4.1。総量は 04 の既定の 100 mm と同じ） */
export const DEFAULT_RAINFALL: RainfallSettings = {
  intensityMmPerH: 100,
  durationMin: 60,
  radiusM: 10,
  wholeRange: false,
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  schemaVersion: 2,
  rainfall: DEFAULT_RAINFALL,
  area: { sizeM: 500 },
  display: {
    verticalExaggeration: 2,
    waterDepthPalette: 'stepped',
    showFlowVectors: true,
    flowVectorSpacingM: 10,
    showOutflowCells: true,
  },
  map: { basemap: 'pale', theme: 'system' },
  disclaimerAcknowledgedAt: null,
}

export function isValidIntensityMmPerH(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= INTENSITY_MM_PER_H.min &&
    value <= INTENSITY_MM_PER_H.max
  )
}

export function isDurationMin(value: unknown): value is DurationMin {
  return DURATIONS_MIN.includes(value as DurationMin)
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
 * ARROW_SPACING_INPUTS で検証した後の値だけを渡す（parsePersistedSettings と perfHook.ts が呼ぶ。R06-11）
 */
export function clampArrowSpacing(
  value: (typeof ARROW_SPACING_INPUTS)[number],
): (typeof ARROW_SPACINGS)[number] {
  return value === 5 ? 10 : value
}

/**
 * 保存値を検証する（tech-spec §8.3、spec 08 §6.4）。返すのは常に schemaVersion 2 の形。
 * - schemaVersion 2: すべての項目を検証し、どれかが欠けるか不正なら null（呼び出し側が既定値に戻す）
 * - schemaVersion 1（v0.2.0・07）: 雨量（amountMm）は読まず、時間雨量・継続時間・範囲全体を既定にする
 *   （R08-8、N1）。半径（radiusM）は R04-6 の検証を通れば残す。雨量以外の項目は今までと同じ規則で検証し、
 *   不正なら null（N2）
 * - それ以外の schemaVersion: null
 * どちらの版でも、欠けた showOutflowCells は true で補い（spec 07）、矢印の間隔 5 は 10 に読む（R06-11）
 */
export function parsePersistedSettings(value: unknown): PersistedSettings | null {
  if (!isRecord(value)) return null
  const version = value.schemaVersion
  if (version !== 1 && version !== 2) return null
  const { rainfall, area, display, map, disclaimerAcknowledgedAt } = value
  if (!isRecord(rainfall) || !isRecord(area) || !isRecord(display) || !isRecord(map)) return null
  const { sizeM } = area
  if (!oneOf(RANGE_SIZES, sizeM)) return null
  const { radiusM } = rainfall
  if (!isValidRadiusM(radiusM, sizeM)) return null
  let rain: RainfallSettings
  if (version === 2) {
    const { intensityMmPerH, durationMin, wholeRange } = rainfall
    if (
      !isValidIntensityMmPerH(intensityMmPerH) ||
      !isDurationMin(durationMin) ||
      typeof wholeRange !== 'boolean'
    ) {
      return null
    }
    rain = { intensityMmPerH, durationMin, radiusM, wholeRange }
  } else {
    // v1: 雨量は読み替えない（R08-8）。雨量だけを既定に戻し、半径は残す（N1）
    rain = { ...DEFAULT_RAINFALL, radiusM }
  }
  const { verticalExaggeration, waterDepthPalette, showFlowVectors, flowVectorSpacingM } = display
  // v0.2.0 の保存値には無い。欠けていれば既定の true で補い、了解の日時を含む他の設定を失わせない（spec 07 §5.3）
  const showOutflowCells = display.showOutflowCells === undefined ? true : display.showOutflowCells
  if (
    !oneOf(VERTICAL_EXAGGERATIONS, verticalExaggeration) ||
    !oneOf(WATER_PALETTES, waterDepthPalette) ||
    typeof showFlowVectors !== 'boolean' ||
    !oneOf(ARROW_SPACING_INPUTS, flowVectorSpacingM) ||
    typeof showOutflowCells !== 'boolean'
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
    schemaVersion: 2,
    rainfall: rain,
    area: { sizeM },
    display: {
      verticalExaggeration,
      waterDepthPalette,
      showFlowVectors,
      flowVectorSpacingM: clampArrowSpacing(flowVectorSpacingM),
      showOutflowCells,
    },
    map: { basemap, theme },
    disclaimerAcknowledgedAt,
  }
}
