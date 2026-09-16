/**
 * 計測用のビルド（pnpm build:perf）だけで使う、Worker から計測用のフックへの知らせ（spec 06 §3、R06-5）。
 * SimulationClient のメッセージ（protocol.ts）とは別の BroadcastChannel で送り、通常のメッセージの形を変えない。
 * 通常のビルドでは、送る側（simulation.worker.ts）も受ける側（ui/perfCollectors.ts）も __RAINTRACE_PERF__ の
 * 分岐ごと消える（この名前が通常のビルドの出力に無いことを grep で確かめる。計画で決めたこと 1）
 */
export const PERF_CHANNEL = 'raintrace-perf'

/** 直近の step の所要時間の要約（Worker が 1 秒ごとに送る） */
export interface StepTimeSnapshot {
  type: 'stepTimes'
  /** これまでに記録した step の数（再生をまたいで数える。Worker を作り直すと 0 から） */
  total: number
  /** 要約に使った step の数（直近の容量ぶんまで） */
  samples: number
  medianMs: number
  p95Ms: number
  maxMs: number
}
