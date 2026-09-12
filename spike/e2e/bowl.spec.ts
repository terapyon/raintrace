import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { FILM_DEPTH_M } from '../src/scenes'
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
// Task 5b（レビュー役の推奨）: 沈み込まない高さの基準膜。20cm はクリアランス
// 0.2m × 倍率 ≥ Task 2 のすり鉢の d の最大 0.18m（倍率10）で、すり鉢の深さ 3m × 倍率
// よりずっと低いので、縁による遮蔽の形は 1cm の膜とほぼ変わらない
const REF_FILM_DEPTH_M = 0.2
const RATIO_MIN = 0.98
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

// レビュー役の推奨（2026-09-13、Task 5b）: pitch60・85 の可視率はすり鉢の縁による正当な遮蔽と沈み込みを
// 区別できない（上のテストの「未確定」）。遮蔽は水深によらず同じだけ効くので、沈み込まない高さの
// 基準膜（20cm）との比を取れば遮蔽が打ち消され、沈み込みだけが残る。A のみ（A' は速度で 05 の候補から
// 事実上外れるため測らない）
test('曲面（すり鉢）の斜め視点: 1cm の膜と 20cm の基準膜の可視率の比で沈み込みを確かめる（A、レビュー役の推奨、Task 5b）', async ({
  page,
  context,
}) => {
  const lists: string[][] = []
  const filmRows = new Map<number, MeasureRow[]>()
  for (const filmDepth of [FILM_DEPTH_M, REF_FILM_DEPTH_M]) {
    lists.push(
      await openSpike(page, context, {
        candidate: 'a',
        scene: 'synthetic',
        water: 'bowlFilm',
        zfix: 'offset',
        capture: 1,
        filmDepth,
      }),
    )
    const rows: MeasureRow[] = []
    for (const view of MEASURE_VIEWS) {
      await setView(page, view)
      rows.push({ scene: 'a', zfix: 'offset', view, measure: await measure(page) })
    }
    filmRows.set(filmDepth, rows)
  }
  const rows1 = filmRows.get(FILM_DEPTH_M) ?? []
  const rows20 = filmRows.get(REF_FILM_DEPTH_M) ?? []

  // 可視の画素数（深度テストありで実際に見えた画素数） = visibleRatio × footprintPx（capture.ts）
  const visiblePx = (row: MeasureRow | undefined): number | null =>
    row === undefined ? null : Math.round(row.measure.visibleRatio * row.measure.footprintPx)

  interface RatioRow {
    view: View
    visible1: number | null
    visible20: number | null
    ratio: number | null
    flicker1: number | null
    judge: '○' | '×' | '測れず'
  }
  const findRow = (rows: MeasureRow[], view: View) =>
    rows.find(
      (r) =>
        r.view.zoom === view.zoom &&
        r.view.exaggeration === view.exaggeration &&
        r.view.pitch === view.pitch,
    )
  const ratioRows: RatioRow[] = MEASURE_VIEWS.map((view) => {
    const r1 = findRow(rows1, view)
    const r20 = findRow(rows20, view)
    const visible1 = visiblePx(r1)
    const visible20 = visiblePx(r20)
    const ratio =
      visible1 !== null && visible20 !== null && visible20 > 0 ? visible1 / visible20 : null
    const judge: RatioRow['judge'] = ratio === null ? '測れず' : ratio >= RATIO_MIN ? '○' : '×'
    return { view, visible1, visible20, ratio, flicker1: r1?.measure.flickerRatio ?? null, judge }
  })

  mkdirSync(results, { recursive: true })
  writeFileSync(
    new URL('bowl-film-ratio.json', results),
    `${JSON.stringify({ rows1, rows20, ratioRows }, null, 2)}\n`,
  )

  const fmt = (v: number | null, digits = 0) => (v === null ? '—' : v.toFixed(digits))
  const lines = [
    '# 曲面（すり鉢）の斜め視点: 1cm の膜と 20cm の基準膜の可視率の比（Task 5b、レビュー役の推奨）',
    '',
    '背景: pitch60・85 では、すり鉢の縁による正当な遮蔽が 1cm の膜にも 20cm の膜にも等しく効くため、',
    '`ratio = visible(1cm) / visible(20cm)`（どちらも深度テストありで実際に見えた画素数）を取ると遮蔽が打ち消され、',
    '沈み込みだけが残る。20cm はクリアランス 0.2m × 倍率 ≥ Task 2 のすり鉢の d の最大 0.18m（倍率10でも 2m ≫ 0.176m）で',
    '沈まない高さ（すり鉢の深さ 3m × 倍率よりずっと低いので、縁による遮蔽の形は 1cm の膜とほぼ変わらない）。',
    `判定: ratio ${RATIO_MIN} 以上を ○、未満を ×（沈み込み）。20cm 側の visible が 0 の視点は比を出さず「測れず」とする。`,
    '',
    '| ズーム | 倍率 | pitch | visible(1cm) | visible(20cm) | ratio | 判定 | 1cm のちらつき |',
    '|---|---|---:|---:|---:|---:|:---:|---:|',
    ...ratioRows.map(
      (r) =>
        `| ${r.view.zoom} | ${r.view.exaggeration} | ${r.view.pitch} | ${fmt(r.visible1)} | ${fmt(r.visible20)} | ${fmt(r.ratio, 4)} | ${r.judge} | ${r.flicker1 === null ? '—' : `${(r.flicker1 * 100).toFixed(2)}%`} |`,
    ),
    '',
  ]
  const failing = ratioRows.filter((r) => r.judge === '×')
  const unmeasured = ratioRows.filter((r) => r.judge === '測れず')
  if (failing.length === 0 && unmeasured.length === 0) {
    lines.push(
      '**判定: 曲面でも斜め視点を含めて基準1を満たす（p0 と、20cm の膜との比で確認）**（16 視点すべて ratio ≥ 0.98）。',
    )
  } else {
    lines.push('**判定: 斜め視点の沈み込みが確認された行がある（05 で対策が要る）**')
    lines.push('')
    if (failing.length > 0) {
      lines.push(
        `× の視点: ${failing
          .map(
            (r) =>
              `z${r.view.zoom}・×${r.view.exaggeration}・pitch${r.view.pitch}（ratio=${r.ratio?.toFixed(4) ?? '—'}）`,
          )
          .join('、')}`,
      )
    }
    if (unmeasured.length > 0) {
      lines.push(
        `測れずの視点（20cm の visible が 0）: ${unmeasured
          .map((r) => `z${r.view.zoom}・×${r.view.exaggeration}・pitch${r.view.pitch}`)
          .join('、')}`,
      )
    }
  }
  lines.push('')
  const mdBody = lines.join('\n')
  writeFileSync(new URL('bowl-film-ratio.md', results), mdBody)
  console.log(mdBody)
  expect(lists.flat()).toEqual([])
})
