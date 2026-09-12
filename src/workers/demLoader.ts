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
 * タイルの 1 回の取得（応答と本文）の上限。超えたら NetworkError として再試行する。
 * 読み込みの番犬（SimulationClient の LOAD_STALL_TIMEOUT_MS = 30 秒）が生きている Worker を止めないよう、
 * 「1 回の取得 + 再試行の待ち（最長 2 秒）」が 30 秒に届かない値にする（計画で決めたこと 16）
 */
export const TILE_FETCH_TIMEOUT_MS = 20_000

/** 取得の進捗。onAttempt は再試行を含む各回の始め（番犬への心拍。started・done の数には数えない） */
export interface TileFetchProgress {
  onStart(): void
  onAttempt(): void
  onDone(): void
}

/**
 * 地理院の DEM タイルの取得関数を作る（spec 02 §4.3）。同時に 6 件まで。404 は missing、
 * それ以外の HTTP エラーとネットワークエラーは 0.5・1・2 秒の間隔で最大 3 回再試行する。signal で取り消す
 */
export function createGsiTileFetcher(
  signal: AbortSignal,
  progress: TileFetchProgress,
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
  // fetcher ごとに 1 枚だけ作り、使い回す（レビュー L5）。最初に使うときに作る
  // （Node のテストでは OffscreenCanvas が無いので、fetcher の生成時には作らない）
  let context: OffscreenCanvasRenderingContext2D | null = null
  const getContext = (): OffscreenCanvasRenderingContext2D => {
    if (context === null) {
      const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE)
      const created = canvas.getContext('2d', { willReadFrequently: true })
      if (created === null) throw new Error('OffscreenCanvas の 2D コンテキストを得られません')
      // 前のタイルの画素が残る経路を消す（GSI の DEM PNG は RGB なので今は実害はない）
      created.globalCompositeOperation = 'copy'
      context = created
    }
    return context
  }
  return (dem, tile) => {
    progress.onStart()
    // 同時数の枠は 1 回の fetchOnce の間だけ占める。再試行の待ち（0.5〜2 秒）は枠の外（レビュー P2）。
    // 各回の始め（枠を得た時点）に心拍を送る。1 回は最長 TILE_FETCH_TIMEOUT_MS なので、進捗は 30 秒より短い間隔で届く
    return retry(
      () =>
        limit(() => {
          progress.onAttempt()
          return fetchOnce(dem, tile, signal, getContext)
        }),
      {
        delaysMs: GSI_RETRY_DELAYS_MS,
        sleep,
        shouldRetry: (error) =>
          !signal.aborted && (error instanceof NetworkError || error instanceof HttpError),
      },
    ).finally(() => progress.onDone())
  }
}

async function fetchOnce(
  dem: DemId,
  tile: TileCoord,
  signal: AbortSignal,
  getContext: () => OffscreenCanvasRenderingContext2D,
): Promise<TileFetchResult> {
  // 外からの取り消し（新しい地点）と、この 1 回の上限のどちらかで打ち切る
  const attempt = AbortSignal.any([signal, AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS)])
  let response: Response
  try {
    response = await fetch(demTileUrl(dem, tile), { signal: attempt })
  } catch (error) {
    // 外からの取り消しはそのまま投げる。上限の打ち切り（TimeoutError）は接続の失敗と同じく再試行の対象
    if (signal.aborted) throw error
    throw new NetworkError(error)
  }
  if (response.status === 404) return { status: 'missing' }
  if (!response.ok) throw new HttpError(response.status)
  let blob: Blob
  try {
    blob = await response.blob()
  } catch (error) {
    // 本文の読み込み中の切断も、fetch() 自体の失敗と同じ扱いにする（レビュー P7）
    if (signal.aborted) throw error
    throw new NetworkError(error)
  }
  // 色空間の変換とアルファの乗算をさせない。RGB の値が変わると標高が狂う（tech-spec §5.4）
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  try {
    if (bitmap.width !== TILE_SIZE || bitmap.height !== TILE_SIZE) {
      throw new Error(`タイルの大きさが ${bitmap.width}×${bitmap.height} です`)
    }
    const context = getContext()
    // drawImage から getImageData までは await を挟まないので、同時に取得していても 1 枚を使い回せる
    context.drawImage(bitmap, 0, 0)
    return {
      status: 'ok',
      data: decodeGsiDem(context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data),
    }
  } finally {
    bitmap.close()
  }
}
