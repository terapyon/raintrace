/**
 * 境界 15 と 16 の可視率・ちらつき率（spec 06 §3・§6 の 6、R06-7、計画で決めたこと 15）。pnpm build:perf の後に
 *   pnpm perf:fps tests/perf/water.perf.ts
 * で回す（地理院に接続する）。渋谷・500 m・500 mm・半径 50 m（05 の撮影と同じ水）を 20 秒「最速」で回して止め、
 * pitch 45・60・85 × 倍率 1・2・5・10 ごとに、描かれるタイルが 15・16 になる見込みのズームとその 0.25・0.5 粗い
 * ズームを置いて測る。環境変数: RAINTRACE_WATER_OUT_DIR（.handoff/06-perf/water-probe）・RAINTRACE_WATER_PITCHES（45,60,85）・
 * RAINTRACE_WATER_EX（1,2,5,10）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { drawnTileZoom } from '../../src/dem/tileZoom'
import { mapZoomForCentreTileZoom } from '../../src/map/view3d/drawnZoom'
import type { WaterProbeReport, WaterProbeRow } from '../../src/ui/perfReports'
import {
  assertPerfBuild,
  listFromEnv,
  outDirFromEnv,
  query,
  readReport,
  SITES,
  withFreshPage,
} from './support'

const ALL_PITCHES = ['45', '60', '85'] as const
const ALL_EXAGGERATIONS = ['1', '2', '5', '10'] as const
/** 絞って試すとき: RAINTRACE_WATER_PITCHES=60 RAINTRACE_WATER_EX=1 */
const PITCHES = listFromEnv(process.env.RAINTRACE_WATER_PITCHES, ALL_PITCHES, ALL_PITCHES).map(
  Number,
)
const EXAGGERATIONS = listFromEnv(
  process.env.RAINTRACE_WATER_EX,
  ALL_EXAGGERATIONS,
  ALL_EXAGGERATIONS,
).map(Number)
const DRAWN = [15, 16] as const
/** 見込みは実測より粗い側にだけ外れる（05 の計画で決めたこと 3）ので、見込みのズームから粗い側へも置く */
const OFFSETS = [0, -0.25, -0.5] as const
const outDir = outDirFromEnv(process.env.RAINTRACE_WATER_OUT_DIR, '.handoff/06-perf/water-probe')
const PAGE_TIMEOUT_MS = 600_000
/**
 * 地図の maxZoom（MapController.ts）。perfParams の zs はこれを超える値を捨てる。pitch 85・描かれるタイル 16・
 * offset 0 は見込みが 18.184 になりこれを超えるので、その組では行が 1 つ少ない（実測で判明。計画の想定外）
 */
const MAX_MAP_ZOOM = 18

interface Cell {
  pitch: number
  ex: number
  drawn: number
  row: WaterProbeRow | null
  /** 評価できる行が無いとき、そのタイルの行の理由（判定できず） */
  reasons: string[]
}

const ratio = (value: number | null, digits: number): string =>
  value === null ? '—' : value.toFixed(digits)

test('境界 15 と 16 の可視率・ちらつき率（probe=water）', async ({ browser }, testInfo) => {
  assertPerfBuild()
  test.setTimeout(PITCHES.length * EXAGGERATIONS.length * PAGE_TIMEOUT_MS)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const reports: { pitch: number; ex: number; report: WaterProbeReport }[] = []
  const cells: Cell[] = []
  for (const pitch of PITCHES) {
    for (const ex of EXAGGERATIONS) {
      const requested = DRAWN.flatMap((d) =>
        OFFSETS.map((o) => ({
          drawn: d,
          zoom: mapZoomForCentreTileZoom(drawnTileZoom(d), pitch) + o,
        })),
      )
      // maxZoom を超える要求は perfParams が捨てるので、送る値には含めるが期待する行数からは外す
      const inRange = requested.filter((r) => r.zoom <= MAX_MAP_ZOOM)
      const outOfRange = requested.filter((r) => r.zoom > MAX_MAP_ZOOM)
      const url = query({
        lat: SITES.shibuya.lat,
        lon: SITES.shibuya.lon,
        size: '500',
        mm: '500',
        r: '50',
        probe: 'water',
        zs: requested.map((r) => r.zoom.toFixed(3)).join(','),
        ex: String(ex),
        pitch: String(pitch),
        wet: '20000',
        settle: '1000',
        fallback: '0',
        // 矢印は深度テストなしで水面の上に描かれ、判定用の色を覆う（Task 27 のレビュー I1。perfHook も止める）
        arrows: '0',
      })
      const report = await withFreshPage(browser, baseURL, async (page) => {
        await page.goto(url)
        return readReport<WaterProbeReport>(page, 'data-water-result', PAGE_TIMEOUT_MS)
      })
      expect(report.rows.length).toBe(inRange.length)
      reports.push({ pitch, ex, report })
      for (const d of DRAWN) {
        // 実測の描かれるタイルが d で、評価できる最初の行をそのセルの値にする
        const row =
          report.rows.find((r) => r.drawnTileZoom === String(d) && r.verdict !== 'not-evaluable') ??
          null
        const reasons = report.rows
          .filter((r) => r.drawnTileZoom === String(d))
          .map((r) => `z${r.requestedZoom}: ${r.reason}`)
        for (const r of outOfRange.filter((r) => r.drawn === d)) {
          reasons.push(
            `z${r.zoom.toFixed(3)}: 地図の maxZoom ${MAX_MAP_ZOOM} を超える（perfParams が捨てた）`,
          )
        }
        cells.push({ pitch, ex, drawn: d, row, reasons })
      }
    }
  }
  const verdictLabel = (row: WaterProbeRow): string =>
    row.verdict === 'pass' ? '○' : row.verdict === 'fail' ? '×' : '判定できず'
  const lines = [
    '渋谷・500 m・500 mm・半径 50 m を「最速」で 20 秒回して止めた水面（矢印・範囲の枠・流れの向き・最低点は隠す）。判定は持ち上げ比 0.98 以上かつちらつき 1% 以下（S と同じ閾値。持ち上げ比 = (見えた ∧ 0.10 m 持ち上げたときに見えた) / 持ち上げたときに見えた）。持ち上げ 2000 px・内側 300 px 未満、閾値との差が雑音（見えた ∧ ¬持ち上げ / 持ち上げ）未満、読みの間の食い違い（見えた ∧ ¬footprint・最初と最後の footprint の違い）が footprint の 0.5% 超、カメラの中心の標高の変化が 0.01 m 超なら「判定できず」',
    '',
    '| pitch | 倍率 | 描かれるタイル | 地図のズーム（実測 pitch） | footprint (px) | 可視率（見えた / footprint） | 持ち上げ比 | 雑音 | ちらつき | カメラと地面 (m) | 判定 |',
    '|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---|',
  ]
  for (const { pitch, ex, drawn, row, reasons } of cells) {
    if (row === null) {
      lines.push(
        `| ${pitch} | ${ex} | ${drawn} | — | — | — | — | — | — | — | 判定できず（${reasons.join('／') || '行が無い'}） |`,
      )
      continue
    }
    const m = row.measure
    lines.push(
      `| ${pitch} | ${ex} | ${drawn} | ${row.mapZoom.toFixed(3)}（${row.mapPitch.toFixed(1)}） | ${m.footprintPx} | ${ratio(m.visibleRatio, 4)} | ${ratio(m.unoccludedRatio, 4)} | ${ratio(m.noiseRatio, 4)} | ${m.flickerRatio === null ? '—' : `${(m.flickerRatio * 100).toFixed(3)}%`} | ${ratio(row.cameraClearanceM, 1)} | ${verdictLabel(row)}（${row.reason}） |`,
    )
  }
  lines.push(
    '',
    '全行（食い違いの数を含む。V = 見えた、L = 持ち上げで見えた、F = footprint、F2 = 最後の footprint）',
    '',
    '| pitch | 倍率 | 要求のズーム | 描かれるタイル | F | F2 | F xor F2 | V | L | V∧L | V∧¬F | V∧¬L | 内側 | 標高の変化 (m) | 判定 |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  )
  for (const { pitch, ex, report } of reports) {
    for (const row of report.rows) {
      const m = row.measure
      lines.push(
        `| ${pitch} | ${ex} | ${row.requestedZoom} | ${row.drawnTileZoom} | ${m.footprintPx} | ${m.footprintEndPx} | ${m.footprintDriftPx} | ${m.visiblePx} | ${m.liftedPx} | ${m.visibleAndLiftedPx} | ${m.visibleNotFootprintPx} | ${m.visibleNotLiftedPx} | ${m.interiorPx} | ${row.cameraDriftM.toFixed(3)} | ${verdictLabel(row)}（${row.reason}） |`,
      )
    }
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL('water.json', outDir), `${JSON.stringify(reports, null, 2)}\n`)
  writeFileSync(new URL('water.md', outDir), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
})
