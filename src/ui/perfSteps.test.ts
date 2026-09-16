import { describe, expect, it } from 'vitest'
import { minutesAt1x } from './perfSteps'

describe('minutesAt1x（1x は毎秒 60 step。R04-5・R06-6 の報告用）', () => {
  it('step 数 ÷ 60 を分にする（04 の綾瀬 267,379 step は約 74 分）', () => {
    expect(minutesAt1x(3600)).toBe(1)
    expect(minutesAt1x(267_379)).toBeCloseTo(74.27, 2)
  })
})
