import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { type Attribution, type Basemap, createGsiStyle } from './basemapStyle'
import { TERRAIN_LAYER_IDS } from './TerrainOverlay'
import { WATER_LAYER_IDS } from './WaterOverlay'

// MapLibre 6 は内部の Worker の URL を import.meta.url から組み立てるが、バンドル後はその場所に
// ファイルが無い。Vite に Worker をバンドルさせ、その URL を渡す
setWorkerUrl(workerUrl)

/** 初期表示: 日本全体（R01-5） */
export const INITIAL_VIEW = { center: [138.0, 36.0] as [number, number], zoom: 5 }

// テストが読む印（E2E 用のフック）。重ね描きのレイヤー ID を、覚えている「べき」状態ではなく、
// map.getLayer() で今のスタイルに実在するかを render のたびに数えて data-overlay-layers に書く。
// TerrainOverlay の data-range-shown はレイヤーを足した事実（addAll）を覚えるだけで、
// setStyle でスタイルごと消えても消されないため、ベースマップの切り替えでレイヤーが戻っているかの
// 確かめには使えない（Task 13 のレビュー指摘）。
// idle ではなく render を使う: 水深の canvas ソースは animate: true（毎フレーム内容が変わる前提）なので、
// 地形を表示した地図はほぼ常に再描画し続け、idle が二度と来ない（実ブラウザで確認済み）。render は
// その animate: true のせいでどのみち高頻度に来るので、そこに相乗りする（変化が無ければ書かない）
const OVERLAY_LAYER_IDS = [...Object.values(TERRAIN_LAYER_IDS), ...Object.values(WATER_LAYER_IDS)]

/** MapLibre を React の外で生成・破棄する（tech-spec §5.3） */
export class MapController {
  readonly map: MapLibreMap
  private readonly attribution: Attribution
  private basemap: Basemap
  private loaded = false
  /** setBasemap の後、style.load を待っている */
  private switching = false
  private readonly waiting: (() => void)[] = []
  private readonly restyleListeners = new Set<() => void>()
  /** 直前に data-overlay-layers へ書いた値。render のたびの再計算で、変わらなければ書き直さない */
  private lastOverlayLayers = ''

  constructor(container: HTMLElement, attribution: Attribution, basemap: Basemap = 'pale') {
    this.attribution = attribution
    this.basemap = basemap
    this.map = new MapLibreMap({
      container,
      style: createGsiStyle(basemap, attribution),
      center: INITIAL_VIEW.center,
      zoom: INITIAL_VIEW.zoom,
      maxZoom: 18,
      // 出典は常に表示する（tech-spec §16.1）。compact だと狭い画面で折りたたまれる
      attributionControl: { compact: false },
      keyboard: true,
    })
    // WebGL のコンテキストの生成の失敗などは、例外ではなく error イベントで届く。
    // 01 では記録だけを行い、画面への表示は後続の spec のエラー処理で扱う
    this.map.on('error', (event) => {
      console.error(event.error)
    })
    // 地図と同時に購読するので、load を取り逃さない。isStyleLoaded() はタイルの読み込み中に false を返すので使わない
    this.map.once('load', () => this.ready())
    // ベースマップの切り替えの後（setBasemap）。最初の読み込みは上の load で扱う
    this.map.on('style.load', () => {
      if (!this.switching) return
      this.switching = false
      for (const listener of this.restyleListeners) listener()
      this.ready()
    })
    this.map.on('render', () => this.writeOverlayLayers())
  }

  /** 地図の読み込み（ベースマップの切り替えを含む）が済んでいればすぐに、まだなら済んだときに run を呼ぶ */
  whenLoaded(run: () => void): void {
    if (this.loaded) run()
    else this.waiting.push(run)
  }

  /**
   * ベースマップを切り替える（spec 04 §2）。スタイルの入れ替えで、重ね描きのソース・レイヤー・画像が消える
   * （02 の申し送り P2）。style.load で onRestyle の購読者が足し直す。diff: false で必ず入れ替えて
   * style.load を起こす（差分の適用で済むと style.load が来ず、足し直しの契機が無い）
   */
  setBasemap(basemap: Basemap): void {
    if (basemap === this.basemap) return
    this.basemap = basemap
    this.loaded = false
    this.switching = true
    this.map.setStyle(createGsiStyle(basemap, this.attribution), { diff: false })
  }

  /** ベースマップの切り替えの後に呼ぶ。登録した順に呼ぶ（地形の重ね描きを先に、水を後に） */
  onRestyle(listener: () => void): () => void {
    this.restyleListeners.add(listener)
    return () => {
      this.restyleListeners.delete(listener)
    }
  }

  destroy(): void {
    this.map.remove()
  }

  private ready(): void {
    this.loaded = true
    // 今のスタイルが読み終わった時点の basemap（E2E 用のフック）
    this.map.getContainer().dataset.basemap = this.basemap
    for (const run of this.waiting.splice(0)) run()
  }

  /** 今のスタイルに実在する重ね描きのレイヤー ID を、コンマ区切りで data-overlay-layers に書く（E2E 用のフック） */
  private writeOverlayLayers(): void {
    const present = OVERLAY_LAYER_IDS.filter((id) => this.map.getLayer(id) !== undefined).join(',')
    if (present === this.lastOverlayLayers) return
    this.lastOverlayLayers = present
    this.map.getContainer().dataset.overlayLayers = present
  }
}
