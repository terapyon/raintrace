import type { DemSourceKind } from './demSource'

/**
 * 3D のレイヤーとソースの ID。MapController が E2E の印（data-overlay-layers）に数えるので、
 * View3d 本体（遅延読み込み）とは別の小さなファイルに置く（計画で決めたこと 21）
 */
export const VIEW3D_LAYER_IDS = { hillshade: 'terrain-3d-hillshade', water: 'water-3d' } as const
/** hillshade は地形と別のソースにする（同じソースだと MapLibre が警告を出す。S の計画 D18） */
export const VIEW3D_SOURCE_IDS: Record<DemSourceKind, string> = {
  terrain: 'terrain-3d-dem',
  hillshade: 'terrain-3d-dem-hillshade',
}
