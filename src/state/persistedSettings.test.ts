import { describe, expect, it } from 'vitest'
import { ARROW_SPACINGS, clampArrowSpacing } from './persistedSettings'

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
