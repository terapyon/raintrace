import type { DemTileData } from './DemGrid.ts'
import { DEM_TIERS, type DemId, type DemTier, SEA_REFERENCE } from './demSources.ts'
import { computeGridRange, type GridRange, rangePixelRect } from './gridRange.ts'
import { TILE_SIZE, type TileCoord, tilesInPixelRect } from './tileMath.ts'

/** タイルの取得の結果。missing は 404（データなし）。ネットワークエラーは再試行の後に reject する */
export type TileFetchResult = { status: 'ok'; data: DemTileData } | { status: 'missing' }
export type FetchDemTile = (dem: DemId, tile: TileCoord) => Promise<TileFetchResult>

export interface DemSelection {
  tier: DemTier
  range: GridRange
  tiles: ReadonlyMap<string, DemTileData> // tileKey(x, y) → タイル。無いタイルは全画素無効
  breakdown: Partial<Record<DemId, number>> // 使った DEM ごとのタイル数
  seaTileCount: number // 海域（または段 3 の 404）として無効にしたタイルの数
}

const SEA_REFERENCE_Z = 14

export const tileKey = (x: number, y: number): string => `${x}/${y}`

/**
 * DEM の段を選ぶ（spec 02 §4.2）。段 1 → 2 → 3 の順に、範囲にかかるタイルを取得する。
 * 404 のタイルが無い、または 404 のタイルがすべて海域なら、その段を採用する。段 3 の 404 は海域・国外として無効にする
 */
export async function selectDem(
  lon: number,
  lat: number,
  sizeM: number,
  fetchTile: FetchDemTile,
): Promise<DemSelection> {
  // dem_png（z14）のタイルは、海域判定と段 3 で 1 回の読み込みの中で使い回す
  const references = new Map<string, Promise<TileFetchResult>>()
  const fetchReference = (tile: TileCoord): Promise<TileFetchResult> => {
    const key = tileKey(tile.x, tile.y)
    let pending = references.get(key)
    if (pending === undefined) {
      pending = fetchTile(SEA_REFERENCE, tile)
      references.set(key, pending)
    }
    return pending
  }
  const fetchFor: FetchDemTile = (dem, tile) =>
    dem === SEA_REFERENCE ? fetchReference(tile) : fetchTile(dem, tile)

  for (const [index, tier] of DEM_TIERS.entries()) {
    const range = computeGridRange(lon, lat, sizeM, tier.z)
    const coords = tilesInPixelRect(rangePixelRect(range), tier.z)
    const fetched = await Promise.all(
      coords.map((tile) => fetchFirstAvailable(tier, tile, fetchFor)),
    )
    const tiles = new Map<string, DemTileData>()
    const breakdown: Partial<Record<DemId, number>> = {}
    const missing: TileCoord[] = []
    fetched.forEach((result, i) => {
      const tile = coords[i]
      if (tile === undefined) return
      if (result === null) {
        missing.push(tile)
        return
      }
      tiles.set(tileKey(tile.x, tile.y), result.data)
      breakdown[result.dem] = (breakdown[result.dem] ?? 0) + 1
    })
    const isLast = index === DEM_TIERS.length - 1
    if (missing.length === 0 || isLast || (await allSea(missing, fetchReference))) {
      return { tier, range, tiles, breakdown, seaTileCount: missing.length }
    }
  }
  throw new Error('DEM の段が定義されていません')
}

async function fetchFirstAvailable(
  tier: DemTier,
  tile: TileCoord,
  fetchTile: FetchDemTile,
): Promise<{ dem: DemId; data: DemTileData } | null> {
  for (const dem of tier.candidates) {
    const result = await fetchTile(dem, tile)
    if (result.status === 'ok') return { dem, data: result.data }
  }
  return null
}

async function allSea(
  tiles: TileCoord[],
  fetchReference: (tile: TileCoord) => Promise<TileFetchResult>,
): Promise<boolean> {
  // 親タイル（z14）が複数あっても、同時数の制限の中で並べて取得する（fetchReference が使い回す。レビュー L4）
  // 参照が取れないタイルは海とみなさない（段を下げる）。段 3 で本当に要るなら、fetchFor が同じ失敗を返して 'network' になる
  const results = await Promise.all(
    tiles.map((tile) => isSeaTile(tile, fetchReference).catch(() => false)),
  )
  return results.every((sea) => sea)
}

/**
 * 404 になったタイルが海域かを、dem_png（z14）の対応する画素の窓で判定する（spec 02 §4.2）。
 * z17 のタイルは 32 × 32、z15 のタイルは 128 × 128 画素の窓。1 画素でも有効な標高があれば陸域。dem_png が 404 なら海域
 */
export async function isSeaTile(
  tile: TileCoord,
  fetchReference: (tile: TileCoord) => Promise<TileFetchResult>,
): Promise<boolean> {
  const ratio = 2 ** (tile.z - SEA_REFERENCE_Z)
  const reference = await fetchReference({
    z: SEA_REFERENCE_Z,
    x: Math.floor(tile.x / ratio),
    y: Math.floor(tile.y / ratio),
  })
  if (reference.status === 'missing') return true
  const window = TILE_SIZE / ratio
  const ox = (tile.x % ratio) * window
  const oy = (tile.y % ratio) * window
  for (let row = 0; row < window; row++) {
    for (let col = 0; col < window; col++) {
      if (reference.data.validMask[(oy + row) * TILE_SIZE + ox + col] === 1) return false
    }
  }
  return true
}
