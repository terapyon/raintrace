import { mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { View } from '../src/types'
import { openSpike, setView } from './support/views'

// 報告に載せる 6 枚（計画 D11）。候補ごとに同じ視点 1 枚、A の LOD、B の境界
const PICKS: { name: string; query: Record<string, string | number>; view: View }[] = [
  {
    name: 'a-synthetic-z17-x10-p60',
    query: { candidate: 'a', scene: 'synthetic' },
    view: { zoom: 17, exaggeration: 10, pitch: 60 },
  },
  {
    name: 'a2-synthetic-z17-x10-p60',
    query: { candidate: 'a2', scene: 'synthetic' },
    view: { zoom: 17, exaggeration: 10, pitch: 60 },
  },
  {
    name: 'b-synthetic-z17-x10-p60',
    query: { candidate: 'b', scene: 'synthetic' },
    view: { zoom: 17, exaggeration: 10, pitch: 60 },
  },
  {
    name: 'braw-synthetic-z17-x10-p60',
    query: { candidate: 'braw', scene: 'synthetic' },
    view: { zoom: 17, exaggeration: 10, pitch: 60 },
  },
  {
    name: 'a-real-z15-x5-p60',
    query: { candidate: 'a', scene: 'real' },
    view: { zoom: 15, exaggeration: 5, pitch: 60 },
  },
  {
    name: 'b-seam-z16-x10-p60',
    query: { candidate: 'b', scene: 'synthetic', skirt: 1 },
    view: { zoom: 16, exaggeration: 10, pitch: 60 },
  },
]
const dir = new URL('../../docs/superpowers/spikes/2026-09-12-3d-rendering/', import.meta.url)

test('報告に載せる画像', async ({ page, context }) => {
  mkdirSync(dir, { recursive: true })
  for (const pick of PICKS) {
    const errors = await openSpike(page, context, { ...pick.query, water: 'fixed' })
    await setView(page, pick.view)
    const path = fileURLToPath(new URL(`${pick.name}.jpg`, dir))
    await page.screenshot({ path, type: 'jpeg', quality: 80 })
    // 1 枚 200KB 以下（計画 D11）
    expect(statSync(path).size).toBeLessThanOrEqual(200_000)
    expect(errors).toEqual([])
  }
})
