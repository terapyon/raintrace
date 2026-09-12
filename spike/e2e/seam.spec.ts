import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { openSpike, setView } from './support/views'

const SEAM_CANDIDATES = ['b'] as const
const results = new URL('../results/', import.meta.url)

for (const candidate of SEAM_CANDIDATES) {
  test(`seam: ${candidate}`, async ({ page, context }) => {
    const lists: string[][] = [] // P20
    const shots: Shot[] = []
    // 範囲の中心から北を向くと、北の縁（台地、段差が最大）が見える
    for (const skirt of [1, 0]) {
      lists.push(await openSpike(page, context, { candidate, scene: 'synthetic', skirt }))
      for (const exaggeration of [1, 10]) {
        for (const pitch of [60, 85]) {
          await setView(page, { zoom: 16, exaggeration, pitch })
          shots.push({
            label: `縁${skirt === 1 ? 'あり' : 'なし'} ×${exaggeration} p${pitch}`,
            png: await page.screenshot(),
          })
        }
      }
    }
    await writeContactSheet(
      context,
      shots,
      4,
      `${candidate} の範囲の境界（ズーム 16、上: 縁あり、下: 縁なし）`,
      fileURLToPath(new URL(`sheets/${candidate}-seam.jpg`, results)),
    )
    expect(lists.flat()).toEqual([])
  })
}

test('境界の段差の表（倍率ごと、合成と実データ）', async ({ page, context }) => {
  const lines = ['| 場面 | 倍率 | 段差の最大 (m) | 段差の平均 (m) |', '|---|---|---:|---:|']
  for (const scene of ['synthetic', 'real'] as const) {
    // 実データはタイルの取得と復号にブラウザが要るので、候補なしのページを開いて測る
    const errors = await openSpike(page, context, { scene })
    const step = await page.evaluate(() => window.spike?.boundaryStep() ?? null)
    expect(step).not.toBeNull()
    expect(errors).toEqual([])
    if (step === null) continue
    for (const exaggeration of [1, 2, 5, 10]) {
      lines.push(
        `| ${scene} | ${exaggeration} | ${(step.max * exaggeration).toFixed(1)} | ${(step.mean * exaggeration).toFixed(1)} |`,
      )
    }
  }
  writeFileSync(new URL('seam.md', results), `# B の範囲の境界の段差\n\n${lines.join('\n')}\n`)
})
