import { describe, expect, it } from 'vitest'
import { percentile, summarizeFrames, summarizeTileTimes } from './fpsStats'

const FRAME = 1000 / 60
const frames = (count: number, ms = FRAME): number[] => Array.from({ length: count }, () => ms)

describe('summarizeFrames（S の D15 の改定版。spec 05 §4.4）', () => {
  it('60Hz にそろったランは平均 60 fps、長いフレーム 0、合格', () => {
    const stats = summarizeFrames(frames(300))
    expect(stats.meanFps).toBeCloseTo(60, 6)
    expect(stats.p50Ms).toBeCloseTo(FRAME, 6)
    expect(stats.longFrameThresholdMs).toBeCloseTo(FRAME * 2.5, 6)
    expect(stats.longFrames).toBe(0)
    expect(stats.gapHistogram).toEqual({ g1: 300, g2: 0, g3: 0, g4: 0, g5plus: 0 })
    expect(stats.pass).toBe(true)
  })

  it('長いフレーム（中央値の 2.5 倍を超える間隔）が 1% ちょうどなら合格、超えたら不合格', () => {
    const ok = summarizeFrames([...frames(297), ...frames(3, 50)])
    expect(ok.longFrames).toBe(3)
    expect(ok.longFrameRatio).toBeCloseTo(0.01, 9)
    expect(ok.meanFps).toBeGreaterThan(57)
    expect(ok.gapHistogram.g3).toBe(3)
    expect(ok.pass).toBe(true)
    const ng = summarizeFrames([...frames(296), ...frames(4, 50)])
    expect(ng.longFrames).toBe(4)
    expect(ng.pass).toBe(false)
  })

  it('ちょうど 2 フレーム分（33.3 ms）の揺れは長いフレームに数えない（固定 33.4 ms の閾値の揺れの対策）', () => {
    const stats = summarizeFrames([...frames(290), ...frames(10, FRAME * 2)])
    expect(stats.longFrames).toBe(0)
    expect(stats.gapHistogram.g2).toBe(10)
  })

  it('平均 57 fps 未満は長いフレームが無くても不合格', () => {
    expect(summarizeFrames(frames(300, 1000 / 56)).pass).toBe(false)
  })

  it('間隔が無ければ 0 で不合格', () => {
    expect(summarizeFrames([])).toMatchObject({ frames: 0, meanFps: 0, pass: false })
  })

  it('percentile は並べた配列の上側の値', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(sorted, 0.5)).toBe(5)
    expect(percentile(sorted, 0.95)).toBe(10)
    expect(percentile([], 0.5)).toBe(0)
  })
})

describe('summarizeTileTimes（タイルの作成をソースごとに数える）', () => {
  it('組み立てた数・使い回した数・組み立ての平均と最大（使い回しは時間に数えない）', () => {
    const samples = [
      { source: 'terrain' as const, composeMs: 4, cached: false },
      { source: 'terrain' as const, composeMs: 8, cached: false },
      { source: 'terrain' as const, composeMs: 0, cached: true },
      { source: 'hillshade' as const, composeMs: 6, cached: false },
    ]
    expect(summarizeTileTimes(samples, 'terrain')).toEqual({
      count: 2,
      cached: 1,
      meanMs: 6,
      maxMs: 8,
    })
    expect(summarizeTileTimes(samples, 'hillshade')).toEqual({
      count: 1,
      cached: 0,
      meanMs: 6,
      maxMs: 6,
    })
    expect(summarizeTileTimes([], 'terrain')).toEqual({ count: 0, cached: 0, meanMs: 0, maxMs: 0 })
  })
})
