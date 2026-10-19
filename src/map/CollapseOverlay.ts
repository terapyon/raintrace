import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CollapsePayload, TerrainGeo } from '../shared/protocol'
import { collapseDepositRgba, newWaterRgba, paintDamOutlines } from './collapseColormap'
import { beforeLayerId, COLLAPSE_LAYER_IDS } from './layerIds'
import { COLLAPSE_DAM_COLOR } from './overlayColors'

export { COLLAPSE_LAYER_IDS } from './layerIds'

interface CompareDepths {
  before: Float32Array
  after: Float32Array
}

function newCanvas(size: number, rgba: Uint8ClampedArray<ArrayBuffer>): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  canvas.getContext('2d')?.putImageData(new ImageData(rgba, size, size), 0, 0)
  return canvas
}

/**
 * 盛土が崩れた後の、積もった土・崩れた跡・せき止められた場所（輪郭とあふれ出し点）・新しく溜まった水を
 * 地図に重ねる（spec 10 §5.4）。FillHistoryOverlay と同じく MapLibre を命令的に操作する。
 * 結果は show・showCompare で覚え、restore で足し直す
 */
export class CollapseOverlay {
  private readonly map: MapLibreMap
  private readonly whenMapLoaded: (run: () => void) => void
  private result: CollapsePayload | null = null
  private compare: CompareDepths | null = null
  private geo: TerrainGeo | null = null
  private generation = 0

  constructor(map: MapLibreMap, whenMapLoaded: (run: () => void) => void) {
    this.map = map
    this.whenMapLoaded = whenMapLoaded
  }

  /** 積もった土・崩れた跡・せき止められた場所を描く。比べた結果は残す（showCompare で別に決める） */
  show(result: CollapsePayload, geo: TerrainGeo): void {
    this.result = result
    this.geo = geo
    this.schedule()
  }

  /** 新しく溜まった水を描く */
  showCompare(before: Float32Array, after: Float32Array, geo: TerrainGeo): void {
    this.compare = { before, after }
    this.geo = geo
    this.schedule()
  }

  /** 新しく溜まった水だけを消す（結果は残す） */
  clearCompare(): void {
    this.compare = null
    this.schedule()
  }

  /** すべて消し、結果も忘れる。読み込みを待っている描画も取り消す */
  clear(): void {
    this.generation++
    this.removeMapObjects()
    this.result = null
    this.compare = null
    this.geo = null
  }

  /** ベースマップの切り替えで消えたものを、覚えている結果で足し直す（冪等） */
  restore(): void {
    this.addAll()
  }

  private schedule(): void {
    // 読み込みを待つ間に別の結果が来たり、消されたりしたら、古い方は描かない
    const generation = ++this.generation
    this.whenMapLoaded(() => {
      if (generation === this.generation) this.addAll()
    })
  }

  private addAll(): void {
    this.removeMapObjects()
    const geo = this.geo
    if (geo === null) return
    const result = this.result
    const compare = this.compare
    if (result !== null) {
      const { size } = geo
      // 積もった土の canvas には、せき止められた窪地の塗りと輪郭も一緒に描く
      const rgba = collapseDepositRgba(result.deposit, result.removed, size)
      paintDamOutlines(
        rgba,
        result.after.labels,
        new Set(result.dams.map((d) => d.depressionId)),
        size,
      )
      this.addCanvasLayer(COLLAPSE_LAYER_IDS.deposit, newCanvas(size, rgba), geo, 0.85)

      this.map.addSource(COLLAPSE_LAYER_IDS.dams, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: result.dams.map((d) => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [d.spill.lon, d.spill.lat] },
            properties: { depressionId: d.depressionId },
          })),
        },
      })
      this.map.addLayer(
        {
          id: COLLAPSE_LAYER_IDS.dams,
          type: 'circle',
          source: COLLAPSE_LAYER_IDS.dams,
          paint: {
            'circle-radius': 6,
            'circle-color': COLLAPSE_DAM_COLOR,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        },
        this.beforeId(COLLAPSE_LAYER_IDS.dams),
      )
    }
    if (compare !== null) {
      const rgba = newWaterRgba(compare.before, compare.after, geo.size)
      this.addCanvasLayer(COLLAPSE_LAYER_IDS.newWater, newCanvas(geo.size, rgba), geo, 0.9)
    }
  }

  private addCanvasLayer(
    id: string,
    canvas: HTMLCanvasElement,
    geo: TerrainGeo,
    opacity: number,
  ): void {
    // 内容は変わらない（変わるときは addAll でソースごと作り直す）ので animate: false
    this.map.addSource(id, {
      type: 'canvas',
      canvas,
      coordinates: geo.corners,
      animate: false,
    })
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

  private removeMapObjects(): void {
    for (const id of Object.values(COLLAPSE_LAYER_IDS)) {
      if (this.map.getLayer(id) !== undefined) this.map.removeLayer(id)
      if (this.map.getSource(id) !== undefined) this.map.removeSource(id)
    }
  }

  private beforeId(id: string): string | undefined {
    return beforeLayerId(id, (other) => this.map.getLayer(other) !== undefined)
  }
}
