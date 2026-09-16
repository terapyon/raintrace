/**
 * 計測用のフックが最初から集める値（spec 06 §3、R06-5）。pnpm build:perf のときだけビルドに入る。
 * 要約は純粋な関数（perfCollectors.test.ts）、集める側はブラウザの API を使う
 */
import { percentile } from '../map/fpsStats'
import { PERF_CHANNEL, type StepTimeSnapshot } from '../shared/perfProtocol'

/** ブラウザの longtask（50 ms を超えたタスク）の 1 件 */
export interface LongTaskSample {
  startMs: number
  durationMs: number
}

export interface LongTaskSummary {
  /** ブラウザが longtask を出すか（false なら数 0 は「無かった」ではない） */
  supported: boolean
  count: number
  maxMs: number
  totalMs: number
}

/** [fromMs, toMs) に始まった長いタスクの要約 */
export function summarizeLongTasks(
  entries: readonly LongTaskSample[],
  supported: boolean,
  fromMs = Number.NEGATIVE_INFINITY,
  toMs = Number.POSITIVE_INFINITY,
): LongTaskSummary {
  const inWindow = entries.filter((entry) => entry.startMs >= fromMs && entry.startMs < toMs)
  return {
    supported,
    count: inWindow.length,
    maxMs: inWindow.reduce((max, entry) => Math.max(max, entry.durationMs), 0),
    totalMs: inWindow.reduce((sum, entry) => sum + entry.durationMs, 0),
  }
}

export interface LongTaskCollector {
  supported: boolean
  entries: LongTaskSample[]
}

/** 長いタスクを集め始める。buffered なので、フックの読み込みより前（起動・最初の読み込み）の分も拾う */
export function observeLongTasks(): LongTaskCollector {
  const entries: LongTaskSample[] = []
  const supported =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
  if (!supported) return { supported, entries }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      entries.push({ startMs: entry.startTime, durationMs: entry.duration })
    }
  }).observe({ type: 'longtask', buffered: true })
  return { supported, entries }
}

/** Worker の要約に、メインで受け取った時刻を付けたもの */
export interface TimedStepSnapshot extends StepTimeSnapshot {
  atMs: number
}

export interface StepTimeSummary {
  /** 窓の中で新しい step を含んだ要約の数 */
  snapshots: number
  /** 各要約の中央値の中央値（tech-spec §6.3 の中央値 8 ms と比べる） */
  medianMs: number | null
  /** 各要約の p95 の 95 パーセンタイル（tech-spec §6.3 の p95 16 ms と比べる） */
  p95Ms: number | null
  maxMs: number | null
}

/**
 * 1 秒ごとの要約の時系列をまとめる（計画で決めたこと 2）。Worker は止まっている間も同じ要約を送り続けるので、
 * total が前の要約より増えたものだけを使う（窓の前の要約も「前」に数える）
 */
export function summarizeStepSeries(
  series: readonly TimedStepSnapshot[],
  fromMs = Number.NEGATIVE_INFINITY,
  toMs = Number.POSITIVE_INFINITY,
): StepTimeSummary {
  const fresh: TimedStepSnapshot[] = []
  let lastTotal = Number.NEGATIVE_INFINITY
  for (const snapshot of series) {
    const isNew = snapshot.total > lastTotal
    lastTotal = Math.max(lastTotal, snapshot.total)
    if (isNew && snapshot.atMs >= fromMs && snapshot.atMs < toMs) fresh.push(snapshot)
  }
  if (fresh.length === 0) return { snapshots: 0, medianMs: null, p95Ms: null, maxMs: null }
  const medians = fresh.map((s) => s.medianMs).sort((a, b) => a - b)
  const p95s = fresh.map((s) => s.p95Ms).sort((a, b) => a - b)
  return {
    snapshots: fresh.length,
    medianMs: percentile(medians, 0.5),
    p95Ms: percentile(p95s, 0.95),
    maxMs: Math.max(...fresh.map((s) => s.maxMs)),
  }
}

export interface StepTimeListener {
  series: TimedStepSnapshot[]
}

/** 計測用のビルドの Worker が送る 1 step の所要時間の要約を受け始める（Task 2） */
export function listenStepTimes(): StepTimeListener {
  const series: TimedStepSnapshot[] = []
  const channel = new BroadcastChannel(PERF_CHANNEL)
  channel.onmessage = (event: MessageEvent<StepTimeSnapshot>) => {
    if (event.data?.type === 'stepTimes') series.push({ ...event.data, atMs: performance.now() })
  }
  return { series }
}
