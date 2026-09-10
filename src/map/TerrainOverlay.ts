import { type GeoJSONSource, type Map as MapLibreMap, Marker } from 'maplibre-gl'
import type { TerrainPayload } from '../shared/protocol'
import { depressionRgba, elevationRgba } from './colormap'
import { flowFeatures, markerFeatures, outlineFeature } from './terrainFeatures'

/** ストアの DisplaySettings と同じ形（map は state に依存しない） */
export interface OverlayDisplay {
  elevation: boolean
  depressions: boolean
  flow: boolean
  flowSpacingM: number
}

const ID = {
  elevation: 'terrain-elevation',
  depressions: 'terrain-depressions',
  outline: 'terrain-outline',
  flow: 'terrain-flow',
  markers: 'terrain-markers',
} as const
const ARROW_IMAGE = 'terrain-flow-arrow'

/**
 * 範囲・地形解析の結果を地図に重ねる（spec 02 §6.1）。MapLibre を命令的に操作し、React には依存しない。
 * レイヤーの追加は地図の読み込みを待つ（whenMapLoaded。MapController.whenLoaded を渡す）
 */
export class TerrainOverlay {
  private readonly map: MapLibreMap
  private readonly whenMapLoaded: (run: () => void) => void
  private marker: Marker | null = null
  private terrain: TerrainPayload | null = null
  // 最新の表示の設定。地形が無い間や描画を待つ間に変わっても覚えておき、描くときに使う。
  // showTerrain・setDisplay が呼ばれるまでは null（ストアの既定値の写しを持たない）
  private display: OverlayDisplay | null = null
  // 描いた矢印の間隔。表示の設定の間隔と違えば、矢印を作り直す
  private flowSpacingM = 10
  private generation = 0

  constructor(map: MapLibreMap, whenMapLoaded: (run: () => void) => void) {
    this.map = map
    this.whenMapLoaded = whenMapLoaded
  }

  showSelection(lon: number, lat: number): void {
    this.marker ??= new Marker({ color: '#d32f2f' })
    this.marker.setLngLat([lon, lat]).addTo(this.map)
  }

  showTerrain(terrain: TerrainPayload, display: OverlayDisplay): void {
    this.display = display
    // 読み込みを待つ間に別の地形が来たり、消されたりしたら、古い方は描かない
    const generation = ++this.generation
    this.whenMapLoaded(() => {
      if (generation !== this.generation) return
      this.removeLayers()
      this.terrain = terrain
      // 待つ間に表示の設定が変わりうるので、描く時点で覚えている設定を使う（無ければ引数の display）
      this.flowSpacingM = (this.display ?? display).flowSpacingM
      const { corners } = terrain.geo
      const range = terrain.elevationRange ?? { min: 0, max: 0 }
      this.addCanvasLayer(
        ID.elevation,
        elevationRgba(terrain.elevation, terrain.validMask, range.min, range.max),
        0.75,
      )
      this.addCanvasLayer(
        ID.depressions,
        depressionRgba(terrain.fill, terrain.elevation, terrain.labels, terrain.depressions),
        0.85,
      )
      this.map.addSource(ID.outline, { type: 'geojson', data: outlineFeature(corners) })
      this.map.addLayer({
        id: ID.outline,
        type: 'line',
        source: ID.outline,
        paint: { 'line-color': '#d32f2f', 'line-width': 2 },
      })
      this.ensureArrowImage()
      this.map.addSource(ID.flow, {
        type: 'geojson',
        data: flowFeatures(terrain, this.flowSpacingM),
      })
      this.map.addLayer({
        id: ID.flow,
        type: 'symbol',
        source: ID.flow,
        layout: {
          'icon-image': ARROW_IMAGE,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-size': 0.6,
        },
      })
      this.map.addSource(ID.markers, { type: 'geojson', data: markerFeatures(terrain) })
      this.map.addLayer({
        id: ID.markers,
        type: 'circle',
        source: ID.markers,
        paint: {
          'circle-radius': 6,
          'circle-color': ['match', ['get', 'kind'], 'lowest', '#1565c0', '#ef6c00'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      this.setDisplay(this.display ?? display)
      this.map.getContainer().dataset.rangeShown = 'true'
      this.map.fitBounds([corners[3], corners[1]], { padding: 40, duration: 0 })
    })
  }

  /** 表示の設定を覚え、地形を描いていれば適用する */
  setDisplay(display: OverlayDisplay): void {
    this.display = display
    const terrain = this.terrain
    if (terrain === null) return
    const visibility = (visible: boolean): 'visible' | 'none' => (visible ? 'visible' : 'none')
    this.map.setLayoutProperty(ID.elevation, 'visibility', visibility(display.elevation))
    this.map.setLayoutProperty(ID.depressions, 'visibility', visibility(display.depressions))
    this.map.setLayoutProperty(ID.flow, 'visibility', visibility(display.flow))
    if (display.flowSpacingM !== this.flowSpacingM) {
      this.flowSpacingM = display.flowSpacingM
      this.map
        .getSource<GeoJSONSource>(ID.flow)
        ?.setData(flowFeatures(terrain, display.flowSpacingM))
    }
  }

  /** 範囲の枠と重ね描きを消す（マーカーは残す）。読み込みを待っている描画も取り消す */
  clearTerrain(): void {
    this.generation++
    this.removeLayers()
  }

  destroy(): void {
    this.marker?.remove()
    this.marker = null
  }

  /** レイヤー・ソースと範囲の表示の印を消す。generation には触らない（待っている描画は取り消さない） */
  private removeLayers(): void {
    for (const id of Object.values(ID)) {
      if (this.map.getLayer(id) !== undefined) this.map.removeLayer(id)
      if (this.map.getSource(id) !== undefined) this.map.removeSource(id)
    }
    delete this.map.getContainer().dataset.rangeShown
    this.terrain = null
  }

  private addCanvasLayer(id: string, rgba: Uint8ClampedArray<ArrayBuffer>, opacity: number): void {
    const terrain = this.terrain
    if (terrain === null) return
    const { size, corners } = terrain.geo
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    canvas.getContext('2d')?.putImageData(new ImageData(rgba, size, size), 0, 0)
    // 内容が変わらないので animate: false（spec 02 §6.1。04 の水深は animate: true）
    this.map.addSource(id, { type: 'canvas', canvas, coordinates: corners, animate: false })
    this.map.addLayer({
      id,
      type: 'raster',
      source: id,
      paint: { 'raster-opacity': opacity, 'raster-resampling': 'nearest' },
    })
  }

  /** 流向の矢印の画像（北向き）を一度だけ作る。外部の画像を読まない（CSP） */
  private ensureArrowImage(): void {
    if (this.map.hasImage(ARROW_IMAGE)) return
    const size = 24
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (context === null) return
    context.fillStyle = '#263238'
    context.beginPath()
    context.moveTo(size / 2, 2)
    context.lineTo(size - 5, size - 4)
    context.lineTo(size / 2, size - 9)
    context.lineTo(5, size - 4)
    context.closePath()
    context.fill()
    const { data } = context.getImageData(0, 0, size, size)
    this.map.addImage(ARROW_IMAGE, { width: size, height: size, data: new Uint8Array(data.buffer) })
  }
}
