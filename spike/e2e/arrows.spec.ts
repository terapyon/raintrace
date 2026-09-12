import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { ArrowPlacement, View } from '../src/types'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)
// 垂直強調 1・5・10 × pitch 0・60、ズーム 17（D20）
const VIEWS: View[] = [1, 5, 10].flatMap((exaggeration) =>
  [0, 60].map((pitch) => ({ zoom: 17, exaggeration, pitch })),
)

test('A: 流れの矢印（symbol レイヤー）と地形・水面の重なり（spec 05 §3.3）', async ({
  page,
  context,
}) => {
  const errors = await openSpike(page, context, {
    candidate: 'a',
    scene: 'synthetic',
    water: 'fixed',
  })
  const cases: { placement: ArrowPlacement; pitchAlignment: 'map' | 'viewport'; views: View[] }[] =
    [
      { placement: 'above', pitchAlignment: 'map', views: VIEWS },
      { placement: 'below', pitchAlignment: 'map', views: VIEWS },
      // (c) の確かめ: 向きの揃え方を変えても高さは変わらないか
      {
        placement: 'above',
        pitchAlignment: 'viewport',
        views: VIEWS.filter((v) => v.pitch === 60),
      },
    ]
  const shots: Shot[] = []
  for (const c of cases) {
    await page.evaluate(async ({ placement, pitchAlignment }) => {
      await window.spike?.candidate?.showArrows?.(placement, pitchAlignment)
    }, c)
    for (const view of c.views) {
      await setView(page, view)
      shots.push({
        label: `${c.placement}/${c.pitchAlignment} ×${view.exaggeration} p${view.pitch}`,
        png: await page.screenshot(),
      })
    }
  }
  await writeContactSheet(
    context,
    shots,
    6,
    'A の流れの矢印（ズーム 17。1 行目: 水面の後、2 行目: 水面の前、3 行目: viewport 揃え）',
    fileURLToPath(new URL('sheets/a-arrows.jpg', results)),
  )
  expect(errors).toEqual([])
})
