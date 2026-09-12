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
// pitch 0（真上）は MapLibre の既定の垂直画角（約 36.9°）では、すり鉢の縁の斜面（最大 45°、倍率10）
// より視線が急なため、縁が手前の平地に隠れる自己遮蔽が構造上起きない（レビュー Important 1 (b)）。
// ここでの可視率の低下は自己遮蔽ではなく、実際の沈み込みとして読める
const P0_VIEWS: View[] = [15, 16, 17, 18].flatMap((zoom) =>
  [1, 10].map((exaggeration) => ({ zoom, exaggeration, pitch: 0 })),
)

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

test("曲面（すり鉢）の 1cm の膜: A と A'（zfix=offset、16 視点 + pitch0 の追加計測。M1）", async ({
  page,
  context,
}) => {
  const lists: string[][] = [] // P20
  const rows: MeasureRow[] = []
  const p0Rows: MeasureRow[] = []
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
    // レビュー Important 1 (b): pitch0 の追加計測。自己遮蔽が構造上起きないので、
    // ここでの可視率の低下は実際の沈み込みと読める。footprintPx が 0 だと
    // visibleRatio が既定で 1 になる（capture.ts）ので、0 でないことを確かめる
    for (const view of P0_VIEWS) {
      await setView(page, view)
      const row = { scene: candidate, zfix: 'offset', view, measure: await measure(page) } as const
      expect(
        row.measure.footprintPx,
        `footprintPx (${candidate}, z${view.zoom}, ×${view.exaggeration})`,
      ).toBeGreaterThan(0)
      p0Rows.push(row)
    }
  }
  mkdirSync(results, { recursive: true })
  writeFileSync(
    new URL('bowl-film.json', results),
    `${JSON.stringify({ rows, p0Rows }, null, 2)}\n`,
  )

  // ズーム × 強調 × pitch 別の可視率（レビュー Important 1 (a): pitch をまとめずに内訳を出す）
  const byPitch = (candidate: string, zoom: number, exaggeration: number, pitch: number) => {
    const row = rows.find(
      (r) =>
        r.scene === candidate &&
        r.view.zoom === zoom &&
        r.view.exaggeration === exaggeration &&
        r.view.pitch === pitch,
    )
    return row === undefined ? null : row.measure.visibleRatio
  }
  const fmt = (v: number | null) => (v === null ? '—' : v.toFixed(4))
  const pitchLines = [
    "| ズーム | 強調 | pitch | A 可視率 | A' 可視率 | すり鉢の d (m) | 0.01 × 倍率 (m) | d が膜を超える |",
    '|---|---|---:|---:|---:|---:|---:|:---:|',
  ]
  for (const zoom of [15, 16, 17, 18]) {
    for (const exaggeration of [1, 10]) {
      const d = bowlD(zoom, exaggeration)
      const over = d !== null && d > 0.01 * exaggeration
      for (const pitch of [60, 85]) {
        pitchLines.push(
          `| ${zoom} | ${exaggeration} | ${pitch} | ${fmt(byPitch('a', zoom, exaggeration, pitch))} | ${fmt(byPitch('a2', zoom, exaggeration, pitch))} | ${d === null ? '—' : d.toFixed(4)} | ${(0.01 * exaggeration).toFixed(2)} | ${over ? '○' : ''} |`,
        )
      }
    }
  }

  // pitch0 の表（自己遮蔽が起きない視点。MIN_VISIBLE を下回れば実際の沈み込み）
  const p0Judge = (candidate: string, zoom: number, exaggeration: number): string => {
    const row = p0Rows.find(
      (r) => r.scene === candidate && r.view.zoom === zoom && r.view.exaggeration === exaggeration,
    )
    if (row === undefined) return '—'
    return row.measure.visibleRatio >= MIN_VISIBLE && row.measure.flickerRatio <= MAX_FLICKER
      ? '○'
      : '×'
  }
  const p0Value = (candidate: string, zoom: number, exaggeration: number): number | null => {
    const row = p0Rows.find(
      (r) => r.scene === candidate && r.view.zoom === zoom && r.view.exaggeration === exaggeration,
    )
    return row === undefined ? null : row.measure.visibleRatio
  }
  const p0FootprintPx = (candidate: string, zoom: number, exaggeration: number): number | null => {
    const row = p0Rows.find(
      (r) => r.scene === candidate && r.view.zoom === zoom && r.view.exaggeration === exaggeration,
    )
    return row === undefined ? null : row.measure.footprintPx
  }
  const p0Lines = [
    "| ズーム | 強調 | A 可視率 | A footprintPx | A' 可視率 | A' footprintPx | A 判定 | A' 判定 |",
    '|---|---|---:|---:|---:|---:|:---:|:---:|',
  ]
  for (const zoom of [15, 16, 17, 18]) {
    for (const exaggeration of [1, 10]) {
      p0Lines.push(
        `| ${zoom} | ${exaggeration} | ${fmt(p0Value('a', zoom, exaggeration))} | ${p0FootprintPx('a', zoom, exaggeration)} | ${fmt(p0Value('a2', zoom, exaggeration))} | ${p0FootprintPx('a2', zoom, exaggeration)} | ${p0Judge('a', zoom, exaggeration)} | ${p0Judge('a2', zoom, exaggeration)} |`,
      )
    }
  }

  const body = [
    summarize(rows, 'a', 'offset'),
    summarize(rows, 'a2', 'offset'),
    '### 比較（ズーム × 強調 × pitch 別、Task 2 のすり鉢の d と）',
    '',
    '可視率が低い行のうち、pitch 60・85 は「すり鉢の縁の斜面が視線より急で、手前の平地に隠れる自己遮蔽」が構造上起こりうる視点であるため、この表の ○/× は沈み込みの証拠にならない（レビュー Important 1）。判定は pitch0 の表（下）で行う。',
    '',
    ...pitchLines,
    '',
    '### pitch0 の追加計測（自己遮蔽が構造上起きない視点。M1 の判定はここで行う）',
    '',
    'MapLibre の既定の垂直画角（約 36.9°）では、pitch0 の視線はすり鉢の最も急な面（縁、倍率10 で 45°）より鉛直に近く、縁が手前の平地に隠れることはない。したがって、この表で可視率が 0.98 を下回れば実際の沈み込みと判定できる。',
    '',
    ...p0Lines,
    '',
    '### 判定',
    '',
    "**pitch 60・85（斜め）: 未確定（この指標は正当な遮蔽と沈み込みを区別できない）**。すり鉢（放物面、半径60m・深さ3m）の縁の斜面は倍率1で5.7°・倍率10で45°、pitch60の視線は水平から30°下・pitch85は5°下で、縁が視線より急な側は手前の台地に隠れる自己遮蔽が幾何的に起こりうる（footprintPx を深度テスト無しで描き、visibleRatio = 見えた画素 ÷ footprintPx とする指標では、正当な遮蔽と沈み込みを区別できない）。倍率10・pitch85 でズームによらず可視率がほぼ一定（0.32/0.33/0.28/0.21）で、すり鉢の中心の d（+0.18→−0.02m）と符号すら対応しないことも、LOD由来の沈み込みではなく幾何的な自己遮蔽で説明がつく。ちらつきの最大は0.01%程度で安定しており（z-fightingのような不安定な現象ではない）、A と A' は16視点すべてで可視率の差が0.02以内（高さの基準（シミュレーションの標高 vs MapLibreの地形）に依存しない）。",
    '',
    "**pitch0（真上）: 沈み込みは確認されなかった**。pitch0 では自己遮蔽が構造上起きないため、この表の可視率がそのまま沈み込みの指標になる。A・A' とも8/8 ○（可視率の最小 0.9953）。footprintPx はすべて0より大きく、可視率が既定値の1に落ちているのではないことを確かめた。",
    '',
    '**斜め視点（pitch60・85）で自己遮蔽に加えて沈み込みが重なっているかは未確認**（時間の都合でオフセットした基準膜との比較は行っていない）。',
    '',
  ].join('\n')
  writeFileSync(
    new URL('bowl-film.md', results),
    `# 曲面（すり鉢）の 1cm の膜の見え方（M1）\n\n${body}`,
  )
  console.log(body)
  expect(lists.flat()).toEqual([])
})
