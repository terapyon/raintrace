import { describe, expect, it } from 'vitest'
import { estimateCompareMinutes } from './compareEstimate'

const base = { wholeRange: true, radiusM: 10, durationMin: 360 }

describe('estimateCompareMinutes', () => {
  // 実測（docs/perf/2026-10-19-fill-collapse.md）との比。2 倍以内
  it.each([
    ['酒々井 500 m', { sizeM: 500, cellSizeM: 3.879 }, 2.5],
    ['酒々井 1000 m', { sizeM: 1000, cellSizeM: 3.879 }, 12.5],
    ['熱海 500 m', { sizeM: 500, cellSizeM: 0.977 }, 120],
    ['熱海 1000 m', { sizeM: 1000, cellSizeM: 0.977 }, 300],
  ])('範囲全体・60 mm/h × 360 分: %s は実測の 0.5〜2 倍', (_, site, measured) => {
    const est = estimateCompareMinutes({ ...base, ...site })
    expect(est).toBeGreaterThan(measured / 2)
    expect(est).toBeLessThan(measured * 2)
  })

  it('雨が短いほど、半径が小さいほど軽い', () => {
    const site = { sizeM: 500, cellSizeM: 0.977 }
    const whole = estimateCompareMinutes({ ...base, ...site })
    expect(estimateCompareMinutes({ ...base, ...site, durationMin: 60 })).toBeCloseTo(whole / 6, 6)
    const r10 = estimateCompareMinutes({ ...base, ...site, wholeRange: false })
    const r100 = estimateCompareMinutes({ ...base, ...site, wholeRange: false, radiusM: 100 })
    expect(r10).toBeLessThan(whole / 30)
    expect(r100).toBeGreaterThan(r10)
    expect(r100).toBeLessThan(whole)
  })

  it('半径の円が範囲いっぱいなら範囲全体と同じ（上限）', () => {
    const site = { sizeM: 500, cellSizeM: 3.879 }
    expect(estimateCompareMinutes({ ...base, ...site, wholeRange: false, radiusM: 250 })).toBe(
      estimateCompareMinutes({ ...base, ...site }),
    )
  })

  it('セルの大きさが不正なら 0', () => {
    expect(estimateCompareMinutes({ ...base, sizeM: 500, cellSizeM: 0 })).toBe(0)
  })
})
