import { describe, expect, it } from 'vitest'
import { createStepTimeRing, percentileSorted } from './stepTiming'

describe('percentileSorted（fpsStats.percentile と同じ定義）', () => {
  it('空なら 0、それ以外は ceil(p × 個数) 番目', () => {
    expect(percentileSorted([], 0.5)).toBe(0)
    expect(percentileSorted([1, 2, 3, 4], 0.5)).toBe(2)
    expect(percentileSorted([1, 2, 3, 4], 0.95)).toBe(4)
    expect(percentileSorted(Float64Array.of(5), 0.95)).toBe(5)
  })
})

describe('createStepTimeRing（直近 300 step の所要時間。spec 06 §3）', () => {
  it('何も記録していなければ null', () => {
    expect(createStepTimeRing().snapshot()).toBeNull()
  })

  it('記録した値の中央値・p95・最大と、通算の数を返す', () => {
    const ring = createStepTimeRing()
    for (const ms of [4, 1, 3, 2]) ring.record(ms)
    expect(ring.snapshot()).toEqual({
      type: 'stepTimes',
      total: 4,
      samples: 4,
      medianMs: 2,
      p95Ms: 4,
      maxMs: 4,
    })
  })

  it('容量を超えたら古い値から上書きし、要約は直近の容量ぶんだけで作る', () => {
    const ring = createStepTimeRing(3)
    for (const ms of [100, 1, 2, 3]) ring.record(ms)
    expect(ring.snapshot()).toMatchObject({ total: 4, samples: 3, medianMs: 2, maxMs: 3 })
  })

  it('既定の容量（300）を超えたら、301 個目で最も古い値を上書きする', () => {
    const ring = createStepTimeRing()
    for (let ms = 1; ms <= 301; ms++) ring.record(ms)
    const snapshot = ring.snapshot()
    expect(snapshot).toMatchObject({ total: 301, samples: 300, maxMs: 301 })
    // 301 個目（301ms）で容量 300 を超え、最も古い値（1ms）が上書きされる。要約は 2〜301 の 300 個になるので、
    // 中央値は（上書きが起きなければ 1〜300 の中央値である）150 ではなく 151 になる
    expect(snapshot?.medianMs).toBe(151)
  })

  it('record は切り離して渡しても動く（Worker は onStepTime: ring.record で渡す）', () => {
    const ring = createStepTimeRing()
    const { record } = ring
    record(7)
    expect(ring.snapshot()?.maxMs).toBe(7)
  })
})
