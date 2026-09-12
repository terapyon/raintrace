import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, type Page, test } from '@playwright/test'
import { lonLatToPixel, pixelToLonLat, TILE_SIZE } from '../../src/dem/tileMath.ts'
import { meshHeightAt } from '../src/candidates/meshHeight'
import {
  BOWL_CENTERS,
  BOWL_RADIUS_M,
  FILM_DEPTH_M,
  shibuyaRange,
  syntheticSampler,
} from '../src/scenes'
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

// レビュー役の推奨（2026-09-13、Task 5b）として実施。ただし fix round 1 のタスクレビューで、この比較
// 自体に欠陥があると判明した: (I-1) 水面シェーダの discard（v_depth < u_minDepth=0.0099m、shaders.ts）
// により、すり鉢の縁のセルでは 1cm の膜がほぼ全滅する一方 20cm の膜は生き残るため、footprint（画素の
// 集合）そのものが水深で異なる。(I-2) 20cm への持ち上げは縁の影の幾何そのものを変える（倍率10では水面が
// 2m 浮き、遠い壁への影の位置が動く）。沈み込みが一切無いラスタライザのモデル（レビュー検証用）でも、
// ここで記録する 16 行の ratio を全て再現できるため、この比だけでは沈み込みの有無を決められない。
// 結果は「記録に残す失敗した実験」として書き、判定には使わない（直接の判定は下の別のテスト。
// bowl.spec.ts 内の「レンダリングを介さず直接計算する」テストが bowl-film-mesh.md を作る）
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
    '# 曲面（すり鉢）の斜め視点: 1cm の膜と 20cm の基準膜の可視率の比（Task 5b、記録用。fix round 1 で判定に使えないと判明）',
    '',
    '**この実験は沈み込みの判定に使えないと判明した（fix round 1、タスクレビュー）**。当初のねらいは',
    '「遮蔽は水深によらず同じだけ効くので、沈み込まない高さの基準膜（20cm）との比 `ratio = visible(1cm)/visible(20cm)`',
    '（どちらも深度テストありで実際に見えた画素数）を取れば遮蔽が打ち消され、沈み込みだけが残る」というものだったが、',
    'この前提が誤りだった。理由: (1) 水面シェーダの discard（`v_depth < u_minDepth`＝0.0099m、`shaders.ts`）により、',
    'すり鉢の縁の水深が浅いセルでは 1cm の膜がほぼ全滅する一方 20cm の膜は生き残るため、footprint（水面の画素の集合）',
    '自体が水深で異なる（例: 倍率1・pitch60 で footprint(20cm)/footprint(1cm) が z15〜z18 で 1.009〜1.028）。',
    '(2) 20cm への持ち上げは縁の影の幾何そのものを変える（倍率10 では水面が 2m 浮き、遠い壁への影の位置が動く）。',
    '沈み込みが一切無いモデル（レビューの検証用ラスタライザ）でも、下の 16 行の ratio を全て再現できる',
    '（実測 ≥ モデルの全行）ため、この比だけでは沈み込みの有無を決められない。以下は記録として残す（数値は変更なし）。',
    '',
    '| ズーム | 倍率 | pitch | visible(1cm) | visible(20cm) | ratio | ratio<0.98 | 1cm のちらつき |',
    '|---|---|---:|---:|---:|---:|:---:|---:|',
    ...ratioRows.map(
      (r) =>
        `| ${r.view.zoom} | ${r.view.exaggeration} | ${r.view.pitch} | ${fmt(r.visible1)} | ${fmt(r.visible20)} | ${fmt(r.ratio, 4)} | ${r.judge} | ${r.flicker1 === null ? '—' : `${(r.flicker1 * 100).toFixed(2)}%`} |`,
    ),
    '',
    '**判定: 斜め視点の沈み込みは、20cm の基準膜との比では決められない（足跡の差＝縁の discard と、持ち上げによる遮蔽の幾何の変化で説明がつき、沈み込みゼロのモデルで全 16 行を再現）。p0 は 8/8 ○**',
    '',
    '直接の判定は `bowl-film-mesh.md`（レンダリングを介さず、MapLibre の地形メッシュの高さを直接計算する。Task 5b fix round 1）を参照。',
    '',
  ]
  const mdBody = lines.join('\n')
  writeFileSync(new URL('bowl-film-ratio.md', results), mdBody)
  console.log(mdBody)
  expect(lists.flat()).toEqual([])
})

/**
 * いま render-to-texture の描画に使われている地形タイル（canonical z・x・y）の一覧を返す
 * （`getRenderableTiles`。タスクレビュー fix round 2）。
 *
 * fix round 1 の `terrainZooms`（`queryTerrainElevation` と `getElevationForLngLatZoom` が一致する
 * ズームを探す手法）は、`queryTerrainElevation` が地点によらず視野全体の最大タイルズームと比較して
 * しまうため、斜め視点ではすり鉢の場所より細かいズームを誤って返すことがあると判明した（例:
 * z15・z16・倍率1・pitch85 が drawnZoom=17 を記録——すり鉢は中心から125m離れており、そのズーム・pitch
 * では構造上あり得ない）。ここでは代わりに、タイルの矩形を tileMath.ts の xyz 計算で求め、地点を実際に
 * 含むタイルを探す
 */
async function renderableTiles(page: Page): Promise<{ z: number; x: number; y: number }[]> {
  return page.evaluate(() => {
    const map = window.spike?.map
    if (map === undefined) throw new Error('window.spike がありません')
    const terrain = map.getTerrain() === null ? null : map.terrain
    if (terrain === null) return []
    return terrain.tileManager
      .getRenderableTiles()
      .map((t) => ({ z: t.tileID.canonical.z, x: t.tileID.canonical.x, y: t.tileID.canonical.y }))
  })
}

/**
 * 地形タイルの一覧から、指定の経緯度を実際に含むタイルを探す（そのタイルのズームでのグローバル
 * ピクセルに変換し、タイルの矩形に入るかを見る）。複数見つかった場合は最も細かい（z が大きい）ものを
 * 採る。地形タイルのズームは DEM 自体のズームより deltaZoom（既定 1、固定。
 * maplibre-gl-dev.mjs L9954 `this.deltaZoom = 1`）だけ細かいので、DEM のズームは
 * `tileZoom − deltaZoom`（同 L10148 `z = tileID.overscaledZ - this.deltaZoom`）
 */
function tileUnderPoint(
  tiles: { z: number; x: number; y: number }[],
  lon: number,
  lat: number,
): { tileZoom: number; demZoom: number } | null {
  const DELTA_ZOOM = 1
  const matches = tiles.filter(({ z, x, y }) => {
    const p = lonLatToPixel(lon, lat, z)
    return Math.floor(p.x / TILE_SIZE) === x && Math.floor(p.y / TILE_SIZE) === y
  })
  if (matches.length === 0) return null
  const finest = matches.reduce((a, b) => (a.z >= b.z ? a : b))
  return { tileZoom: finest.z, demZoom: finest.z - DELTA_ZOOM }
}

// タスクレビュー fix round 1: bowl-film-ratio（可視率の比）は判定に使えないと判明したため、
// レンダリングを介さず MapLibre の地形メッシュの高さを直接計算する。対象はすり鉢の代表点
// （BOWL_CENTERS[1]、a.ts の probeCells の 'bowl' と同じ (0.5, 0.25)）の周り半径 60m
test('曲面（すり鉢）の沈み込みをレンダリングを介さず直接計算する（A、直接の判定、Task 5b fix round 1）', async ({
  page,
  context,
}) => {
  const lists: string[][] = []
  lists.push(
    await openSpike(page, context, {
      candidate: 'a',
      scene: 'synthetic',
      water: 'bowlFilm',
      zfix: 'offset',
    }),
  )

  const range = shibuyaRange()
  const sample = syntheticSampler(range)
  const n = range.size
  const [bcx = 0.5, bcy = 0.25] = BOWL_CENTERS[1] ?? [0.5, 0.25]
  const centerCol = Math.floor(n * bcx)
  const centerRow = Math.floor(n * bcy)
  const ll = pixelToLonLat(
    range.originX + centerCol + 0.5,
    range.originY + centerRow + 0.5,
    range.z,
  )

  const ALL_VIEWS: View[] = [...MEASURE_VIEWS, ...P0_VIEWS]
  interface ViewZoom {
    view: View
    tileZoom: number | null // すり鉢の代表点を実際に含む地形タイルのズーム
    demZoom: number | null // = tileZoom − 1（deltaZoom）。meshHeightAt に渡す値
    coarsestTileZoom: number | null // 視野内の地形タイルのうち最も粗いズーム
    coarsestDemZoom: number | null // = coarsestTileZoom − 1
  }
  const viewZooms: ViewZoom[] = []
  for (const view of ALL_VIEWS) {
    await setView(page, view)
    const tiles = await renderableTiles(page)
    const under = tileUnderPoint(tiles, ll.lon, ll.lat)
    const coarsestTileZoom = tiles.length === 0 ? null : Math.min(...tiles.map((t) => t.z))
    viewZooms.push({
      view,
      tileZoom: under?.tileZoom ?? null,
      demZoom: under?.demZoom ?? null,
      coarsestTileZoom,
      coarsestDemZoom: coarsestTileZoom === null ? null : coarsestTileZoom - 1,
    })
  }

  // s = メッシュの高さ − シミュレーションの標高（倍率なし。倍率は地形・水面の両方に同じだけ掛かるので
  // 沈み込みの有無の判定には影響しない）。demZoom だけで決まるので、ズームごとに1回だけ計算する
  const radiusPx = BOWL_RADIUS_M / range.cellSizeM
  const cellsCache = new Map<number, { maxS: number; exceedFraction: number; cellCount: number }>()
  const computeForZoom = (zoom: number): { maxS: number; exceedFraction: number } => {
    const cached = cellsCache.get(zoom)
    if (cached !== undefined) return cached
    let maxS = 0
    let exceed = 0
    let count = 0
    const rMin = Math.max(0, Math.floor(centerRow - radiusPx))
    const rMax = Math.min(n - 1, Math.ceil(centerRow + radiusPx))
    const cMin = Math.max(0, Math.floor(centerCol - radiusPx))
    const cMax = Math.min(n - 1, Math.ceil(centerCol + radiusPx))
    for (let row = rMin; row <= rMax; row++) {
      for (let col = cMin; col <= cMax; col++) {
        if ((col - centerCol) ** 2 + (row - centerRow) ** 2 >= radiusPx ** 2) continue
        const gx = range.originX + col
        const gy = range.originY + row
        const simElevation = sample(gx, gy) ?? 0
        const meshHeight = meshHeightAt(sample, zoom, gx + 0.5, gy + 0.5)
        const s = meshHeight - simElevation
        maxS = Math.max(maxS, s)
        count++
        if (s > 0.01) exceed++
      }
    }
    const result = { maxS, exceedFraction: count === 0 ? 0 : exceed / count, cellCount: count }
    cellsCache.set(zoom, result)
    return result
  }

  interface MeshRow extends ViewZoom {
    maxS: number | null
    exceedFraction: number | null
  }
  const meshRows: MeshRow[] = viewZooms.map((vz) => {
    if (vz.demZoom === null) return { ...vz, maxS: null, exceedFraction: null }
    const { maxS, exceedFraction } = computeForZoom(vz.demZoom)
    return { ...vz, maxS, exceedFraction }
  })

  mkdirSync(results, { recursive: true })
  writeFileSync(
    new URL('bowl-film-mesh.json', results),
    `${JSON.stringify(
      { bowlCenter: { col: centerCol, row: centerRow, lngLat: ll }, meshRows },
      null,
      2,
    )}\n`,
  )

  const fmt = (v: number | null, digits = 4) => (v === null ? '—' : v.toFixed(digits))
  const zoomsSorted = [...cellsCache.keys()].sort((a, b) => a - b)

  // pitch0（自己遮蔽が無く、視野内が単一ズームで曖昧さが無い）の行から、地図ズームごとの判定を
  // その場で計算する（数値を文章に手で書き写すと、fix round 1→2 のように前提が変わったときに
  // 古い値のまま残る事故が起きるため、fix round 2 では埋め込み文字列をやめて表から動的に作る）
  const p0Summary = [15, 16, 17, 18]
    .map((mapZoom) => meshRows.find((r) => r.view.zoom === mapZoom && r.view.pitch === 0))
    .filter((r): r is MeshRow => r !== undefined)
    .map((r) => ({
      mapZoom: r.view.zoom,
      demZoom: r.demZoom,
      maxS: r.maxS,
      exceedFraction: r.exceedFraction,
      pass: r.maxS !== null && r.maxS <= 0.01,
    }))
  const p0Lines = p0Summary.map(
    (r) =>
      `- 地図ズーム ${r.mapZoom}（pitch0）: 実際に描かれる DEM のズーム ${r.demZoom ?? '—'}（地形タイルのズーム − deltaZoom 1）、max s = ${fmt(r.maxS)}m（${r.exceedFraction === null ? '—' : `${(r.exceedFraction * 100).toFixed(1)}%`} が1cm超）→ **${r.pass ? '合格（1cm未満）' : '不合格（1cm超の沈み込み）'}**`,
  )
  const failingMapZooms = p0Summary.filter((r) => !r.pass).map((r) => r.mapZoom)
  const okMapZooms = p0Summary.filter((r) => r.pass).map((r) => r.mapZoom)

  const lines = [
    '# 曲面（すり鉢）の沈み込みの直接計算（レンダリングを介さない。Task 5b fix round 2）',
    '',
    '`bowl-film-ratio.md` の可視率の比は判定に使えないと分かったため、MapLibre の地形メッシュの高さを',
    'レンダリングを介さず直接計算する。すり鉢の代表点（`BOWL_CENTERS[1]`、`a.ts` の `probeCells` の',
    "'bowl' と同じ (0.5, 0.25)。3つのすり鉢は同一の放物面で、z15 で 0.0248/0.0246/0.0249m と",
    'ほぼ一致するので代表点で十分）の周り半径 60m のすり鉢の膜セルについて、すり鉢の代表点を実際に含む',
    '地形タイルのズーム（`tileZoom`。`getRenderableTiles` が返すタイルの矩形を xyz 計算で求め、地点を',
    '含むタイルを探す）と、そこから求めた DEM のズーム（`demZoom = tileZoom − 1`。deltaZoom は既定 1、',
    '固定）、視野内の地形タイルのうち最も粗いズーム（`coarsestTileZoom`。本番の粗い DEM の目安）と',
    'その DEM ズーム（`coarsestDemZoom`）を求めた。`demZoom` のメッシュ（2px 間隔の三角形分割、',
    '対角は左上→右下）の高さとシミュレーションの標高の差 `s = meshHeight − simElevation`',
    '（倍率なし。倍率は地形・水面の両方に同じだけ掛かるので判定には影響しない）を計算した。',
    's は demZoom だけで決まるので、ズームごとに1回だけ計算している（下の「ズームごとの s」）。',
    '',
    '**fix round 2 での訂正**: fix round 1 では `queryTerrainElevation` と `getElevationForLngLatZoom`',
    'が一致するズームを探す手法（`a2` の `resampleHeights` と同じ）で drawnZoom を求めていたが、',
    '`queryTerrainElevation` は地点によらず視野全体の最大タイルズームと比較してしまうため、斜め視点で',
    '誤った（すり鉢の場所より細かい）ズームを返すことがあると判明した（例: z15・z16・倍率1・pitch85 が',
    'drawnZoom=17——すり鉢は中心から125m離れており、そのズーム・pitch では構造上あり得ない）。',
    'この版では地点を実際に含むタイルを探す方法に直した。',
    '',
    '**注意（polygonOffset の余裕は「数mm」ではない。タスクレビュー再訂正）**: この直接計算は zfix の',
    'polygonOffset(−1, −4) が描画時に与える深度の余裕を無視している。この余裕はカメラ距離 d の2乗に',
    '比例して増える項を含み、z15・pitch0 では概算で数cm程度（レビューの見積もり）になりうる——',
    '「数mm」ではない。したがって p0 で膜が 8/8 ○（可視）に見えても、それは沈み込み（縁の一部）を',
    'polygonOffset の余裕が覆い隠している可能性があり、逆に本来隠れるべき遠くの水面が薄い地形を透けて',
    '見える（bleed-through）可能性もある——可視率の指標ではこの透けを検出できない。05 でこの対策の',
    '係数を選ぶときは、近傍の弦の沈み込みと遠方の透けの両方を天秤にかける必要がある。',
    '',
    '| ズーム | 倍率 | pitch | tileZoom | demZoom | coarsestTileZoom | coarsestDemZoom | max s (m) | s>0.01m の割合 |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
    ...meshRows.map(
      (r) =>
        `| ${r.view.zoom} | ${r.view.exaggeration} | ${r.view.pitch} | ${r.tileZoom ?? '—'} | ${r.demZoom ?? '—'} | ${r.coarsestTileZoom ?? '—'} | ${r.coarsestDemZoom ?? '—'} | ${fmt(r.maxS)} | ${r.exceedFraction === null ? '—' : `${(r.exceedFraction * 100).toFixed(1)}%`} |`,
    ),
    '',
    '### ズームごとの s（demZoom が同じ視点をまとめた代表値。上の表と同じ値）',
    '',
    '| demZoom | max s (m) | s>0.01m の割合 | セル数 |',
    '|---:|---:|---:|---:|',
    ...zoomsSorted.map((z) => {
      const v = cellsCache.get(z)
      return `| ${z} | ${v?.maxS.toFixed(4)} | ${((v?.exceedFraction ?? 0) * 100).toFixed(1)}% | ${v?.cellCount} |`
    }),
    '',
    '### 判定（確立している事実と、していない事実を分ける。タスクレビュー fix round 2）',
    '',
    '**確立している事実**: MapLibre の地形メッシュは、この凹んだ地形（すり鉢）ではシミュレーションの',
    '水面より弦の高さぶん高く浮く。pitch0（自己遮蔽が無く、視野が単一ズームで曖昧さが無い）で実測した',
    '地図ズームごとの判定は次のとおり（地形タイルのズームは地図ズームと一致するが、実際に描かれる',
    'DEM はそこから deltaZoom=1 だけ粗い。fix round 1 ではこの1段のずれを見落としていた）:',
    '',
    ...p0Lines,
    '',
    `**地図ズーム ${failingMapZooms.length === 0 ? 'なし' : failingMapZooms.join('・')} は不合格（実際の沈み込みが1cmを超える）、地図ズーム ${okMapZooms.length === 0 ? 'なし' : okMapZooms.join('・')} は合格**。弦の高さはズームが1段粗くなるごとに約4倍になる（格子間隔が2倍→弦の高さは格子間隔の2乗に比例）。より粗いタイル（demZoom=13相当。斜め視点で実際に使われる、下表参照）では約 0.40m まで拡大する。`,
    'pitch0・zfix=offset の描画では膜は8/8○（可視率最小0.9953、bowl-film.md）だが、上記のとおり',
    'polygonOffset の余裕は「数mm」ではなくcm程度と見積もられるため、この○が沈み込みを覆い隠して',
    'いるのか、覆い隠せていないのかはこの可視率の指標だけでは判定できない。',
    '',
    '**確立していない事実**: 斜め視点（pitch60・85）では、すり鉢の付近は上の表の tileZoom・coarsestTileZoom',
    'のとおり、はるかに粗いタイル（詳細な数値は表を参照。おおむね pitch60で demZoom 12〜16、pitch85で',
    'demZoom 8〜10 程度まで下がる）で描かれており、その粗さでの弦の高さは「ズームごとの s」の表のとおり',
    '数十cmに達しうる。この視点でレンダリングが実際にそれを隠すか（自己遮蔽や polygonOffset の余裕で）は、',
    '可視率の指標が正当な遮蔽と沈み込みを区別できないため未確定のまま（bowl-film.md・bowl-film-ratio.md 参照）。',
    '',
  ]
  const mdBody2 = lines.join('\n')
  writeFileSync(new URL('bowl-film-mesh.md', results), mdBody2)
  console.log(mdBody2)
  expect(lists.flat()).toEqual([])
})
