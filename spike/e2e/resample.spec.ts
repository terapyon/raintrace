import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ResampleInfo, View } from '../src/types'
import { allViews, openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)

test("A': 高さの取り直しの時間と、シミュレーションの標高との差", async ({ page, context }) => {
  const errors = await openSpike(page, context, {
    candidate: 'a2',
    scene: 'synthetic',
    water: 'fixed',
  })
  const rows: { view: View; info: ResampleInfo }[] = []
  for (const view of allViews()) {
    await setView(page, view)
    const info = await page.evaluate(() => window.spike?.candidate?.lastResample?.() ?? null)
    expect(info).not.toBeNull()
    if (info !== null) rows.push({ view, info })
  }
  mkdirSync(results, { recursive: true })
  writeFileSync(new URL('a2-resample.json', results), `${JSON.stringify(rows, null, 2)}\n`)
  const lines = [
    '| ズーム | 取り直し ms（平均） | ms（最大） | 差の最大 (m) | 全セルで query | DEM のズーム |',
    '|---|---:|---:|---:|---:|---|',
  ]
  for (const zoom of [15, 16, 17, 18]) {
    const group = rows.filter((r) => r.view.zoom === zoom)
    const ms = group.map((r) => r.info.ms)
    lines.push(
      `| ${zoom} | ${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1)} | ${Math.max(...ms).toFixed(1)} | ${Math.max(...group.map((r) => r.info.maxDiffM)).toFixed(3)} | ${group.filter((r) => r.info.fallback).length} | ${[...new Set(group.map((r) => r.info.zoom))].join('・')} |`,
    )
  }
  const table = `${lines.join('\n')}\n`
  writeFileSync(
    new URL('a2-resample.md', results),
    `# A' の高さの取り直し（合成、固定の水）\n\n${table}`,
  )
  console.log(table)
  expect(errors).toEqual([])
})
