import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { type Attribution, type Basemap, createGsiStyle } from './basemapStyle'

// MapLibre 6 は内部の Worker の URL を import.meta.url から組み立てるが、バンドル後はその場所に
// ファイルが無い。Vite に Worker をバンドルさせ、その URL を渡す
setWorkerUrl(workerUrl)

/** 初期表示: 日本全体（R01-5） */
export const INITIAL_VIEW = { center: [138.0, 36.0] as [number, number], zoom: 5 }

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
    for (const run of this.waiting.splice(0)) run()
  }
}
