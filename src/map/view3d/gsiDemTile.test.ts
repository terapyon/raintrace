import { afterEach, describe, expect, it, vi } from 'vitest'
import { GSI_RETRY_DELAYS_MS } from '../../dem/async'
import type { TileCoord } from '../../dem/tileMath'
import { createMainGsiFetcher } from './gsiDemTile'

/** 復号に渡す 256 × 256 の画素（すべて 0 → 標高 0 m の有効セル） */
const TILE_PIXELS = new Uint8ClampedArray(256 * 256 * 4)

class FakeOffscreenCanvas {
  getContext() {
    return {
      globalCompositeOperation: '',
      drawImage: () => {},
      getImageData: () => ({ data: TILE_PIXELS }),
    }
  }
}

function stubTileDecoding(width = 256, height = 256): void {
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close: () => {} })),
  )
}

const tile = (x: number, y: number): TileCoord => ({ z: 16, x, y })
const key = (t: TileCoord): string => `${t.z}/${t.x}/${t.y}`

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe(
  'createMainGsiFetcher（メインスレッドでの地理院タイルの取得。spec 05 §4.2、計画で決めたこと 23。' +
    '再レビューの推奨 2: mainTileGenerator.test.ts の isWanted は常に true で、ここの核となる規則が' +
    '確かめられていなかった）',
  () => {
    it('枠を待っている間に要らなくなったタイルは、取得せずに reject する（UnwantedTileError）', async () => {
      stubTileDecoding()
      const okResponse = { status: 200, ok: true, blob: async () => ({}) }
      const pending: { url: string; resolve: () => void }[] = []
      const fetchMock = vi.fn(
        (url: string) =>
          new Promise((resolve) => {
            pending.push({ url, resolve: () => resolve(okResponse) })
          }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const wanted = new Set<string>()
      const isWanted = vi.fn((t: TileCoord) => wanted.has(key(t)))
      const fetchTile = createMainGsiFetcher(isWanted)

      // 同時 6 件の枠を、要り続けるタイルで埋める
      const fillers = Array.from({ length: 6 }, (_, i) => tile(i, 0))
      const fillerPromises = fillers.map((t) => {
        wanted.add(key(t))
        return fetchTile('dem5a', t)
      })
      expect(pending).toHaveLength(6)

      // 7 番目は枠が空くまで待たされる（fetch はまだ呼ばれない）
      const target = tile(99, 99)
      wanted.add(key(target))
      const targetPromise = fetchTile('dem5a', target)
      expect(pending).toHaveLength(6)

      // 枠を待っている間に、要らなくなる
      wanted.delete(key(target))

      // 1 枠を空ける。空いた枠は target に回るが、isWanted が false なので取得しない
      pending[0]?.resolve()
      await fillerPromises[0]

      await expect(targetPromise).rejects.toThrow(/99\/99/)
      // fetch は 6 件のフィラーの分だけ（target の分は増えない）
      expect(fetchMock).toHaveBeenCalledTimes(6)
    })

    it('HTTP 500 の後に要らなくなっていたら、再試行しない（1 回だけ試す）', async () => {
      stubTileDecoding()
      const target = tile(1, 1)
      const wanted = new Set([key(target)])
      const isWanted = vi.fn((t: TileCoord) => wanted.has(key(t)))
      const fetchMock = vi.fn(async () => {
        // 応答が届いた時点で、そのタイルを待つ要求が無くなった
        wanted.delete(key(target))
        return { status: 500, ok: false, blob: async () => ({}) }
      })
      vi.stubGlobal('fetch', fetchMock)
      const fetchTile = createMainGsiFetcher(isWanted)

      await expect(fetchTile('dem5a', target)).rejects.toThrow(/HTTP 500/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it(
      '要り続ける間、再試行できる失敗（ネットワークエラー）は GSI_RETRY_DELAYS_MS の回数・間隔で' +
        '再試行する（0.5・1・2 秒で最大 3 回）',
      async () => {
        vi.useFakeTimers()
        stubTileDecoding()
        const target = tile(2, 2)
        const isWanted = vi.fn(() => true)
        const fetchMock = vi.fn(async () => {
          throw new Error('接続できません')
        })
        vi.stubGlobal('fetch', fetchMock)
        const fetchTile = createMainGsiFetcher(isWanted)

        const promise = fetchTile('dem5a', target)
        promise.catch(() => {})

        await vi.advanceTimersByTimeAsync(0)
        expect(fetchMock).toHaveBeenCalledTimes(1)

        for (const [index, delay] of GSI_RETRY_DELAYS_MS.entries()) {
          await vi.advanceTimersByTimeAsync(delay)
          expect(fetchMock).toHaveBeenCalledTimes(index + 2)
        }

        await expect(promise).rejects.toThrow(/接続できません/)
        // 最初の 1 回 + GSI_RETRY_DELAYS_MS の回数（3）の再試行 = 4 回
        expect(fetchMock).toHaveBeenCalledTimes(1 + GSI_RETRY_DELAYS_MS.length)
      },
    )

    it('復号したタイルの大きさが違う応答は、再試行しない', async () => {
      stubTileDecoding(1, 1)
      const target = tile(3, 3)
      const isWanted = vi.fn(() => true)
      const fetchMock = vi.fn(async () => ({ status: 200, ok: true, blob: async () => ({}) }))
      vi.stubGlobal('fetch', fetchMock)
      const fetchTile = createMainGsiFetcher(isWanted)

      await expect(fetchTile('dem5a', target)).rejects.toThrow(/タイルの大きさ/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  },
)
