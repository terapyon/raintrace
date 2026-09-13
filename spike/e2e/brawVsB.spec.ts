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
 *
 * fix round 1（タスクレビュー Important 1 対応）: 画面左上の `#status` の帯（index.html、`z${zoom} ...` では
 * なく `${candidate} / ${scene} / ...` の文字列。main.ts の rendererName の行）は候補名を含むため、b と braw の
 * スクリーンショットは帯の中で必ず異なる。128 組すべてを Python(PIL) で bbox を取って測ったところ、差のある
 * 画素は全ペアで y ≤ 45（x ≤ 590）の中に収まっていた（`#status` の CSS: top 8px + padding 4px + line-height
 * 16.8px ≈ 32.8px と概ね整合する）。帯の外（y ≥ STATUS_CUTOFF_Y）だけを比べることで、地形・水面の描画そのものの
 * 一致を測る
 */

const STATUS_CUTOFF_Y = 50 // 実測した帯の下端 y=45 に余裕を足した値（コメント参照）

const shotsDir = new URL('../out/shots/', import.meta.url)
const results = new URL('../results/', import.meta.url)

const label = (v: View): string => `z${v.zoom} ×${v.exaggeration} p${v.pitch}`
const shotPath = (candidate: string, scene: string, view: View): string =>
  fileURLToPath(new URL(`${candidate}-${scene}-${label(view).replaceAll(' ', '_')}.png`, shotsDir))

interface Diff {
  dimsMatch: boolean
  widthA: number
  heightA: number
  widthB: number
  heightB: number
  diffPixels: number | null // 帯の外（y >= STATUS_CUTOFF_Y）で 1 チャンネルでも異なる画素の数。寸法が違えば null
  mean: number | null // 参考値: 帯の外の画素の RGB 差の平均（0〜1 に正規化）。寸法が違えば null
  max: number | null // 同じ尺度の画素ごとの最大
}

async function diffPngs(page: Page, aPath: string, bPath: string): Promise<Diff> {
  const aB64 = readFileSync(aPath).toString('base64')
  const bB64 = readFileSync(bPath).toString('base64')
  return page.evaluate(
    async ({ aB64, bB64, cutoffY }) => {
      const load = (b64: string): Promise<HTMLImageElement> =>
        new Promise((resolve, reject) => {
          const img = new Image()
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('画像を読み込めません'))
          img.src = `data:image/png;base64,${b64}`
        })
      const [imgA, imgB] = await Promise.all([load(aB64), load(bB64)])
      const dimsMatch = imgA.width === imgB.width && imgA.height === imgB.height
      const base = {
        dimsMatch,
        widthA: imgA.width,
        heightA: imgA.height,
        widthB: imgB.width,
        heightB: imgB.height,
      }
      // 寸法が違う画像は比べない（黙って拡縮しない。タスクレビュー Important 1 対応）
      if (!dimsMatch) return { ...base, diffPixels: null, mean: null, max: null }
      const { width, height } = imgA
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (ctx === null) throw new Error('2d context を作れません')
      ctx.drawImage(imgA, 0, 0)
      const dataA = ctx.getImageData(0, 0, width, height).data
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(imgB, 0, 0) // 寸法が一致しているので拡縮しない
      const dataB = ctx.getImageData(0, 0, width, height).data
      let diffPixels = 0
      let sum = 0
      let max = 0
      let counted = 0
      for (let y = cutoffY; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          const d =
            Math.abs((dataA[i] ?? 0) - (dataB[i] ?? 0)) +
            Math.abs((dataA[i + 1] ?? 0) - (dataB[i + 1] ?? 0)) +
            Math.abs((dataA[i + 2] ?? 0) - (dataB[i + 2] ?? 0))
          if (d !== 0) diffPixels++
          const normalized = d / (255 * 3)
          sum += normalized
          if (normalized > max) max = normalized
          counted++
        }
      }
      return { ...base, diffPixels, mean: sum / counted, max }
    },
    { aB64, bB64, cutoffY: STATUS_CUTOFF_Y },
  )
}

test('braw と b のスクリーンショットの画素差（controller 申し送り §2、fix round 1 で状態表示の帯を除外）', async ({
  page,
}) => {
  const rows: { scene: string; view: View; diff: Diff }[] = []
  const missing: string[] = []
  for (const scene of ['synthetic', 'real'] as const) {
    for (const view of allViews()) {
      const bPath = shotPath('b', scene, view)
      const brawPath = shotPath('braw', scene, view)
      if (!existsSync(bPath) || !existsSync(brawPath)) {
        missing.push(
          `${scene} ${label(view)}（b: ${existsSync(bPath)}, braw: ${existsSync(brawPath)}）`,
        )
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

  // 寸法が一致しない組は黙って拡縮せず、ここで検査を失敗させる
  const dimMismatches = rows.filter((r) => !r.diff.dimsMatch)
  expect(
    dimMismatches.map(
      (r) =>
        `${r.scene} ${label(r.view)}: b=${r.diff.widthA}x${r.diff.heightA} braw=${r.diff.widthB}x${r.diff.heightB}`,
    ),
    '寸法が一致しない組がある',
  ).toEqual([])

  // 帯（y < STATUS_CUTOFF_Y）の外に 1 画素でも差があれば失敗させる（このテストの本来の目的）
  const nonZero = rows.filter((r) => (r.diff.diffPixels ?? 0) > 0)
  expect(
    nonZero.map((r) => `${r.scene} ${label(r.view)}: diffPixels=${r.diff.diffPixels}`),
    '状態表示の帯の外で braw が b と画素単位で一致しない視点がある',
  ).toEqual([])

  const totalDiffPixels = rows.reduce((s, r) => s + (r.diff.diffPixels ?? 0), 0)
  const maxOfMaxes = Math.max(...rows.map((r) => r.diff.max ?? 0))

  const lines = [
    '# B-raw と B の画素差（スクリーンショットの比較、fix round 1）',
    '',
    `視点は ${rows.length} 通り（${['synthetic', 'real'].join('・')} 場面 × 64 視点）。画面左上の状態表示の帯（\`#status\`。候補名を含むので b と braw で必ず異なる）を除いた y ≥ ${STATUS_CUTOFF_Y} の領域だけを比べる（帯の実際の下端は 128 組全てで y ≤ 45 だったことを PIL で確認済み）。`,
    '',
    `**結果: ${rows.length}/${rows.length} 視点で状態表示の帯の外は画素単位で一致（differing pixels = 0）**。全視点の帯外の差分画素の合計: **${totalDiffPixels}**、寸法不一致: **${dimMismatches.length}** 件。`,
    '',
    `参考値（帯の外、0〜1 に正規化した RGB 差。理論上は上の結果よりこちらが主）: 全視点の最大の最大は **${maxOfMaxes.toFixed(6)}**。`,
    '',
    '## 全視点',
    '',
    '| 場面 | 視点 | 差分画素数（帯の外） | 寸法一致 |',
    '|---|---|---:|:---:|',
    ...rows.map(
      (r) =>
        `| ${r.scene} | ${label(r.view)} | ${r.diff.diffPixels ?? '—'} | ${r.diff.dimsMatch ? '○' : '×'} |`,
    ),
    '',
  ].join('\n')
  writeFileSync(new URL('braw-vs-b.md', results), `${lines}\n`)
  console.log(
    `braw-vs-b: ${rows.length}/${rows.length} 視点で帯の外は画素単位で一致（差分画素の合計=${totalDiffPixels}、寸法不一致=${dimMismatches.length}）`,
  )
})
