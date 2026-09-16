/**
 * fps の測り直し（spec 05 §4.4、spec 06 §4.1・§5・§5.1）と、クリックから表示まで（spec 06 §3・§5）。
 *
 * fallback=0: (c) の 2D への切り替えを止めて測る。z16 ×10 p85 は、pitch つきの見込みでは画面の中心のタイルが
 * 14 だが、実測は 16（05 の Task 6・9: pitch 78.6037°・zoom 15.9768 に落ち着く）。3D の間の (c) の判定は実測で
 * 行うので、この視点は 2D に落ちない。fallback=0 は、計測の途中で実測が境界を割って 2D に落ちることが
 * 絶対に起きないようにする保険である
 *
 * 環境変数: RAINTRACE_FPS_SET（terrain-main・terrain-tiles・water・isolate・water-sites）・
 * RAINTRACE_FPS_REPEAT（既定 3）・
 * RAINTRACE_FPS_SITES（既定 shibuya。06 の M2 は ayase,shibuya,minatomirai。RAINTRACE_LOAD=1 のときだけ
 * nemuro〈段 2。ユーザーの裁定 R5〉も選べる）・RAINTRACE_FPS_OUT_DIR
 * （既定は 05 にあった組〈terrain-main・terrain-tiles・water〉と RAINTRACE_DRAWN_ZOOM=1 が .handoff/05-fps、
 * 06 で足した組〈isolate・water-sites〉と RAINTRACE_LOAD=1 が .handoff/06-perf）・RAINTRACE_LOAD=1（クリックから
 * 表示まで）・RAINTRACE_DRAWN_ZOOM=1
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { FpsResult } from '../../src/map/fpsProbe'
import { drawnTileZoomForView } from '../../src/map/view3d/drawnZoom'
import type { LongTaskSummary, StepTimeSummary } from '../../src/ui/perfCollectors'
import type { LoadReport } from '../../src/ui/perfReports'
import {
  assertPerfBuild,
  LOAD_SITES,
  type LoadSiteName,
  loadSitesFromEnv,
  median,
  outDirFromEnv,
  query,
  readReport,
  SITES,
  type SiteName,
  sitesFromEnv,
  withFreshPage,
} from './support'

interface Variant {
  label: string
  hillshade?: string
  water: '0' | '1'
  /** URL に足す項目（depthEvery・pause・arrows・arrowsM。spec 06 §5.1） */
  extra?: Record<string, string>
}

/** 実際に置けた視点（要求どおりとは限らない。地形がカメラを持ち上げる） */
interface Achieved {
  mapZoom: number
  mapPitch: number
}

interface Report {
  /** 測った視点（フックが入れる。URL と照合する）。mapZoom・mapPitch は計測の後に読んだ値 */
  view3d: string
  mapZoom: number
  mapPitch: number
  /** タイルが揃ってからの 2 回目の jumpTo の直後（落ち着かせる前） */
  achievedBeforeSettle: Achieved
  /** 計測の窓を閉じた後。achievedBeforeSettle と一致すれば、窓の間ずっとこの視点だったと言える */
  achievedAfterRun: Achieved
  prepareMs: number[]
  waterBuildMs: number[]
  tiles: { loaded: boolean; waitMs: number }
  result: FpsResult
  /** 計測の窓の長いタスク（spec 06 §3） */
  longTasks: LongTaskSummary
  /** 計測の窓の 1 step の所要時間（水面ありのときだけ値がある） */
  stepTimes: StepTimeSummary
}

interface Row extends Report {
  site: SiteName
  variant: string
  size: string
  view: string
  /** URL で要求した視点。実測（mapZoom・mapPitch）と並べて、表にも JSON にも残す（コントローラーの裁定） */
  requested: { z: number; pitch: number }
  /** 同じ条件の何回目か（1 から） */
  run: number
}

// S と同じ 2 つの視点（spec 05 §4.4）
const VIEWS = [
  { name: 'z17 ×5 p60', z: '17', ex: '5', pitch: '60' },
  { name: 'z16 ×10 p85', z: '16', ex: '10', pitch: '85' },
] as const
type ViewName = (typeof VIEWS)[number]['name']
const SIZES = ['500', '1000'] as const
type Size = (typeof SIZES)[number]

interface SetDef {
  variants: readonly Variant[]
  /** 水面ありの条件の URL に足す雨（mm・r）。省けば既定の雨（05 と同じ） */
  waterRain?: Readonly<Record<string, string>>
  /** 05 にあった組か。05 の記録を上書きしないよう、06 で足した組の結果の既定の書き先を分ける */
  from05?: true
  /** 省けば SIZES と VIEWS のすべて */
  sizes?: readonly Size[]
  views?: readonly ViewName[]
}

/**
 * 3 地点の組の水面ありの条件の雨（平衡に届かない。R-b。05 の shots.perf の水面の撮影と同じ雨）。既定の雨
 * （100 mm・半径 10 m）はみなとみらいで約 3 秒で平衡に届き、計測の窓の間に水深の転送が止まって、地点どうしを
 * 比べられなくなる。05 と比べる組（water・isolate。渋谷）には使わない。渋谷は既定の雨で窓の間に平衡に届かず
 * （04 の実測 47.9 秒）、05 の 51.0 fps はその雨で測ったため
 */
const WATER_RAIN = { mm: '500', r: '50' } as const

const WATER_VARIANTS: readonly Variant[] = [
  { label: '既定・地形のみ', water: '0' },
  { label: '既定・水面あり（最速で降雨、水深を毎フレーム更新）', water: '1' },
]

/** 地形のみの 2 変種（05 の Task 5）。地形の生成場所は main のみ（05 の Task 6 で Worker を採らなかった） */
const TERRAIN_MAIN_ONLY: readonly Variant[] = [
  { label: 'main・hillshade あり・地形のみ', hillshade: 'on', water: '0' },
  { label: 'main・hillshade なし・地形のみ', hillshade: 'off', water: '0' },
]

/**
 * 計測の組（RAINTRACE_FPS_SET で選ぶ）。water の組は 05 の Task 9、isolate は 06 の §5.1、water-sites は 06 の
 * §4.1（3 地点。RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai と組み合わせる）。
 * terrain-main（05 の Task 5）・terrain-tiles（05 の Task 6）は同じ中身（既存の記録が両方の名を使うため）
 */
const SETS: Record<string, SetDef> = {
  'terrain-main': { variants: TERRAIN_MAIN_ONLY, from05: true },
  'terrain-tiles': { variants: TERRAIN_MAIN_ONLY, from05: true },
  water: { variants: WATER_VARIANTS, from05: true },
  'water-sites': {
    waterRain: WATER_RAIN,
    variants: [
      { label: '既定・地形のみ', water: '0' },
      {
        label: '既定・水面あり（500 mm・半径 50 m を最速で降雨、水深を毎フレーム更新）',
        water: '1',
      },
    ],
  },
  // 51 fps の切り分け（spec 06 §5.1）。05 と同じ 1000 m・z16 ×10 p85 だけ（9 条件。既定の 3 回で 27 回）
  isolate: {
    sizes: ['1000'],
    views: ['z16 ×10 p85'],
    variants: [
      { label: '地形のみ（water=0）', water: '0' },
      // 1000 m の既定は後の Task で 2 になりうるので、1 も URL で明示する（URL が既定に勝つ）
      { label: '水面あり・depthEvery=1', water: '1', extra: { depthEvery: '1' } },
      { label: '水面あり・depthEvery=2', water: '1', extra: { depthEvery: '2' } },
      { label: '水面あり・depthEvery=4', water: '1', extra: { depthEvery: '4' } },
      { label: '水面あり・止めた水面（pause=1）', water: '1', extra: { pause: '1' } },
      { label: '水面あり・矢印なし（arrows=0）', water: '1', extra: { arrows: '0' } },
      // 受け取り側の CPU の切り分け（転送を減らし、矢印も止める）
      {
        label: '水面あり・depthEvery=4・矢印なし（arrows=0）',
        water: '1',
        extra: { depthEvery: '4', arrows: '0' },
      },
      // 矢印の本数と fps の関係（M2 の準備で追加）。1000 m の実効の間隔は設定の 2 倍、既定（10 m）は実効 20 m・2,500 本
      {
        label: '水面あり・矢印 5 m（1000 m で実効 10 m・10,000 本）',
        water: '1',
        extra: { arrowsM: '5' },
      },
      {
        label: '水面あり・矢印 20 m（実効 40 m・625 本）',
        water: '1',
        extra: { arrowsM: '20' },
      },
    ],
  },
}

const DEFAULT_SET = 'terrain-main'
const setName = process.env.RAINTRACE_FPS_SET ?? DEFAULT_SET
/** 同じ条件を測る回数。判定はセルごとの中央値で行う */
const repeat = Number(process.env.RAINTRACE_FPS_REPEAT ?? '3')
/** 1 回の計測を待つ上限 */
const RUN_TIMEOUT_MS = 240_000
const outDirFor = (fallback: '.handoff/05-fps' | '.handoff/06-perf'): URL =>
  outDirFromEnv(process.env.RAINTRACE_FPS_OUT_DIR, fallback)

const tileCell = (t: FpsResult['tileGen']['terrain']): string =>
  `${t.count}・${t.cached}・${t.meanMs.toFixed(1)}・${t.maxMs.toFixed(1)}`

/** 05 の表の注意（置き換える前の formatTable の文字列のまま。Task 6 は 1 文字も変えない） */
const NOTES: readonly string[] = [
  '',
  '注意 1（「実測 pitch」「実測 zoom」の読み方）: この 2 列は、計測の窓を閉じた後に 1 回だけ読んだ値である。',
  'runFpsProbe は rAF の loop を抜けて map.jumpTo({ center, bearing }) で中心と bearing を戻し、その後に',
  'perfHook が getZoom()・getPitch() を読む。10 秒の計測の間ずっとこの角度だった、という意味ではない。',
  '',
  '注意 2（垂直強調 ×10 では pitch 85° に届かない）: MapLibre の _elevateCameraIfInsideTerrain',
  '（maplibre-gl-dev.mjs の 22431〜22443 行）が、カメラが持ち上がった地形の中に入るときカメラをその地形の',
  '高さまで持ち上げ、calculateCameraOptionsFromTo で pitch とズームを作り直す（transform の更新ごとの修飾。',
  '同 22454 行あたり）。渋谷の 8.8〜33 m は ×10 で 88〜330 m になり、z16・p85 でのカメラの高さを超える。',
  'つまり要求どおりの 85° には届かず、実測は 78.6° 付近に落ち着く。要求どおりの 85° になるのは垂直強調 ×1 の',
  'とき、pitch 0 は常に要求どおりになる（いずれも実測で確認）。加えて（Task 6 で入れた直しにより）タイルが',
  '揃った後に同じ jumpTo をもう一度発行してから計測しているので、到達する視点は条件・ラン共通で同一になる',
  '（下の表の z16 ×10 p85 の 12 行はすべて 78.6037°・幅 0.0000）。Task 5 の 1 回目の jumpTo（タイルが読める',
  '前）では、同じ「z16 ×10 p85」を要求した 4 セルで実測が 78.60° と 82.96° に割れたが、それはこの直しの',
  '前の挙動であり、今のデータには当てはまらない。',
  '',
  '注意 3（render CPU の列）: onRenderTime を呼ぶのは水面の Custom Layer で、呼び出し元は Task 8 で入った',
  '（Task 9 の実測は条件ごとの中央値で 0.149〜0.416 ms。ランごとの値は 0.137〜0.463 ms）。水面を描いていない条件ではこの列は「未計測」であって、0 ms という意味ではない。',
  '',
  '注意 4（タイルの待ちが短い理由）: 視点を置く前に data-view3d-framed（3D の視点へ動き終えたこと）を',
  '待っているので、areTilesLoaded() は 0.12〜0.51 秒で真になる。実際に落ち着かせている時間は、その後の',
  '3 秒と合わせて約 3.1〜3.5 秒で、S の固定 3 秒とほぼ同じ。areTilesLoaded() だけを根拠にしない。',
  '',
  '推定（未検証。事実としては扱わない）: S も同じ渋谷の地形に対し、同じ MapLibre 6.6.0 で同じ',
  'map.jumpTo({ zoom, pitch }) を使っており、実測の pitch・zoom を記録していなかった。したがって S の',
  '「z16 ×10 p85」も、おそらく 85° 未満で測られている。そうであれば比較は実質的に同じ条件どうしで、',
  'S の側でそれが記録されていなかっただけ、ということになる。',
  '',
  '合否（平均 57 fps 以上・長いフレーム 1% 以下）は、要求した視点を MapLibre が落ち着かせた先に対して',
  '判定する。それが利用者が実際に到達できる、いちばん厳しい視点だからである。',
]

function formatTable(rows: readonly Row[]): string {
  const lines = [
    `描画: ${rows[0]?.result.renderer ?? '不明'}（実 GPU・headless。rAF は 60Hz に刻まれるので 60 fps が上限。RAINTRACE_UNCAPPED=1 のときは外した起動）`,
    `GPU のタイマー（EXT_disjoint_timer_query_webgl2）: ${rows[0]?.result.gpuTimerQuery === true ? '使える' : '使えない'}`,
    '',
    'タイルの列は「組み立てた数・使い回した数・組み立ての平均・最大（ms）」。',
    '',
    '| 地点 | 条件 | 範囲 | 視点 | 要求 pitch | 実測 pitch | 要求 zoom | 実測 zoom | 平均 fps | 中央値 (ms) | 長いフレーム | ヒストグラム g1/g2/g3/g4/g5+ | render CPU 平均 (ms) | 地形のタイル | hillshade のタイル | 描かれるタイル | タイルの待ち (s) | 準備 (ms) | 水面の作成 (ms) | 長いタスク（数・最大 ms） | 1 step 中央値 (ms) | pass |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|---|---|---:|---|---|---|---|---:|---|',
  ]
  for (const row of rows) {
    const { site, variant, run, size, view, requested, mapPitch, mapZoom, prepareMs } = row
    const { waterBuildMs, tiles, longTasks, stepTimes, result: r } = row
    const h = r.gapHistogram
    const wait = `${(tiles.waitMs / 1000).toFixed(1)}${tiles.loaded ? '' : '（揃わず）'}`
    lines.push(
      `| ${SITES[site].label} | ${variant} #${run} | ${size} m | ${view} | ${requested.pitch} | ${mapPitch.toFixed(1)} | ${requested.z} | ${mapZoom.toFixed(3)} | ${r.meanFps.toFixed(1)} | ${r.p50Ms.toFixed(1)} | ${r.longFrames}/${r.frames}（${(r.longFrameRatio * 100).toFixed(1)}%） | ${h.g1}/${h.g2}/${h.g3}/${h.g4}/${h.g5plus} | ${r.renderFrames === 0 || r.renderCpuMeanMs === null ? '未計測' : r.renderCpuMeanMs.toFixed(2)} | ${tileCell(r.tileGen.terrain)} | ${tileCell(r.tileGen.hillshade)} | ${r.drawnTileZoom} | ${wait} | ${prepareMs.map((ms) => ms.toFixed(0)).join('・')} | ${waterBuildMs.map((ms) => ms.toFixed(0)).join('・')} | ${longTasks.supported ? `${longTasks.count}・${longTasks.maxMs.toFixed(0)}` : '未対応'} | ${stepTimes.medianMs === null ? '—' : stepTimes.medianMs.toFixed(2)} | ${r.pass} |`,
    )
  }
  const warnings = comparabilityWarnings(rows)
  if (warnings.length > 0) {
    lines.push('', '**条件の比較に使えない組**（同じセルなのに実測の視点がそろっていない）:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  lines.push(...NOTES)
  return `${lines.join('\n')}\n`
}

/**
 * 同じセル（地点・範囲・視点）の中で、実測の視点がそろっていない組を探す。地形があると要求どおりの pitch に
 * ならず、しかもその角度は固定でない。実測の視点が違う行どうしを「条件の差」として読むと結論を取り違えるので、
 * 表の中で名指しする
 */
function comparabilityWarnings(rows: readonly Row[]): string[] {
  const cells = new Map<string, Row[]>()
  for (const row of rows) {
    const key = `${SITES[row.site].label}・${row.size} m・${row.view}`
    cells.set(key, [...(cells.get(key) ?? []), row])
  }
  const warnings: string[] = []
  for (const [key, runs] of cells) {
    const pitches = runs.map((r) => r.mapPitch)
    const drawn = [...new Set(runs.map((r) => r.result.drawnTileZoom))]
    if (Math.max(...pitches) - Math.min(...pitches) <= 0.5 && drawn.length <= 1) continue
    warnings.push(
      `${key}: 実測 pitch が ${pitches.map((p) => p.toFixed(2)).join(' / ')}、描かれるタイルが ${drawn.join(' / ')} とそろっていない。` +
        'この組は条件の比較には使えない。視点そのものが違う',
    )
  }
  return warnings
}

/** セル（地点・条件・範囲・視点）ごとの、ランの中央値と幅。判定はこの表で行う */
function formatSummary(rows: readonly Row[]): string {
  const cells = new Map<string, Row[]>()
  for (const row of rows) {
    const key = `${row.site}|${row.variant}|${row.size}|${row.view}`
    cells.set(key, [...(cells.get(key) ?? []), row])
  }
  const spread = (values: number[], digits: number): string =>
    `${median(values).toFixed(digits)}（${Math.min(...values).toFixed(digits)}〜${Math.max(...values).toFixed(digits)}）`
  const lines = [
    `セルごとの ${repeat} 回の中央値（括弧は最小〜最大）。組み立ての最大は地形と hillshade の大きい方。D15 = 平均 57 fps 以上かつ長いフレーム 1% 以下`,
    '',
    '| 地点 | 条件 | 範囲 | 視点 | 平均 fps | 長いフレーム | g2 | 長いタスクの最大 (ms) | 組み立ての最大 (ms) | 組み立てた数（地形・hillshade） |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const runs of cells.values()) {
    const first = runs[0]
    if (first === undefined) continue
    const results = runs.map((r) => r.result)
    const fps = results.map((r) => r.meanFps)
    const long = results.map((r) => r.longFrames)
    const g2 = results.map((r) => r.gapHistogram.g2)
    const tasks = runs.map((r) => r.longTasks.maxMs)
    const build = results.map((r) => Math.max(r.tileGen.terrain.maxMs, r.tileGen.hillshade.maxMs))
    const terrainCount = median(results.map((r) => r.tileGen.terrain.count))
    const hillshadeCount = median(results.map((r) => r.tileGen.hillshade.count))
    lines.push(
      `| ${SITES[first.site].label} | ${first.variant} | ${first.size} m | ${first.view} | ${spread(fps, 1)} | ${spread(long, 0)} | ${spread(g2, 0)} | ${spread(tasks, 0)} | ${spread(build, 1)} | ${terrainCount}・${hillshadeCount} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

test(`fps の測り直し（${setName}）`, async ({ browser }, testInfo) => {
  test.skip(
    process.env.RAINTRACE_LOAD === '1' || process.env.RAINTRACE_DRAWN_ZOOM === '1',
    '別のテストを回すとき',
  )
  assertPerfBuild()
  const sites = sitesFromEnv(process.env.RAINTRACE_FPS_SITES, ['shibuya'])
  const set = SETS[setName]
  if (set === undefined) throw new Error(`計測の組がありません: ${setName}`)
  const outDir = outDirFor(set.from05 === true ? '.handoff/05-fps' : '.handoff/06-perf')
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`RAINTRACE_FPS_REPEAT は 1 以上の整数: ${process.env.RAINTRACE_FPS_REPEAT}`)
  }
  const sizes = set.sizes ?? SIZES
  const views = VIEWS.filter((v) => set.views === undefined || set.views.includes(v.name))
  // 1 回の上限 × 回数（config の 90 分は、多い組の最悪に足りない）
  test.setTimeout(
    sites.length * set.variants.length * sizes.length * views.length * repeat * RUN_TIMEOUT_MS,
  )
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const rows: Row[] = []
  let turn = 0
  for (let run = 1; run <= repeat; run++) {
    for (const site of sites) {
      for (const size of sizes) {
        for (const view of views) {
          // 条件の順を 1 回ごと・ランごとに入れ替える（時間とともに変わる条件の偏りを減らす）
          const order = (turn++ + run) % 2 === 0 ? set.variants : [...set.variants].reverse()
          for (const variant of order) {
            const url = query({
              lat: SITES[site].lat,
              lon: SITES[site].lon,
              size,
              probe: 'fps',
              z: view.z,
              ex: view.ex,
              pitch: view.pitch,
              water: variant.water,
              ...(variant.water === '1' ? set.waterRain : {}),
              hillshade: variant.hillshade,
              fallback: '0',
              ...variant.extra,
            })
            const report = await withFreshPage(browser, baseURL, async (page) => {
              await page.goto(url)
              return readReport<Report>(page, 'data-fps-result', RUN_TIMEOUT_MS)
            })
            // 3D のまま（(c) で 2D に落ちていない。フックも data-perf-error にする）
            expect(report.view3d).toBe('3d')
            // 視点は厳密な一致ではなく「幅」で照合する（05 のコントローラーの裁定）。地形があると MapLibre は
            // カメラを地形の上に保つので、pitch は要求より下がる。この照合は「フックが pitch を無視した」ような
            // 取り違えを捕まえるためのもので、角度そのものの検証ではない
            const requestedPitch = Number(view.pitch)
            expect(report.mapPitch).toBeLessThanOrEqual(requestedPitch + 0.05)
            expect(report.mapPitch).toBeGreaterThanOrEqual(requestedPitch - 10.0)
            expect(Math.abs(report.mapZoom - Number(view.z))).toBeLessThanOrEqual(0.05)
            rows.push({
              site,
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
  }
  mkdirSync(outDir, { recursive: true })
  // JSON は全ラン（生のフレームの間隔 deltas を含む）を残す
  writeFileSync(new URL(`${setName}.json`, outDir), `${JSON.stringify(rows, null, 2)}\n`)
  const table = `${formatSummary(rows)}\n${formatTable(rows)}`
  writeFileSync(new URL(`${setName}.md`, outDir), table)
  console.log(table)
})

test('クリックから 2D の地形の表示まで・3D を押してから最初の 3D のフレームまで（spec 06 §3・§5）', async ({
  browser,
}, testInfo) => {
  test.skip(process.env.RAINTRACE_LOAD !== '1', 'RAINTRACE_LOAD=1 のときだけ回す')
  assertPerfBuild()
  if (!Number.isInteger(repeat) || repeat < 1)
    throw new Error('RAINTRACE_FPS_REPEAT は 1 以上の整数')
  const sites = loadSitesFromEnv(process.env.RAINTRACE_FPS_SITES, ['shibuya'])
  test.setTimeout(sites.length * SIZES.length * repeat * RUN_TIMEOUT_MS)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const rows: { site: LoadSiteName; size: Size; run: number; report: LoadReport }[] = []
  for (let run = 1; run <= repeat; run++) {
    for (const site of sites) {
      for (const size of SIZES) {
        // lat・lon を付けない（起動時に地点を選ばせない）。at= の地点をフックが選ぶ（計画で決めたこと 9）
        const url = query({
          size,
          probe: 'load',
          at: `${LOAD_SITES[site].lat},${LOAD_SITES[site].lon}`,
          mode: '3d',
          fallback: '0',
        })
        const report = await withFreshPage(browser, baseURL, async (page) => {
          await page.goto(url)
          return readReport<LoadReport>(page, 'data-load-result', RUN_TIMEOUT_MS)
        })
        expect(report.to3d).not.toBeNull()
        rows.push({ site, size, run, report })
      }
    }
  }
  const seconds = (ms: number | null | undefined): string =>
    ms === null || ms === undefined ? '—' : (ms / 1000).toFixed(2)
  const lines = [
    '地理院に実際に接続し、毎回新しい context（HTTP の cache が空）。「最初の 3D のフレーム」はタイルが揃って 2 フレーム描いた時刻',
    '',
    '| 地点 | 範囲 | # | 選んでから ready (s) | 2D の表示 (s) | 3D の状態 (s) | 水面 (s) | 最初の 3D のフレーム (s) | タイル | 長いタスク 読み込み（数・最大 ms） | 長いタスク 3D（数・最大 ms） | 準備 (ms) | 水面の作成 (ms) |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---|---|',
  ]
  for (const { site, size, run, report: r } of rows) {
    const t = r.to3d
    const load = r.longTasks.load
    const to3d = r.longTasks.to3d
    lines.push(
      `| ${LOAD_SITES[site].label} | ${size} m | ${run} | ${seconds(r.selectToReadyMs)} | ${seconds(r.selectTo2dMs)} | ${seconds(t?.statusMs)} | ${seconds(t?.waterBuiltMs)} | ${seconds(t?.firstFrameMs)} | ${t?.tilesLoaded === false ? '揃わず' : '揃った'} | ${load.count}・${load.maxMs.toFixed(0)} | ${to3d === null ? '—' : `${to3d.count}・${to3d.maxMs.toFixed(0)}`} | ${r.prepareMs.map((ms) => ms.toFixed(0)).join('・')} | ${r.waterBuildMs.map((ms) => ms.toFixed(0)).join('・')} |`,
    )
  }
  const outDir = outDirFor('.handoff/06-perf')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL('load.json', outDir), `${JSON.stringify(rows, null, 2)}\n`)
  writeFileSync(new URL('load.md', outDir), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
})

test('描かれる地形タイルのズームの実測と、pitch つきの見込み（05 の計画で決めたこと 3）', async ({
  browser,
}, testInfo) => {
  test.skip(process.env.RAINTRACE_DRAWN_ZOOM !== '1', 'RAINTRACE_DRAWN_ZOOM=1 のときだけ回す')
  assertPerfBuild()
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const lines = ['| 地図のズーム | pitch | 見込み | 実測 |', '|---:|---:|---:|---:|']
  for (const z of [15.5, 16, 16.5, 17]) {
    for (const pitch of [0, 60, 85]) {
      const url = query({
        lat: SITES.shibuya.lat,
        lon: SITES.shibuya.lon,
        size: '500',
        probe: 'view',
        z: String(z),
        pitch: String(pitch),
        water: '0',
        fallback: '0',
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
  const outDir = outDirFor('.handoff/05-fps')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL('drawn-zoom.md', outDir), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
})
