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
  }

  destroy(): void {
    this.map.remove()
  }
}
