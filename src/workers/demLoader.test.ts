import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TileCoord } from '../dem/tileMath'
import { createGsiTileFetcher, TILE_FETCH_TIMEOUT_MS } from './demLoader'

const noopProgress = { onStart: () => {}, onAttempt: () => {}, onDone: () => {} }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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

/** signal で打ち切られるまで応答しない fetch（打ち切りの理由で失敗する） */
function hangUntilAborted(init: RequestInit | undefined): Promise<Response> {
  return new Promise<Response>((_, reject) => {
    const signal = init?.signal
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

describe('createGsiTileFetcher: 1 回の取得の上限と心拍（計画で決めたこと 16）', () => {
  it('1 回の取得は TILE_FETCH_TIMEOUT_MS で打ち切り、ネットワークエラーとして再試行する', async () => {
    vi.useFakeTimers()
    // AbortSignal.timeout は Node の内部のタイマーで動き、偽のタイマーでは進まない。打ち切りを手で起こせる signal に差し替える
    const timeouts: AbortController[] = []
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController()
      timeouts.push(controller)
      return controller.signal
    })
    // 1 回目は打ち切られるまで応答しない。2 回目は 404
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit): Promise<Response> =>
        fetchMock.mock.calls.length === 1
          ? hangUntilAborted(init)
          : Promise.resolve({ status: 404, ok: false } as Response),
    )
    vi.stubGlobal('fetch', fetchMock)
    const fetchTile = createGsiTileFetcher(new AbortController().signal, noopProgress)

    const result = fetchTile('dem1a', { z: 17, x: 0, y: 0 })
    await vi.advanceTimersByTimeAsync(0)
    expect(timeout).toHaveBeenCalledWith(TILE_FETCH_TIMEOUT_MS)
    timeouts[0]?.abort(new DOMException('The operation timed out.', 'TimeoutError'))
    // 打ち切りは NetworkError になり、0.5 秒の待ちの後に再試行する
    await vi.advanceTimersByTimeAsync(500)

    await expect(result).resolves.toEqual({ status: 'missing' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('外からの取り消しは再試行せず、そのまま投げる（上限の打ち切りと区別する）', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => hangUntilAborted(init))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const fetchTile = createGsiTileFetcher(controller.signal, noopProgress)

    const result = fetchTile('dem1a', { z: 17, x: 0, y: 0 })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('再試行を含む各回の始めに onAttempt で知らせる（番犬への心拍。onStart・onDone は 1 回ずつ）', async () => {
    vi.useFakeTimers()
    const statuses = [503, 503, 404]
    const fetchMock = vi.fn(() =>
      Promise.resolve({ status: statuses.shift() ?? 404, ok: false } as Response),
    )
    vi.stubGlobal('fetch', fetchMock)
    const events: string[] = []
    const fetchTile = createGsiTileFetcher(new AbortController().signal, {
      onStart: () => events.push('start'),
      onAttempt: () => events.push('attempt'),
      onDone: () => events.push('done'),
    })

    const result = fetchTile('dem1a', { z: 17, x: 0, y: 0 })
    // 503 → 0.5 秒待つ → 503 → 1 秒待つ → 404
    await vi.advanceTimersByTimeAsync(1500)

    await expect(result).resolves.toEqual({ status: 'missing' })
    expect(events).toEqual(['start', 'attempt', 'attempt', 'attempt', 'done'])
  })
})
