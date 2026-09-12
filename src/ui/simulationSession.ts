import type { FrameView, SimulationClient } from '../bridge/SimulationClient'
import { gridPositionM } from '../dem/gridRange'
import type { PlaybackSpeed, TerrainPayload } from '../shared/protocol'
import type { DisplayStats, SimulationStore } from '../state/simulationStore'
import { createThrottle, type Throttle } from '../state/throttle'

/** 統計をストアへ入れる間隔（10Hz。tech-spec §5.1） */
export const STATS_INTERVAL_MS = 100

interface StatsUpdate {
  stats: DisplayStats
  stepsPerSecond: number
}

/**
 * 再生の命令と、frame → ストア・地図のつなぎ（spec 04 §5.3）。React の外に置く。
 * 水深の配列は SimulationClient が持ち、ストアには小さな値だけを入れる
 */
export class SimulationSession {
  readonly store: SimulationStore
  private readonly client: SimulationClient
  private readonly statsThrottle: Throttle<StatsUpdate>
  private terrain: TerrainPayload | null = null
  private center: { lon: number; lat: number } | null = null

  constructor(client: SimulationClient, store: SimulationStore) {
    this.client = client
    this.store = store
    this.statsThrottle = createThrottle<StatsUpdate>(STATS_INTERVAL_MS, (u) =>
      this.store.getState().setStats(u.stats, u.stepsPerSecond),
    )
    client.onFrame((frame) => this.onFrame(frame))
    client.onSimFailed((reason) => {
      if (this.terrain !== null) {
        // 間引き待ちの古い統計を、失敗の後に上書きしない（stats: null を保つ）
        this.statsThrottle.cancel()
        this.store.getState().failed(reason)
      }
    })
    client.onCrash(() => this.onCrash())
  }

  /** 新しい地点の読み込みを始めた。前の地形の水と統計を消す（地点の変更はリセット。spec 04 §3） */
  terrainCleared(): void {
    this.terrain = null
    this.center = null
    this.statsThrottle.cancel()
    this.store.getState().reset()
  }

  /** 地形を読み込んだ。center は降雨中心（範囲の中心。R04-2） */
  terrainReady(terrain: TerrainPayload, center: { lon: number; lat: number }): void {
    this.terrain = terrain
    this.center = center
    // 異常終了で作り直した Worker（新しい PlaybackScheduler）は速度 1・既定の矢印設定で始まり、
    // ストアが持つ今の速度とずれる。読み込みが済むたびに送り直して揃える（コントローラーの追加の裁定。
    // 矢印の設定はこの段階の session がまだ知らないので、矢印を扱う段になったら同様に送り直す）
    this.client.setSpeed(this.store.getState().speed)
  }

  start(amountMm: number, radiusM: number): void {
    if (this.terrain === null || this.center === null) return
    const { x, y } = gridPositionM(this.terrain.geo, this.center.lon, this.center.lat)
    this.client.start({ x, y, radiusM, amountMm })
    this.store.getState().started()
  }

  pause(): void {
    this.client.pause()
    this.store.getState().paused()
  }

  /** 地形の読み込み中（terrain が無い）は送らない。Worker はまだ古い地形のままなので実行しない（レビューの裁定 2） */
  resume(): void {
    if (this.terrain === null) return
    this.client.resume()
    this.store.getState().resumed()
  }

  /** 地形の読み込み中は送らない（レビューの裁定 2） */
  step(): void {
    if (this.terrain === null) return
    this.client.step()
  }

  reset(): void {
    this.client.reset()
    this.statsThrottle.cancel()
    this.store.getState().reset()
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.client.setSpeed(speed)
    this.store.getState().setSpeed(speed)
  }

  private onFrame(frame: FrameView): void {
    if (this.terrain === null) return
    const { events, ...stats } = frame.stats
    const state = this.store.getState()
    if (events.length > 0) state.addSpills(events)
    const update = { stats, stepsPerSecond: frame.stepsPerSecond }
    if (state.status === 'running') {
      if (stats.settled) {
        this.statsThrottle.cancel()
        state.settle(stats, frame.stepsPerSecond)
      } else {
        this.statsThrottle.push(update)
      }
      return
    }
    // 止まっている間の frame（Step・Reset・矢印の切り替え）はすぐに入れる。
    // Reset の直後に届く前の frame が settled でも、idle のままにする
    this.statsThrottle.cancel()
    if (stats.settled && state.status === 'paused') state.settle(stats, frame.stepsPerSecond)
    else state.setStats(stats, frame.stepsPerSecond)
  }

  private onCrash(): void {
    this.statsThrottle.cancel()
    // 読み込み中の異常終了は、読み込みの失敗（'worker'）として TerrainSession が出す
    if (this.terrain !== null) this.store.getState().failed('worker')
  }
}
