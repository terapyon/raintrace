import type { MapMouseEvent } from 'maplibre-gl'
import { type SimulationClient, TerrainLoadError } from '../bridge/SimulationClient'
import { wrapLongitude } from '../dem/tileMath'
import type { MapController } from '../map/MapController'
import { type OverlayDisplay, TerrainOverlay } from '../map/TerrainOverlay'
import { type AppStore, summarizeTerrain } from '../state/appStore'
import { arrowSpacingForRange } from '../state/arrowSpacing'
import { type ClickEvent, type ClickTarget, reduceClick } from '../state/clickState'
import { createDebounce, type Debounce } from '../state/debounce'
import type { SettingsStore } from '../state/settingsStore'
import { formatUrlView, parseUrlView } from '../state/urlState'
import { type CellInfo, cellInfoAt } from './cellInfo'
import type { SimulationSession } from './simulationSession'
import { View3dSession } from './view3dSession'

/**
 * 地図のクリック → Worker での読み込み → 地図とパネルへの反映をつなぐ（spec 02）。React の外に置く。
 * 大きな配列は SimulationClient が持ち、ストアには要約だけを置く
 */
export class TerrainSession {
  readonly store: AppStore
  private readonly client: SimulationClient
  readonly simulation: SimulationSession
  private readonly settings: SettingsStore
  /** 2D と 3D の切り替えと 3D の表示（spec 05 §3.6） */
  readonly view3d: View3dSession
  private overlay: TerrainOverlay | null = null
  private controller: MapController | null = null
  // URL の書き込みは、変更（地点の選択・地図の移動・雨量や範囲の変更）から 300ms 置いてまとめて行う（spec 04 §7）
  private readonly urlDebounce: Debounce = createDebounce(() => this.writeUrl(), 300)

  // Worker が異常終了してもストアは変えない。読み込み中なら、その要求の失敗（'worker'）が load() で
  // failed になる。表示中なら、メインは地形の複製を持つので、重ね描きもカーソル位置の標高もそのまま動く
  constructor(
    client: SimulationClient,
    store: AppStore,
    simulation: SimulationSession,
    settings: SettingsStore,
  ) {
    this.client = client
    this.store = store
    this.simulation = simulation
    this.settings = settings
    this.view3d = new View3dSession(simulation, store, settings)
  }

  /** 地形の重ね描きの表示。矢印の間隔は設定のストア（水の流れと共通）を範囲に比例させた値（spec 05 §3.3） */
  private overlayDisplay(): OverlayDisplay {
    const { display, area } = this.settings.getState()
    return {
      ...this.store.getState().display,
      flowSpacingM: arrowSpacingForRange(display.flowVectorSpacingM, area.sizeM),
    }
  }

  /** 地図のクリック・カーソル・移動を購読し、URL の地点を読む。戻り値で外す */
  attach(controller: MapController): () => void {
    const { map } = controller
    this.controller = controller
    this.overlay = new TerrainOverlay(
      map,
      (run) => controller.whenLoaded(run),
      (lon, lat) => this.dispatchClick({ type: 'marker-drag-end', lon, lat }),
    )
    // 水のレイヤーは地形のレイヤーの後に置く（水が上に重なるよう、TerrainOverlay を先に作る）
    const detachWater = this.simulation.attach(controller)
    // ベースマップの切り替えの後に、地形 → 水の順に足し直す（水は地形のレイヤーの間に入れる）
    const offRestyle = controller.onRestyle(() => {
      this.overlay?.restore()
      this.simulation.restoreOverlay()
    })
    // 3D の足し直しは 04 の重ね描きの足し直しの後に行う（onRestyle は登録した順に呼ばれる）
    const detach3d = this.view3d.attach(controller)

    const onClick = (event: MapMouseEvent): void => {
      const { lng, lat } = event.lngLat
      // event.point は地図の要素の中の座標。ポップオーバーはビューポートの座標で置くので、要素の左上を足す
      // （地図の要素が画面の左上から始まるとは限らない）
      const rect = map.getContainer().getBoundingClientRect()
      this.dispatchClick({
        type: 'map-click',
        target: this.clickTarget(lng, lat),
        lon: lng,
        lat,
        x: rect.left + event.point.x,
        y: rect.top + event.point.y,
      })
    }
    let frame = 0
    let pending: { lng: number; lat: number } | null = null
    // カーソル位置の標高は、描画フレームごとに 1 回だけストアへ反映する（spec 02 §6.2）
    const onMove = (event: MapMouseEvent): void => {
      pending = event.lngLat
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        if (pending !== null) this.updateCursor(pending.lng, pending.lat)
      })
    }
    const unsubscribe = this.store.subscribe((state, previous) => {
      if (state.display !== previous.display) this.overlay?.setDisplay(this.overlayDisplay())
    })
    const unsubscribeSettings = this.settings.subscribe((state, previous) => {
      // 範囲の大きさの変更は、同じ地点を読み込み直してリセットする（spec 04 §3）
      if (state.area.sizeM !== previous.area.sizeM) this.retry()
      if (state.display.flowVectorSpacingM !== previous.display.flowVectorSpacingM) {
        this.overlay?.setDisplay(this.overlayDisplay())
      }
      if (state.rainfall !== previous.rainfall || state.area !== previous.area) {
        this.urlDebounce.schedule()
      }
    })
    map.on('click', onClick)
    map.on('mousemove', onMove)
    map.on('moveend', this.urlDebounce.schedule)

    const view = parseUrlView(window.location.search)
    if (view.point !== null) {
      // 読み込みの間も地点の周りを見せる。範囲が出たら fitBounds で合わせ直す
      if (view.zoom !== null) {
        map.jumpTo({ center: [view.point.lon, view.point.lat], zoom: view.zoom })
      }
      this.select(view.point.lon, view.point.lat)
    } else if (view.zoom !== null) map.setZoom(view.zoom)

    return () => {
      detach3d()
      map.off('click', onClick)
      map.off('mousemove', onMove)
      map.off('moveend', this.urlDebounce.schedule)
      cancelAnimationFrame(frame)
      this.urlDebounce.cancel()
      unsubscribe()
      unsubscribeSettings()
      offRestyle()
      detachWater()
      this.overlay?.clearTerrain()
      this.overlay?.destroy()
      this.overlay = null
      this.controller = null
    }
  }

  /** 地点を選び、読み込む。経度は [−180, 180) に収めてから、ストア・マーカー・URL・Worker に渡す */
  select(lon: number, lat: number): void {
    const wrappedLon = wrapLongitude(lon)
    this.store.getState().selectPoint(wrappedLon, lat)
    this.simulation.terrainCleared()
    this.overlay?.clearTerrain()
    this.overlay?.showSelection(wrappedLon, lat)
    this.urlDebounce.schedule()
    void this.load(wrappedLon, lat)
  }

  /** 失敗した読み込みをやり直す。Worker が止まっていれば、SimulationClient が次の要求で起動し直す */
  retry(): void {
    const { selected } = this.store.getState()
    if (selected !== null) this.select(selected.lon, selected.lat)
  }

  private async load(lon: number, lat: number): Promise<void> {
    // zustand のアクションは変わらないので、ここで一度だけ取り出してよい
    const actions = this.store.getState()
    try {
      const sizeM = this.settings.getState().area.sizeM
      const terrain = await this.client.loadTerrain(lon, lat, sizeM, (done, started) =>
        actions.setProgress(done, started),
      )
      actions.setTerrain(summarizeTerrain(terrain))
      // 表示の切り替えは読み込みの間にも変わりうるので、描く直前の値を取り直す
      this.overlay?.showTerrain(terrain, this.overlayDisplay())
      this.simulation.terrainReady(terrain, { lon, lat })
    } catch (error) {
      const reason = error instanceof TerrainLoadError ? error.reason : 'internal'
      // 新しい地点の読み込みに置き換わった。ストアはもう新しい地点の読み込み中なので、何もしない
      if (reason === 'superseded') return
      actions.setFailed(reason)
      // 「この地域には標高データがありません」のときは範囲を消す（spec 02 §7）
      this.overlay?.clearTerrain()
      console.error(error)
    }
  }

  /** 地図のクリック・ポップオーバーのボタン・マーカーのドラッグ（spec 04 §4）。遷移は clickState.ts */
  dispatchClick(event: ClickEvent): void {
    const { popover, select } = reduceClick(this.store.getState().popover, event)
    this.store.getState().setPopover(popover)
    if (select !== null) this.select(select.lon, select.lat)
  }

  /** 地点のセルの標高・水深・水位。範囲の外や地形が無ければ null */
  cellInfo(lon: number, lat: number): CellInfo | null {
    const terrain = this.client.terrain
    if (terrain === null) return null
    return cellInfoAt(terrain, this.client.water, lon, lat)
  }

  private clickTarget(lon: number, lat: number): ClickTarget {
    if (this.client.terrain === null || this.store.getState().load.status !== 'ready') {
      return 'no-range'
    }
    return this.cellInfo(lon, lat) === null ? 'outside' : 'inside'
  }

  /** カーソル位置の標高（spec 02 §6.2）。02 の振る舞い（範囲の外は outside、無効セルは no-data）のまま、cellInfo で読む */
  private updateCursor(lon: number, lat: number): void {
    if (this.store.getState().load.status !== 'ready') return
    const info = this.cellInfo(lon, lat)
    this.store
      .getState()
      .setCursor(
        info === null
          ? { kind: 'outside' }
          : info.kind === 'value'
            ? { kind: 'value', meters: info.elevationM }
            : { kind: 'no-data' },
      )
  }

  private writeUrl(): void {
    const { rainfall, area } = this.settings.getState()
    const next = formatUrlView(window.location.search, {
      point: this.store.getState().selected,
      zoom: this.controller?.map.getZoom() ?? null,
      sizeM: area.sizeM,
      amountMm: rainfall.amountMm,
      radiusM: rainfall.radiusM,
    })
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${next}${window.location.hash}`,
    )
  }
}
