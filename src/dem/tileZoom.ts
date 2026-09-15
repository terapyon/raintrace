/**
 * ズームの取り違えを型で防ぐ（spec 05 §4.3、S の報告 §10.1 の 5。S では地図・タイル・DEM のズームの
 * 取り違えで 3 回の直しが入った）。
 * - DrawnTileZoom: MapLibre が描く地形タイル（地形のメッシュ）のズーム。raster-dem が tileSize: 256 のとき、
 *   pitch 0 の画面の中心では floor(地図のズーム)。pitch がつくと粗くなる（計画の Global Constraints、Task 3 の見込み）
 * - DemZoom: raster-dem のタイルの要求（addProtocol の URL の {z}）と、GSI の標高タイルのズーム
 * 変換は demZoomForDrawnTile だけで行う
 */
import { groundResolutionM, TILE_SIZE } from './tileMath.ts'

declare const drawnTileZoomBrand: unique symbol
declare const demZoomBrand: unique symbol
export type DrawnTileZoom = number & { readonly [drawnTileZoomBrand]: true }
export type DemZoom = number & { readonly [demZoomBrand]: true }

/** MapLibre の地形は DEM のタイル 1 枚を 1 段細かい地形タイルとして描く（TerrainTileManager.deltaZoom） */
export const TERRAIN_DELTA_ZOOM = 1
/** raster-dem の最大ズーム（DEM1A の z17）。これより細かい地形タイルは z17 を引き伸ばして読む */
export const MAX_DEM_ZOOM = 17
/** raster-dem の tileSize（spec 05 §4.2。既定の 512 のままだと頂点間隔が 2 倍、弦の高さが 4 倍になる） */
export const DEM_TILE_SIZE = 256
/** 地形タイル 1 枚の格子の分割数（MapLibre の Terrain の meshSize） */
export const TERRAIN_MESH_SIZE = 128
/** 描かれる地形タイルのズームの上限（地図の maxZoom 18 より十分大きい） */
const MAX_DRAWN_TILE_ZOOM = 24

function integerIn(z: number, max: number, name: string): number {
  if (!Number.isInteger(z) || z < 0 || z > max) {
    throw new RangeError(`${name}は 0〜${max} の整数です（${z}）`)
  }
  return z
}

export function drawnTileZoom(z: number): DrawnTileZoom {
  return integerIn(z, MAX_DRAWN_TILE_ZOOM, '描かれる地形タイルのズーム') as DrawnTileZoom
}

export function demZoom(z: number): DemZoom {
  return integerIn(z, MAX_DEM_ZOOM, 'DEM のズーム') as DemZoom
}

/** 描かれる地形タイルが読む DEM のズーム（MapLibre の getSourceTile: z − deltaZoom、maxzoom で頭打ち） */
export function demZoomForDrawnTile(z: DrawnTileZoom): DemZoom {
  return demZoom(Math.min(MAX_DEM_ZOOM, Math.max(0, z - TERRAIN_DELTA_ZOOM)))
}

/** 地形のメッシュの頂点間隔（m）。描かれる地形タイルの幅 ÷ 128（spec 05 §4.3 の表） */
export function terrainVertexSpacingM(z: DrawnTileZoom, lat: number): number {
  return (groundResolutionM(lat, z) * TILE_SIZE) / TERRAIN_MESH_SIZE
}
