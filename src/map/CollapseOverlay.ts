import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CollapsePayload, TerrainGeo } from '../shared/protocol'
import { collapseDepositRgba, paintDamOutlines } from './collapseColormap'
import { beforeLayerId, COLLAPSE_LAYER_IDS } from './layerIds'
import {
  COLLAPSE_CULVERT_BLOCKED_COLOR,
  COLLAPSE_CULVERT_OPEN_COLOR,
  COLLAPSE_DAM_COLOR,
} from './overlayColors'

export { COLLAPSE_LAYER_IDS } from './layerIds'

/** 描く見え方: after は積もった土・せき止め・水路の線、before は水路の線（通っている）だけ */
export interface CollapseShowOptions {
  markerCount: number
  view: 'before' | 'after'
}

function newCanvas(size: number, rgba: Uint8ClampedArray<ArrayBuffer>): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  canvas.getContext('2d')?.putImageData(new ImageData(rgba, size, size), 0, 0)
  return canvas
}

/**
 * 盛土が崩れた後の、積もった土・崩れた跡・せき止められた場所（輪郭とあふれ出し点）を
 * 地図に重ねる（spec 10 §5.4）。FillHistoryOverlay と同じく MapLibre を命令的に操作する。
 * 結果は show で覚え、restore で足し直す
 */
export class CollapseOverlay {
  private readonly map: MapLibreMap
  private readonly whenMapLoaded: (run: () => void) => void
  private result: CollapsePayload | null = null
  private geo: TerrainGeo | null = null
  private markerCount = Number.POSITIVE_INFINITY
  private view: 'before' | 'after' = 'after'
  private generation = 0

  constructor(map: MapLibreMap, whenMapLoaded: (run: () => void) => void) {
    this.map = map
    this.whenMapLoaded = whenMapLoaded
  }

  /**
   * 積もった土・崩れた跡・せき止められた場所を描く。
   * あふれ出し点の印は dams の先頭（溜まりうる水の多い順）から markerCount 個だけ。塗りと輪郭は全部（R12）。
   * 水路を仮定した結果なら、水路の線も描く（崩れた後でふさがったら、ふさがった見え方。spec 10b §4.1）。
   * view が before のときは、水路の線（通っている）だけ描く
   */
  show(result: CollapsePayload, geo: TerrainGeo, options: CollapseShowOptions): void {
    this.result = result
    this.markerCount = options.markerCount
    this.view = options.view
    this.geo = geo
    this.schedule()
  }

  /** すべて消し、結果も忘れる。読み込みを待っている描画も取り消す */
  clear(): void {
    this.generation++
    this.removeMapObjects()
    this.result = null
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
    if (result === null) return
    if (this.view === 'after') {
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
          features: result.dams.slice(0, this.markerCount).map((d) => ({
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
    if (result.culvert !== null) this.addCulvert(result.culvert, this.view === 'after')
  }

  /** 水路の線。崩れる前は常に「通っている」。崩れた後は blocked ならふさがった見え方（破線） */
  private addCulvert(culvert: NonNullable<CollapsePayload['culvert']>, afterView: boolean): void {
    const blocked = afterView && culvert.blocked
    const id = COLLAPSE_LAYER_IDS.culvert
    this.map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: culvert.line },
        properties: {},
      },
    })
    this.map.addLayer(
      {
        id,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: blocked
          ? {
              'line-color': COLLAPSE_CULVERT_BLOCKED_COLOR,
              'line-width': 3,
              'line-dasharray': [2, 2],
            }
          : { 'line-color': COLLAPSE_CULVERT_OPEN_COLOR, 'line-width': 3 },
      },
      this.beforeId(id),
    )
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
