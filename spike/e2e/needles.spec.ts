import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { View } from '../src/types'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)
// a-real.jpg で針状のノイズが目立ったコマ（M2）
const VIEWS: View[] = [
  { zoom: 15, exaggeration: 1, pitch: 0 },
  { zoom: 16, exaggeration: 1, pitch: 45 },
  { zoom: 16, exaggeration: 10, pitch: 45 },
]

test('A の実データ: 無効画素を 0m にした地形と、最も近い有効画素で埋めた地形（M2）', async ({
  page,
  context,
}) => {
  const lists: string[][] = [] // P20
  const shots: Shot[] = []
  for (const demFill of ['zero', 'nearest'] as const) {
    lists.push(
      await openSpike(page, context, { candidate: 'a', scene: 'real', water: 'fixed', demFill }),
    )
    for (const view of VIEWS) {
      await setView(page, view)
      shots.push({
        label: `${demFill} z${view.zoom} ×${view.exaggeration} p${view.pitch}`,
        png: await page.screenshot(),
      })
    }
  }
  await writeContactSheet(
    context,
    shots,
    3,
    'A の実データの針状ノイズ（上: 無効画素 0m、下: 最も近い有効画素で埋める。水面は同じ）',
    fileURLToPath(new URL('sheets/a-real-needles.jpg', results)),
  )
  expect(lists.flat()).toEqual([])
})
