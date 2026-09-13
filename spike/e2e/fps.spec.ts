import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { CandidateId, FpsResult, View, WaterMode } from '../src/types'
import { openSpike, setView } from './support/views'

interface FpsRun {
  label: string
  candidate: CandidateId
  water: WaterMode
}

// a2 は 05 の候補から事実上外れる（高さの取り直しが 123〜156ms）が、参考値として一度は測る
// （controller の Task 8 dispatch notes）。「a（地形のみ）」は water=none で水面の Custom Layer を
// 追加しない基準（Task 8 fix round 1、レビュー Important 2: A の不足が水面のせいか地形のせいかを分ける）
const FPS_RUNS: FpsRun[] = [
  { label: 'a', candidate: 'a', water: 'dynamic' },
  { label: 'a2', candidate: 'a2', water: 'dynamic' },
  { label: 'b', candidate: 'b', water: 'dynamic' },
  { label: 'braw', candidate: 'braw', water: 'dynamic' },
  { label: 'a（地形のみ、water=none）', candidate: 'a', water: 'none' },
]
// 手動の計測と同じ 2 つの視点。B・B-raw は map.setTerrain を呼ばないため、この視点でも
// 水面が画面に入っているかは別途 measure() で確かめる（下の 2 つ目のテスト）
const FPS_VIEWS: View[] = [
  { zoom: 17, exaggeration: 5, pitch: 60 },
  { zoom: 16, exaggeration: 10, pitch: 85 },
]
const results = new URL('../results/', import.meta.url)

test('fps（自動、ヘッドレスの Chromium。参考値）', async ({ page, context }, testInfo) => {
  // fps-gpu プロジェクト（実 GPU、headless）は同じテストを別ファイル名で書く（controller dispatch notes §1）
  const suffix = testInfo.project.name === 'fps-gpu' ? '-gpu' : ''
  const rows: { label: string; view: View; result: FpsResult }[] = []
  const lists: string[][] = [] // P20
  for (const run of FPS_RUNS) {
    lists.push(
      await openSpike(page, context, {
        candidate: run.candidate,
        scene: 'real',
        water: run.water,
      }),
    )
    for (const view of FPS_VIEWS) {
      await setView(page, view)
      const result = await page.evaluate(async () => {
        if (window.spike === undefined) throw new Error('window.spike がありません')
        return window.spike.runFps(5_000)
      })
      rows.push({ label: run.label, view, result })
    }
  }
  mkdirSync(results, { recursive: true })
  writeFileSync(new URL(`fps-auto${suffix}.json`, results), `${JSON.stringify(rows, null, 2)}\n`)
  // headless の rAF はディスプレイに縛られないのではなく、この環境では 60Hz に刻まれる（p50 が
  // どの行も約 16.7ms、B/B-raw が 60.0fps に張り付く）。「60.0」は余裕ではなく上限で、この計測は
  // 「60Hz に追いつけるか」しか示さない（Task 8 fix round 1、レビュー Important 1）
  const note =
    suffix === '-gpu'
      ? '参考、実 GPU・headless。headless の rAF はこの環境で 60Hz に刻まれるため 60fps が上限——余裕は測れず、60Hz に追いつくかだけを示す'
      : 'ソフトウェア描画なら参考値。計画 D15'
  const lines = [
    `描画: ${rows[0]?.result.renderer ?? '不明'}（${note}）`,
    '',
    '| 候補 | 視点 | 平均 fps | 中央値 (ms) | 長いフレームの閾値 (ms) | 長いフレーム | ヒストグラム g1/g2/g3/g4/g5+ | render CPU 平均 (ms) | depthUpdates/renderFrames | 水深の往復 (ms) | pass |',
    '|---|---|---:|---:|---:|---:|---|---:|---:|---:|---|',
    ...rows.map(({ label, view, result: r }) => {
      const h = r.gapHistogram
      const ratio = r.renderFrames === 0 ? 0 : r.depthUpdates / r.renderFrames
      return `| ${label} | z${view.zoom} ×${view.exaggeration} p${view.pitch} | ${r.meanFps.toFixed(1)} | ${r.p50Ms.toFixed(1)} | ${r.longFrameThresholdMs.toFixed(1)} | ${(r.longFrameRatio * 100).toFixed(1)}% | ${h.g1}/${h.g2}/${h.g3}/${h.g4}/${h.g5plus} | ${r.renderCpuMeanMs.toFixed(2)} | ${(ratio * 100).toFixed(1)}% (${r.depthUpdates}/${r.renderFrames}) | ${r.roundTripMeanMs.toFixed(1)} | ${r.pass} |`
    }),
  ]
  const table = `${lines.join('\n')}\n`
  writeFileSync(
    new URL(`fps-auto${suffix}.md`, results),
    `# fps（自動${suffix === '-gpu' ? '、実 GPU' : ''}）\n\n${table}`,
  )
  console.log(table)
  expect(lists.flat()).toEqual([])
})

// B・B-raw は map.setTerrain を呼ばないため、カメラは地形の高さを知らない（Task 6・7 の申し送り）。
// fps の視点で水面が画面から外れていないかを、水深の値ではなく footprintPx（0 なら画面外）で確かめる
// （controller の Task 8 dispatch notes: 「水の無いフレームを黙って比べない」）。
// この確認は setView 直後の静止した姿勢だけで行い、runFps の回転・水深の更新中は見ていない
// （水面は常にカメラ付近を中心に置かれるので大きくは変わらないはずだが、確かめてはいない。
// fix round 1、レビュー Minor 5）。water.request は呼ばないため水深は初期値のまま更新されない
test('fps の視点で水面が画面に入っているか（参考）', async ({ page, context }, testInfo) => {
  // fps-auto と同様、プロジェクトごとに別ファイルへ書く（同じファイル名だと後勝ちで上書きされる。
  // fix round 1、レビュー Important 4）
  const suffix = testInfo.project.name === 'fps-gpu' ? '-gpu' : ''
  const rows: { candidate: string; view: View; footprintPx: number }[] = []
  const lists: string[][] = [] // P20
  for (const candidate of ['a', 'b', 'braw'] as const) {
    lists.push(
      await openSpike(page, context, {
        candidate,
        scene: 'real',
        water: 'dynamic',
        capture: 1,
      }),
    )
    for (const view of FPS_VIEWS) {
      await setView(page, view)
      const measure = await page.evaluate(async () => {
        if (window.spike === undefined) throw new Error('window.spike がありません')
        return window.spike.measure()
      })
      rows.push({ candidate, view, footprintPx: measure.footprintPx })
    }
  }
  mkdirSync(results, { recursive: true })
  const lines = [
    '| 候補 | 視点 | footprintPx（0 なら水面が画面外） |',
    '|---|---|---:|',
    ...rows.map(
      ({ candidate, view, footprintPx }) =>
        `| ${candidate} | z${view.zoom} ×${view.exaggeration} p${view.pitch} | ${footprintPx} |`,
    ),
  ]
  writeFileSync(new URL(`fps-views${suffix}.md`, results), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
  // 画面外（footprintPx=0）はここでは失敗にしない（Task 8 の目的は fps であり、視点の妥当性は
  // 報告に記録してコーディネーターの判断に委ねる。controller dispatch notes 参照）。
  // ページの例外・CSP 違反だけを検査する
  expect(lists.flat()).toEqual([])
})
