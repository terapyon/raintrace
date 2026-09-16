import { describe, expect, it } from 'vitest'
import { summarizeLongTasks, summarizeStepSeries, type TimedStepSnapshot } from './perfCollectors'

describe('summarizeLongTasks（spec 06 §3、計画で決めたこと 10）', () => {
  const entries = [
    { startMs: 100, durationMs: 60 },
    { startMs: 500, durationMs: 123 },
    { startMs: 900, durationMs: 51 },
  ]

  it('窓 [from, to) に始まったタスクの数・最大・合計', () => {
    expect(summarizeLongTasks(entries, true, 400, 1000)).toEqual({
      supported: true,
      count: 2,
      maxMs: 123,
      totalMs: 174,
    })
  })

  it('窓を省けば全部。無ければ数 0・最大 0', () => {
    expect(summarizeLongTasks(entries, true).count).toBe(3)
    expect(summarizeLongTasks([], false)).toEqual({
      supported: false,
      count: 0,
      maxMs: 0,
      totalMs: 0,
    })
  })
})

describe('summarizeStepSeries（計画で決めたこと 2）', () => {
  const snap = (atMs: number, total: number, medianMs: number, p95Ms: number, maxMs: number) =>
    ({ type: 'stepTimes', atMs, total, samples: 300, medianMs, p95Ms, maxMs }) as TimedStepSnapshot

  it('新しい step を含む要約（total が増えたもの）だけで、中央値の中央値・p95 の 95 パーセンタイル・最大', () => {
    const series = [
      snap(1000, 300, 1, 2, 3),
      snap(2000, 900, 3, 6, 9),
      snap(3000, 900, 3, 6, 9), // 止まった後の同じ要約（数えない）
      snap(4000, 1500, 2, 4, 20),
    ]
    expect(summarizeStepSeries(series)).toEqual({
      snapshots: 3,
      medianMs: 2,
      p95Ms: 6,
      maxMs: 20,
    })
  })

  it('窓で絞る。窓の前の要約と同じ total のものは新しい要約とみなさない', () => {
    const series = [snap(1000, 300, 1, 2, 3), snap(2000, 300, 1, 2, 3), snap(3000, 600, 5, 7, 8)]
    expect(summarizeStepSeries(series, 1500, 3500)).toEqual({
      snapshots: 1,
      medianMs: 5,
      p95Ms: 7,
      maxMs: 8,
    })
  })

  it('無ければ null', () => {
    expect(summarizeStepSeries([])).toEqual({
      snapshots: 0,
      medianMs: null,
      p95Ms: null,
      maxMs: null,
    })
  })
})
