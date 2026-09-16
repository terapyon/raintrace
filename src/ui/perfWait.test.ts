import { describe, expect, it } from 'vitest'
import { placeViewOnLoadedTerrain } from './perfWait'

describe('placeViewOnLoadedTerrain（タイルが揃ってから、同じ視点をもう一度置く）', () => {
  const view = { center: [139.7016, 35.658] as [number, number], zoom: 16, pitch: 85, bearing: 0 }

  it('1 回目の視点 → 降雨の開始 → タイルの待ち → 2 回目の視点、の順に行う', async () => {
    const calls: string[] = []
    const map = {
      jumpTo: (target: typeof view) => calls.push(`jumpTo z${target.zoom} p${target.pitch}`),
    }
    const tiles = await placeViewOnLoadedTerrain(
      map,
      view,
      () => calls.push('降雨の開始'),
      async () => {
        calls.push('タイルの待ち')
        return { loaded: true, waitMs: 120 }
      },
    )
    // 2 回目が「タイルの待ち」の後にあることが肝心（読める地形の上でカメラの持ち上がりを計算させる）
    expect(calls).toEqual(['jumpTo z16 p85', '降雨の開始', 'タイルの待ち', 'jumpTo z16 p85'])
    expect(tiles).toEqual({ loaded: true, waitMs: 120 })
  })

  it('タイルが揃わなくても 2 回目を置き、待ちの結果をそのまま返す', async () => {
    const targets: number[] = []
    const map = { jumpTo: (target: typeof view) => targets.push(target.pitch) }
    const tiles = await placeViewOnLoadedTerrain(
      map,
      view,
      () => undefined,
      async () => ({ loaded: false, waitMs: 60_000 }),
    )
    expect(targets).toEqual([85, 85])
    expect(tiles).toEqual({ loaded: false, waitMs: 60_000 })
  })
})
