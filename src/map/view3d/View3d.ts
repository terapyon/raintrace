/**
 * 3D の表示の取りまとめ（spec 05 §3・§4）。3D に切り替えたときに動的 import で読む（ui/view3dSession.ts）。
 * 地形（Terrain3d）、3D の視点、E2E・計測用の印を持つ。地図の操作は whenLoaded の中で行う
 * （ベースマップの切り替え・コンテキスト喪失の間はスタイルが無い）
 */
import { type Map as MapLibreMap, MercatorCoordinate } from 'maplibre-gl'
import type { RangeElevation } from '../../dem/terrainTiles'
import { fillInvalidNearest } from '../../dem/terrarium'
import { pixelToLonLat, worldSizePx } from '../../dem/tileMath'
import type { DrawnTileZoom } from '../../dem/tileZoom'
import type { WaterLayer, WaterLayerOptions } from '../../renderer/waterLayer'
import type { TerrainPayload } from '../../shared/protocol'
import type { Basemap } from '../basemapStyle'
import type { MapController } from '../MapController'
import { TERRAIN_LAYER_IDS } from '../TerrainOverlay'
import { type WaterPalette, waterLutSpec } from '../waterColormap'
import {
  boundaryDecision,
  drawnTileZoomAt,
  PITCH_3D_DEG,
  predictedCentreTileZoom,
  zoomFor3dView,
} from './drawnZoom'
import { VIEW3D_LAYER_IDS } from './layerIds'
import { createMainTileGenerator } from './mainTileGenerator'
import { hillshadeEnabled, type View3dOptions } from './options'
import { Terrain3d } from './Terrain3d'

/** off: 2D を選んでいる。3d: 3D で描いている。fallback-2d: 3D を選んでいるが境界より粗いので 2D（spec 05 §4.3） */
export type View3dRendering = 'off' | '3d' | 'fallback-2d'

export interface View3dInit {
  options: View3dOptions
  basemap: Basemap
  exaggeration: number
  palette: WaterPalette
  onRendering: (rendering: View3dRendering) => void
}

/** 水面の Custom Layer の作り方（動的 import で読む renderer/waterLayer の createWaterLayer） */
type CreateWaterLayer = (map: MapLibreMap, options: WaterLayerOptions) => WaterLayer

/** 視点の移動の時間（ms） */
const CAMERA_MS = 500

export class View3d {
  private readonly controller: MapController
  private readonly options: View3dOptions
  private readonly onRendering: (rendering: View3dRendering) => void
  private readonly terrain3d: Terrain3d
  private basemap: Basemap
  private exaggeration: number
  private palette: WaterPalette
  /** 最新の水深（SimulationSession.onWater から。次の frame まで有効） */
  private depth: Float32Array | null = null
  private water: WaterLayer | null = null
  private waterLoading = false
  private terrain: TerrainPayload | null = null
  /** terrain の無効セルを埋めた標高。3D で描くときに初めて作る（2D の間は作らない） */
  private range: RangeElevation | null = null
  private enabled = false
  private rendering: View3dRendering = 'off'
  /** 3D の視点へ動かしている間。動き終えたら data-view3d-framed を立てる */
  private framing = false
  /** 視点を動かし終えた（または 3D に戻した）。次の描画で境界を判定する */
  private boundaryCheckPending = false
  /** 直前に書いた印（変わらなければ書き直さない） */
  private readonly marks = { mapZoom: '', mapPitch: '', drawnTileZoom: '' }
  private readonly onRender = (): void => this.afterRender()
  private readonly onMoveEnd = (): void => this.afterMove()

  constructor(controller: MapController, init: View3dInit) {
    this.controller = controller
    this.options = init.options
    this.onRendering = init.onRendering
    this.basemap = init.basemap
    this.exaggeration = init.exaggeration
    this.palette = init.palette
    this.terrain3d = new Terrain3d(
      controller.map,
      createMainTileGenerator(),
      init.exaggeration,
      init.options.onTileTime,
    )
    controller.map.on('render', this.onRender)
    controller.map.on('moveend', this.onMoveEnd)
  }

  /**
   * 地形（範囲）が変わった。3D を選んでいれば、新しい範囲のタイルに読み直し、視点を合わせ直す。境界より粗くて
   * 2D に落ちている間（fallback-2d）なら 3D に戻す（3D の視点の見込みは戻す閾値以上。Task 3 のテスト）。
   * 新しい地点の読み込みの間（null）は、前の範囲のタイルのまま置く（null と新しい範囲で 2 回作り直さない）
   */
  setTerrain(terrain: TerrainPayload | null): void {
    this.terrain = terrain
    this.range = null
    this.controller.whenLoaded(() => {
      this.removeWater()
      if (this.rendering === 'off' || this.terrain === null) return
      if (this.rendering === 'fallback-2d') {
        // 3D に戻す（show3d の最後で水面も足す）
        this.show3d()
      } else {
        this.terrain3d.setRange(this.ensureRange())
        this.ensureWater()
      }
      this.frame()
    })
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    this.controller.whenLoaded(() => {
      if (this.enabled) {
        this.show3d()
        this.frame()
      } else {
        this.hide3d('off')
        this.controller.map.easeTo({ pitch: 0, duration: CAMERA_MS })
      }
    })
  }

  setWater(water: Float32Array | null): void {
    this.depth = water
    this.water?.setWater(water)
  }

  setPalette(palette: WaterPalette): void {
    this.palette = palette
    this.water?.setLut(waterLutSpec(palette))
  }

  /** 垂直強調は地形（setTerrain）と水面のシェーダに同じ値を渡す（spec 05 §3.2） */
  setExaggeration(value: number): void {
    this.exaggeration = value
    this.water?.setExaggeration(value)
    this.controller.whenLoaded(() => this.terrain3d.setExaggeration(value))
  }

  /** ベースマップ（hillshade の要否）。切り替えの後の onRestyle で restore が反映する */
  setBasemap(basemap: Basemap): void {
    this.basemap = basemap
  }

  /** ベースマップの切り替え・コンテキストの復帰の後（onRestyle）。3D で描いていれば足し直す（冪等） */
  restore(): void {
    if (this.rendering === '3d') this.show3d()
  }

  dispose(): void {
    const { map } = this.controller
    map.off('render', this.onRender)
    map.off('moveend', this.onMoveEnd)
    // removeWater は冪等で安価なので、rendering の状態に関わらず必ず呼ぶ（hide3d が先に呼んでいる前提に
    // 頼らない。Task 8 の申し送りの反映）
    this.removeWater()
    if (this.rendering !== 'off') this.terrain3d.hide()
    this.terrain3d.dispose()
  }

  private ensureRange(): RangeElevation | null {
    const terrain = this.terrain
    if (terrain === null) return null
    if (this.range === null) {
      const start = performance.now()
      const { geo } = terrain
      const elevation = fillInvalidNearest(terrain.elevation, terrain.validMask, geo.size, geo.size)
      this.options.onPrepareTime?.(performance.now() - start)
      this.range = {
        z: geo.z,
        originX: geo.originX,
        originY: geo.originY,
        size: geo.size,
        elevation,
      }
    }
    return this.range
  }

  private show3d(): void {
    if (this.terrain !== null) this.terrain3d.setRange(this.ensureRange())
    this.terrain3d.show({
      hillshade: hillshadeEnabled(this.options.hillshade, this.basemap),
      beforeId: this.hillshadeBeforeId(),
    })
    this.setRendering('3d')
    this.ensureWater()
  }

  private hide3d(rendering: 'off' | 'fallback-2d'): void {
    this.removeWater()
    this.terrain3d.hide()
    this.setRendering(rendering)
  }

  private setRendering(rendering: View3dRendering): void {
    if (rendering === this.rendering) return
    this.rendering = rendering
    this.controller.map.getContainer().dataset.view3d = rendering
    this.onRendering(rendering)
  }

  /** hillshade は 04 の重ね描き（標高の色分け）の下、ベースマップの上に置く */
  private hillshadeBeforeId(): string | undefined {
    const { map } = this.controller
    return map.getLayer(TERRAIN_LAYER_IDS.elevation) !== undefined
      ? TERRAIN_LAYER_IDS.elevation
      : undefined
  }

  /** 水面の Custom Layer を、無ければ足す。three は初めて要るときに動的 import で読む（spec 05 §3.8） */
  private ensureWater(): void {
    if (!this.options.water || this.rendering !== '3d' || this.terrain === null) return
    if (this.controller.map.getLayer(VIEW3D_LAYER_IDS.water) !== undefined) return
    if (this.waterLoading) return
    this.waterLoading = true
    import('../../renderer/waterLayer').then(
      ({ createWaterLayer }) => {
        this.waterLoading = false
        this.controller.whenLoaded(() => this.addWater(createWaterLayer))
      },
      (error: unknown) => {
        this.waterLoading = false
        console.error(error)
      },
    )
  }

  private addWater(create: CreateWaterLayer): void {
    const terrain = this.terrain
    const range = this.ensureRange()
    const { map } = this.controller
    if (this.rendering !== '3d' || terrain === null || range === null) return
    if (map.getLayer(VIEW3D_LAYER_IDS.water) !== undefined) return
    this.water?.dispose()
    const start = performance.now()
    const { geo } = terrain
    const center = pixelToLonLat(geo.originX + geo.size / 2, geo.originY + geo.size / 2, geo.z)
    const water = create(map, {
      id: VIEW3D_LAYER_IDS.water,
      size: geo.size,
      placement: { originX: geo.originX, originY: geo.originY, worldSizePx: worldSizePx(geo.z) },
      metersToMercator: MercatorCoordinate.fromLngLat([
        center.lon,
        center.lat,
      ]).meterInMercatorCoordinateUnits(),
      elevation: range.elevation,
      lut: waterLutSpec(this.palette),
      exaggeration: this.exaggeration,
      onRenderTime: this.options.onRenderTime,
    })
    water.setWater(this.depth)
    // メッシュ（1000 m で約 212 万枚、index 25 MB）とテクスチャの作成の時間。GPU への転送は最初の描画（Task 9 で記録）
    this.options.onWaterBuildTime?.(performance.now() - start)
    // 04 の重ね描き（標高・窪地・2D の水深）の上、範囲の枠と矢印の下に置く（矢印は水面の後。spec 05 §3.3）
    const before =
      map.getLayer(TERRAIN_LAYER_IDS.outline) !== undefined ? TERRAIN_LAYER_IDS.outline : undefined
    map.addLayer(water.layer, before)
    this.water = water
  }

  /** 水面を外す。スタイルから外すと onRemove が資源を捨てる。スタイルに無い（喪失の後）ときも捨てる */
  private removeWater(): void {
    const { map } = this.controller
    if (map.getLayer(VIEW3D_LAYER_IDS.water) !== undefined) map.removeLayer(VIEW3D_LAYER_IDS.water)
    this.water?.dispose()
    this.water = null
  }

  /** 3D の視点（spec 05 §3.4、計画で決めたこと 4）: 範囲を中心に pitch 60、ズームは zoomFor3dView */
  private frame(): void {
    const { map } = this.controller
    map.getContainer().dataset.view3dFramed = 'false'
    this.framing = true
    const terrain = this.terrain
    if (terrain === null) {
      map.easeTo({ pitch: PITCH_3D_DEG, duration: CAMERA_MS })
      return
    }
    const { corners } = terrain.geo
    const camera = map.cameraForBounds([corners[3], corners[1]], { padding: 40 })
    map.easeTo({
      center: camera?.center ?? map.getCenter(),
      zoom: zoomFor3dView(camera?.zoom ?? map.getZoom()),
      pitch: PITCH_3D_DEG,
      duration: CAMERA_MS,
    })
  }

  /** 3D で描いているときの、画面の中心で描かれている地形タイルのズーム（実測）。描いていなければ null */
  private measuredCentreZoom(): DrawnTileZoom | null {
    const { map } = this.controller
    if (this.rendering !== '3d' || map.getTerrain() === null) return null
    const tiles = map.terrain.tileManager.getRenderableTiles().map((tile) => tile.tileID.canonical)
    return drawnTileZoomAt(tiles, MercatorCoordinate.fromLngLat(map.getCenter()))
  }

  private afterRender(): void {
    const measured = this.measuredCentreZoom()
    this.writeMarks(measured)
    if (!this.boundaryCheckPending || this.controller.map.isMoving()) return
    // 3D に戻した直後など、まだ描かれたタイルが無ければ、有るまで待つ
    if (this.rendering === '3d' && measured === null) return
    this.boundaryCheckPending = false
    this.checkBoundary(measured)
  }

  private afterMove(): void {
    if (this.framing) {
      this.framing = false
      this.controller.map.getContainer().dataset.view3dFramed = 'true'
    }
    // タイルは動き終えた後の描画で決まるので、判定は次の描画で行う
    this.requestBoundaryCheck()
  }

  private requestBoundaryCheck(): void {
    if (!this.enabled || !this.options.boundaryFallback) return
    this.boundaryCheckPending = true
    this.controller.map.triggerRepaint()
  }

  /**
   * (c): 3D の間は画面の中心で描かれている地形タイルのズーム（実測）が境界（MIN_3D_DRAWN_TILE_ZOOM）より粗ければ
   * 2D に落とす。2D に落ちた後は地形が無く実測できないので、pitch つきの見込みが境界 + 0.5 に届いたら 3D に戻す
   * （spec 05 §4.3、R05-4。§4.4 の「粗いズームを 2D」も同じ判定。計画で決めたこと 2・3）
   */
  private checkBoundary(measured: DrawnTileZoom | null): void {
    if (this.rendering === 'off') return
    const { map } = this.controller
    const predicted = predictedCentreTileZoom(map.getZoom(), map.getPitch())
    const decision = boundaryDecision(this.rendering, measured, predicted)
    if (decision === 'to-2d') {
      this.hide3d('fallback-2d')
    } else if (decision === 'to-3d') {
      this.show3d()
      // 戻した後の最初の描画で実測を確かめる（見込みが外れていれば、また 2D に落ちる）
      this.requestBoundaryCheck()
    }
  }

  /** E2E・計測用の印（計画で決めたこと 21）。地図のズームは URL（小数 2 桁）より細かく、小数 3 桁で書く */
  private writeMarks(drawn: DrawnTileZoom | null): void {
    const { map } = this.controller
    const { dataset } = map.getContainer()
    const mapZoom = map.getZoom().toFixed(3)
    const mapPitch = map.getPitch().toFixed(1)
    const drawnTileZoom = drawn === null ? '' : String(drawn)
    if (mapZoom !== this.marks.mapZoom) dataset.mapZoom = mapZoom
    if (mapPitch !== this.marks.mapPitch) dataset.mapPitch = mapPitch
    if (drawnTileZoom !== this.marks.drawnTileZoom) dataset.drawnTileZoom = drawnTileZoom
    Object.assign(this.marks, { mapZoom, mapPitch, drawnTileZoom })
  }
}
