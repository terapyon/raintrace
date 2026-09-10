import type { TileCoord } from './tileMath.ts'

/** DEM の種類（tech-spec §7.4）。DEM10B のタイルのパスは dem_png */
export type DemId = 'dem1a' | 'dem5a' | 'dem5b' | 'dem5c' | 'dem10b'

const PATHS: Record<DemId, string> = {
  dem1a: 'dem1a_png',
  dem5a: 'dem5a_png',
  dem5b: 'dem5b_png',
  dem5c: 'dem5c_png',
  dem10b: 'dem_png',
}

/** 段（R02-2）。段 2 はタイルごとに候補を順に試し、200 が返ったものを使う */
export interface DemTier {
  level: 1 | 2 | 3
  z: number
  candidates: readonly DemId[]
}

export const DEM_TIERS: readonly DemTier[] = [
  { level: 1, z: 17, candidates: ['dem1a'] },
  { level: 2, z: 15, candidates: ['dem5a', 'dem5b', 'dem5c'] },
  { level: 3, z: 14, candidates: ['dem10b'] },
]

/** 海域判定に使う DEM（全国分がある dem_png、z14。spec 02 §4.2） */
export const SEA_REFERENCE: DemId = 'dem10b'

export const GSI_BASE_URL = 'https://cyberjapandata.gsi.go.jp/xyz'

export function demTileUrl(dem: DemId, tile: TileCoord): string {
  return `${GSI_BASE_URL}/${PATHS[dem]}/${tile.z}/${tile.x}/${tile.y}.png`
}
