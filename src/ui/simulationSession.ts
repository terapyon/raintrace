import type { FrameView, SimulationClient } from '../bridge/SimulationClient'
import { gridPositionM } from '../dem/gridRange'
import type { MapController } from '../map/MapController'
import { WaterOverlay } from '../map/WaterOverlay'
import type { WaterPalette } from '../map/waterColormap'
import { waterArrowFeatures } from '../map/waterFeatures'
import type { ArrowSpacingM, PlaybackSpeed, TerrainPayload } from '../shared/protocol'
import type { SettingsState, SettingsStore } from '../state/settingsStore'
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
  private overlay: WaterOverlay | null = null
  private readonly arrowsThrottle: Throttle<Float32Array>
  private arrowSettings: { visible: boolean; spacingM: ArrowSpacingM } = {
    visible: true,
    spacingM: 10,
  }
  private palette: WaterPalette = 'stepped'
  /** 地形の読み込み・消去の購読者（3D。spec 05 §3.6） */
  private readonly terrainListeners = new Set<(terrain: TerrainPayload | null) => void>()
  /** 今の実行の水深の購読者（3D。Reset の後の古い frame は runId で捨ててから渡す。計画で決めたこと 14） */
  private readonly waterListeners = new Set<(water: Float32Array | null) => void>()
  /** 2D の水深の canvas を出すか（3D の間は隠す。計画で決めたこと 16） */
  private depthCanvasVisible = true

  constructor(client: SimulationClient, store: SimulationStore, settings: SettingsStore) {
    this.client = client
    this.store = store
    this.statsThrottle = createThrottle<StatsUpdate>(STATS_INTERVAL_MS, (u) =>
      this.store.getState().setStats(u.stats, u.stepsPerSecond),
    )
    // 矢印の地図への反映は 10Hz に間引く（spec 04 §6.2）
    this.arrowsThrottle = createThrottle<Float32Array>(STATS_INTERVAL_MS, (arrows) => {
      if (this.terrain !== null) {
        this.overlay?.setArrows(waterArrowFeatures(arrows, this.terrain.geo))
      }
    })
    client.onFrame((frame) => this.onFrame(frame))
    client.onSimFailed((reason, runId) => {
      if (this.terrain !== null && runId === this.runId) {
        // 間引き待ちの古い統計を、失敗の後に上書きしない（stats: null を保つ）
        this.statsThrottle.cancel()
        // simFailed の直前に SimulationClient が今の水深バッファを Worker へ返却済み（detach 済み）なので、
        // overlay が古い（切り離された）配列をなお参照し続けないよう、明示的に消す（レビューの追加指摘）
        this.clearWater()
        this.store.getState().failed(reason)
      }
    })
    client.onCrash(() => this.onCrash())

    // 矢印の表示・間隔と水深の配色は設定のストアが持つ（tech-spec §8.1）。ここで初期値を反映し、以後の変更も購読する
    const apply = (display: SettingsState['display']): void => {
      this.setArrows(display.showFlowVectors, display.flowVectorSpacingM)
      this.setPalette(display.waterDepthPalette)
    }
    apply(settings.getState().display)
    settings.subscribe((state, previous) => {
      if (state.display !== previous.display) apply(state.display)
    })
  }

  /** 新しい地点の読み込みを始めた。前の地形の水と統計を消す（地点の変更はリセット。spec 04 §3） */
  terrainCleared(): void {
    this.clearTerrainState()
    this.statsThrottle.cancel()
    this.arrowsThrottle.cancel()
    this.overlay?.clear()
    this.store.getState().reset()
    for (const listener of this.terrainListeners) listener(null)
    for (const listener of this.waterListeners) listener(null)
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
    // ストアが持つ今の速度とずれる。読み込みが済むたびに送り直して揃える（コントローラーの追加の裁定）
    this.client.setSpeed(this.store.getState().speed)
    this.overlay?.show(terrain.geo)
    this.client.setArrows(this.arrowSettings.visible, this.arrowSettings.spacingM)
    for (const listener of this.terrainListeners) listener(terrain)
  }

  /** 地図ができたら水深と矢印のレイヤーを置く。戻り値で外す */
  attach(
    controller: MapController,
    createOverlay: (
      map: MapController['map'],
      whenLoaded: (run: () => void) => void,
    ) => WaterOverlay = (map, whenLoaded) => new WaterOverlay(map, whenLoaded),
  ): () => void {
    const overlay = createOverlay(controller.map, (run) => controller.whenLoaded(run))
    overlay.setPalette(this.palette)
    overlay.setArrowsVisible(this.arrowSettings.visible)
    overlay.setDepthVisible(this.depthCanvasVisible)
    if (this.terrain !== null) overlay.show(this.terrain.geo)
    this.overlay = overlay
    return () => {
      this.arrowsThrottle.cancel()
      overlay.clear()
      this.overlay = null
    }
  }

  /** 水の流れの矢印の表示と間隔。非表示なら Worker は flowVectors() を呼ばない */
  setArrows(visible: boolean, spacingM: ArrowSpacingM): void {
    this.arrowSettings = { visible, spacingM }
    this.overlay?.setArrowsVisible(visible)
    if (this.terrain !== null) this.client.setArrows(visible, spacingM)
  }

  setPalette(palette: WaterPalette): void {
    this.palette = palette
    this.overlay?.setPalette(palette)
  }

  /** ベースマップの切り替えで消えた水深と矢印のレイヤーを足し直す */
  restoreOverlay(): void {
    this.overlay?.restore()
  }

  /** 地形を読み込んだ（地形）・新しい地点の読み込みを始めた（null）を知らせる。戻り値で外す */
  onTerrain(listener: (terrain: TerrainPayload | null) => void): () => void {
    this.terrainListeners.add(listener)
    return () => {
      this.terrainListeners.delete(listener)
    }
  }

  /** 今の実行の水深（frame のバッファ。次の frame まで有効）と、消えたとき（null）を知らせる。戻り値で外す */
  onWater(listener: (water: Float32Array | null) => void): () => void {
    this.waterListeners.add(listener)
    return () => {
      this.waterListeners.delete(listener)
    }
  }

  setDepthCanvasVisible(visible: boolean): void {
    this.depthCanvasVisible = visible
    this.overlay?.setDepthVisible(visible)
  }

  start(amountMm: number, radiusM: number): void {
    if (this.terrain === null || this.center === null) return
    const { x, y } = gridPositionM(this.terrain.geo, this.center.lon, this.center.lat)
    this.runId += 1
    this.client.start({ x, y, radiusM, amountMm }, this.runId)
    this.clearWater()
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
    this.clearWater()
    this.store.getState().reset()
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.client.setSpeed(speed)
    this.store.getState().setSpeed(speed)
  }

  private onFrame(frame: FrameView): void {
    if (this.terrain === null) return
    // 今の実行のものだけを反映する（バッファの返却は SimulationClient 側でこれまでどおり行われる。
    // frame の受信そのものは止めない）。overlay・矢印への反映もこの判定の後に置き、古い runId の frame が
    // client.onFrame を素通りしても overlay まで届かないようにする（タスク 6 のレビューの追加指摘）
    if (frame.runId !== this.runId) return
    // 着色は描画フレームごとに最新の 1 つだけ（WaterOverlay）。矢印は null なら前のまま
    this.overlay?.setWater(frame.water)
    for (const listener of this.waterListeners) listener(frame.water)
    if (frame.arrows !== null) this.arrowsThrottle.push(frame.arrows)
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
      // Worker が居なくなった以上、それが持っていた水深・矢印はもう更新されない。overlay に古い絵を
      // 残さない（レビューの追加指摘。simFailed と同じ理由）
      this.clearWater()
      this.store.getState().failed('worker')
      // 異常終了の後、新しい Worker には地形が無い。command() が start・resume・step を黙って
      // 捨てるのに任せるだけでなく、session 自身も「地形が無い」状態にする。そうしないと start() が
      // ストアを running に進め、せっかく出した error: 'worker' を消してしまう
      // （UI 側の canStart のようなガードは、二重の安全策として残る）
      this.clearTerrainState()
    }
  }

  /**
   * 表示の水と矢印をすぐに消し、間引き待ちの古い矢印も取り消す（reset・start・失敗・異常終了）。
   * runId が進んだ後に古い実行の frame が届くと、SimulationClient は前のバッファを Worker へ返すが、
   * その frame は overlay に渡らない。消しておかないと、overlay が返却済み（切り離し済み）のバッファを
   * 参照し続ける（最終レビューの軽微）
   */
  private clearWater(): void {
    this.arrowsThrottle.cancel()
    this.overlay?.setWater(null)
    this.overlay?.clearArrows()
    for (const listener of this.waterListeners) listener(null)
  }

  /** 地形・降雨中心をまとめて消す（terrainCleared・異常終了で使う） */
  private clearTerrainState(): void {
    this.terrain = null
    this.center = null
  }
}
