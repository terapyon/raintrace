import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ApiProbeResult, View } from '../src/types'
import {
  MAX_FLICKER,
  MEASURE_VIEWS,
  type MeasureRow,
  MIN_VISIBLE,
  measure,
  summarize,
} from './support/measure'
import { openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)
const BOWL_CANDIDATES = ['a', 'a2'] as const

/** Task 2 の api-probe.json から、すり鉢の中心の d（地形 − シミュレーションの標高 × 倍率、倍率込みの m。pitch 60） */
function bowlD(zoom: number, exaggeration: number): number | null {
  const rows = JSON.parse(readFileSync(new URL('api-probe.json', results), 'utf8')) as {
    view: View
    probe: ApiProbeResult
  }[]
  const row = rows.find(
    (r) => r.view.zoom === zoom && r.view.exaggeration === exaggeration && r.view.pitch === 60,
  )
  const bowl = row?.probe.points.find((point) => point.label === 'bowl')
  if (bowl === undefined || bowl.terrainElevation === null) return null
  return bowl.terrainElevation - bowl.simElevation * exaggeration
}

test("曲面（すり鉢）の 1cm の膜: A と A'（zfix=offset、16 視点。M1）", async ({
  page,
  context,
}) => {
  const lists: string[][] = [] // P20
  const rows: MeasureRow[] = []
  for (const candidate of BOWL_CANDIDATES) {
    lists.push(
      await openSpike(page, context, {
        candidate,
        scene: 'synthetic',
        water: 'bowlFilm',
        zfix: 'offset',
        capture: 1,
      }),
    )
    for (const view of MEASURE_VIEWS) {
      await setView(page, view)
      rows.push({ scene: candidate, zfix: 'offset', view, measure: await measure(page) })
    }
  }
  mkdirSync(results, { recursive: true })
  writeFileSync(new URL('bowl-film.json', results), `${JSON.stringify(rows, null, 2)}\n`)
  const judge = (candidate: string, zoom: number, exaggeration: number): string => {
    const group = rows.filter(
      (r) => r.scene === candidate && r.view.zoom === zoom && r.view.exaggeration === exaggeration,
    )
    const visible = Math.min(...group.map((r) => r.measure.visibleRatio))
    const flicker = Math.max(...group.map((r) => r.measure.flickerRatio))
    return visible >= MIN_VISIBLE && flicker <= MAX_FLICKER ? '○' : '×'
  }
  const lines = [
    "| ズーム | 強調 | A | A' | すり鉢の d (m) | 0.01 × 倍率 (m) | d が膜を超える |",
    '|---|---|:---:|:---:|---:|---:|:---:|',
  ]
  for (const zoom of [15, 16, 17, 18]) {
    for (const exaggeration of [1, 10]) {
      const d = bowlD(zoom, exaggeration)
      const over = d !== null && d > 0.01 * exaggeration
      lines.push(
        `| ${zoom} | ${exaggeration} | ${judge('a', zoom, exaggeration)} | ${judge('a2', zoom, exaggeration)} | ${d === null ? '—' : d.toFixed(4)} | ${(0.01 * exaggeration).toFixed(2)} | ${over ? '○' : ''} |`,
      )
    }
  }
  const body = [
    summarize(rows, 'a', 'offset'),
    summarize(rows, 'a2', 'offset'),
    '### 比較（Task 2 のすり鉢の d と）',
    '',
    ...lines,
    '',
  ].join('\n')
  writeFileSync(
    new URL('bowl-film.md', results),
    `# 曲面（すり鉢）の 1cm の膜の見え方（M1）\n\n${body}`,
  )
  console.log(body)
  expect(lists.flat()).toEqual([])
})
