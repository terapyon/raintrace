import { describe, expect, it } from 'vitest'
import { ARROW_REFERENCE_SIZE_M, arrowSpacingForRange } from './arrowSpacing'

describe('arrowSpacingForRange（spec 05 §3.3、計画で決めたこと 18）', () => {
  it('選んだ間隔は 500 m の範囲での値。実際の間隔は範囲の一辺に比例する（1000 m の既定は 20 m）', () => {
    expect(ARROW_REFERENCE_SIZE_M).toBe(500)
    expect(arrowSpacingForRange(10, 500)).toBe(10)
    expect(arrowSpacingForRange(10, 1000)).toBe(20)
    expect(arrowSpacingForRange(10, 250)).toBe(5)
    expect(arrowSpacingForRange(20, 1000)).toBe(40)
  })

  it('1 辺あたりの矢印の本数は範囲によらず同じ（既定で約 50 本）', () => {
    for (const sizeM of [250, 500, 1000] as const) {
      expect(sizeM / arrowSpacingForRange(10, sizeM)).toBe(50)
    }
  })
})
