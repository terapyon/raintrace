import { type GeoJSONSource, type Map as MapLibreMap, Marker } from 'maplibre-gl'
import type { TerrainPayload } from '../shared/protocol'
import { ensureArrowImage } from './arrowImage'
import { depressionRgba, elevationRgba } from './colormap'
import { beforeLayerId, TERRAIN_LAYER_IDS } from './layerIds'
import { flowFeatures, markerFeatures, outlineFeature } from './terrainFeatures'

/** ストアの DisplaySettings と同じ形（map は state に依存しない） */
export interface OverlayDisplay {
  elevation: boolean
  depressions: boolean
  flow: boolean
  flowSpacingM: number
}

export { TERRAIN_LAYER_IDS } from './layerIds'

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
  // 段に分けて足す途中で restore（全部を同期で足す）が走ったら増やし、待っている段を捨てる。generation とは
  // 分ける（読み込み待ちの showTerrain を restore が取り消さないように）
  private stages = 0

  private readonly onMarkerDragEnd: (lon: number, lat: number) => void

  constructor(
    map: MapLibreMap,
    whenMapLoaded: (run: () => void) => void,
    onMarkerDragEnd: (lon: number, lat: number) => void = () => {},
  ) {
    this.map = map
    this.whenMapLoaded = whenMapLoaded
    this.onMarkerDragEnd = onMarkerDragEnd
  }

  showSelection(lon: number, lat: number): void {
    this.marker ??= this.createMarker()
    this.marker.setLngLat([lon, lat]).addTo(this.map)
  }

  /** 降雨マーカー。ドラッグで動かせ、離した位置が新しい地点になる（spec 04 §4） */
  private createMarker(): Marker {
    const marker = new Marker({ color: '#d32f2f', draggable: true })
    marker.on('dragend', () => {
      const p = marker.getLngLat()
      this.onMarkerDragEnd(p.lng, p.lat)
    })
    return marker
  }

  showTerrain(terrain: TerrainPayload, display: OverlayDisplay): void {
    this.display = display
    // 読み込みを待つ間に別の地形が来たり、消されたりしたら、古い方は描かない
    const generation = ++this.generation
    this.whenMapLoaded(() => {
      if (generation !== this.generation) return
      this.removeLayers()
      this.terrain = terrain
      const { corners } = terrain.geo
      this.map.fitBounds([corners[3], corners[1]], { padding: 40, duration: 0 })
      // 標高の canvas（1000 m で数十 ms）と残りを別々のタスクで足し、読み込みの終わりの長いタスクを分ける
      // （spec 06 §5.2、Task 17）。重なり順は足す順によらず OVERLAY_LAYER_ORDER で決まる
      this.later(generation, () => {
        this.addElevationLayer()
        this.later(generation, () => this.addRemainingLayers())
      })
    })
  }

  /**
   * run を次のタスクで、地図の読み込みを待ってから呼ぶ。その間に別の地形が来た・消された・ベースマップを
   * 切り替えた（restore が全部を足す）なら呼ばない
   */
  private later(generation: number, run: () => void): void {
    const stages = this.stages
    setTimeout(() => {
      this.whenMapLoaded(() => {
        const current = generation === this.generation && stages === this.stages
        if (current && this.terrain !== null) run()
      })
    }, 0)
  }

  /**
   * 覚えている地形（this.terrain）と表示の設定（this.display）で、ソース・レイヤー・画像を同期で全部足す。
   * restore（ベースマップの切り替えの後）から呼ぶ。showTerrain は同じものを 2 つのタスクに分けて足す
   */
  private addAll(): void {
    this.addElevationLayer()
    this.addRemainingLayers()
  }

  /** 標高の canvas のレイヤーを足す（段 1） */
  private addElevationLayer(): void {
    const terrain = this.terrain
    if (terrain === null || this.display === null) return
    const range = terrain.elevationRange ?? { min: 0, max: 0 }
    this.addCanvasLayer(
      TERRAIN_LAYER_IDS.elevation,
      elevationRgba(terrain.elevation, terrain.validMask, range.min, range.max),
      0.75,
    )
  }

  /**
   * 窪地の canvas・範囲の枠・流向・最低点を足し、表示の設定を適用する（段 2）。待つ間に表示の設定が変わりうる
   * ので、描く時点で覚えている設定を使う（showTerrain・setDisplay が先に代入するので、地形があれば null ではない）
   */
  private addRemainingLayers(): void {
    const terrain = this.terrain
    const display = this.display
    if (terrain === null || display === null) return
    this.flowSpacingM = display.flowSpacingM
    const { corners } = terrain.geo
    // depressions は地形解析の配列のまま渡す（絞り込み・並べ替えをしない）。depressionRgba はラベル label の
    // 窪地を depressions[label − 1] で引く（窪地の id は 1 から順）。エンジンの setDepressions に
    // significant だけを渡すのは Worker（workers/simulationRunner.ts）で、ここは絞らない
    this.addCanvasLayer(
      TERRAIN_LAYER_IDS.depressions,
      depressionRgba(terrain.fill, terrain.elevation, terrain.labels, terrain.depressions),
      0.85,
    )
    this.map.addSource(TERRAIN_LAYER_IDS.outline, {
      type: 'geojson',
      data: outlineFeature(corners),
    })
    this.map.addLayer(
      {
        id: TERRAIN_LAYER_IDS.outline,
        type: 'line',
        source: TERRAIN_LAYER_IDS.outline,
        paint: { 'line-color': '#d32f2f', 'line-width': 2 },
      },
      this.beforeId(TERRAIN_LAYER_IDS.outline),
    )
    ensureArrowImage(this.map, ARROW_IMAGE, '#263238')
    this.map.addSource(TERRAIN_LAYER_IDS.flow, {
      type: 'geojson',
      data: flowFeatures(terrain, this.flowSpacingM),
    })
    this.map.addLayer(
      {
        id: TERRAIN_LAYER_IDS.flow,
        type: 'symbol',
        source: TERRAIN_LAYER_IDS.flow,
        layout: {
          'icon-image': ARROW_IMAGE,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-size': 0.6,
        },
      },
      this.beforeId(TERRAIN_LAYER_IDS.flow),
    )
    this.map.addSource(TERRAIN_LAYER_IDS.markers, {
      type: 'geojson',
      data: markerFeatures(terrain),
    })
    this.map.addLayer(
      {
        id: TERRAIN_LAYER_IDS.markers,
        type: 'circle',
        source: TERRAIN_LAYER_IDS.markers,
        paint: {
          'circle-radius': 6,
          'circle-color': ['match', ['get', 'kind'], 'lowest', '#1565c0', '#ef6c00'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      this.beforeId(TERRAIN_LAYER_IDS.markers),
    )
    // 最低点のレイヤーを足した後なので、下の setDisplay の条件（最低点のレイヤーがある）を満たして適用される
    this.setDisplay(display)
    this.map.getContainer().dataset.rangeShown = 'true'
  }

  /** ベースマップの切り替えで消えたソース・レイヤー・画像を、覚えている地形と表示の設定で足し直す（冪等） */
  restore(): void {
    if (this.terrain === null) return
    // 段の途中で切り替えたら、ここで全部を足し、待っている段は捨てる（二重に addLayer しない）。generation は
    // 増やさない（切り替えの間に来た次の地形の showTerrain は、このあと whenMapLoaded の待ちから描く）
    this.stages++
    this.removeMapObjects()
    this.addAll()
  }

  /** 表示の設定を覚え、地形を描いていれば適用する */
  setDisplay(display: OverlayDisplay): void {
    this.display = display
    const terrain = this.terrain
    // 地形が無い、ベースマップの切り替えの途中（レイヤーが消えている）、または段に分けて足す途中（最後に足す
    // 最低点のレイヤーがまだ無い）なら覚えるだけ。restore・段 2 の終わりが使う
    if (terrain === null || this.map.getLayer(TERRAIN_LAYER_IDS.markers) === undefined) return
    const visibility = (visible: boolean): 'visible' | 'none' => (visible ? 'visible' : 'none')
    this.map.setLayoutProperty(
      TERRAIN_LAYER_IDS.elevation,
      'visibility',
      visibility(display.elevation),
    )
    this.map.setLayoutProperty(
      TERRAIN_LAYER_IDS.depressions,
      'visibility',
      visibility(display.depressions),
    )
    this.map.setLayoutProperty(TERRAIN_LAYER_IDS.flow, 'visibility', visibility(display.flow))
    if (display.flowSpacingM !== this.flowSpacingM) {
      this.flowSpacingM = display.flowSpacingM
      this.map
        .getSource<GeoJSONSource>(TERRAIN_LAYER_IDS.flow)
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
    this.removeMapObjects()
    delete this.map.getContainer().dataset.rangeShown
    this.terrain = null
  }

  /** レイヤーとソースだけを消す（this.terrain には触らない）。restore が足し直す前の掃除に使う */
  private removeMapObjects(): void {
    for (const id of Object.values(TERRAIN_LAYER_IDS)) {
      if (this.map.getLayer(id) !== undefined) this.map.removeLayer(id)
      if (this.map.getSource(id) !== undefined) this.map.removeSource(id)
    }
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
    this.map.addLayer(
      {
        id,
        type: 'raster',
        source: id,
        paint: { 'raster-opacity': opacity, 'raster-resampling': 'nearest' },
      },
      this.beforeId(id),
    )
  }

  /** id を重ね描きの並び（OVERLAY_LAYER_ORDER）どおりに置くための beforeId */
  private beforeId(id: string): string | undefined {
    return beforeLayerId(id, (other) => this.map.getLayer(other) !== undefined)
  }
}
