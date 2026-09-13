import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import type { View } from '../src/types'
import { allViews } from './support/views'

/**
 * B-raw（Task 7）が B と同じ見た目になっているかを数値で確かめる（controller の申し送り §2）。
 * PNG を読むライブラリは spike の依存に無いので、Playwright のページに data URL の <img> を 2 枚読み込み、
 * canvas に描いて getImageData で比べる（contactSheet.ts がブラウザで画像を扱うやり方に倣う。新しい依存は足さない）。
 * b-*.png は matrix.spec.ts の `matrix: b` が既に書き出している（コミット済みの `spike/results/water-b.md` と
 * 同じ実行）。out/ は git の外なので、無ければ先に `pnpm spike:e2e spike/e2e/matrix.spec.ts -g "matrix: b$"` を
 * 回し直す必要がある
 */

const shotsDir = new URL('../out/shots/', import.meta.url)
const results = new URL('../results/', import.meta.url)

const label = (v: View): string => `z${v.zoom} ×${v.exaggeration} p${v.pitch}`
const shotPath = (candidate: string, scene: string, view: View): string =>
  fileURLToPath(new URL(`${candidate}-${scene}-${label(view).replaceAll(' ', '_')}.png`, shotsDir))

interface Diff {
  mean: number // 0〜1（差の割合。RGB 3 チャンネルの絶対差の合計 ÷ 255 ÷ 3 の画素平均）
  max: number // 同じ尺度の画素ごとの最大
  width: number
  height: number
}

async function diffPngs(page: Page, aPath: string, bPath: string): Promise<Diff> {
  const aB64 = readFileSync(aPath).toString('base64')
  const bB64 = readFileSync(bPath).toString('base64')
  return page.evaluate(
    async ({ aB64, bB64 }) => {
      const load = (b64: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('画像を読み込めません'))
          img.src = `data:image/png;base64,${b64}`
        })
      const [imgA, imgB] = await Promise.all([load(aB64), load(bB64)])
      const canvas = document.createElement('canvas')
      canvas.width = imgA.width
      canvas.height = imgA.height
      const ctx = canvas.getContext('2d')
      if (ctx === null) throw new Error('2d context を作れません')
      ctx.drawImage(imgA, 0, 0)
      const dataA = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(imgB, 0, 0, canvas.width, canvas.height)
      const dataB = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let sum = 0
      let max = 0
      const pixels = canvas.width * canvas.height
      for (let i = 0; i < dataA.length; i += 4) {
        const d =
          Math.abs((dataA[i] ?? 0) - (dataB[i] ?? 0)) +
          Math.abs((dataA[i + 1] ?? 0) - (dataB[i + 1] ?? 0)) +
          Math.abs((dataA[i + 2] ?? 0) - (dataB[i + 2] ?? 0))
        const normalized = d / (255 * 3)
        sum += normalized
        if (normalized > max) max = normalized
      }
      return { mean: sum / pixels, max, width: canvas.width, height: canvas.height }
    },
    { aB64, bB64 },
  )
}

test('braw と b のスクリーンショットの画素差（controller 申し送り §2）', async ({ page }) => {
  const rows: { scene: string; view: View; diff: Diff | null; note?: string }[] = []
  const missing: string[] = []
  for (const scene of ['synthetic', 'real'] as const) {
    for (const view of allViews()) {
      const bPath = shotPath('b', scene, view)
      const brawPath = shotPath('braw', scene, view)
      if (!existsSync(bPath) || !existsSync(brawPath)) {
        missing.push(
          `${scene} ${label(view)}（b: ${existsSync(bPath)}, braw: ${existsSync(brawPath)}）`,
        )
        rows.push({ scene, view, diff: null })
        continue
      }
      const diff = await diffPngs(page, bPath, brawPath)
      rows.push({ scene, view, diff })
    }
  }

  expect(
    missing,
    `b または braw の shots が無い（先に matrix.spec.ts を回す）: ${missing.join('、')}`,
  ).toEqual([])

  const withDiff = rows.filter(
    (r): r is { scene: string; view: View; diff: Diff } => r.diff !== null,
  )
  const meanOfMeans = withDiff.reduce((s, r) => s + r.diff.mean, 0) / withDiff.length
  const maxOfMaxes = Math.max(...withDiff.map((r) => r.diff.max))
  const worst = [...withDiff].sort((a, b) => b.diff.mean - a.diff.mean).slice(0, 10)

  const lines = [
    '# B-raw と B の画素差（スクリーンショットの比較）',
    '',
    `視点は 128 通り（${['synthetic', 'real'].join('・')} 場面 × 64 視点）。差は RGB 3 チャンネルの絶対差の合計を 255×3 で正規化した 0〜1 の値（0 = 完全一致）。`,
    '',
    `全視点の平均の平均: **${meanOfMeans.toFixed(6)}**、全視点の最大の最大: **${maxOfMaxes.toFixed(6)}**`,
    '',
    '## 差の大きい上位 10 視点',
    '',
    '| 場面 | 視点 | 平均差 | 最大差 |',
    '|---|---|---:|---:|',
    ...worst.map(
      (r) =>
        `| ${r.scene} | ${label(r.view)} | ${r.diff.mean.toFixed(6)} | ${r.diff.max.toFixed(6)} |`,
    ),
    '',
    '## 全視点',
    '',
    '| 場面 | 視点 | 平均差 | 最大差 |',
    '|---|---|---:|---:|',
    ...withDiff.map(
      (r) =>
        `| ${r.scene} | ${label(r.view)} | ${r.diff.mean.toFixed(6)} | ${r.diff.max.toFixed(6)} |`,
    ),
    '',
  ].join('\n')
  writeFileSync(new URL('braw-vs-b.md', results), `${lines}\n`)
  console.log(
    `braw-vs-b: 平均の平均=${meanOfMeans.toFixed(6)} 最大の最大=${maxOfMaxes.toFixed(6)} worst=${worst
      .slice(0, 3)
      .map((r) => `${r.scene}/${label(r.view)}:${r.diff.mean.toFixed(6)}`)
      .join(', ')}`,
  )
})
