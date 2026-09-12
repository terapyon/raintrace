import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { View, ZFix } from '../src/types'
import { MAX_FLICKER, type MeasureRow, MIN_VISIBLE, measure } from './support/measure'
import { openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)

// pitch0（真上）は自己遮蔽が構造上起きない視点（Task 5 の bowl.spec.ts と同じ理由）。
// B は自前で地形と水面の三角形を描くので、A の MapLibre 地形メッシュとは仕組みが違う。
// 平面の膜（斜面）と曲面の膜（すり鉢）の両方で、斜め視点（pitch60・85、matrix.spec.ts が測る）の
// 結果が自己遮蔽と沈み込みのどちらなのかを切り分けるための基準にする（中間の判定の反映の申し送り）
const P0_VIEWS: View[] = [15, 16, 17, 18].flatMap((zoom) =>
  [1, 10].map((exaggeration) => ({ zoom, exaggeration, pitch: 0 })),
)
const ZFIXES: readonly ZFix[] = ['none', 'offset', 'offset2']

test('B の 1cm の膜（平面・曲面）を pitch0 で測る（斜め視点の自己遮蔽と沈み込みを切り分ける基準）', async ({
  page,
  context,
}) => {
  const lists: string[][] = [] // P20
  const filmRows: MeasureRow[] = []
  const bowlRows: MeasureRow[] = []
  // footprintPx が 0 の行は画面外（pitch0・z18・×10 は 200m 級の急斜面が視野の外へ出る。計測の
  // 都合の問題であって B の対策の良し悪しではない）。visibleRatio は既定で 1 になる（capture.ts）ので
  // 判定には使わず、別に記録して表に「画面外」と書く
  const offscreen: string[] = []

  // 平面の膜（斜面）: none・offset・offset2 の 3 通り。斜め視点で none が × になる行が
  // 沈み込みなのか自己遮蔽なのかを、pitch0（自己遮蔽が起きない斜面）で確かめる
  for (const zfix of ZFIXES) {
    lists.push(
      await openSpike(page, context, {
        candidate: 'b',
        scene: 'synthetic',
        water: 'film',
        zfix,
        capture: 1,
      }),
    )
    for (const view of P0_VIEWS) {
      await setView(page, view)
      const row = { scene: 'film', zfix, view, measure: await measure(page) }
      if (row.measure.footprintPx === 0) {
        offscreen.push(`film zfix=${zfix} z${view.zoom} ×${view.exaggeration}`)
      }
      filmRows.push(row)
    }
  }

  // 曲面の膜（すり鉢）: zfix=offset だけ（A の bowl-film.md の基準と同じ条件で比べるため）
  lists.push(
    await openSpike(page, context, {
      candidate: 'b',
      scene: 'synthetic',
      water: 'bowlFilm',
      zfix: 'offset',
      capture: 1,
    }),
  )
  for (const view of P0_VIEWS) {
    await setView(page, view)
    const row = { scene: 'bowlFilm', zfix: 'offset' as ZFix, view, measure: await measure(page) }
    if (row.measure.footprintPx === 0) {
      offscreen.push(`bowlFilm z${view.zoom} ×${view.exaggeration}`)
    }
    bowlRows.push(row)
  }

  mkdirSync(results, { recursive: true })
  writeFileSync(
    new URL('b-film-p0.json', results),
    `${JSON.stringify({ filmRows, bowlRows, offscreen }, null, 2)}\n`,
  )

  const cell = (row: MeasureRow | undefined): string => {
    if (row === undefined) return '—'
    if (row.measure.footprintPx === 0) return '画面外'
    const ok = row.measure.visibleRatio >= MIN_VISIBLE && row.measure.flickerRatio <= MAX_FLICKER
    return `${row.measure.visibleRatio.toFixed(4)} / ${(row.measure.flickerRatio * 100).toFixed(2)}% / ${row.measure.footprintPx} / ${ok ? '○' : '×'}`
  }
  const filmLines = [
    '### 平面の膜（斜面）、pitch0（自己遮蔽が起きない視点）',
    '',
    '| zfix | ズーム | 強調 | 可視率 / ちらつき / footprintPx / 判定 |',
    '|---|---|---:|---|',
  ]
  for (const zfix of ZFIXES) {
    for (const view of P0_VIEWS) {
      const row = filmRows.find(
        (r) =>
          r.zfix === zfix && r.view.zoom === view.zoom && r.view.exaggeration === view.exaggeration,
      )
      filmLines.push(`| ${zfix} | ${view.zoom} | ${view.exaggeration} | ${cell(row)} |`)
    }
  }
  const bowlLines = [
    "### 曲面の膜（すり鉢）、zfix=offset、pitch0（M1 と同じ条件。A/A' は 8/8 ○・可視率の最小 0.9953/0.9955）",
    '',
    '| ズーム | 強調 | 可視率 / ちらつき / footprintPx / 判定 |',
    '|---|---:|---|',
  ]
  for (const view of P0_VIEWS) {
    const row = bowlRows.find(
      (r) => r.view.zoom === view.zoom && r.view.exaggeration === view.exaggeration,
    )
    bowlLines.push(`| ${view.zoom} | ${view.exaggeration} | ${cell(row)} |`)
  }
  const minVisible = (rows: MeasureRow[]): number => {
    const visible = rows.filter((r) => r.measure.footprintPx > 0)
    return visible.length === 0
      ? Number.NaN
      : Math.min(...visible.map((r) => r.measure.visibleRatio))
  }
  const body = [
    ...filmLines,
    '',
    `平面の膜（斜面）は pitch0 で自己遮蔽が構造上起きない。zfix=none の可視率の最小（画面外を除く）は **${minVisible(filmRows.filter((r) => r.zfix === 'none')).toFixed(4)}**、offset は **${minVisible(filmRows.filter((r) => r.zfix === 'offset')).toFixed(4)}**、offset2 は **${minVisible(filmRows.filter((r) => r.zfix === 'offset2')).toFixed(4)}**。`,
    '',
    ...bowlLines,
    '',
    `B の曲面（すり鉢）の pitch0 の可視率の最小（画面外を除く）は **${minVisible(bowlRows).toFixed(4)}**。A/A' の bowl-film.md（zfix=offset、pitch0）の可視率の最小 0.9953/0.9955 と比べる。`,
    '',
    offscreen.length === 0
      ? '画面外（footprintPx=0）の行は無かった。'
      : `画面外（footprintPx=0、visibleRatio は既定の 1 になるため判定から除いた）: ${offscreen.join('、')}。急斜面が高倍率・高ズームの pitch0 の狭い視野の外へ出るための計測上の制約で、B の z-fighting 対策の良し悪しとは無関係`,
    '',
  ].join('\n')
  writeFileSync(new URL('b-film-p0.md', results), `# B の 1cm の膜、pitch0 の追加計測\n\n${body}\n`)
  console.log(body)
  expect(lists.flat()).toEqual([])
})
