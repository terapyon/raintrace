import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TileCoord } from '../dem/tileMath'
import { createGsiTileFetcher } from './demLoader'

const noopProgress = { onStart: () => {}, onDone: () => {} }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('createGsiTileFetcher', () => {
  it('再試行の待ちの間は同時数の枠を空ける（レビュー P2）', async () => {
    vi.useFakeTimers()
    // 1 枚目だけ 503、残りの 6 枚は決して解決しない fetch
    const fetchMock = vi.fn((): Promise<Response> => {
      if (fetchMock.mock.calls.length === 1) {
        return Promise.resolve({ status: 503, ok: false } as Response)
      }
      return new Promise<Response>(() => {})
    })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const fetchTile = createGsiTileFetcher(controller.signal, noopProgress)

    const tiles: TileCoord[] = Array.from({ length: 7 }, (_, i) => ({ z: 17, x: i, y: 0 }))
    for (const tile of tiles) {
      fetchTile('dem1a', tile).catch(() => {})
    }
    // 503 の応答とその後の再試行の判断が進むところまでマイクロタスクを流す（500ms の待ちより前）
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchMock).toHaveBeenCalledTimes(7)

    // 後片付け: 1 枚目の再試行の待ちを取り消し、タイマーを残さない
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('本文の読み込みの失敗も再試行する（レビュー P7）', async () => {
    vi.useFakeTimers()
    const responses: Response[] = [
      {
        status: 200,
        ok: true,
        blob: () => Promise.reject(new TypeError('network')),
      } as unknown as Response,
      { status: 404, ok: false } as Response,
    ]
    const fetchMock = vi.fn(() => Promise.resolve(responses.shift() as Response))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const fetchTile = createGsiTileFetcher(controller.signal, noopProgress)

    const result = fetchTile('dem1a', { z: 17, x: 0, y: 0 })
    await vi.advanceTimersByTimeAsync(500)

    await expect(result).resolves.toEqual({ status: 'missing' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
