import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { openSpike } from './support/views'

const results = new URL('../results/', import.meta.url)

for (const scene of ['synthetic', 'real'] as const) {
  test(`候補なしの ${scene} の場面が開き、エラーと CSP 違反が無い`, async ({ page, context }) => {
    const errors = await openSpike(page, context, { scene })
    const info = await page.evaluate(() => ({
      size: window.spike?.scene.range.size,
      csp: window.spike?.cspViolations,
    }))
    expect(info.size).toBe(516)
    expect(info.csp).toEqual([])
    if (scene === 'real') {
      // 実データの範囲の値は決め打ちせず、実行時に求めて記録する（着手前の検査 G2）
      const stats = await page.evaluate(() => {
        const s = window.spike?.scene
        if (s === undefined) return null
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        let invalid = 0
        let maxDepth = 0
        for (let i = 0; i < s.elevation.length; i++) {
          if (s.validMask[i] !== 1) {
            invalid++
            continue
          }
          const e = s.elevation[i] ?? 0
          min = Math.min(min, e)
          max = Math.max(max, e)
          maxDepth = Math.max(maxDepth, s.depth[i] ?? 0)
        }
        return { min, max, invalidRatio: invalid / s.elevation.length, maxDepth }
      })
      expect(stats).not.toBeNull()
      if (stats !== null) {
        mkdirSync(results, { recursive: true })
        writeFileSync(
          new URL('real-scene.md', results),
          [
            '# 実データの場面（渋谷駅付近、DEM1A の実タイル 9 枚、500m）',
            '',
            '| 最低の標高 | 最高の標高 | 無効セル | 満水の最大の水深 |',
            '|---:|---:|---:|---:|',
            `| ${stats.min.toFixed(2)} m | ${stats.max.toFixed(2)} m | ${(stats.invalidRatio * 100).toFixed(2)}% | ${stats.maxDepth.toFixed(2)} m |`,
            '',
            '参考: 02 の手動確認（渋谷駅付近、500m）は 8.78〜33.06 m、無効セル 0.2%、最大の窪地の深さ 2.80 m。',
            '',
          ].join('\n'),
        )
      }
    }
    expect(errors).toEqual([])
  })
}

for (const candidate of ['a', 'a2', 'b', 'braw'] as const) {
  test(`候補 ${candidate} の読み込みで CSP 違反とエラーが無い`, async ({ page, context }) => {
    const errors = await openSpike(page, context, { candidate, scene: 'real' })
    expect(await page.evaluate(() => window.spike?.cspViolations)).toEqual([])
    expect(errors).toEqual([])
  })
}
