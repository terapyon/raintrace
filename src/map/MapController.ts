import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { type Attribution, createGsiPaleStyle } from './gsiStyle'

// MapLibre 6 は内部の Worker の URL を import.meta.url から組み立てるが、バンドル後はその場所に
// ファイルが無い。Vite に Worker をバンドルさせ、その URL を渡す
setWorkerUrl(workerUrl)

/** 初期表示: 日本全体（R01-5） */
export const INITIAL_VIEW = { center: [138.0, 36.0] as [number, number], zoom: 5 }

/** MapLibre を React の外で生成・破棄する（tech-spec §5.3） */
export class MapController {
  readonly map: MapLibreMap
  private loaded = false
  private readonly waiting: (() => void)[] = []

  constructor(container: HTMLElement, attribution: Attribution) {
    this.map = new MapLibreMap({
      container,
      style: createGsiPaleStyle(attribution),
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
    this.map.once('load', () => {
      this.loaded = true
      for (const run of this.waiting.splice(0)) run()
    })
  }

  /** 地図の最初の読み込みが済んでいればすぐに、まだなら済んだときに run を呼ぶ */
  whenLoaded(run: () => void): void {
    if (this.loaded) run()
    else this.waiting.push(run)
  }

  destroy(): void {
    this.map.remove()
  }
}
