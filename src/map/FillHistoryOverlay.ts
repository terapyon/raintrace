import type { CanvasSource, ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl'
import type { FillHistoryPayload, TerrainGeo } from '../shared/protocol'
import { fillDeltaRgba } from './fillColormap'
import { beforeLayerId, FILL_LAYER_IDS } from './layerIds'
import {
  A54_COLOR,
  FILL_EDGE_SELECTED_COLOR,
  FILL_MARKER_COLOR,
  LANDFORM_COLORS,
} from './overlayColors'
import { uploadCanvasSource } from './WaterOverlay'

export { FILL_LAYER_IDS } from './layerIds'

/** 人工地形（地理院の地形分類）のコード。盛土地・埋立地、切土地、改変工事中（spec 09 §4.2） */
const LANDFORM_FILL_CODES = ['11004', '11005', '11006', '11007', '11014', '4010201']
const LANDFORM_CUT_CODES = ['11001', '11003', '11009', '11011', '4010301']
const LANDFORM_CONSTRUCTION_CODES = ['11010']

/** 番号の画像のレイヤー。並びの管理外で、円のレイヤーの直後（一番上）に足す */
const LABEL_LAYER_ID = 'fill-marker-labels'
const LABEL_IMAGE_PREFIX = 'fill-label-'
const LABEL_WIDTH = 44
const LABEL_HEIGHT = 22

type Ring = Array<[number, number]>

function polygonFeature<P>(rings: Ring[], properties: P) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: rings },
    properties,
  }
}

function landformKind(code: string): 'fill' | 'cut' | 'construction' | 'other' {
  if (LANDFORM_FILL_CODES.includes(code)) return 'fill'
  if (LANDFORM_CUT_CODES.includes(code)) return 'cut'
  if (LANDFORM_CONSTRUCTION_CODES.includes(code)) return 'construction'
  return 'other'
}

/**
 * 候補の番号（#id）の画像。スタイルに glyphs が無く、外部のフォントも読めない（CSP）ので、symbol の text-field
 * ではなく canvas に描いた画像を icon-image に使う。ベースマップの切り替えで消えるので hasImage を見て足し直す
 */
function ensureLabelImage(map: MapLibreMap, id: number): string {
  const name = `${LABEL_IMAGE_PREFIX}${id}`
  if (map.hasImage(name)) return name
  const canvas = document.createElement('canvas')
  canvas.width = LABEL_WIDTH
  canvas.height = LABEL_HEIGHT
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (context === null) return name
  context.fillStyle = FILL_MARKER_COLOR
  context.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT)
  context.fillStyle = '#ffffff'
  context.font = 'bold 14px sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(`#${id}`, LABEL_WIDTH / 2, LABEL_HEIGHT / 2)
  const { data } = context.getImageData(0, 0, LABEL_WIDTH, LABEL_HEIGHT)
  map.addImage(name, {
    width: LABEL_WIDTH,
    height: LABEL_HEIGHT,
    data: new Uint8Array(data.buffer),
  })
  return name
}

/**
 * 盛土の履歴（標高差・A54・人工地形・候補の印）を地図に重ねる（spec 09 §4.2）。TerrainOverlay と同じく
 * MapLibre を命令的に操作し、React には依存しない。結果は show で覚え、restore で足し直す
 */
export class FillHistoryOverlay {
  private readonly map: MapLibreMap
  private readonly whenMapLoaded: (run: () => void) => void
  private readonly a54Attribution: string
  private readonly landformAttribution: string
  private result: FillHistoryPayload | null = null
  private geo: TerrainGeo | null = null
  private selectedId: number | null = null
  private canvas: HTMLCanvasElement | null = null
  private generation = 0

  /** a54Attribution は A54 のソースの出典（strings は ui にあり、map は import しないので呼び出し側から渡す） */
  constructor(
    map: MapLibreMap,
    whenMapLoaded: (run: () => void) => void,
    a54Attribution: string,
    landformAttribution: string,
  ) {
    this.map = map
    this.whenMapLoaded = whenMapLoaded
    this.a54Attribution = a54Attribution
    this.landformAttribution = landformAttribution
  }

  show(result: FillHistoryPayload, geo: TerrainGeo, selectedId: number | null): void {
    // 読み込みを待つ間に別の結果が来たり、消されたりしたら、古い方は描かない
    const generation = ++this.generation
    this.result = result
    this.geo = geo
    this.selectedId = selectedId
    this.whenMapLoaded(() => {
      if (generation === this.generation) this.addAll()
    })
  }

  /** 選んだ候補を変える。縁の色（黄）と印の色を塗り直す */
  setSelected(id: number | null): void {
    this.selectedId = id
    const canvas = this.canvas
    if (this.result === null || this.geo === null || canvas === null) return
    if (this.map.getLayer(FILL_LAYER_IDS.delta) !== undefined) {
      this.drawCanvas(canvas)
      uploadCanvasSource(this.map.getSource<CanvasSource>(FILL_LAYER_IDS.delta))
    }
    if (this.map.getLayer(FILL_LAYER_IDS.markers) !== undefined) {
      this.map.setPaintProperty(FILL_LAYER_IDS.markers, 'circle-color', this.markerColor())
    }
  }

  /** レイヤー・ソースを消し、結果も忘れる。読み込みを待っている描画も取り消す */
  clear(): void {
    this.generation++
    this.removeMapObjects()
    this.result = null
    this.geo = null
    this.canvas = null
  }

  /** ベースマップの切り替えで消えたソース・レイヤー・画像を、覚えている結果で足し直す（冪等） */
  restore(): void {
    if (this.result === null) return
    this.removeMapObjects()
    this.addAll()
  }

  private markerColor(): ExpressionSpecification {
    return [
      'case',
      ['==', ['get', 'id'], this.selectedId ?? -1],
      FILL_EDGE_SELECTED_COLOR,
      FILL_MARKER_COLOR,
    ]
  }

  private drawCanvas(canvas: HTMLCanvasElement): void {
    const result = this.result
    const geo = this.geo
    if (result === null || geo === null) return
    const rgba = fillDeltaRgba(
      result.deltaCorrected,
      result.candidateLabels,
      geo.size,
      this.selectedId,
    )
    canvas.getContext('2d')?.putImageData(new ImageData(rgba, geo.size, geo.size), 0, 0)
  }

  private addAll(): void {
    const result = this.result
    const geo = this.geo
    if (result === null || geo === null) return
    this.removeMapObjects()

    const canvas = document.createElement('canvas')
    canvas.width = geo.size
    canvas.height = geo.size
    this.canvas = canvas
    this.drawCanvas(canvas)
    // 内容は選択のときだけ変わる（setSelected が転送する）ので animate: false
    this.map.addSource(FILL_LAYER_IDS.delta, {
      type: 'canvas',
      canvas,
      coordinates: geo.corners,
      animate: false,
    })
    this.map.addLayer(
      {
        id: FILL_LAYER_IDS.delta,
        type: 'raster',
        source: FILL_LAYER_IDS.delta,
        paint: { 'raster-opacity': 0.85, 'raster-resampling': 'nearest' },
      },
      this.beforeId(FILL_LAYER_IDS.delta),
    )

    this.map.addSource(FILL_LAYER_IDS.landform, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: result.landformPolygons.map((p) =>
          polygonFeature(p.rings, { kind: landformKind(p.code) }),
        ),
      },
      attribution: this.landformAttribution,
    })
    const landformColor: ExpressionSpecification = [
      'match',
      ['get', 'kind'],
      'fill',
      LANDFORM_COLORS.fill,
      'cut',
      LANDFORM_COLORS.cut,
      LANDFORM_COLORS.construction,
    ]
    this.map.addLayer(
      {
        id: FILL_LAYER_IDS.landform,
        type: 'fill',
        source: FILL_LAYER_IDS.landform,
        paint: {
          'fill-color': landformColor,
          'fill-opacity': 0.2,
          'fill-outline-color': landformColor,
        },
      },
      this.beforeId(FILL_LAYER_IDS.landform),
    )

    this.map.addSource(FILL_LAYER_IDS.a54, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: result.a54Polygons.map((p) => polygonFeature(p.rings, { a54Type: p.a54Type })),
      },
      attribution: this.a54Attribution,
    })
    this.map.addLayer(
      {
        id: FILL_LAYER_IDS.a54,
        type: 'fill',
        source: FILL_LAYER_IDS.a54,
        paint: { 'fill-color': A54_COLOR, 'fill-opacity': 0.2, 'fill-outline-color': A54_COLOR },
      },
      this.beforeId(FILL_LAYER_IDS.a54),
    )

    this.map.addSource(FILL_LAYER_IDS.markers, {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: result.candidates.map((c) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [c.centroid.lon, c.centroid.lat] },
          properties: { id: c.id, icon: ensureLabelImage(this.map, c.id) },
        })),
      },
    })
    this.map.addLayer(
      {
        id: FILL_LAYER_IDS.markers,
        type: 'circle',
        source: FILL_LAYER_IDS.markers,
        paint: {
          'circle-radius': 6,
          'circle-color': this.markerColor(),
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      },
      this.beforeId(FILL_LAYER_IDS.markers),
    )
    // 番号の画像は円の上に重ねる（同じソースの 2 つ目のレイヤー）。クリックは円のレイヤー（fill-markers）で当てる
    this.map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: FILL_LAYER_IDS.markers,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-anchor': 'bottom',
        'icon-offset': [0, -8],
        'icon-allow-overlap': true,
      },
    })
  }

  private removeMapObjects(): void {
    if (this.map.getLayer(LABEL_LAYER_ID) !== undefined) this.map.removeLayer(LABEL_LAYER_ID)
    for (const id of Object.values(FILL_LAYER_IDS)) {
      if (this.map.getLayer(id) !== undefined) this.map.removeLayer(id)
      if (this.map.getSource(id) !== undefined) this.map.removeSource(id)
    }
  }

  private beforeId(id: string): string | undefined {
    return beforeLayerId(id, (other) => this.map.getLayer(other) !== undefined)
  }
}
