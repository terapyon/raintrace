import { describe, expect, it } from 'vitest'
import { summarizeLongTasks } from './perfCollectors'
import { stepLongTaskEntries, summarizeDt } from './perfSteps'

describe('summarizeDt（spec 08 §7.3 の dt の中央値と最小。10 Hz の統計の標本）', () => {
  it('標本が無ければ null', () => {
    expect(summarizeDt([])).toBeNull()
  })

  it('数・中央値（偶数個は下側）・最小', () => {
    expect(summarizeDt([1, 0.5, 0.25, 1])).toEqual({ count: 4, medianS: 0.5, minS: 0.25 })
    expect(summarizeDt([0.3])).toEqual({ count: 1, medianS: 0.3, minS: 0.3 })
  })
})

describe('stepLongTaskEntries（[from, to) の長いタスクの一覧。LoadReport.longTasks.entries と同じ形。spec 06 M4 Task 13a）', () => {
  it('窓の外は落とし、窓の中だけ開始と長さで返す', () => {
    const entries = [
      { startMs: 0, durationMs: 60 },
      { startMs: 100, durationMs: 53 },
      { startMs: 200, durationMs: 70 },
    ]
    expect(stepLongTaskEntries(entries, 100, 200)).toEqual([{ startMs: 100, durationMs: 53 }])
  })

  it('summarizeLongTasks と同じ [from, to) を渡せば、件数が summary.count と一致する（runStepsProbe は両方を同じ start・end で呼ぶ）', () => {
    const entries = [
      { startMs: 50, durationMs: 55 },
      { startMs: 150, durationMs: 60 },
    ]
    const filtered = stepLongTaskEntries(entries, 50, 150)
    expect(filtered).toHaveLength(summarizeLongTasks(entries, true, 50, 150).count)
  })
})
