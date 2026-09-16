import type { StepTimeSnapshot } from '../shared/perfProtocol'

/** 所要時間を持つ step の数（spec 06 §3 の「直近 300 step」） */
export const STEP_TIME_CAPACITY = 300
/** Worker が要約を送る間隔（ms） */
export const STEP_TIME_PUBLISH_MS = 1000

/** 並べ替え済みの値の p 分位（map/fpsStats.ts の percentile と同じ定義。Worker は map を import できないので写す） */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
}

export interface StepTimeRing {
  record(ms: number): void
  /** 1 つも記録していなければ null */
  snapshot(): StepTimeSnapshot | null
}

/**
 * 1 step の所要時間の輪（計測用のビルドの Worker だけが作る。計画で決めたこと 1）。
 * record は PlaybackScheduler の onStepTime に切り離して渡すので、this を使わない
 */
export function createStepTimeRing(capacity = STEP_TIME_CAPACITY): StepTimeRing {
  const values = new Float64Array(capacity)
  let total = 0
  return {
    record(ms) {
      values[total % capacity] = ms
      total++
    },
    snapshot() {
      if (total === 0) return null
      const samples = Math.min(total, capacity)
      // Float64Array の sort は数値の順に並べる
      const sorted = values.slice(0, samples).sort()
      return {
        type: 'stepTimes',
        total,
        samples,
        medianMs: percentileSorted(sorted, 0.5),
        p95Ms: percentileSorted(sorted, 0.95),
        maxMs: sorted[samples - 1] ?? 0,
      }
    },
  }
}
