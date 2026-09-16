import { afterEach, describe, expect, it, vi } from 'vitest'
import { demZoom } from '../../dem/tileZoom'
import { createMainTileGenerator } from './mainTileGenerator'
import { notFoundResponse, okResponse, stubTileDecoding } from './tileDecoding.test-support'

/** z16 の隣り合う 2 枚は、同じ z15 の親（dem5a）を出所にする（ancestorTile） */
const TILE_A = { z: demZoom(16), x: 2, y: 2 }
const TILE_B = { z: demZoom(16), x: 3, y: 2 }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createMainTileGenerator（範囲の外のタイルの取得の共有。spec 05 §4.2）', () => {
  it('同じ出所のタイルを待つ 2 つの要求で、取得の最中に片方を取り消しても、もう片方はタイルを受け取る（取得は 1 回。再レビューの推奨 4）', async () => {
    const urls: string[] = []
    let release: () => void = () => {}
    let started = false
    stubTileDecoding()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        await new Promise<void>((resolve) => {
          release = resolve
          started = true
        })
        return okResponse
      }),
    )
    const generator = createMainTileGenerator()
    const a = new AbortController()
    const b = new AbortController()
    const pendingA = generator.generate(TILE_A, a.signal)
    const pendingB = generator.generate(TILE_B, b.signal)
    await vi.waitFor(() => expect(started).toBe(true))

    // 取得の最中に片方だけを取り消す（もう片方が同じ出所のタイルを待っているので、取得は続く）
    a.abort()
    release()

    await expect(pendingA).resolves.toBeNull()
    const result = await pendingB
    expect(result?.rgba).toHaveLength(256 * 256 * 4)
    expect(urls.filter((url) => url.includes('dem5a_png'))).toHaveLength(1)
  })

  it('範囲の外の出所をどれも取れない（DEM10B も 404）と、0 m で描いて console.warn で知らせる（error にしない。計画で決めたこと 5）', async () => {
    // DEM5 は 200 で返るが大きさが違う（再試行しない失敗）、DEM10B は 404。最後の頼みの 0 m に落ちる
    stubTileDecoding(1, 1)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('dem_png') ? notFoundResponse : okResponse)),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const generator = createMainTileGenerator()

    const result = await generator.generate(TILE_A, new AbortController().signal)

    expect(result?.rgba).toHaveLength(256 * 256 * 4)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })
})
