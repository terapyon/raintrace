/**
 * 地形のタイル（Terrarium、256 × 256）の組み立て（spec 05 §4.2）。I/O を持たない（取得は引数の関数で受ける）。
 * - 範囲の中: 02 のグリッド（シミュレーションと同じデータ。無効セルは埋めた後）から、どのズームでも作る。
 *   地形とシミュレーションの標高の差は弦の高さ（と縮小でなめらかになる分）だけになる（S の報告 §10.1 の 4）
 * - 範囲の外: GSI の標高タイル（DEM のズーム、無ければ親のズーム）から作る（計画で決めたこと 6）
 * - 画素には角の位置の高さを書く（角の規約。terrarium.ts の sampleCorner）
 */
import { PromiseCache } from './async.ts'
import type { FetchDemTile } from './demSelection.ts'
import type { DemId } from './demSources.ts'
import { type CellSampler, encodeTerrarium, fillInvalidNearest, sampleCorner } from './terrarium.ts'
import type { TileCoord } from './tileMath.ts'
import { DEM_TILE_SIZE, type DemZoom } from './tileZoom.ts'

/** raster-dem が要求するタイル（addProtocol の URL の {z}/{x}/{y}） */
export interface DemTileId {
  z: DemZoom
  x: number
  y: number
}

/** 範囲の標高（02 のグリッドの複製） */
export interface RangeElevation {
  z: number
  originX: number
  originY: number
  size: number
  /** size × size、行優先（北から、西から）。無効セルは埋めた後（fillInvalidNearest） */
  elevation: Float32Array
}

export interface OutsideSource {
  dem: DemId
  zoom: number
}

/** 範囲の外の出所のタイル（出所のズームのタイル座標と、無効画素を埋めた 256 × 256 の標高） */
export interface OutsideTile {
  tile: TileCoord
  elevation: Float32Array
}

export type RangeCoverage = 'all' | 'some' | 'none'

export interface GeneratedTile {
  rgba: Uint8ClampedArray<ArrayBuffer>
  /** 範囲の外のタイルの取得に失敗し、外を 0 m で作った */
  outsideFailed: boolean
  /** 組み立て（composeTerrariumTile）の時間（ms。注入した時計で測る） */
  composeMs: number
}

const DEM5: readonly OutsideSource[] = [
  { dem: 'dem5a', zoom: 15 },
  { dem: 'dem5b', zoom: 15 },
  { dem: 'dem5c', zoom: 15 },
]
const DEM10B_Z14: OutsideSource = { dem: 'dem10b', zoom: 14 }

/** DEM のズーム z のタイルの、範囲の外の出所の候補（先に試す順。404 なら次）。GSI に無い z16 は親から作る */
export function outsideSources(z: DemZoom): readonly OutsideSource[] {
  if (z >= 17) return [{ dem: 'dem1a', zoom: 17 }, ...DEM5, DEM10B_Z14]
  if (z >= 15) return [...DEM5, DEM10B_Z14]
  return [{ dem: 'dem10b', zoom: z }]
}

/** タイルを含む、ズーム zoom（タイルのズーム以下）のタイル */
export function ancestorTile(tile: DemTileId, zoom: number): TileCoord {
  if (zoom > tile.z)
    throw new RangeError(`親のズーム ${zoom} がタイルのズーム ${tile.z} より細かい`)
  const scale = 2 ** (tile.z - zoom)
  return { z: zoom, x: Math.floor(tile.x / scale), y: Math.floor(tile.y / scale) }
}

/**
 * タイルの画素のうち、角の周りの 4 セルがすべて範囲の中にあるもの（すべて・一部・無し）。
 * 連続座標 c の 4 セルは floor(c − 0.5) と +1 なので、中にあるのは origin + 0.5 ≤ c < origin + size − 0.5
 */
export function rangeCoverage(tile: DemTileId, range: RangeElevation): RangeCoverage {
  const k = 2 ** (range.z - tile.z)
  const axis = (first: number, origin: number): RangeCoverage => {
    const lo = origin + 0.5
    const hi = origin + range.size - 0.5
    const a = first * k
    const b = (first + DEM_TILE_SIZE - 1) * k
    if (a >= lo && b < hi) return 'all'
    if (b < lo || a >= hi) return 'none'
    return 'some'
  }
  const x = axis(tile.x * DEM_TILE_SIZE, range.originX)
  const y = axis(tile.y * DEM_TILE_SIZE, range.originY)
  if (x === 'none' || y === 'none') return 'none'
  return x === 'all' && y === 'all' ? 'all' : 'some'
}

function rangeSampler(range: RangeElevation): CellSampler {
  const { originX, originY, size, elevation } = range
  return (gx, gy) => {
    const col = gx - originX
    const row = gy - originY
    if (col < 0 || row < 0 || col >= size || row >= size) return null
    return elevation[row * size + col] ?? 0
  }
}

/** 外のタイルの標本化。隣のタイルは取らず、タイルの中に丸める（計画で決めたこと 9） */
function tileSampler(outside: OutsideTile): CellSampler {
  const x0 = outside.tile.x * DEM_TILE_SIZE
  const y0 = outside.tile.y * DEM_TILE_SIZE
  const last = DEM_TILE_SIZE - 1
  return (gx, gy) => {
    const col = Math.min(last, Math.max(0, gx - x0))
    const row = Math.min(last, Math.max(0, gy - y0))
    return outside.elevation[row * DEM_TILE_SIZE + col] ?? 0
  }
}

/**
 * タイルの RGBA を組み立てる。画素ごとに、範囲の中（角の周りの 4 セルがすべて範囲の中）ならグリッド、
 * そうでなければ外の出所、どちらも無ければ 0 m（計画で決めたこと 8）
 */
export function composeTerrariumTile(
  tile: DemTileId,
  range: RangeElevation | null,
  outside: OutsideTile | null,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(DEM_TILE_SIZE * DEM_TILE_SIZE * 4)
  const inside = range === null ? null : rangeSampler(range)
  const outer = outside === null ? null : tileSampler(outside)
  const toRange = range === null ? 0 : 2 ** (range.z - tile.z)
  const toOutside = outside === null ? 0 : 2 ** (outside.tile.z - tile.z)
  for (let py = 0; py < DEM_TILE_SIZE; py++) {
    const y = tile.y * DEM_TILE_SIZE + py
    for (let px = 0; px < DEM_TILE_SIZE; px++) {
      const x = tile.x * DEM_TILE_SIZE + px
      let h = inside === null ? null : sampleCorner(inside, x * toRange, y * toRange)
      if (h === null && outer !== null) h = sampleCorner(outer, x * toOutside, y * toOutside)
      encodeTerrarium(h ?? 0, rgba, (py * DEM_TILE_SIZE + px) * 4)
    }
  }
  return rgba
}

/**
 * 外の出所のタイル（無効画素を埋めた標高）の cache。キーは 'dem/z/x/y'。z16 の 4 枚が同じ z15 の親を使うなど、
 * 同じ出所を何度も使うため。404 の結果（null）も覚える
 */
export class OutsideTileCache extends PromiseCache<Float32Array | null> {
  constructor(capacity = 64) {
    super(capacity)
  }
}

/**
 * 外の出所を順に試し、最初に取れたタイルを返す。どれも 404 なら null（海域・国外）。
 * 取得に失敗した（404 ではない）出所があれば、1 段粗い DEM10B で代える。それも取れなければ最初の失敗を投げる
 * （generateTerrariumTile が 0 m で作る。計画で決めたこと 5）
 */
export async function loadOutsideTile(
  tile: DemTileId,
  fetchTile: FetchDemTile,
  cache: OutsideTileCache,
): Promise<OutsideTile | null> {
  const load = async (source: OutsideSource): Promise<OutsideTile | null> => {
    const at = ancestorTile(tile, source.zoom)
    const elevation = await cache.load(`${source.dem}/${at.z}/${at.x}/${at.y}`, async () => {
      const result = await fetchTile(source.dem, at)
      if (result.status === 'missing') return null
      return fillInvalidNearest(
        result.data.elevation,
        result.data.validMask,
        DEM_TILE_SIZE,
        DEM_TILE_SIZE,
      )
    })
    return elevation === null ? null : { tile: at, elevation }
  }
  let failure: unknown = null
  for (const source of outsideSources(tile.z)) {
    try {
      const outside = await load(source)
      if (outside !== null) return outside
    } catch (error) {
      failure ??= error
    }
  }
  if (failure === null) return null
  const parentZoom = Math.min(tile.z, 14) - 1
  if (parentZoom >= 0) {
    const outside = await load({ dem: 'dem10b', zoom: parentZoom }).catch(() => null)
    if (outside !== null) return outside
  }
  throw failure
}

/** 取り消しの印（AbortSignal はこの形に合う。dem は DOM の型を持たないので、形だけで受ける） */
export interface AbortFlag {
  readonly aborted: boolean
}

const NOT_ABORTED: AbortFlag = { aborted: false }

/**
 * タイルを 1 枚作る。範囲がタイルを覆えば外を取らず、範囲にかからなければグリッドを見ない。
 * 外の取得の失敗は投げずに outsideFailed で知らせる（MapLibre の error にしない。計画で決めたこと 5）。
 * 組み立ての前に取り消されていたら（MapLibre が要らなくしたタイル）、組み立てずに null を返す（計画で決めたこと 23）
 */
export async function generateTerrariumTile(
  tile: DemTileId,
  range: RangeElevation | null,
  fetchTile: FetchDemTile,
  cache: OutsideTileCache,
  now: () => number = () => 0,
  signal: AbortFlag = NOT_ABORTED,
): Promise<GeneratedTile | null> {
  const coverage: RangeCoverage = range === null ? 'none' : rangeCoverage(tile, range)
  let outside: OutsideTile | null = null
  let outsideFailed = false
  if (coverage !== 'all') {
    try {
      outside = await loadOutsideTile(tile, fetchTile, cache)
    } catch {
      outsideFailed = true
    }
  }
  if (signal.aborted) return null
  const start = now()
  const rgba = composeTerrariumTile(tile, coverage === 'none' ? null : range, outside)
  return { rgba, outsideFailed, composeMs: now() - start }
}
