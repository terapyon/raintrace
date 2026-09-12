import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Corners } from '../dem/gridRange'
import { ensureArrowImage } from './arrowImage'
import { TERRAIN_LAYER_IDS } from './TerrainOverlay'
import type { PointCollection } from './terrainFeatures'
import { type WaterPalette, waterRgba } from './waterColormap'

export const WATER_LAYER_IDS = { water: 'water-depth', arrows: 'water-arrows' } as const
const ARROW_IMAGE = 'water-flow-arrow'
const EMPTY: PointCollection<{ bearing: number }> = { type: 'FeatureCollection', features: [] }

interface Target {
  corners: Corners
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  rgba: Uint8ClampedArray<ArrayBuffer>
  image: ImageData
}

/**
 * 水深の 2D 表示（spec 04 §6.1、R04-7）と水の流れの矢印（§6.2）。範囲の四隅に合わせた canvas ソースを
 * animate: true で置き、描画フレームごとに最新の水深だけを着色する（届いた frame が多くても 1 回）。
 * 水深の配列は SimulationClient が持つもので、ここでは参照するだけ。client は次の frame で古い方を Worker へ
 * 返す（転送で切り離す）。Reset の後に古い実行の frame が届くと、session は setWater を呼ばないまま client が
 * 前のバッファを返すので、session は reset・start・失敗・異常終了のたびに setWater(null) で参照を外す
 */
export class WaterOverlay {
  private readonly map: MapLibreMap
  private readonly whenMapLoaded: (run: () => void) => void
  private target: Target | null = null
  private latest: Float32Array | null = null
  private palette: WaterPalette = 'stepped'
  private arrows: PointCollection<{ bearing: number }> = EMPTY
  private arrowsVisible = true
  private frame = 0
  private generation = 0

  constructor(map: MapLibreMap, whenMapLoaded: (run: () => void) => void) {
    this.map = map
    this.whenMapLoaded = whenMapLoaded
  }

  /** 地形の範囲に水深の canvas と矢印のレイヤーを置く（最初は透明） */
  show(geo: { size: number; corners: Corners }): void {
    this.clear()
    const generation = this.generation
    const canvas = document.createElement('canvas')
    canvas.width = geo.size
    canvas.height = geo.size
    const context = canvas.getContext('2d')
    if (context === null) return
    const rgba = new Uint8ClampedArray(geo.size * geo.size * 4)
    this.target = {
      corners: geo.corners,
      canvas,
      context,
      rgba,
      image: new ImageData(rgba, geo.size, geo.size),
    }
    this.whenMapLoaded(() => {
      if (generation === this.generation) this.addLayers()
    })
  }

  /**
   * 最新の水深（次の frame が届くまでの間、SimulationClient が持つバッファをそのまま参照する）。
   * null は実行の失敗・異常終了などで、描くものが無くなったとき（呼び出し側が古いバッファへの参照を残さない）
   */
  setWater(water: Float32Array | null): void {
    this.latest = water
    this.requestDraw()
  }

  setPalette(palette: WaterPalette): void {
    this.palette = palette
    this.requestDraw()
  }

  setArrows(features: PointCollection<{ bearing: number }>): void {
    this.arrows = features
    this.map.getSource<GeoJSONSource>(WATER_LAYER_IDS.arrows)?.setData(features)
  }

  /** 実行の失敗・異常終了で、古い矢印を残さない */
  clearArrows(): void {
    this.setArrows(EMPTY)
  }

  setArrowsVisible(visible: boolean): void {
    this.arrowsVisible = visible
    if (this.map.getLayer(WATER_LAYER_IDS.arrows) !== undefined) {
      this.map.setLayoutProperty(WATER_LAYER_IDS.arrows, 'visibility', visible ? 'visible' : 'none')
    }
  }

  /** レイヤー・ソースと、待っている描画を消す（新しい地点の読み込み） */
  clear(): void {
    this.generation++
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.removeLayers()
    this.target = null
    this.latest = null
    this.arrows = EMPTY
  }

  /** ベースマップの切り替えで消えたソースとレイヤーを足し直す（冪等。Task 10） */
  restore(): void {
    if (this.target !== null) this.addLayers()
  }

  private requestDraw(): void {
    if (this.frame !== 0 || this.target === null) return
    this.frame = requestAnimationFrame(this.draw)
  }

  private readonly draw = (): void => {
    this.frame = 0
    const target = this.target
    if (target === null) return
    if (this.latest === null) target.rgba.fill(0)
    else waterRgba(this.latest, this.palette, target.rgba)
    target.context.putImageData(target.image, 0, 0)
  }

  private addLayers(): void {
    const target = this.target
    if (target === null) return
    this.removeLayers()
    const before = (id: string): string | undefined =>
      this.map.getLayer(id) !== undefined ? id : undefined
    // 毎フレーム内容が変わるので animate: true（spec 04 §6.1）
    this.map.addSource(WATER_LAYER_IDS.water, {
      type: 'canvas',
      canvas: target.canvas,
      coordinates: target.corners,
      animate: true,
    })
    // 水は標高・窪地の上、範囲の枠・矢印・最低点の下
    this.map.addLayer(
      {
        id: WATER_LAYER_IDS.water,
        type: 'raster',
        source: WATER_LAYER_IDS.water,
        paint: { 'raster-opacity': 0.9, 'raster-resampling': 'nearest' },
      },
      before(TERRAIN_LAYER_IDS.outline),
    )
    // 白に濃い青の縁（青い水の上でも見える）
    ensureArrowImage(this.map, ARROW_IMAGE, '#ffffff', '#0d47a1')
    this.map.addSource(WATER_LAYER_IDS.arrows, { type: 'geojson', data: this.arrows })
    this.map.addLayer(
      {
        id: WATER_LAYER_IDS.arrows,
        type: 'symbol',
        source: WATER_LAYER_IDS.arrows,
        layout: {
          'icon-image': ARROW_IMAGE,
          'icon-rotate': ['get', 'bearing'],
          'icon-rotation-alignment': 'map',
          'icon-allow-overlap': true,
          'icon-size': 0.6,
          visibility: this.arrowsVisible ? 'visible' : 'none',
        },
      },
      before(TERRAIN_LAYER_IDS.markers),
    )
  }

  private removeLayers(): void {
    for (const id of Object.values(WATER_LAYER_IDS)) {
      if (this.map.getLayer(id) !== undefined) this.map.removeLayer(id)
      if (this.map.getSource(id) !== undefined) this.map.removeSource(id)
    }
  }
}
