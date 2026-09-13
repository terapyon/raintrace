import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { FpsResult, View } from '../src/types'
import { openSpike, setView } from './support/views'

// a2 は 05 の候補から事実上外れる（高さの取り直しが 123〜156ms）が、参考値として一度は測る
// （controller の Task 8 dispatch notes）
const FPS_CANDIDATES = ['a', 'a2', 'b', 'braw'] as const
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
  const rows: { candidate: string; view: View; result: FpsResult }[] = []
  const lists: string[][] = [] // P20
  for (const candidate of FPS_CANDIDATES) {
    lists.push(await openSpike(page, context, { candidate, scene: 'real', water: 'dynamic' }))
    for (const view of FPS_VIEWS) {
      await setView(page, view)
      const result = await page.evaluate(async () => {
        if (window.spike === undefined) throw new Error('window.spike がありません')
        return window.spike.runFps(5_000)
      })
      rows.push({ candidate, view, result })
    }
  }
  mkdirSync(results, { recursive: true })
  writeFileSync(new URL(`fps-auto${suffix}.json`, results), `${JSON.stringify(rows, null, 2)}\n`)
  const note =
    suffix === '-gpu'
      ? '参考、実 GPU・headless（headless Chrome はディスプレイのリフレッシュレートに縛られないため、体感の fps ではなくレンダリングの速さの参考値）'
      : 'ソフトウェア描画なら参考値。計画 D15'
  const lines = [
    `描画: ${rows[0]?.result.renderer ?? '不明'}（${note}）`,
    '',
    '| 候補 | 視点 | 平均 fps | p95 (ms) | 長いフレーム | render の CPU 平均 (ms) | 水深の往復 (ms) | 水深の数 |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      ({ candidate, view, result: r }) =>
        `| ${candidate} | z${view.zoom} ×${view.exaggeration} p${view.pitch} | ${r.meanFps.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${(r.longFrameRatio * 100).toFixed(1)}% | ${r.renderCpuMeanMs.toFixed(2)} | ${r.roundTripMeanMs.toFixed(1)} | ${r.waterFrames} |`,
    ),
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
// （controller の Task 8 dispatch notes: 「水の無いフレームを黙って比べない」）
test('fps の視点で水面が画面に入っているか（参考）', async ({ page, context }) => {
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
  writeFileSync(new URL('fps-views.md', results), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
  // 画面外（footprintPx=0）はここでは失敗にしない（Task 8 の目的は fps であり、視点の妥当性は
  // 報告に記録してコーディネーターの判断に委ねる。controller dispatch notes 参照）。
  // ページの例外・CSP 違反だけを検査する
  expect(lists.flat()).toEqual([])
})
