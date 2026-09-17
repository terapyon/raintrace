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

export const WATER_LAYER_IDS = { water: 'water-depth', arrows: 'water-arrows' } as const

/**
 * 重ね描きのレイヤーの下から上への並び（04 の重ね描き・spec 05 §3.3・§3.6 の並びを写したもの）。
 * 地形の重ね描きは複数のタスクに分けて足すので、先に足される水深・矢印・3D のレイヤーも、後から足される
 * 地形のレイヤーも、この並びから beforeId を決める
 */
export const OVERLAY_LAYER_ORDER: readonly string[] = [
  VIEW3D_LAYER_IDS.hillshade,
  TERRAIN_LAYER_IDS.elevation,
  TERRAIN_LAYER_IDS.depressions,
  WATER_LAYER_IDS.water,
  VIEW3D_LAYER_IDS.water,
  TERRAIN_LAYER_IDS.outline,
  TERRAIN_LAYER_IDS.flow,
  WATER_LAYER_IDS.arrows,
  TERRAIN_LAYER_IDS.markers,
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
