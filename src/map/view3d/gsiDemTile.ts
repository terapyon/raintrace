import { createLimiter, GSI_RETRY_DELAYS_MS, retry } from '../../dem/async'
import type { FetchDemTile, TileFetchResult } from '../../dem/demSelection'
import type { DemId } from '../../dem/demSources'
import { demTileUrl } from '../../dem/demSources'
import { decodeGsiDem } from '../../dem/GsiDemDecoder'
import { TILE_SIZE, type TileCoord } from '../../dem/tileMath'

/** 1 回の取得の上限（02 の Worker の TILE_FETCH_TIMEOUT_MS と同じ値） */
const TILE_FETCH_TIMEOUT_MS = 20_000

/** 再試行する失敗（接続できない・1 回の上限を超えた・本文の読み込み中の切断・404 以外の HTTP） */
class RetryableFetchError extends Error {}

/** そのタイルを待つ要求がすべて取り消された（取得しない。再試行もしない） */
class UnwantedTileError extends Error {}

/**
 * メインスレッドで地理院の標高タイルを取得して復号する（範囲の外の地形。spec 05 §4.2）。
 * 02 の Worker の取得（workers/demLoader.ts の createGsiTileFetcher）と同じ規則にする: 同時 6 件、1 回 20 秒、
 * 0.5・1・2 秒の間隔で 3 回まで再試行、404 は missing（計画で決めたこと 23）。
 * isWanted は、取り消されていない要求がそのタイルを待っているか。枠を待った後と再試行の前に見て、待つ要求が
 * 無ければ取得しない。signal は受けない（1 つの取得を複数の DEM タイルが共有するので、1 つの要求の取り消しで止めない）。
 * OffscreenCanvas の扱いは demLoader.ts の getContext と同じ。層の規則で共有できない（map は workers を読めず、
 * dem・shared は DOM の型を持たない）ので写す。Task 6 はメインスレッドを選んだので、このファイルは消えない
 */
export function createMainGsiFetcher(isWanted: (tile: TileCoord) => boolean): FetchDemTile {
  const limit = createLimiter(6)
  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
  let context: OffscreenCanvasRenderingContext2D | null = null
  const getContext = (): OffscreenCanvasRenderingContext2D => {
    if (context === null) {
      const created = new OffscreenCanvas(TILE_SIZE, TILE_SIZE).getContext('2d', {
        willReadFrequently: true,
      })
      if (created === null) throw new Error('OffscreenCanvas の 2D コンテキストを得られません')
      created.globalCompositeOperation = 'copy'
      context = created
    }
    return context
  }
  const fetchOnce = async (dem: DemId, tile: TileCoord): Promise<TileFetchResult> => {
    const name = `${dem} ${tile.z}/${tile.x}/${tile.y}`
    let response: Response
    try {
      response = await fetch(demTileUrl(dem, tile), {
        signal: AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS),
      })
    } catch (error) {
      throw new RetryableFetchError(`${name}: ${String(error)}`)
    }
    if (response.status === 404) return { status: 'missing' }
    if (!response.ok) throw new RetryableFetchError(`${name}: HTTP ${response.status}`)
    let blob: Blob
    try {
      blob = await response.blob()
    } catch (error) {
      // 本文の読み込み中の切断も、fetch() 自体の失敗と同じ扱いにする（demLoader.ts と同じ）
      throw new RetryableFetchError(`${name}: ${String(error)}`)
    }
    const bitmap = await createImageBitmap(blob, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    try {
      if (bitmap.width !== TILE_SIZE || bitmap.height !== TILE_SIZE) {
        throw new Error(`${name}: タイルの大きさが ${bitmap.width}×${bitmap.height} です`)
      }
      const ctx = getContext()
      ctx.drawImage(bitmap, 0, 0)
      const data = decodeGsiDem(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data)
      return { status: 'ok', data }
    } finally {
      bitmap.close()
    }
  }
  /** 枠を待つ前と、枠を取った後に、そのタイルを待つ要求が残っているかを見る */
  const attempt = (dem: DemId, tile: TileCoord): Promise<TileFetchResult> => {
    const ensureWanted = (): void => {
      if (!isWanted(tile)) throw new UnwantedTileError(`${dem} ${tile.z}/${tile.x}/${tile.y}`)
    }
    ensureWanted()
    return limit(() => {
      ensureWanted()
      return fetchOnce(dem, tile)
    })
  }
  return (dem, tile) =>
    retry(() => attempt(dem, tile), {
      delaysMs: GSI_RETRY_DELAYS_MS,
      sleep,
      shouldRetry: (error) => error instanceof RetryableFetchError && isWanted(tile),
    })
}
