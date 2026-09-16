/**
 * fps の集計（spec 05 §4.4。S の D15 の改定版と同じ指標）。S の spike/src/fps.ts から、集計を純粋な関数に切り出した。
 * 長いフレームは「そのランの中央値の 2.5 倍を超えた間隔」（60Hz なら約 41.7 ms）。固定の 33.4 ms は、ちょうど
 * 2 フレーム分の間隔が float の丸めで閾値の内外に揺れ、同じ条件で合否が入れ替わったため（S の報告 §3）
 */
import type { DemSourceKind } from './view3d/demSource'
import type { TileTimeSample } from './view3d/options'

export const PASS_FPS = 57
export const PASS_LONG_RATIO = 0.01
export const LONG_FRAME_MULTIPLIER = 2.5

/** 中央値を 1 フレーム分として、間隔を 1〜5（5 は 5 フレーム分以上）に丸めて数える（閾値を変えて再採点するため） */
export interface GapHistogram {
  g1: number
  g2: number
  g3: number
  g4: number
  g5plus: number
}

export interface FrameStats {
  frames: number
  meanFps: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  longFrameThresholdMs: number
  longFrames: number
  longFrameRatio: number
  gapHistogram: GapHistogram
  pass: boolean
}

/** ソースごとのタイルの作成（count は組み立てた数、cached は組み立て済みを使い回した数） */
export interface TileGenStats {
  count: number
  cached: number
  meanMs: number
  maxMs: number
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

function gapHistogram(deltas: readonly number[], medianMs: number): GapHistogram {
  const histogram: GapHistogram = { g1: 0, g2: 0, g3: 0, g4: 0, g5plus: 0 }
  if (medianMs <= 0) return histogram
  for (const d of deltas) {
    const n = Math.round(d / medianMs)
    if (n <= 1) histogram.g1++
    else if (n === 2) histogram.g2++
    else if (n === 3) histogram.g3++
    else if (n === 4) histogram.g4++
    else histogram.g5plus++
  }
  return histogram
}

/** フレームの間隔（ms）の並びを集計する */
export function summarizeFrames(deltas: readonly number[]): FrameStats {
  const sorted = [...deltas].sort((a, b) => a - b)
  const total = deltas.reduce((a, b) => a + b, 0)
  const p50Ms = percentile(sorted, 0.5)
  const longFrameThresholdMs = p50Ms * LONG_FRAME_MULTIPLIER
  const longFrames = deltas.filter((d) => d > longFrameThresholdMs).length
  const longFrameRatio = deltas.length === 0 ? 0 : longFrames / deltas.length
  const meanFps = total === 0 ? 0 : deltas.length / (total / 1000)
  return {
    frames: deltas.length,
    meanFps,
    p50Ms,
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
    longFrameThresholdMs,
    longFrames,
    longFrameRatio,
    gapHistogram: gapHistogram(deltas, p50Ms),
    pass: deltas.length > 0 && meanFps >= PASS_FPS && longFrameRatio <= PASS_LONG_RATIO,
  }
}

export function summarizeTileTimes(
  samples: readonly TileTimeSample[],
  source: DemSourceKind,
): TileGenStats {
  const ofSource = samples.filter((s) => s.source === source)
  const composed = ofSource.filter((s) => !s.cached).map((s) => s.composeMs)
  return {
    count: composed.length,
    cached: ofSource.length - composed.length,
    meanMs: mean(composed),
    maxMs: Math.max(0, ...composed),
  }
}
