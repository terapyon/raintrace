import { describe, expect, it } from 'vitest'
import { summarizeLongTasks } from './perfCollectors'
import { minutesAt1x, stepLongTaskEntries } from './perfSteps'

describe('minutesAt1x（1x は毎秒 60 step。R04-5・R06-6 の報告用）', () => {
  it('step 数 ÷ 60 を分にする（04 の綾瀬 267,379 step は約 74 分）', () => {
    expect(minutesAt1x(3600)).toBe(1)
    expect(minutesAt1x(267_379)).toBeCloseTo(74.27, 2)
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
