import type { MapMouseEvent } from 'maplibre-gl'
import { type SimulationClient, TerrainLoadError } from '../bridge/SimulationClient'
import { cellAt } from '../dem/gridRange'
import type { MapController } from '../map/MapController'
import { TerrainOverlay } from '../map/TerrainOverlay'
import { type AppStore, summarizeTerrain } from '../state/appStore'
import { formatUrlView, parseUrlView } from '../state/urlState'

const RANGE_SIZE_M = 500 // R02-4

/**
 * 地図のクリック → Worker での読み込み → 地図とパネルへの反映をつなぐ（spec 02）。React の外に置く。
 * 大きな配列は SimulationClient が持ち、ストアには要約だけを置く
 */
export class TerrainSession {
  readonly store: AppStore
  private readonly client: SimulationClient
  private overlay: TerrainOverlay | null = null
  private controller: MapController | null = null

  // Worker が異常終了してもストアは変えない。読み込み中なら、その要求の失敗（'worker'）が load() で
  // failed になる。表示中なら、メインは地形の複製を持つので、重ね描きもカーソル位置の標高もそのまま動く
  constructor(client: SimulationClient, store: AppStore) {
    this.client = client
    this.store = store
  }

  /** 地図のクリック・カーソル・移動を購読し、URL の地点を読む。戻り値で外す */
  attach(controller: MapController): () => void {
    const { map } = controller
    this.controller = controller
    this.overlay = new TerrainOverlay(map, (run) => controller.whenLoaded(run))

    const onClick = (event: MapMouseEvent): void => this.select(event.lngLat.lng, event.lngLat.lat)
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
    let urlTimer: ReturnType<typeof setTimeout> | undefined
    const onMoveEnd = (): void => {
      clearTimeout(urlTimer)
      urlTimer = setTimeout(() => this.writeUrl(), 300)
    }
    const unsubscribe = this.store.subscribe((state, previous) => {
      if (state.display !== previous.display) this.overlay?.setDisplay(state.display)
    })
    map.on('click', onClick)
    map.on('mousemove', onMove)
    map.on('moveend', onMoveEnd)

    const view = parseUrlView(window.location.search)
    if (view.point !== null) this.select(view.point.lon, view.point.lat)
    else if (view.zoom !== null) map.setZoom(view.zoom)

    return () => {
      map.off('click', onClick)
      map.off('mousemove', onMove)
      map.off('moveend', onMoveEnd)
      cancelAnimationFrame(frame)
      clearTimeout(urlTimer)
      unsubscribe()
      this.overlay?.clearTerrain()
      this.overlay?.destroy()
      this.overlay = null
      this.controller = null
    }
  }

  /** 地点を選び、読み込む */
  select(lon: number, lat: number): void {
    this.store.getState().selectPoint(lon, lat)
    this.overlay?.clearTerrain()
    this.overlay?.showSelection(lon, lat)
    this.writeUrl()
    void this.load(lon, lat)
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
      const terrain = await this.client.loadTerrain(lon, lat, RANGE_SIZE_M, (done, started) =>
        actions.setProgress(done, started),
      )
      actions.setTerrain(summarizeTerrain(terrain))
      // 表示の切り替えは読み込みの間にも変わりうるので、描く直前の値を取り直す
      this.overlay?.showTerrain(terrain, this.store.getState().display)
    } catch (error) {
      if (error instanceof TerrainLoadError && error.reason === 'superseded') return
      actions.setFailed(error instanceof TerrainLoadError ? error.reason : 'internal')
      // 「この地域には標高データがありません」のときは範囲を消す（spec 02 §7）
      this.overlay?.clearTerrain()
      console.error(error)
    }
  }

  private updateCursor(lon: number, lat: number): void {
    const terrain = this.client.terrain
    if (terrain === null || this.store.getState().load.status !== 'ready') return
    const cell = cellAt(terrain.geo, lon, lat)
    if (cell === null) {
      this.store.getState().setCursor({ kind: 'outside' })
      return
    }
    const index = cell.row * terrain.geo.size + cell.col
    this.store
      .getState()
      .setCursor(
        terrain.validMask[index] === 1
          ? { kind: 'value', meters: terrain.elevation[index] ?? 0 }
          : { kind: 'no-data' },
      )
  }

  private writeUrl(): void {
    const zoom = this.controller?.map.getZoom() ?? null
    const next = formatUrlView(window.location.search, {
      point: this.store.getState().selected,
      zoom,
    })
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${next}${window.location.hash}`,
    )
  }
}
