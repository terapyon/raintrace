import type { Map as MapLibreMap } from 'maplibre-gl'
import type { DemTileId } from '../../dem/terrainTiles'
import { DEM_TILE_SIZE, demZoom, MAX_DEM_ZOOM } from '../../dem/tileZoom'

/** addProtocol の名前（spec 05 §4.2）。登録は地図の外にあり、コンテキスト喪失の影響を受けない（§3.7） */
export const DEM_PROTOCOL = 'raintrace-dem'

/** 地形のタイルを要求するソース。URL に入れ、タイルの作成をソースごとに数える（計画で決めたこと 24） */
export type DemSourceKind = 'terrain' | 'hillshade'

/**
 * hillshade のソースの tileSize。MapLibre の地形は floor(地図のズーム) − 1 の DEM を（deltaZoom 1）、hillshade だけの
 * ソースは round(地図のズーム + log2(512 / tileSize)) を要求する（roundZoom）。256 だと地形より 2〜3 段（16〜64 倍）
 * 細かい。512 でも 1〜2 段細かい（計画で決めたこと 12。Task 6 で重ければ 1024 を試す）
 */
export const HILLSHADE_TILE_SIZE = 512

/** maplibre-gl は raster-dem のソースの型を名前で公開していないので、addSource の引数から取り出す */
export type RasterDemSource = Extract<
  Parameters<MapLibreMap['addSource']>[1],
  { type: 'raster-dem' }
>

export interface DemTileRequest {
  source: DemSourceKind
  /** 地形（範囲）が変わるたびに進める世代。MapLibre に古いタイルを使わせない */
  generation: number
  tile: DemTileId
}

export function demTileTemplate(source: DemSourceKind, generation: number): string {
  return `${DEM_PROTOCOL}://${source}/${generation}/{z}/{x}/{y}`
}

export function parseDemTileUrl(url: string): DemTileRequest | null {
  const match = /^raintrace-dem:\/\/(terrain|hillshade)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url)
  if (match === null) return null
  const z = Number(match[3])
  if (z > MAX_DEM_ZOOM) return null
  return {
    source: match[1] === 'hillshade' ? 'hillshade' : 'terrain',
    generation: Number(match[2]),
    tile: { z: demZoom(z), x: Number(match[4]), y: Number(match[5]) },
  }
}

/** raster-dem のソース。地形は tileSize: 256 を明示する（既定の 512 のままだと頂点間隔が 2 倍、弦の高さが 4 倍） */
export function demSourceSpec(source: DemSourceKind, generation: number): RasterDemSource {
  return {
    type: 'raster-dem',
    tiles: [demTileTemplate(source, generation)],
    tileSize: source === 'hillshade' ? HILLSHADE_TILE_SIZE : DEM_TILE_SIZE,
    maxzoom: MAX_DEM_ZOOM,
    encoding: 'terrarium',
  }
}
