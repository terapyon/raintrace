import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ApiProbeResult, View } from '../src/types'
import { openSpike, setView, ZOOMS } from './support/views'

const resultsDir = new URL('../results/', import.meta.url)
const distance = (a: { x: number; y: number } | null, b: { x: number; y: number }): number =>
  a === null ? Number.POSITIVE_INFINITY : Math.hypot(a.x - b.x, a.y - b.y)

test('A: Custom Layer の行列に地形の高さが反映されるか（判定 (1)）', async ({ page, context }) => {
  const errors = await openSpike(page, context, { candidate: 'a', scene: 'synthetic' })
  const rows: { view: View; probe: ApiProbeResult }[] = []
  for (const zoom of ZOOMS) {
    for (const exaggeration of [1, 10]) {
      for (const pitch of [0, 60]) {
        const view = { zoom, exaggeration, pitch }
        await setView(page, view)
        const probe = await page.evaluate(() => window.spike?.candidate?.apiProbe?.() ?? null)
        expect(probe).not.toBeNull()
        if (probe !== null) rows.push({ view, probe })
      }
    }
  }
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(new URL('api-probe.json', resultsDir), `${JSON.stringify(rows, null, 2)}\n`)

  // 台地（平ら）では地形の LOD によらず高さが一致するので、行列の意味だけを取り出せる
  console.log('zoom exag pitch | z=0 | 地形 | シミュ | bowl の 地形−シミュ×倍率 (m)')
  for (const { view, probe } of rows) {
    const flat = probe.points.find((p) => p.label === 'flat')
    const bowl = probe.points.find((p) => p.label === 'bowl')
    if (flat === undefined || bowl === undefined) continue
    const lod = (bowl.terrainElevation ?? Number.NaN) - bowl.simElevation * view.exaggeration
    console.log(
      `${view.zoom} ${view.exaggeration} ${view.pitch} | ${distance(flat.viaMatrixZ0, flat.projected).toFixed(1)} | ${distance(flat.viaMatrixTerrain, flat.projected).toFixed(1)} | ${distance(flat.viaMatrixSim, flat.projected).toFixed(1)} | ${lod.toFixed(3)}`,
    )
  }
  expect(errors).toEqual([])
})
