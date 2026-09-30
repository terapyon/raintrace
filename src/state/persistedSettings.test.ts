import { describe, expect, it } from 'vitest'
import {
  ARROW_SPACINGS,
  clampArrowSpacing,
  DEFAULT_SETTINGS,
  DURATIONS_MIN,
  INTENSITY_MM_PER_H,
  isDurationMin,
  isValidIntensityMmPerH,
  parsePersistedSettings,
} from './persistedSettings'

describe('clampArrowSpacing（R06-11 の裁定 (a2): 矢印の 1 辺の本数の上限を全範囲で 50 にする。計画で決めたこと 19）', () => {
  it('ARROW_SPACINGS は 5 を含まない（選択肢から外した）', () => {
    expect(ARROW_SPACINGS).toEqual([10, 20])
  })

  it('選べる値（10・20）はそのまま返す', () => {
    expect(clampArrowSpacing(10)).toBe(10)
    expect(clampArrowSpacing(20)).toBe(20)
  })

  it('5（選択肢から外れた値）は 10 として読む（移行）', () => {
    expect(clampArrowSpacing(5)).toBe(10)
  })
})

/** v0.2.0 が保存した値（schemaVersion 1、showOutflowCells が無い。注意事項は了解済み） */
const V020 = {
  schemaVersion: 1,
  rainfall: { amountMm: 120, radiusM: 30 },
  area: { sizeM: 500 },
  display: {
    verticalExaggeration: 2,
    waterDepthPalette: 'stepped',
    showFlowVectors: true,
    flowVectorSpacingM: 10,
  },
  map: { basemap: 'photo', theme: 'dark' },
  disclaimerAcknowledgedAt: '2026-09-20T01:02:03.000Z',
}

/** 07 が保存した値（schemaVersion 1、showOutflowCells あり） */
const V07 = { ...V020, display: { ...V020.display, showOutflowCells: false } }

/** 08 が保存する値（schemaVersion 2） */
const V2 = {
  ...DEFAULT_SETTINGS,
  rainfall: { intensityMmPerH: 250, durationMin: 120, radiusM: 40, wholeRange: true },
  disclaimerAcknowledgedAt: '2026-09-30T00:00:00.000Z',
}

describe('雨の設定の形（spec 08 §4.1・§6.3・§6.4）', () => {
  it('既定は 100 mm/h・1 時間・半径 10 m・範囲全体オフ。schemaVersion は 2', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(2)
    expect(DEFAULT_SETTINGS.rainfall).toEqual({
      intensityMmPerH: 100,
      durationMin: 60,
      radiusM: 10,
      wholeRange: false,
    })
  })

  it('時間雨量は 1〜300 の整数、継続時間は 10・20・30・60・120・180・360 分', () => {
    expect(INTENSITY_MM_PER_H).toEqual({ min: 1, max: 300 })
    expect(DURATIONS_MIN).toEqual([10, 20, 30, 60, 120, 180, 360])
    for (const ok of [1, 100, 300]) expect(isValidIntensityMmPerH(ok)).toBe(true)
    for (const bad of [0, 301, 1.5, '100', Number.NaN])
      expect(isValidIntensityMmPerH(bad)).toBe(false)
    expect(isDurationMin(120)).toBe(true)
    for (const bad of [45, '60', 0]) expect(isDurationMin(bad)).toBe(false)
  })

  it('v2 の保存値はそのまま読む', () => {
    expect(parsePersistedSettings(V2)).toEqual(V2)
  })

  it.each<[string, Record<string, unknown>]>([
    ['v0.2.0（showOutflowCells なし）', V020],
    ['07（showOutflowCells あり）', V07],
    ['雨量が欠けている', { ...V020, rainfall: { radiusM: 30 } }],
    ['雨量が範囲外', { ...V020, rainfall: { amountMm: 5000, radiusM: 30 } }],
    ['雨量が文字列', { ...V020, rainfall: { amountMm: '120', radiusM: 30 } }],
  ])(
    'v1（%s）は雨量を読まず、時間雨量・継続時間・範囲全体を既定にする。半径と、ほかの設定（注意事項の了解を含む）は残す（R08-8、N1）',
    (_, saved) => {
      const parsed = parsePersistedSettings(saved)
      expect(parsed?.schemaVersion).toBe(2)
      expect(parsed?.rainfall).toEqual({
        intensityMmPerH: 100,
        durationMin: 60,
        radiusM: 30,
        wholeRange: false,
      })
      expect(parsed?.disclaimerAcknowledgedAt).toBe('2026-09-20T01:02:03.000Z')
      expect(parsed?.area).toEqual({ sizeM: 500 })
      expect(parsed?.map).toEqual({ basemap: 'photo', theme: 'dark' })
      expect(parsed?.display.verticalExaggeration).toBe(2)
    },
  )

  it('v1 の showOutflowCells は、欠けていれば true、あればその値（spec 07 §5.3）', () => {
    expect(parsePersistedSettings(V020)?.display.showOutflowCells).toBe(true)
    expect(parsePersistedSettings(V07)?.display.showOutflowCells).toBe(false)
  })

  it.each<[string, Record<string, unknown>]>([
    ['半径が欠けている', { ...V020, rainfall: { amountMm: 120 } }],
    ['半径が範囲の半分を超える', { ...V020, rainfall: { amountMm: 120, radiusM: 251 } }],
    ['範囲の大きさが候補に無い', { ...V020, area: { sizeM: 300 } }],
    ['ベースマップが候補に無い', { ...V020, map: { basemap: 'satellite', theme: 'dark' } }],
    [
      '表示の流出が真偽値でない',
      { ...V020, display: { ...V020.display, showOutflowCells: 'yes' } },
    ],
  ])('v1 で雨量以外（%s）が不正なら、今までどおり全体を捨てる（null。N2）', (_, saved) => {
    expect(parsePersistedSettings(saved)).toBeNull()
  })

  it.each<[string, unknown]>([
    ['時間雨量 0', { ...V2.rainfall, intensityMmPerH: 0 }],
    ['時間雨量 301', { ...V2.rainfall, intensityMmPerH: 301 }],
    ['時間雨量が整数でない', { ...V2.rainfall, intensityMmPerH: 1.5 }],
    ['時間雨量が文字列', { ...V2.rainfall, intensityMmPerH: '100' }],
    ['継続時間が選択肢に無い', { ...V2.rainfall, durationMin: 45 }],
    ['継続時間が欠けている', { intensityMmPerH: 100, radiusM: 10, wholeRange: false }],
    ['範囲全体が真偽値でない', { ...V2.rainfall, wholeRange: 'yes' }],
    ['v1 の形のまま', { amountMm: 100, radiusM: 10 }],
  ])('v2 で雨の設定が不正（%s）なら全体を捨てる（null）', (_, rainfall) => {
    expect(parsePersistedSettings({ ...V2, rainfall })).toBeNull()
  })

  it.each<[string, unknown]>([
    ['3', 3],
    ['無い', undefined],
    ['文字列の 2', '2'],
  ])('schemaVersion が 1・2 以外（%s）なら null', (_, schemaVersion) => {
    expect(parsePersistedSettings({ ...V2, schemaVersion })).toBeNull()
  })
})

describe('display.showOutflowCells（spec 07 §5.3、軽微 m2）', () => {
  it('既定はオン', () => {
    expect(DEFAULT_SETTINGS.display.showOutflowCells).toBe(true)
  })

  it.each<[string, unknown]>([
    ['文字列', 'yes'],
    ['null', null],
    ['数', 1],
  ])('型が違えば（%s）全体を捨てる（null）', (_, value) => {
    expect(
      parsePersistedSettings({ ...V2, display: { ...V2.display, showOutflowCells: value } }),
    ).toBeNull()
  })
})
