import { createLimiter, GSI_RETRY_DELAYS_MS, retry } from '../dem/async'
import type { FetchDemTile, TileFetchResult } from '../dem/demSelection'
import { type DemId, demTileUrl } from '../dem/demSources'
import { decodeGsiDem } from '../dem/GsiDemDecoder'
import { TILE_SIZE, type TileCoord } from '../dem/tileMath'

/** 404 以外の HTTP エラー。再試行の対象 */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

/** fetch() そのものの失敗（接続できない・CORS など）。再試行の対象。コードの誤りの TypeError と区別する */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(`ネットワークエラー: ${String(cause)}`, { cause })
  }
}

/**
 * 地理院の DEM タイルの取得関数を作る（spec 02 §4.3）。同時に 6 件まで。404 は missing、
 * それ以外の HTTP エラーとネットワークエラーは 0.5・1・2 秒の間隔で最大 3 回再試行する。signal で取り消す
 */
export function createGsiTileFetcher(
  signal: AbortSignal,
  progress: { onStart(): void; onDone(): void },
): FetchDemTile {
  const limit = createLimiter(6)
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  return (dem, tile) => {
    progress.onStart()
    return limit(() =>
      retry(() => fetchOnce(dem, tile, signal), {
        delaysMs: GSI_RETRY_DELAYS_MS,
        sleep,
        shouldRetry: (error) =>
          !signal.aborted && (error instanceof NetworkError || error instanceof HttpError),
      }),
    ).finally(() => progress.onDone())
  }
}

async function fetchOnce(
  dem: DemId,
  tile: TileCoord,
  signal: AbortSignal,
): Promise<TileFetchResult> {
  let response: Response
  try {
    response = await fetch(demTileUrl(dem, tile), { signal })
  } catch (error) {
    if (signal.aborted) throw error
    throw new NetworkError(error)
  }
  if (response.status === 404) return { status: 'missing' }
  if (!response.ok) throw new HttpError(response.status)
  // 色空間の変換とアルファの乗算をさせない。RGB の値が変わると標高が狂う（tech-spec §5.4）
  const bitmap = await createImageBitmap(await response.blob(), {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  try {
    if (bitmap.width !== TILE_SIZE || bitmap.height !== TILE_SIZE) {
      throw new Error(`タイルの大きさが ${bitmap.width}×${bitmap.height} です`)
    }
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (context === null) throw new Error('OffscreenCanvas の 2D コンテキストを得られません')
    context.drawImage(bitmap, 0, 0)
    return {
      status: 'ok',
      data: decodeGsiDem(context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data),
    }
  } finally {
    bitmap.close()
  }
}
