// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { placeViewOnLoadedTerrain, pollUntil, sleep, waitForDataset } from './perfWait'

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

describe('sleep（計測の待ちの基本部品。perfSteps の IDLE_QUIET_MS の待ちなどで使う）', () => {
  it('指定した ms だけ待って解決する', async () => {
    const start = performance.now()
    await sleep(30)
    expect(performance.now() - start).toBeGreaterThanOrEqual(29)
  })
})

describe('pollUntil（check が真になるまで intervalMs ごとに見る。perfLoad の地図の読み込み待ちで使う）', () => {
  it('check が真になったら、待たずに true で解決する', async () => {
    await expect(pollUntil(() => true, 1000)).resolves.toBe(true)
  })

  it('待つうちに真になれば true で解決する', async () => {
    let ready = false
    setTimeout(() => {
      ready = true
    }, 20)
    await expect(pollUntil(() => ready, 1000, 5)).resolves.toBe(true)
  })

  it('timeoutMs を過ぎても真にならなければ false で解決する', async () => {
    await expect(pollUntil(() => false, 30, 5)).resolves.toBe(false)
  })
})

describe('waitForDataset（要素の data-* が条件を満たすまで待つ。perfLoad・perfSteps が使う）', () => {
  it('すでに条件を満たしていれば、待たずに解決する', async () => {
    const element = document.createElement('div')
    element.dataset.foo = 'true'
    await expect(
      waitForDataset(element, (dataset) => dataset.foo === 'true'),
    ).resolves.toBeUndefined()
  })

  it('属性の変化（MutationObserver）を見て、条件を満たしたら解決する', async () => {
    const element = document.createElement('div')
    const done = waitForDataset(element, (dataset) => dataset.foo === 'true')
    setTimeout(() => {
      element.dataset.foo = 'true'
    }, 10)
    await expect(done).resolves.toBeUndefined()
  })

  it('timeoutMs を過ぎても満たさなければ reject する', async () => {
    const element = document.createElement('div')
    await expect(waitForDataset(element, (dataset) => dataset.foo === 'true', 30)).rejects.toThrow(
      '計測の準備が時間内に終わりませんでした',
    )
  })
})
