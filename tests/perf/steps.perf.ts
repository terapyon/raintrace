/**
 * 1 step の所要時間と平衡までの時間（spec 06 §4.1・§4.2・§5、計画で決めたこと 3〜5）。pnpm build:perf の後に回す。
 *
 * 最初に 1 回だけ DEM を記録する（地理院に接続する）:
 *   RAINTRACE_DEM=record pnpm perf:fps tests/perf/steps.perf.ts -g 記録
 * 平衡（2D、既定。3 地点 × 500・1000 m × 3 つの雨、各 300 秒まで）:
 *   pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間
 * 3D ありの窓（60 秒）:
 *   RAINTRACE_STEPS_MODE=3d pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間
 *
 * 環境変数: RAINTRACE_STEPS_SITES（ayase,shibuya,minatomirai）・RAINTRACE_STEPS_SIZES（500,1000）・
 * RAINTRACE_STEPS_RAINS（r10,r100,full）・RAINTRACE_STEPS_MODE（2d|3d）・RAINTRACE_STEPS_UNTIL（settle|window。
 * 既定は 2d なら settle、3d なら window）・RAINTRACE_STEPS_CAP_MS（300000）・RAINTRACE_STEPS_WINDOW_MS（60000）・
 * RAINTRACE_STEPS_OUT_DIR（.handoff/06-perf）・RAINTRACE_DEM（replay|record|live）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { StepsReport } from '../../src/ui/perfReports'
import {
  type DemRouteCounts,
  demModeFromEnv,
  readManifest,
  routeDem,
  writeManifest,
} from './demFixtures'
import {
  assertPerfBuild,
  listFromEnv,
  outDirFromEnv,
  query,
  readReport,
  SITES,
  type SiteName,
  sitesFromEnv,
  withFreshPage,
} from './support'

const SIZES = ['500', '1000'] as const
type Size = (typeof SIZES)[number]
/** 降雨（計画で決めたこと 3）。full は半径を範囲の半分（R04-6 の上限）にして、外接矩形を範囲全体にする */
const RAINS = {
  r10: { label: '半径 10 m・100 mm', mm: '100', radius: (_size: Size): string => '10' },
  r100: { label: '半径 100 m・100 mm', mm: '100', radius: (_size: Size): string => '100' },
  full: {
    label: '全面を濡らす雨（半径 = 範囲の半分・100 mm）',
    mm: '100',
    radius: (size: Size): string => String(Number(size) / 2),
  },
} as const
type RainName = keyof typeof RAINS
const RAIN_NAMES = Object.keys(RAINS) as RainName[]
const ALL_SITES = Object.keys(SITES) as SiteName[]

const mode = process.env.RAINTRACE_STEPS_MODE === '3d' ? '3d' : '2d'
const untilEnv = process.env.RAINTRACE_STEPS_UNTIL
if (untilEnv !== undefined && untilEnv !== '' && untilEnv !== 'settle' && untilEnv !== 'window') {
  throw new Error(`RAINTRACE_STEPS_UNTIL は settle・window のどちらか: ${untilEnv}`)
}
const until: 'settle' | 'window' =
  untilEnv === 'settle' || untilEnv === 'window' ? untilEnv : mode === '2d' ? 'settle' : 'window'
const capMs = Number(process.env.RAINTRACE_STEPS_CAP_MS ?? '300000')
const windowMs = Number(process.env.RAINTRACE_STEPS_WINDOW_MS ?? '60000')
const outDir = outDirFromEnv(process.env.RAINTRACE_STEPS_OUT_DIR, '.handoff/06-perf')
/** 読み込み・3D の準備・止まっている間の再描画の数え・報告の書き出しの余裕 */
const OVERHEAD_MS = 180_000

interface Row {
  site: SiteName
  size: Size
  rain: RainName
  dem: DemRouteCounts
  report: StepsReport
}

const fixed = (value: number | null, digits: number): string =>
  value === null ? '—' : value.toFixed(digits)

function formatTable(rows: readonly Row[]): string {
  const lines = [
    `mode=${mode}・until=${until}（cap ${capMs / 1000} 秒・窓 ${windowMs / 1000} 秒）。1 step の値は 1 秒ごとの直近 300 step の要約の、中央値の中央値と p95 の 95 パーセンタイル（計画で決めたこと 2）`,
    '',
    '| 地点 | 範囲 | 雨 | 3D | 平衡 | step | 所要 (s) | 1x 換算 (分) | step／秒 | 1 step 中央値 (ms) | 1 step p95 (ms) | 1 step 最大 (ms) | 長いタスク（数・最大 ms） | 止まっている間の render（2 秒） | 質量誤差 (m³) | DEM（固定・素通し・欠け） |',
    '|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|',
  ]
  for (const { site, size, rain, dem, report: r } of rows) {
    lines.push(
      `| ${SITES[site].label} | ${size} m | ${RAINS[rain].label} | ${r.view3d} | ${r.settled ? '平衡' : '届かず'} | ${r.steps} | ${(r.elapsedMs / 1000).toFixed(1)} | ${r.minutesAt1x.toFixed(1)} | ${r.stepsPerSecond.toFixed(0)} | ${fixed(r.stepTimes.medianMs, 2)} | ${fixed(r.stepTimes.p95Ms, 2)} | ${fixed(r.stepTimes.maxMs, 2)} | ${r.longTasks.supported ? `${r.longTasks.count}・${r.longTasks.maxMs.toFixed(0)}` : '未対応'} | ${r.idleRenders} | ${fixed(r.final?.massError ?? null, 6)} | ${dem.fixture}・${dem.passthrough}・${dem.missing} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

test('1 step の所要時間と平衡までの時間（spec 06 §4.2）', async ({ browser }, testInfo) => {
  test.skip(process.env.RAINTRACE_DEM === 'record', 'DEM の記録のときは回さない')
  assertPerfBuild()
  const demMode = demModeFromEnv(process.env.RAINTRACE_DEM)
  const manifest = readManifest()
  if (demMode === 'replay' && Object.keys(manifest).length === 0) {
    throw new Error(
      'tests/perf/fixtures/dem-manifest.json がありません。RAINTRACE_DEM=record で先に記録する',
    )
  }
  const sites = sitesFromEnv(process.env.RAINTRACE_STEPS_SITES, ALL_SITES)
  const sizes = listFromEnv(process.env.RAINTRACE_STEPS_SIZES, SIZES, SIZES)
  const rains = listFromEnv(process.env.RAINTRACE_STEPS_RAINS, RAIN_NAMES, RAIN_NAMES)
  const perRunMs = (until === 'settle' ? capMs : windowMs) + OVERHEAD_MS
  test.setTimeout(sites.length * sizes.length * rains.length * perRunMs)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const rows: Row[] = []
  for (const site of sites) {
    for (const size of sizes) {
      for (const rain of rains) {
        const url = query({
          lat: SITES[site].lat,
          lon: SITES[site].lon,
          size,
          mm: RAINS[rain].mm,
          r: RAINS[rain].radius(size),
          probe: 'steps',
          mode,
          until,
          cap: String(capMs),
          ms: String(windowMs),
          fallback: '0',
        })
        const holder: { dem: DemRouteCounts | null } = { dem: null }
        const report = await withFreshPage(
          browser,
          baseURL,
          async (page) => {
            await page.goto(url)
            return readReport<StepsReport>(page, 'data-steps-result', perRunMs)
          },
          async (context) => {
            holder.dem = await routeDem(context, demMode, manifest)
          },
        )
        const dem = holder.dem ?? { fixture: 0, recorded: 0, passthrough: 0, missing: 0 }
        if (demMode === 'replay') {
          // 固定の DEM が欠けていれば、同じ DEM で回したことにならない
          expect(dem.missing).toBe(0)
          // 2D の読み込みはすべて固定のタイルで賄う（素通しは 3D の範囲の外のタイルだけ）
          if (mode === '2d') expect(dem.passthrough).toBe(0)
        }
        // 雨の半径が URL のとおり（範囲の半分の上限で丸められていない）
        expect(report.rain.radiusM).toBe(Number(RAINS[rain].radius(size)))
        rows.push({ site, size, rain, dem, report })
      }
    }
  }
  mkdirSync(outDir, { recursive: true })
  const name = `steps-${mode}-${until}`
  writeFileSync(new URL(`${name}.json`, outDir), `${JSON.stringify(rows, null, 2)}\n`)
  const table = formatTable(rows)
  writeFileSync(new URL(`${name}.md`, outDir), table)
  console.log(table)
})

test('DEM のフィクスチャを記録する（RAINTRACE_DEM=record。計画で決めたこと 5）', async ({
  browser,
}, testInfo) => {
  test.skip(process.env.RAINTRACE_DEM !== 'record', 'RAINTRACE_DEM=record のときだけ回す')
  const sites = sitesFromEnv(process.env.RAINTRACE_STEPS_SITES, ALL_SITES)
  test.setTimeout(sites.length * SIZES.length * 180_000)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const manifest = readManifest()
  for (const site of sites) {
    for (const size of SIZES) {
      await withFreshPage(
        browser,
        baseURL,
        async (page) => {
          await page.goto(query({ lat: SITES[site].lat, lon: SITES[site].lon, size }))
          await expect(page.locator('[data-range-shown="true"]')).toBeAttached({
            timeout: 120_000,
          })
        },
        async (context) => {
          await routeDem(context, 'record', manifest)
        },
      )
    }
  }
  writeManifest(manifest)
  const entries = Object.values(manifest)
  const bytes = entries.reduce((sum, e) => sum + (e.status === 200 ? e.bytes : 0), 0)
  console.log(
    `manifest: ${entries.length} 件（200: ${entries.filter((e) => e.status === 200).length}、404: ${entries.filter((e) => e.status === 404).length}）、本体 ${(bytes / 1e6).toFixed(2)} MB`,
  )
})
