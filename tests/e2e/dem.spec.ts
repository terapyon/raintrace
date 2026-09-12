import { expect, test } from '@playwright/test'
import { strings } from '../../src/ui/strings'
import { acknowledgeDisclaimer, clickMap, waitTerrain } from './support/app'
import { routeGsi } from './support/gsi'

const SHIBUYA = '/?lat=35.658000&lon=139.701600'

test('クリックすると、中心のマーカーと範囲の枠が出る', async ({ page, context }) => {
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto('/')
  await clickMap(page)
  await expect(page.locator('.maplibregl-marker')).toBeVisible()
  await waitTerrain(page)
})

test('DEM 情報バッジに「DEM1A」と出る', async ({ page, context }) => {
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  await expect(page.getByTestId('dem-badge')).toHaveText(strings.dem.dem1a)
})

test('最低・最高の標高が実タイルの期待値と一致する @webkit', async ({ page, context }) => {
  // すべての DEM の要求に実タイルを返す。範囲は 2 タイル幅以上なので、タイルのすべての画素が範囲に入る（spec 02 §8.2）
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  await expect(page.getByTestId('elevation-min')).toHaveText('11.08 m')
  await expect(page.getByTestId('elevation-max')).toHaveText('23.08 m')
})

test('DEM1A が 404 で dem_png が陸域なら、バッジが「DEM5A」になる', async ({ page, context }) => {
  await routeGsi(context, { dem1a: 'missing', demPng: 'fixture', dem5: 'fixture' })
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  await expect(page.getByTestId('dem-badge')).toHaveText(strings.dem.dem5a)
})

test('一部の DEM1A が 404 で dem_png が無効値なら、DEM1A のまま無効セルの割合が 0 より大きい', async ({
  page,
  context,
}) => {
  await routeGsi(context, { dem1a: (x) => (x % 2 === 0 ? 'fixture' : 'missing'), demPng: 'na' })
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  await expect(page.getByTestId('dem-badge')).toHaveText(strings.dem.dem1a)
  await expect(page.getByTestId('invalid-ratio')).not.toHaveText('0.0%')
})

test('すべて 404 なら「この地域には標高データがありません」と出て、範囲を出さない', async ({
  page,
  context,
}) => {
  // 経路: 段 1 の 404 は、dem_png も 404 なので海域とみなし、タイルの無い段 1 を採用する
  // → 範囲の無効セルが 100% → no-data（段 3 まで落ちる経路ではない）
  await routeGsi(context, { dem1a: 'missing', dem5: 'missing', demPng: 'missing' })
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await expect(page.getByTestId('load-error')).toHaveText(strings.errors['no-data'], {
    timeout: 20_000,
  })
  await expect(page.locator('[data-range-shown="true"]')).toHaveCount(0)
})

test('対応範囲（日本）の外の地点は、取得せずに知らせる', async ({ page, context }) => {
  const counts = await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto('/?lat=60.000000&lon=139.000000')
  await expect(page.getByTestId('load-error')).toHaveText(strings.errors['out-of-range'], {
    timeout: 20_000,
  })
  await expect(page.locator('[data-range-shown="true"]')).toHaveCount(0)
  expect(counts.dem).toBe(0)
})

test('表示のスイッチと矢印の間隔を切り替えてもエラーが出ない', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  for (const label of [
    strings.panel.showElevation,
    strings.panel.showDepressions,
    strings.panel.showFlow,
  ]) {
    await page.getByLabel(label).click()
    await page.getByLabel(label).click()
  }
  for (const spacing of ['5 m', '20 m', '10 m']) {
    await page.getByRole('button', { name: spacing }).click()
  }
  expect(errors).toEqual([])
})

test('クリックすると URL に lat・lon が入り、再読み込みすると同じ地点が選ばれる', async ({
  page,
  context,
}) => {
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto('/')
  await clickMap(page)
  await waitTerrain(page)
  await expect(page).toHaveURL(/lat=-?\d+\.\d{6}&lon=-?\d+\.\d{6}/)
  const point = await page.getByTestId('selected-point').textContent()
  await page.reload()
  await waitTerrain(page)
  await expect(page.getByTestId('selected-point')).toHaveText(point ?? '')
})

test('Worker の中の DEM の取得も差し替えられている', async ({ page, context }) => {
  const counts = await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  expect(counts.dem).toBeGreaterThan(0)
})

test('Worker のスクリプトを読めなくても、クリックのたびに停止を知らせ、作り直しが回り続けない', async ({
  page,
  context,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  // Worker のスクリプト（dist/assets/simulation.worker-<hash>.js）の取得を失敗させる。
  // Chromium では Worker に 'error' が発火し、SimulationClient は次の要求で作り直す
  let workerRequests = 0
  await context.route('**/assets/simulation.worker-*.js', (route) => {
    workerRequests++
    return route.abort()
  })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-worker-ready', 'false')
  expect(workerRequests).toBe(1)

  await clickMap(page)
  // クリックで Worker を 1 回だけ作り直し、それも失敗する
  await expect.poll(() => workerRequests).toBe(2)
  await expect(page.getByTestId('load-error')).toContainText(strings.errors.worker)

  // 再試行のボタン（spec 02 §7 の再試行の経路）でも、同じく Worker を 1 回だけ作り直す
  await page.getByRole('button', { name: strings.panel.retry }).click()
  await expect.poll(() => workerRequests).toBe(3)
  await expect(page.getByTestId('load-error')).toContainText(strings.errors.worker)

  // 要求が無ければ作り直さない。表示も読み込み中に戻らない
  await page.waitForTimeout(1000)
  expect(workerRequests).toBe(3)
  await expect(page.getByTestId('load-error')).toContainText(strings.errors.worker)
  expect(errors).toEqual([])
})
