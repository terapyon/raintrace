import { createStore, type StoreApi } from 'zustand/vanilla'
import {
  DEFAULT_PLAYBACK_SPEED,
  type PlaybackSpeed,
  type SimFailureReason,
} from '../shared/protocol'
import type { SimulationEvent, StepStats } from '../simulation/types'

/** 'settled' は自動で止まった状態（stopReason が settled でも cap でも。計画で決めたこと 20） */
export type PlaybackStatus = 'idle' | 'running' | 'paused' | 'settled'
/** 再生の失敗の理由。worker は Worker の異常終了（「再読み込み」を出す） */
export type SimErrorReason = SimFailureReason | 'worker'
/** 画面に出す統計（越流イベントは spills に分ける） */
export type DisplayStats = Omit<StepStats, 'events'>

export interface SpillNotice {
  depressionId: number
  spillElevation: number
  step: number
  /** 越流が始まったシミュレーションの時刻（s。spec 08 §6.2） */
  timeS: number
}

/** 今の実行の雨（spec 08 §6.2 の降雨の残りと総量に使う。計画で決めたこと 22） */
export interface RunRain {
  intensityMmPerH: number
  /** 継続時間（s） */
  durationS: number
}

export interface SimulationState {
  status: PlaybackStatus
  speed: PlaybackSpeed
  stats: DisplayStats | null
  stepsPerSecond: number
  /** 実際の倍率（実時間 1 秒あたりに進んだシミュレーションの秒。spec 08 §6.1） */
  simSecondsPerSecond: number
  run: RunRain | null
  spills: SpillNotice[]
  error: SimErrorReason | null
}

export interface SimulationActions {
  started(run?: RunRain): void
  paused(): void
  resumed(): void
  /** 水を消して step 0 に戻る（Reset、地点の変更）。速度は残す */
  reset(): void
  setSpeed(speed: PlaybackSpeed): void
  setStats(stats: DisplayStats, stepsPerSecond: number, simSecondsPerSecond?: number): void
  /** 自動で止まった（settled・cap。spec 08 §3.9） */
  settle(stats: DisplayStats, stepsPerSecond: number, simSecondsPerSecond?: number): void
  addSpills(events: readonly SimulationEvent[]): void
  failed(reason: SimErrorReason): void
}

export type SimulationStore = StoreApi<SimulationState & SimulationActions>

/** 再生の一時状態（tech-spec §8.1。永続化しない）。統計は SimulationSession が 10Hz に間引いて入れる */
export function createSimulationStore(): SimulationStore {
  return createStore<SimulationState & SimulationActions>()((set) => ({
    status: 'idle',
    speed: DEFAULT_PLAYBACK_SPEED,
    stats: null,
    stepsPerSecond: 0,
    simSecondsPerSecond: 0,
    run: null,
    spills: [],
    error: null,
    // 前の実行の統計を残さない（idle の間に届く ZERO_STATS で「降雨終了」が一瞬出るのを防ぐ。最終レビューの指摘 1）
    started: (run) =>
      set({
        status: 'running',
        error: null,
        run: run ?? null,
        stats: null,
        stepsPerSecond: 0,
        simSecondsPerSecond: 0,
      }),
    paused: () => set({ status: 'paused' }),
    resumed: () => set({ status: 'running' }),
    reset: () =>
      set({
        status: 'idle',
        stats: null,
        stepsPerSecond: 0,
        simSecondsPerSecond: 0,
        run: null,
        spills: [],
        error: null,
      }),
    setSpeed: (speed) => set({ speed }),
    setStats: (stats, stepsPerSecond, simSecondsPerSecond = 0) =>
      set({ stats, stepsPerSecond, simSecondsPerSecond }),
    settle: (stats, stepsPerSecond, simSecondsPerSecond = 0) =>
      set({ status: 'settled', stats, stepsPerSecond, simSecondsPerSecond }),
    addSpills: (events) =>
      set((state) => ({
        spills: [
          ...state.spills,
          ...events.map(({ depressionId, spillElevation, step, timeS }) => ({
            depressionId,
            spillElevation,
            step,
            timeS,
          })),
        ],
      })),
    // 失敗した実行の統計を出し続けない（04 のタスク 4 のレビューの裁定 1）。stats: null は「まだ値が無い」と
    // 同じ意味にし、reset と同じ形にする
    failed: (reason) =>
      set({
        status: 'idle',
        error: reason,
        stats: null,
        stepsPerSecond: 0,
        simSecondsPerSecond: 0,
        run: null,
      }),
  }))
}
