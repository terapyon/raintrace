import { mkdirSync, writeFileSync } from 'node:fs'
import { type Browser, expect, type Page, test } from '@playwright/test'
import type { FpsResult } from '../../src/map/fpsProbe'
import { percentile } from '../../src/map/fpsStats'
import { drawnTileZoomForView } from '../../src/map/view3d/drawnZoom'
import { acknowledgeDisclaimer, collectErrors } from '../e2e/support/app'

interface Variant {
  label: string
  /** 省くと URL に載せず、フックの既定（3D の既定）を使う */
  tiles?: string
  hillshade?: string
  water: '0' | '1'
}

interface Report {
  /** 測った視点（フックが入れる。URL と照合する） */
  view3d: string
  mapZoom: number
  mapPitch: number
  prepareMs: number[]
  waterBuildMs: number[]
  tiles: { loaded: boolean; waitMs: number }
  result: FpsResult
}

interface Row extends Report {
  variant: string
  size: string
  view: string
  /** URL で要求した視点。実測（mapZoom・mapPitch）と並べて、表にも JSON にも残す（コントローラーの裁定） */
  requested: { z: number; pitch: number }
  /** 同じ条件の何回目か（1 から） */
  run: number
}

// S と同じ 2 つの視点と画面（spec 05 §4.4）
const VIEWS = [
  { name: 'z17 ×5 p60', z: '17', ex: '5', pitch: '60' },
  { name: 'z16 ×10 p85', z: '16', ex: '10', pitch: '85' },
] as const
const SIZES = ['500', '1000'] as const
const SHIBUYA = { lat: '35.658000', lon: '139.701600' }
const VIEWPORT = { width: 960, height: 600 }

/** 計測の組（RAINTRACE_FPS_SET で選ぶ）。Task 6・9 で組を足す */
const SETS: Record<string, readonly Variant[]> = {
  'terrain-main': [
    { label: 'main・hillshade あり・地形のみ', tiles: 'main', hillshade: 'on', water: '0' },
    { label: 'main・hillshade なし・地形のみ', tiles: 'main', hillshade: 'off', water: '0' },
  ],
}

const DEFAULT_SET = 'terrain-main'
const setName = process.env.RAINTRACE_FPS_SET ?? DEFAULT_SET
/** 同じ条件を測る回数。判定（Task 6・9）はセルごとの中央値で行う。Task 5 は 1 でよい */
const repeat = Number(process.env.RAINTRACE_FPS_REPEAT ?? '3')
/** 1 回の計測を待つ上限（readReport） */
const RUN_TIMEOUT_MS = 240_000
const outDir = new URL('../../.handoff/05-fps/', import.meta.url)

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  )
  return `/?${new URLSearchParams(entries).toString()}`
}

/**
 * 1 回ずつ新しい context（HTTP の cache が空）で開く。同じページで続けると、後の条件ほど地理院のタイルが
 * cache から来て有利になる（計画で決めたこと 20）
 */
async function withFreshPage<T>(
  browser: Browser,
  baseURL: string,
  run: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORT, deviceScaleFactor: 1 })
  try {
    await acknowledgeDisclaimer(context)
    const page = await context.newPage()
    const errors = collectErrors(page)
    const value = await run(page)
    expect(errors).toEqual([])
    return value
  } finally {
    await context.close()
  }
}

/** 結果か失敗の印が付くまで待ち、結果を読む */
async function readReport(page: Page): Promise<Report> {
  await expect(page.locator('html[data-fps-result], html[data-perf-error]')).toBeAttached({
    timeout: RUN_TIMEOUT_MS,
  })
  const failure = await page.locator('html').getAttribute('data-perf-error')
  if (failure !== null) throw new Error(`計測の失敗: ${failure}`)
  return JSON.parse((await page.locator('html').getAttribute('data-fps-result')) ?? 'null')
}

const tileCell = (t: FpsResult['tileGen']['terrain']): string =>
  `${t.count}・${t.cached}・${t.meanMs.toFixed(1)}・${t.maxMs.toFixed(1)}`

function formatTable(rows: readonly Row[]): string {
  const lines = [
    `描画: ${rows[0]?.result.renderer ?? '不明'}（実 GPU・headless。rAF は 60Hz に刻まれるので 60 fps が上限）`,
    '',
    'タイルの列は「組み立てた数・使い回した数・組み立ての平均・最大（ms）」。tiles=worker の時間は Worker の中の時間で、メインスレッドを止めない',
    '',
    '| 条件 | 範囲 | 視点 | 要求 pitch | 実測 pitch | 要求 zoom | 実測 zoom | 平均 fps | 中央値 (ms) | 長いフレーム | ヒストグラム g1/g2/g3/g4/g5+ | render CPU 平均 (ms) | 地形のタイル | hillshade のタイル | 描かれるタイル | タイルの待ち (s) | 準備 (ms) | 水面の作成 (ms) | pass |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|---|---|---:|---|---|---|---|',
  ]
  for (const {
    variant,
    run,
    size,
    view,
    requested,
    mapPitch,
    mapZoom,
    prepareMs,
    waterBuildMs,
    tiles,
    result: r,
  } of rows) {
    const h = r.gapHistogram
    const wait = `${(tiles.waitMs / 1000).toFixed(1)}${tiles.loaded ? '' : '（揃わず）'}`
    lines.push(
      `| ${variant} #${run} | ${size} m | ${view} | ${requested.pitch} | ${mapPitch.toFixed(1)} | ${requested.z} | ${mapZoom.toFixed(3)} | ${r.meanFps.toFixed(1)} | ${r.p50Ms.toFixed(1)} | ${r.longFrames}/${r.frames}（${(r.longFrameRatio * 100).toFixed(1)}%） | ${h.g1}/${h.g2}/${h.g3}/${h.g4}/${h.g5plus} | ${r.renderCpuMeanMs.toFixed(2)} | ${tileCell(r.tileGen.terrain)} | ${tileCell(r.tileGen.hillshade)} | ${r.drawnTileZoom} | ${wait} | ${prepareMs.map((ms) => ms.toFixed(0)).join('・')} | ${waterBuildMs.map((ms) => ms.toFixed(0)).join('・')} | ${r.pass} |`,
    )
  }
  lines.push(
    '',
    'S との比較について: S の「z16 ×10 p85」は、実アプリでは pitch 85° に届かない。垂直強調 ×10 では、MapLibre の',
    '_elevateCameraIfInsideTerrain（maplibre-gl-dev.mjs の 22431〜22443 行）が、カメラが持ち上がった地形の中に',
    '入ってしまうときカメラをその地形の高さまで持ち上げ、calculateCameraOptionsFromTo で pitch とズームを',
    '作り直す。これは transform の更新ごとの修飾として働く（同 22454 行あたり）。渋谷の 8.8〜33 m は ×10 で',
    '88〜330 m になり、z16・p85 でのカメラの高さを超える。',
    '落ち着く角度は、視点を置いたまま静止していれば約 83°、上の表のように計測で地図を動かしている間は約 78.6°。',
    '動かすとカメラがより高い地面の上を通り、持ち上がりが大きくなるためで、持ち上がりは「カメラの下の標高 ×',
    '垂直強調」に比例する固定でない量である。要求どおりの 85° になるのは垂直強調 ×1 のとき、また pitch 0 は',
    '常に要求どおりになる（いずれも実測で確認）。',
    '',
    '推定（未検証。事実としては扱わない）: S も同じ渋谷の地形に対し、同じ MapLibre 6.6.0 で同じ',
    'map.jumpTo({ zoom, pitch }) を使っており、実測の pitch・zoom を記録していなかった。したがって S の',
    '「z16 ×10 p85」も、おそらく ≈83° で測られている。そうであれば比較は実質的に同じ条件どうしで、',
    'S の側でそれが記録されていなかっただけ、ということになる。',
    '',
    '合否（平均 57 fps 以上・長いフレーム 1% 以下）は、この「落ち着いた後の視点」に対して判定する。',
    'それが利用者が実際に到達できる、いちばん厳しい視点だからである。各行の「実測 pitch」「実測 zoom」がその視点。',
  )
  return `${lines.join('\n')}\n`
}

/** 中央値（回数が偶数なら上側。percentile と同じ） */
const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return percentile(sorted, 0.5)
}

/**
 * セル（条件・範囲・視点）ごとの、ランの中央値と幅。Task 6・9 の判定はこの表で行う（1 回のランでは、GC 1 回で
 * 長いフレームが 2 間隔ほど動く。計画で決めたこと 20）
 */
function formatSummary(rows: readonly Row[]): string {
  const cells = new Map<string, Row[]>()
  for (const row of rows) {
    const key = `${row.variant}|${row.size}|${row.view}`
    cells.set(key, [...(cells.get(key) ?? []), row])
  }
  const spread = (values: number[], digits: number): string =>
    `${median(values).toFixed(digits)}（${Math.min(...values).toFixed(digits)}〜${Math.max(...values).toFixed(digits)}）`
  const lines = [
    `セルごとの ${repeat} 回の中央値（括弧は最小〜最大）。組み立ての最大は地形と hillshade の大きい方`,
    '',
    '| 条件 | 範囲 | 視点 | 平均 fps | 長いフレーム | 組み立ての最大 (ms) | 組み立てた数（地形・hillshade） |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const runs of cells.values()) {
    const first = runs[0]
    if (first === undefined) continue
    const results = runs.map((r) => r.result)
    const fps = results.map((r) => r.meanFps)
    const long = results.map((r) => r.longFrames)
    const build = results.map((r) => Math.max(r.tileGen.terrain.maxMs, r.tileGen.hillshade.maxMs))
    const terrainCount = median(results.map((r) => r.tileGen.terrain.count))
    const hillshadeCount = median(results.map((r) => r.tileGen.hillshade.count))
    lines.push(
      `| ${first.variant} | ${first.size} m | ${first.view} | ${spread(fps, 1)} | ${spread(long, 0)} | ${spread(build, 1)} | ${terrainCount}・${hillshadeCount} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

test(`fps の測り直し（${setName}）`, async ({ browser }, testInfo) => {
  const variants = SETS[setName]
  if (variants === undefined) throw new Error(`計測の組がありません: ${setName}`)
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`RAINTRACE_FPS_REPEAT は 1 以上の整数: ${process.env.RAINTRACE_FPS_REPEAT}`)
  }
  // 1 回の上限 × 回数（config の 90 分は、Task 6 の 48 回の最悪に足りない）
  test.setTimeout(variants.length * SIZES.length * VIEWS.length * repeat * RUN_TIMEOUT_MS)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const rows: Row[] = []
  let turn = 0
  for (let run = 1; run <= repeat; run++) {
    for (const size of SIZES) {
      for (const view of VIEWS) {
        // 条件の順を 1 回ごと・ランごとに入れ替える（時間とともに変わる条件の偏りを減らす）
        const order = (turn++ + run) % 2 === 0 ? variants : [...variants].reverse()
        for (const variant of order) {
          const url = query({
            ...SHIBUYA,
            size,
            probe: 'fps',
            z: view.z,
            ex: view.ex,
            pitch: view.pitch,
            water: variant.water,
            hillshade: variant.hillshade,
            tiles: variant.tiles,
          })
          const report = await withFreshPage(browser, baseURL, async (page) => {
            await page.goto(url)
            return readReport(page)
          })
          // 3D のまま（(c) で 2D に落ちていない。フックも data-perf-error にする）
          expect(report.view3d).toBe('3d')
          // 視点は厳密な一致ではなく「幅」で照合する（コントローラーの裁定による、ブリーフからの意図的な変更）。
          // 地形があると MapLibre はカメラを（垂直強調で持ち上がった）地形の上に保つので、pitch は要求より下がる
          // （渋谷 500 m・×10 では 85 → 約 83）。また地図のズームは地形があると保存量ではなく、画面の中心の
          // 地形の標高から決まり直すので（Transform.recalculateZoomAndCenter）、計測で地図を動かすと少し動く。
          // pitch の下側の幅を広く取るのは、カメラの持ち上がりが「カメラの下の標高 × 垂直強調」に比例し、
          // 範囲によって変わる量だからである（1000 m ではカメラが中心より数百 m 南の、より高い地面の上に来うる）。
          // この照合は「フックが pitch を無視した」ような取り違えを捕まえるためのもので、角度そのものの検証では
          // ない。実際に測れた角度は「実測 pitch」の列が示す
          const requestedPitch = Number(view.pitch)
          expect(report.mapPitch).toBeLessThanOrEqual(requestedPitch + 0.05)
          expect(report.mapPitch).toBeGreaterThanOrEqual(requestedPitch - 10.0)
          expect(Math.abs(report.mapZoom - Number(view.z))).toBeLessThanOrEqual(0.05)
          rows.push({
            variant: variant.label,
            size,
            view: view.name,
            run,
            requested: { z: Number(view.z), pitch: requestedPitch },
            ...report,
          })
        }
      }
    }
  }
  mkdirSync(outDir, { recursive: true })
  // JSON は全ラン（生のフレームの間隔 deltas を含む）を残す
  writeFileSync(new URL(`${setName}.json`, outDir), `${JSON.stringify(rows, null, 2)}\n`)
  const table = `${formatSummary(rows)}\n${formatTable(rows)}`
  writeFileSync(new URL(`${setName}.md`, outDir), table)
  console.log(table)
})

test('描かれる地形タイルのズームの実測と、pitch つきの見込み（計画で決めたこと 3）', async ({
  browser,
}, testInfo) => {
  test.skip(process.env.RAINTRACE_DRAWN_ZOOM !== '1', 'RAINTRACE_DRAWN_ZOOM=1 のときだけ回す')
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const lines = ['| 地図のズーム | pitch | 見込み | 実測 |', '|---:|---:|---:|---:|']
  for (const z of [15.5, 16, 16.5, 17]) {
    for (const pitch of [0, 60, 85]) {
      const url = query({
        ...SHIBUYA,
        size: '500',
        probe: 'view',
        z: String(z),
        pitch: String(pitch),
        water: '0',
      })
      const drawn = await withFreshPage(browser, baseURL, async (page) => {
        await page.goto(url)
        await expect(page.locator('html[data-perf-ready="true"]')).toBeAttached({
          timeout: 240_000,
        })
        return page.locator('[data-map-loaded="true"]').getAttribute('data-drawn-tile-zoom')
      })
      lines.push(`| ${z} | ${pitch} | ${drawnTileZoomForView(z, pitch)} | ${drawn ?? ''} |`)
    }
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL('drawn-zoom.md', outDir), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
})
