import { describe, expect, it } from 'vitest'
import {
  ARROW_SPACINGS,
  clampArrowSpacing,
  DEFAULT_SETTINGS,
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

describe('display.showOutflowCells（spec 07 §5.3、軽微 m2）', () => {
  /** v0.2.0 が保存した値（showOutflowCells が無い。注意事項は了解済み） */
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
    map: { basemap: 'pale', theme: 'system' },
    disclaimerAcknowledgedAt: '2026-09-20T01:02:03.000Z',
  }

  it('既定はオン', () => {
    expect(DEFAULT_SETTINGS.display.showOutflowCells).toBe(true)
  })

  it('v0.2.0 の保存値は捨てずに読み、注意事項の了解を残し、showOutflowCells を true で補う', () => {
    const parsed = parsePersistedSettings(V020)
    expect(parsed?.disclaimerAcknowledgedAt).toBe('2026-09-20T01:02:03.000Z')
    expect(parsed?.rainfall).toEqual({ amountMm: 120, radiusM: 30 })
    expect(parsed?.display.showOutflowCells).toBe(true)
  })

  it('保存された false はそのまま読む', () => {
    const parsed = parsePersistedSettings({
      ...V020,
      display: { ...V020.display, showOutflowCells: false },
    })
    expect(parsed?.display.showOutflowCells).toBe(false)
  })

  it.each<[string, unknown]>([
    ['文字列', 'yes'],
    ['null', null],
    ['数', 1],
  ])('型が違えば（%s）これまでどおり全体を捨てる（null）', (_, value) => {
    expect(
      parsePersistedSettings({ ...V020, display: { ...V020.display, showOutflowCells: value } }),
    ).toBeNull()
  })
})
