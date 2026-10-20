import { VIEW3D_LAYER_IDS } from './view3d/layerIds'

/**
 * 重ね描きのレイヤーの ID と重なり順（spec 06 §5.2、Task 17）。maplibre-gl を import しない純粋なモジュール。
 * TerrainOverlay・WaterOverlay は ID をここから再エクスポートする（互いを import せず、循環を作らない）
 */
export const TERRAIN_LAYER_IDS = {
  elevation: 'terrain-elevation',
  depressions: 'terrain-depressions',
  outline: 'terrain-outline',
  flow: 'terrain-flow',
  markers: 'terrain-markers',
} as const

/** 盛土の履歴（spec 09 §4.2）。標高差の canvas・人工地形・A54 は窪地の上、候補の印は一番上 */
export const FILL_LAYER_IDS = {
  delta: 'fill-delta',
  landform: 'fill-landform',
  a54: 'fill-a54',
  markers: 'fill-markers',
} as const

/** 盛土が崩れたら（spec 10 §5.4）。積もった土は A54 の直後、せき止められた場所の点はその後。
 * 水路の線（spec 10b §4.1）は流出の帯の直後（水の上に線が見える） */
export const COLLAPSE_LAYER_IDS = {
  deposit: 'collapse-deposit',
  dams: 'collapse-dams',
  culvert: 'collapse-culvert',
} as const

export const WATER_LAYER_IDS = {
  water: 'water-depth',
  /** 流出の帯（spec 07 §5.2）。2D の水深の直後 */
  outflow: 'water-outflow',
  arrows: 'water-arrows',
} as const

/**
 * 重ね描きのレイヤーの下から上への並び（04 の重ね描き・spec 05 §3.3・§3.6 の並びを写したもの）。
 * 地形の重ね描きは複数のタスクに分けて足すので、先に足される水深・矢印・3D のレイヤーも、後から足される
 * 地形のレイヤーも、この並びから beforeId を決める
 */
export const OVERLAY_LAYER_ORDER: readonly string[] = [
  VIEW3D_LAYER_IDS.hillshade,
  TERRAIN_LAYER_IDS.elevation,
  TERRAIN_LAYER_IDS.depressions,
  FILL_LAYER_IDS.delta,
  FILL_LAYER_IDS.landform,
  FILL_LAYER_IDS.a54,
  COLLAPSE_LAYER_IDS.deposit,
  COLLAPSE_LAYER_IDS.dams,
  WATER_LAYER_IDS.water,
  WATER_LAYER_IDS.outflow,
  COLLAPSE_LAYER_IDS.culvert,
  VIEW3D_LAYER_IDS.water,
  TERRAIN_LAYER_IDS.outline,
  TERRAIN_LAYER_IDS.flow,
  WATER_LAYER_IDS.arrows,
  TERRAIN_LAYER_IDS.markers,
  FILL_LAYER_IDS.markers,
]

/**
 * id を OVERLAY_LAYER_ORDER どおりに置くための addLayer の beforeId: 並びで id より上のレイヤーのうち、
 * 今ある（has が true）一番下のもの。無ければ undefined（一番上に積む）。並びに無い id は例外
 */
export function beforeLayerId(id: string, has: (id: string) => boolean): string | undefined {
  const index = OVERLAY_LAYER_ORDER.indexOf(id)
  if (index < 0) throw new Error(`重ね描きの並びに無いレイヤーです: ${id}`)
  return OVERLAY_LAYER_ORDER.slice(index + 1).find(has)
}
