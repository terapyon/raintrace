import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import type { View, ZFix } from '../src/types'
import { MAX_FLICKER, type MeasureRow, MIN_VISIBLE, measure } from './support/measure'
import { openSpike } from './support/views'

const results = new URL('../results/', import.meta.url)

// pitch0（真上）は自己遮蔽が構造上起きない視点（Task 5 の bowl.spec.ts と同じ理由）。
// B は自前で地形と水面の三角形を描くので、A の MapLibre 地形メッシュとは仕組みが違う。
// 平面の膜（斜面）と曲面の膜（すり鉢）の両方で、斜め視点（pitch60・85、matrix.spec.ts が測る）の
// 結果が自己遮蔽と沈み込みのどちらなのかを切り分けるための基準にする（中間の判定の反映の申し送り）
const P0_VIEWS: View[] = [15, 16, 17, 18].flatMap((zoom) =>
  [1, 10].map((exaggeration) => ({ zoom, exaggeration, pitch: 0 })),
)
const ZFIXES: readonly ZFix[] = ['none', 'offset', 'offset2']

// B は map.setTerrain を呼ばない（A と違い、MapLibre はカメラの位置を平面の地図として計算する）。
// pitch0 で `setView`（範囲の中心に固定）のまま測ると、範囲の中心から外れた場所にある斜面の膜・
// すり鉢は、標高 × 倍率ぶんカメラに向かって迫り出す（レビュー対応: z18・倍率10 では最大約 200m、
// z18 のカメラ距離は約 437m に対して無視できない大きさ）ため、狭い視野の外へ出てしまう
// （footprintPx=0）。この計測の対象は「B の z-fighting の対策」であって、カメラの視野の問題では
// ないので、範囲の中心ではなく膜・すり鉢の中心へ視点を寄せて測る（scenes.ts の FILM・BOWL_CENTERS の
// 中央のすり鉢と同じ位置）。緯度だけをずらせば足りる（どちらも x の中心は範囲の中心と同じ 0.5）
const METERS_PER_DEGREE_LAT = 111_320 // 目標をおおよそ画面の中心に置ければよいので、概算で足りる
const FILM_LAT_OFFSET_M = -(0.75 - 0.5) * 500 // scenes.ts の FILM（x:0.1-0.9, y:0.6-0.9）の中心 y=0.75。南は緯度が下がる
const BOWL_LAT_OFFSET_M = (0.5 - 0.25) * 500 // scenes.ts の BOWL_CENTERS の中央 [0.5, 0.25]。北は緯度が上がる

async function setViewAt(page: Page, view: View, latOffsetM: number): Promise<void> {
  await page.evaluate(
    async ({ view, latOffsetM, metersPerDegreeLat }) => {
      const spike = window.spike
      if (spike === undefined || spike.candidate === null)
        throw new Error('spike/candidate がありません')
      const center: [number, number] = [
        spike.scene.center.lon,
        spike.scene.center.lat + latOffsetM / metersPerDegreeLat,
      ]
      spike.map.jumpTo({ center, zoom: view.zoom, pitch: view.pitch, bearing: 0 })
      spike.candidate.setExaggeration(view.exaggeration)
      await spike.candidate.whenIdle()
    },
    { view, latOffsetM, metersPerDegreeLat: METERS_PER_DEGREE_LAT },
  )
}

test('B の 1cm の膜（平面・曲面）を pitch0 で測る（斜め視点の自己遮蔽と沈み込みを切り分ける基準）', async ({
  page,
  context,
}) => {
  const lists: string[][] = [] // P20
  const filmRows: MeasureRow[] = []
  const bowlRows: MeasureRow[] = []
  // footprintPx=0（画面外）・footprintPx>0 だが interiorPx=0（縁を 2 画素削ると何も残らず、
  // ちらつきが測れない）の行は、判定に使わずここへ別記する（レビュー対応: 既定値で「合格」に
  // 見えてしまう罠を避ける。Task 5 の bowl.spec.ts と同じ注意）
  const gaps: string[] = []

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
      await setViewAt(page, view, FILM_LAT_OFFSET_M)
      const row = { scene: 'film', zfix, view, measure: await measure(page) }
      if (row.measure.footprintPx === 0) {
        gaps.push(`film zfix=${zfix} z${view.zoom} ×${view.exaggeration}: footprintPx=0（画面外）`)
      } else if (row.measure.interiorPx === 0) {
        gaps.push(
          `film zfix=${zfix} z${view.zoom} ×${view.exaggeration}: interiorPx=0（footprintPx=${row.measure.footprintPx} だが縁を 2 画素削ると残らず、ちらつきが測れない）`,
        )
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
    await setViewAt(page, view, BOWL_LAT_OFFSET_M)
    const row = { scene: 'bowlFilm', zfix: 'offset' as ZFix, view, measure: await measure(page) }
    if (row.measure.footprintPx === 0) {
      gaps.push(`bowlFilm z${view.zoom} ×${view.exaggeration}: footprintPx=0（画面外）`)
    } else if (row.measure.interiorPx === 0) {
      gaps.push(
        `bowlFilm z${view.zoom} ×${view.exaggeration}: interiorPx=0（footprintPx=${row.measure.footprintPx} だが縁を 2 画素削ると残らず、ちらつきが測れない）`,
      )
    }
    bowlRows.push(row)
  }

  mkdirSync(results, { recursive: true })
  writeFileSync(
    new URL('b-film-p0.json', results),
    `${JSON.stringify({ filmRows, bowlRows, gaps }, null, 2)}\n`,
  )

  const isGap = (row: MeasureRow): boolean =>
    row.measure.footprintPx === 0 || row.measure.interiorPx === 0
  const cell = (row: MeasureRow | undefined): string => {
    if (row === undefined) return '—'
    if (isGap(row))
      return `未計測（footprintPx=${row.measure.footprintPx}, interiorPx=${row.measure.interiorPx}）`
    const ok = row.measure.visibleRatio >= MIN_VISIBLE && row.measure.flickerRatio <= MAX_FLICKER
    return `${row.measure.visibleRatio.toFixed(4)} / ${(row.measure.flickerRatio * 100).toFixed(2)}% / ${row.measure.footprintPx} / ${ok ? '○' : '×'}`
  }
  const filmLines = [
    '### 平面の膜（斜面）、pitch0（自己遮蔽が起きない視点。カメラは斜面の膜の中心に寄せている）',
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
    "### 曲面の膜（すり鉢）、zfix=offset、pitch0（M1 と同じ条件。A/A' は 8/8 ○・可視率の最小 0.9953/0.9955。カメラはすり鉢の中心に寄せている）",
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
    const visible = rows.filter((r) => !isGap(r))
    return visible.length === 0
      ? Number.NaN
      : Math.min(...visible.map((r) => r.measure.visibleRatio))
  }
  const maxFlicker = (rows: MeasureRow[]): number => {
    const visible = rows.filter((r) => !isGap(r))
    return visible.length === 0
      ? Number.NaN
      : Math.max(...visible.map((r) => r.measure.flickerRatio))
  }
  const filmNone = filmRows.filter((r) => r.zfix === 'none')
  const body = [
    ...filmLines,
    '',
    `平面の膜（斜面）は pitch0 で自己遮蔽が構造上起きない。zfix=none の可視率の最小（未計測を除く）は **${minVisible(filmNone).toFixed(4)}**、ちらつきの最大は **${(maxFlicker(filmNone) * 100).toFixed(2)}%**（0 ではない行があれば、pitch0 でも z-fighting の兆候がわずかに出ていることを示す）。offset は **${minVisible(filmRows.filter((r) => r.zfix === 'offset')).toFixed(4)}**、offset2 は **${minVisible(filmRows.filter((r) => r.zfix === 'offset2')).toFixed(4)}**。`,
    '',
    ...bowlLines,
    '',
    `B の曲面（すり鉢）の pitch0 の可視率の最小（未計測を除く）は **${minVisible(bowlRows).toFixed(4)}**。A/A' の bowl-film.md（zfix=offset、pitch0）の可視率の最小 0.9953/0.9955 と比べる。`,
    '',
    gaps.length === 0
      ? '未計測（footprintPx=0 または interiorPx=0）の行は無かった。'
      : `未計測の行（判定から除外し、ここに明記する）: ${gaps.join('、')}。`,
    '',
    '**カメラの視点についての注記（レビュー対応）**: B は `map.setTerrain` を呼ばないため、MapLibre はカメラの位置・距離を平面の地図として計算する。B 自身が描く地形・水面は標高 × 倍率ぶん実際にはカメラへ迫り出しているため、範囲の中心（`setView` の既定）から外れた場所にある的（斜面の膜・すり鉢）を、高いズーム・高い倍率・pitch0（狭い視野）で見ようとすると視野の外へ出てしまう（05 で B 系を検討する際に考慮が要る、B 固有の性質）。この計測では的の中心へカメラを寄せることで回避した',
    '',
  ].join('\n')
  writeFileSync(new URL('b-film-p0.md', results), `# B の 1cm の膜、pitch0 の追加計測\n\n${body}\n`)
  console.log(body)
  expect(lists.flat()).toEqual([])
})
