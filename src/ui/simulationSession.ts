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
  /**
   * 直前に送った start・reset の通し番号。frame・simFailed に同じ番号が載って返ってくるので、
   * 「今の実行」のものだけをストアへ反映できる（タスクレビューの重要な指摘・追加の裁定）。
   *
   * なぜ必要か: 以前は「水を消した step 0 の frame（ZERO_STATS）が届くまで無視する」という目印で
   * 実行の新旧を区別していたが、PlaybackScheduler の保留枠は 1 つしかなく（`playbackScheduler.ts` の
   * `pending`）、reset の直後に start が来ると、reset がまだ送れていない ZERO_STATS は start の
   * suspend()（discardPending()）でそのまま消えてしまう。バッファが尽きている（congestion）と
   * この discardPending がちょうど間に合ってしまい、reset の step 0 の frame が二度と届かず、
   * それ以降のすべての frame を無視し続けてしまう実害があった。runId は Worker 側では作らず、
   * ここ（メイン）だけが振る。frame・simFailed には常にその時点の runId をそのまま載せて返すだけ
   * なので、保留枠に何が残っていても取り違えない
   */
  private runId = 0

  constructor(client: SimulationClient, store: SimulationStore) {
    this.client = client
    this.store = store
    this.statsThrottle = createThrottle<StatsUpdate>(STATS_INTERVAL_MS, (u) =>
      this.store.getState().setStats(u.stats, u.stepsPerSecond),
    )
    client.onFrame((frame) => this.onFrame(frame))
    client.onSimFailed((reason, runId) => {
      if (this.terrain !== null && runId === this.runId) {
        // 間引き待ちの古い統計を、失敗の後に上書きしない（stats: null を保つ）
        this.statsThrottle.cancel()
        this.store.getState().failed(reason)
      }
    })
    client.onCrash(() => this.onCrash())
  }

  /** 新しい地点の読み込みを始めた。前の地形の水と統計を消す（地点の変更はリセット。spec 04 §3） */
  terrainCleared(): void {
    this.clearTerrainState()
    this.statsThrottle.cancel()
    this.store.getState().reset()
  }

  /** 地形を読み込んだ。center は降雨中心（範囲の中心。R04-2） */
  terrainReady(terrain: TerrainPayload, center: { lon: number; lat: number }): void {
    this.terrain = terrain
    this.center = center
    // Worker は loadTerrain の直後 runId を 0 にする（新しい地形では実行がまだ始まっていない）。
    // 異常終了で作り直した Worker も、terrainReady は必ず新しい読み込みの後に呼ばれるので、
    // ここで揃えておけば両者は常に同じ基準（0）から始まる
    this.runId = 0
    // 異常終了で作り直した Worker（新しい PlaybackScheduler）は速度 1・既定の矢印設定で始まり、
    // ストアが持つ今の速度とずれる。読み込みが済むたびに送り直して揃える（コントローラーの追加の裁定。
    // 矢印の設定はこの段階の session がまだ知らないので、矢印を扱う段になったら同様に送り直す）
    this.client.setSpeed(this.store.getState().speed)
  }

  start(amountMm: number, radiusM: number): void {
    if (this.terrain === null || this.center === null) return
    const { x, y } = gridPositionM(this.terrain.geo, this.center.lon, this.center.lat)
    this.runId += 1
    this.client.start({ x, y, radiusM, amountMm }, this.runId)
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
    this.runId += 1
    this.client.reset(this.runId)
    this.statsThrottle.cancel()
    this.store.getState().reset()
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.client.setSpeed(speed)
    this.store.getState().setSpeed(speed)
  }

  private onFrame(frame: FrameView): void {
    if (this.terrain === null) return
    // 今の実行のものだけを反映する（バッファの返却は SimulationClient 側でこれまでどおり行われる。
    // frame の受信そのものは止めない）
    if (frame.runId !== this.runId) return
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
    // idle の間（reset・失敗の直後）は settled でも状態を変えない
    this.statsThrottle.cancel()
    if (stats.settled && state.status === 'paused') state.settle(stats, frame.stepsPerSecond)
    else state.setStats(stats, frame.stepsPerSecond)
  }

  private onCrash(): void {
    this.statsThrottle.cancel()
    // 読み込み中の異常終了は、読み込みの失敗（'worker'）として TerrainSession が出す
    if (this.terrain !== null) {
      this.store.getState().failed('worker')
      // 異常終了の後、新しい Worker には地形が無い。command() が start・resume・step を黙って
      // 捨てるのに任せるだけでなく、session 自身も「地形が無い」状態にする。そうしないと start() が
      // ストアを running に進め、せっかく出した error: 'worker' を消してしまう
      // （UI 側の canStart のようなガードは、二重の安全策として残る）
      this.clearTerrainState()
    }
  }

  /** 地形・降雨中心をまとめて消す（terrainCleared・異常終了で使う） */
  private clearTerrainState(): void {
    this.terrain = null
    this.center = null
  }
}
