import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { strings } from '../../src/ui/strings'
import { acknowledgeDisclaimer, waitTerrain } from './support/app'
import { encodeDemPng, routeGsi } from './support/gsi'

const SHIBUYA_URL = '/?lat=35.658000&lon=139.701600'
const a54Fixture = readFileSync(new URL('../fixtures/fill/a54.json', import.meta.url), 'utf8')
const platformTile = encodeDemPng(256, 256, (x, y) =>
  x >= 96 && x < 160 && y >= 96 && y < 160 ? 30 : 10,
)
const flatTile = encodeDemPng(256, 256, () => 10)

test.use({ viewport: { width: 390, height: 844 } })

test('スマホの幅で、崩れる前／後の切り替えが地図の出典と重ならない（spec 10）', async ({
  page,
}) => {
  await routeGsi(page.context(), {
    dem1a: platformTile,
    dem5: 'missing',
    demPng: flatTile,
    landform: 'fill',
  })
  await page
    .context()
    .route('**/data/a54/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: a54Fixture }),
    )
  await acknowledgeDisclaimer(page.context())
  await page.goto(SHIBUYA_URL)
  await waitTerrain(page)
  await page.getByLabel(strings.fillHistory.enable, { exact: true }).check()
  await page.getByTestId('fill-row-1').click({ timeout: 30_000 })
  await page.getByRole('button', { name: strings.collapse.open }).click()
  await page.getByRole('button', { name: strings.collapse.compute }).click()
  const toggle = page.getByRole('group', { name: strings.scenario.label })
  await expect(toggle).toBeVisible({ timeout: 60_000 })
  const box = await toggle.boundingBox()
  const attribution = await page.locator('.maplibregl-ctrl-bottom-right').boundingBox()
  if (box === null || attribution === null) throw new Error('要素の位置が取れません')
  // 出典は右上に出る。切り替えの右端と出典の左端の間に余白がある
  expect(box.x + box.width).toBeLessThanOrEqual(attribution.x)
  if (process.env.SHOT_DIR)
    await page.screenshot({ path: `${process.env.SHOT_DIR}/phone-collapse-ready.png` })
})
