import { createStore, type StoreApi } from 'zustand/vanilla'
import type { PlaybackSpeed, SimFailureReason } from '../shared/protocol'
import type { SimulationEvent, StepStats } from '../simulation/types'

export type PlaybackStatus = 'idle' | 'running' | 'paused' | 'settled'
/** 再生の失敗の理由。worker は Worker の異常終了（「再読み込み」を出す） */
export type SimErrorReason = SimFailureReason | 'worker'
/** 画面に出す統計（越流イベントは spills に分ける） */
export type DisplayStats = Omit<StepStats, 'events'>

export interface SpillNotice {
  depressionId: number
  spillElevation: number
  step: number
}

export interface SimulationState {
  status: PlaybackStatus
  speed: PlaybackSpeed
  stats: DisplayStats | null
  stepsPerSecond: number
  spills: SpillNotice[]
  error: SimErrorReason | null
}

export interface SimulationActions {
  started(): void
  paused(): void
  resumed(): void
  /** 水を消して step 0 に戻る（Reset、地点の変更）。速度は残す */
  reset(): void
  setSpeed(speed: PlaybackSpeed): void
  setStats(stats: DisplayStats, stepsPerSecond: number): void
  /** 平衡に達して自動で止まった（spec 04 §5.2） */
  settle(stats: DisplayStats, stepsPerSecond: number): void
  addSpills(events: readonly SimulationEvent[]): void
  failed(reason: SimErrorReason): void
}

export type SimulationStore = StoreApi<SimulationState & SimulationActions>

/** 再生の一時状態（tech-spec §8.1。永続化しない）。統計は SimulationSession が 10Hz に間引いて入れる */
export function createSimulationStore(): SimulationStore {
  return createStore<SimulationState & SimulationActions>()((set) => ({
    status: 'idle',
    speed: 1,
    stats: null,
    stepsPerSecond: 0,
    spills: [],
    error: null,
    started: () => set({ status: 'running', error: null }),
    paused: () => set({ status: 'paused' }),
    resumed: () => set({ status: 'running' }),
    reset: () => set({ status: 'idle', stats: null, stepsPerSecond: 0, spills: [], error: null }),
    setSpeed: (speed) => set({ speed }),
    setStats: (stats, stepsPerSecond) => set({ stats, stepsPerSecond }),
    settle: (stats, stepsPerSecond) => set({ status: 'settled', stats, stepsPerSecond }),
    addSpills: (events) =>
      set((state) => ({
        spills: [
          ...state.spills,
          ...events.map(({ depressionId, spillElevation, step }) => ({
            depressionId,
            spillElevation,
            step,
          })),
        ],
      })),
    // 失敗した実行の統計を出し続けない（タスク 4 のレビューの裁定 1）。stats: null は「まだ値が無い」と
    // 同じ意味にし、reset と同じ形にする
    failed: (reason) => set({ status: 'idle', error: reason, stats: null, stepsPerSecond: 0 }),
  }))
}
