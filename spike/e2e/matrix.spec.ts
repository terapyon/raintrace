import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import type { View, WaterMeasure, ZFix } from '../src/types'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { allViews, openSpike, setView } from './support/views'

// Task 5〜7 で候補を足す
const MATRIX_CANDIDATES = ['a'] as const

// 判定の閾値（計画 D9）
const MIN_VISIBLE = 0.98
const MAX_FLICKER = 0.01
// 数値の計測の視点（16 通り）: ズーム 15〜18 × 倍率 1・10 × pitch 60・85。スクリーンショットは 64 通りのまま（R1）
const MEASURE_VIEWS: View[] = allViews().filter(
  (v) => (v.exaggeration === 1 || v.exaggeration === 10) && (v.pitch === 60 || v.pitch === 85),
)

const results = new URL('../results/', import.meta.url)
const shotsDir = new URL('../out/shots/', import.meta.url)

interface MeasureRow {
  scene: string
  zfix: ZFix
  view: View
  measure: WaterMeasure
}

const label = (v: View): string => `z${v.zoom} ×${v.exaggeration} p${v.pitch}`

async function measure(page: Page): Promise<WaterMeasure> {
  return page.evaluate(async () => {
    if (window.spike === undefined) throw new Error('window.spike がありません')
    return window.spike.measure()
  })
}

/** 視点ごとの最小の可視率と最大のちらつきの表(ズーム × 垂直強調、pitch の 4 通りをまとめる) */
function summarize(rows: MeasureRow[], scene: string, zfix: ZFix): string {
  const lines = [
    `### ${scene} / zfix=${zfix}`,
    '',
    '| ズーム | 強調 | 可視率の最小 | ちらつきの最大 | 判定 |',
    '|---|---|---:|---:|:---:|',
  ]
  for (const zoom of [15, 16, 17, 18]) {
    for (const exaggeration of [1, 2, 5, 10]) {
      const group = rows.filter(
        (r) =>
          r.scene === scene &&
          r.zfix === zfix &&
          r.view.zoom === zoom &&
          r.view.exaggeration === exaggeration,
      )
      if (group.length === 0) continue
      const visible = Math.min(...group.map((r) => r.measure.visibleRatio))
      const flicker = Math.max(...group.map((r) => r.measure.flickerRatio))
      const ok = visible >= MIN_VISIBLE && flicker <= MAX_FLICKER
      lines.push(
        `| ${zoom} | ${exaggeration} | ${visible.toFixed(4)} | ${(flicker * 100).toFixed(2)}% | ${ok ? '○' : '×'} |`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}

for (const candidate of MATRIX_CANDIDATES) {
  test(`matrix: ${candidate}`, async ({ page, context }) => {
    mkdirSync(shotsDir, { recursive: true })
    mkdirSync(new URL('sheets/', results), { recursive: true })
    // openSpike の配列は後のエラーも受け取り続けるので、参照を持って最後に確かめる（P20）
    const lists: string[][] = []
    const rows: MeasureRow[] = []

    // 1. スクリーンショット（固定の水、対策あり）。場面ごとに 1 枚のコンタクトシート
    for (const scene of ['synthetic', 'real'] as const) {
      lists.push(await openSpike(page, context, { candidate, scene, water: 'fixed' }))
      const shots: Shot[] = []
      for (const view of allViews()) {
        await setView(page, view)
        const png = await page.screenshot()
        writeFileSync(
          new URL(`${candidate}-${scene}-${label(view).replaceAll(' ', '_')}.png`, shotsDir),
          png,
        )
        shots.push({ label: label(view), png })
      }
      await writeContactSheet(
        context,
        shots,
        4,
        `${candidate} / ${scene}（行: ズーム × 垂直強調、列: pitch 0・45・60・85）`,
        fileURLToPath(new URL(`sheets/${candidate}-${scene}.jpg`, results)),
      )
    }

    // 2. 判定 (2): 合成の斜面の 1cm の膜だけを、対策なし・ありで測る。実データは対策ありの参考値（16 視点。R1）
    const plans = [
      { scene: 'synthetic', water: 'film', zfix: 'none' },
      { scene: 'synthetic', water: 'film', zfix: 'offset' },
      { scene: 'synthetic', water: 'film', zfix: 'offset2' },
      { scene: 'real', water: 'fixed', zfix: 'offset' },
    ] as const
    for (const plan of plans) {
      lists.push(
        await openSpike(page, context, {
          candidate,
          scene: plan.scene,
          water: plan.water,
          zfix: plan.zfix,
          capture: 1,
        }),
      )
      for (const view of MEASURE_VIEWS) {
        await setView(page, view)
        rows.push({ scene: plan.scene, zfix: plan.zfix, view, measure: await measure(page) })
      }
    }
    writeFileSync(new URL(`water-${candidate}.json`, results), `${JSON.stringify(rows, null, 2)}\n`)
    const summary = plans.map((p) => summarize(rows, p.scene, p.zfix)).join('\n')
    writeFileSync(
      new URL(`water-${candidate}.md`, results),
      `# ${candidate} の水面の見え方\n\n${summary}`,
    )
    console.log(summary)
    expect(lists.flat()).toEqual([])
  })
}
