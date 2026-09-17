import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { type Attribution, type Basemap, createGsiStyle } from './basemapStyle'
import { OVERLAY_LAYER_ORDER } from './layerIds'
import { TERRAIN_LAYER_IDS } from './TerrainOverlay'
import { VIEW3D_LAYER_IDS } from './view3d/layerIds'
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
const OVERLAY_LAYER_IDS = [
  ...Object.values(TERRAIN_LAYER_IDS),
  ...Object.values(WATER_LAYER_IDS),
  ...Object.values(VIEW3D_LAYER_IDS),
]

/** MapLibre を React の外で生成・破棄する（tech-spec §5.3） */
export class MapController {
  readonly map: MapLibreMap
  private readonly attribution: Attribution
  private basemap: Basemap
  private loaded = false
  /**
   * 次の style.load で onRestyle の購読者を呼ぶ。setBasemap の後（02 の P2）と、WebGL のコンテキスト喪失の後
   * （復帰で MapLibre が保存したスタイルを setStyle で戻す。spec 05 §3.7）に立てる。最初の読み込みの style.load
   * では立っていないので、購読者を二重に呼ばない（計画で決めたこと 19）
   */
  private awaitingStyle = false
  private readonly waiting: (() => void)[] = []
  private readonly restyleListeners = new Set<() => void>()
  /** 直前に書いた値（present・visible・order を | でつないだ値）。変わらなければ書き直さない */
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
      // S の合格基準の視点（pitch 85）を実アプリで見る（計画で決めたこと 22）
      maxPitch: 85,
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
    // ベースマップの切り替えとコンテキストの復帰の後。最初の読み込みは上の load で扱う
    this.map.on('style.load', () => {
      if (!this.awaitingStyle) return
      this.awaitingStyle = false
      for (const listener of this.restyleListeners) listener()
      this.ready()
    })
    // コンテキスト喪失（spec 05 §3.7）。MapLibre はスタイルを破棄し、復帰で保存したスタイルを setStyle で戻す。
    // Custom Layer（水面）は戻らないので、次の style.load で onRestyle の購読者が足し直す。喪失の間はスタイルが
    // 無いので、whenLoaded を待たせ、印を空にする。最初の読み込みの前の喪失は、最初の load が扱う
    this.map.on('webglcontextlost', () => {
      if (!this.loaded && !this.awaitingStyle) return
      this.loaded = false
      this.awaitingStyle = true
      this.lastOverlayLayers = ''
      const { dataset } = this.map.getContainer()
      dataset.overlayLayers = ''
      dataset.visibleOverlayLayers = ''
      dataset.overlayOrder = ''
    })
    this.map.on('render', () => this.writeOverlayLayers())
  }

  /** 地図の読み込み（ベースマップの切り替えを含む）が済んでいればすぐに、まだなら済んだときに run を呼ぶ */
  whenLoaded(run: () => void): void {
    if (this.loaded) run()
    else this.waiting.push(run)
  }

  /**
   * 地図の読み込みが済んでいるか（ベースマップの切り替え・コンテキスト喪失の間は false）。setTerrain・addSource
   * などスタイルに触れる操作は whenLoaded の外から呼ぶと、MapLibre が Style is not done loading. で例外を
   * 投げる（Map.setTerrain は style._checkLoaded() から始まる）。render イベントは読み込み中も届くので、
   * View3d.afterRender はここを見てから境界の判定（checkBoundary）に進む（R1）
   */
  isLoaded(): boolean {
    return this.loaded
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
    this.awaitingStyle = true
    this.map.setStyle(createGsiStyle(basemap, this.attribution), { diff: false })
  }

  /** ベースマップの切り替えとコンテキストの復帰の後に呼ぶ。登録した順に呼ぶ（地形の重ね描きを先に、水を後に） */
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

  /**
   * 今のスタイルに実在する重ね描きのレイヤー ID を data-overlay-layers に、そのうち visibility が none でない
   * ものを data-visible-overlay-layers に、今のスタイルの実際の重なり順（下から上。Map.getLayersOrder）のうち
   * 重ね描きのレイヤーを data-overlay-order に、コンマ区切りで書く（E2E 用のフック。計画で決めたこと 21、
   * spec 06 Task 17）
   */
  private writeOverlayLayers(): void {
    const present = OVERLAY_LAYER_IDS.filter((id) => this.map.getLayer(id) !== undefined)
    const visible = present.filter((id) => this.map.getLayoutProperty(id, 'visibility') !== 'none')
    const order = this.map.getLayersOrder().filter((id) => OVERLAY_LAYER_ORDER.includes(id))
    const text = `${present.join(',')}|${visible.join(',')}|${order.join(',')}`
    if (text === this.lastOverlayLayers) return
    this.lastOverlayLayers = text
    const { dataset } = this.map.getContainer()
    dataset.overlayLayers = present.join(',')
    dataset.visibleOverlayLayers = visible.join(',')
    dataset.overlayOrder = order.join(',')
  }
}
