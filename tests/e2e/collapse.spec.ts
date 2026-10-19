import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { COLLAPSE_LAYER_IDS } from '../../src/map/layerIds'
import { strings } from '../../src/ui/strings'
import { acknowledgeDisclaimer, clickMap, mapElement, switchTo3d, waitTerrain } from './support/app'
import { encodeDemPng, type GsiScenario, routeGsi } from './support/gsi'

const SHIBUYA = { lat: 35.658, lon: 139.7016 }
const SHIBUYA_URL = `/?lat=${SHIBUYA.lat.toFixed(6)}&lon=${SHIBUYA.lon.toFixed(6)}`
const t = strings.collapse

const a54Fixture = readFileSync(new URL('../fixtures/fill/a54.json', import.meta.url), 'utf8')

/** 地点（渋谷）の世界座標（ズーム z の画素。タイルは 256 画素） */
function worldPixel(z: number): { u: number; v: number } {
  const worldPx = 256 * 2 ** z
  const rad = (SHIBUYA.lat * Math.PI) / 180
  return {
    u: ((SHIBUYA.lon + 180) / 360) * worldPx,
    v: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * worldPx,
  }
}

/**
 * 南へ流れる谷。中央の列（地点の経度）が低く、両側が約 30°（勾配 0.58）で上がり、南へ 5% で下る。
 * withPlatform なら、谷の上流（北）側を谷ごとまたぐ +15 m の盛土（z17 で 80 × 40 画素。今の地形だけ）。
 * 上流の谷が今の地形で窪地になり、昔の谷底が盛土の下を通る（水路の仮定になる）。
 * 土が谷底に積もってせき止めの下限（100 m³ 超・面積 200 m² 以上。R12）を超えるよう、斜面を急にしている
 * 位置は z17 の画素で決めて、DEM10B（z14）の画素にも同じ地形を当てる
 */
function valleyElevation(withPlatform: boolean) {
  const origin = worldPixel(17)
  return (z: number, tileX: number, tileY: number) => (px: number, py: number) => {
    const scale = 2 ** (17 - z)
    const u = (tileX * 256 + px + 0.5) * scale - origin.u
    const v = (tileY * 256 + py + 0.5) * scale - origin.v
    const base = 30 + 0.58 * Math.abs(u) - 0.05 * v
    const onPlatform = u >= -40 && u < 40 && v >= -60 && v < -20
    return withPlatform && onPlatform ? base + 15 : base
  }
}

/** タイルごとに PNG を作って使い回す */
function tileRule(z: number, withPlatform: boolean) {
  const elevation = valleyElevation(withPlatform)
  const cache = new Map<string, Buffer>()
  return (x: number, y: number): Buffer => {
    const key = `${x}/${y}`
    let png = cache.get(key)
    if (png === undefined) {
      png = encodeDemPng(256, 256, elevation(z, x, y))
      cache.set(key, png)
    }
    return png
  }
}

/** 今は DEM1A（台つき）、昔は台なしの DEM10B。人工地形は盛土地 */
const VALLEY_SCENARIO: GsiScenario = {
  dem1a: tileRule(17, true),
  dem5: 'missing',
  demPng: tileRule(14, false),
  landform: 'fill',
}

async function setup(page: Page, url: string): Promise<void> {
  await routeGsi(page.context(), VALLEY_SCENARIO)
  await page
    .context()
    .route('**/data/a54/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: a54Fixture }),
    )
  await acknowledgeDisclaimer(page.context())
  await page.goto(url)
  await waitTerrain(page)
}

/** 盛土の履歴をオンにして最初の候補を選び、「崩れたと仮定する」を押す */
async function openCollapse(page: Page): Promise<void> {
  await page.getByLabel(strings.fillHistory.enable, { exact: true }).check()
  await page.getByTestId('fill-row-1').click({ timeout: 30_000 })
  await page.getByRole('button', { name: t.open }).click()
  await expect(page.getByTestId('collapse-section')).toBeVisible()
}

/** 計算して結果の行が出るまで待つ */
async function computeToReady(page: Page): Promise<void> {
  await page.getByRole('button', { name: t.compute }).click()
  await expect(page.getByTestId('collapse-result')).toBeVisible({ timeout: 60_000 })
}

const scenarioToggle = (page: Page): Locator =>
  page.getByRole('group', { name: strings.scenario.label })

const overlayLayers = async (page: Page, name = 'data-overlay-layers'): Promise<string[]> =>
  (await mapElement(page).getAttribute(name))?.split(',') ?? []

test.describe('盛土が崩れたら（spec 10 §7.2）', () => {
  test('候補を選び「崩れたと仮定する」→ 計算 → 崩れた土・積もった土・せき止めの行が出る', async ({
    page,
  }) => {
    await setup(page, SHIBUYA_URL)
    await openCollapse(page)
    await computeToReady(page)
    const result = page.getByTestId('collapse-result')
    await expect(result).toContainText(t.collapsed)
    await expect(result).toContainText(t.deposited)
    // 積もった土は 0 でない
    const text = await result.innerText()
    const deposited = /積もった土: 約 ([\d,.]+)/.exec(text)
    expect(Number((deposited?.[1] ?? '0').replace(/,/g, ''))).toBeGreaterThan(0)
    // 谷をふさぐ台なので、せき止められた場所が 1 か所以上ある（「ありません」ではない）
    expect(text).toMatch(/せき止められた場所: [1-9]\d* か所/)
    expect(text).not.toContain(t.noDams)
    await expect(scenarioToggle(page)).toBeVisible()
  })

  test('「崩れる前｜崩れた後」で、data-collapse-view が変わり、collapse-deposit のレイヤーが出たり消えたりする', async ({
    page,
  }) => {
    await setup(page, SHIBUYA_URL)
    await openCollapse(page)
    await computeToReady(page)
    const mapEl = mapElement(page)
    const toggle = scenarioToggle(page)
    // 計算が済むと、押さなくても崩れた後の地形と積もった土が出る
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'after')
    await expect.poll(() => overlayLayers(page)).toContain(COLLAPSE_LAYER_IDS.deposit)
    await toggle.getByRole('button', { name: strings.scenario.before, exact: true }).click()
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'before')
    await expect.poll(() => overlayLayers(page)).not.toContain(COLLAPSE_LAYER_IDS.deposit)
    await toggle.getByRole('button', { name: strings.scenario.after, exact: true }).click()
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'after')
    await expect.poll(() => overlayLayers(page)).toContain(COLLAPSE_LAYER_IDS.deposit)
  })

  test('計算の後、data-collapse-culvert が blocked、collapse-culvert のレイヤーがあり、「崩れた土で水路がふさがりました」が出る', async ({
    page,
  }) => {
    await setup(page, SHIBUYA_URL)
    await openCollapse(page)
    await computeToReady(page)
    await expect(mapElement(page)).toHaveAttribute('data-collapse-culvert', 'blocked')
    await expect.poll(() => overlayLayers(page)).toContain(COLLAPSE_LAYER_IDS.culvert)
    const section = page.getByTestId('collapse-section')
    await expect(section).toContainText(t.culvertAssumed)
    await expect(section).toContainText(t.culvertBlocked)
  })

  test('「崩れる前」に切り替えると data-collapse-culvert が open になり、collapse-culvert は残り、collapse-deposit は消える', async ({
    page,
  }) => {
    await setup(page, SHIBUYA_URL)
    await openCollapse(page)
    await computeToReady(page)
    const mapEl = mapElement(page)
    await scenarioToggle(page)
      .getByRole('button', { name: strings.scenario.before, exact: true })
      .click()
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'before')
    await expect(mapEl).toHaveAttribute('data-collapse-culvert', 'open')
    await expect.poll(() => overlayLayers(page)).toContain(COLLAPSE_LAYER_IDS.culvert)
    await expect.poll(() => overlayLayers(page)).not.toContain(COLLAPSE_LAYER_IDS.deposit)
  })

  test('「崩れる前と後を比べる」のボタンが無く、見比べの案内が出る', async ({ page }) => {
    await setup(page, SHIBUYA_URL)
    await openCollapse(page)
    await computeToReady(page)
    await expect(page.getByRole('button', { name: '崩れる前と後を比べる' })).toHaveCount(0)
    await expect(page.getByTestId('collapse-section')).toContainText(t.playbackHint)
  })

  test('閉じると data-collapse-culvert が none になり、collapse-culvert が消える', async ({
    page,
  }) => {
    await setup(page, SHIBUYA_URL)
    await openCollapse(page)
    await computeToReady(page)
    await expect(mapElement(page)).toHaveAttribute('data-collapse-culvert', 'blocked')
    await page
      .getByTestId('collapse-section')
      .getByRole('button', { name: t.close, exact: true })
      .click()
    await expect(mapElement(page)).toHaveAttribute('data-collapse-culvert', 'none')
    await expect.poll(() => overlayLayers(page)).not.toContain(COLLAPSE_LAYER_IDS.culvert)
  })

  test('崩れた後を表示中に別の地点を選ぶと、閉じて崩れる前の地形に戻る', async ({ page }) => {
    await setup(page, SHIBUYA_URL)
    await openCollapse(page)
    await computeToReady(page)
    const mapEl = mapElement(page)
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'after')
    // 範囲の外をクリックして「ここを新しい地点にする」を押す
    await clickMap(page, 0.1, 0.5)
    await page.getByRole('button', { name: strings.cellInfo.newPoint }).click()
    await expect(page.getByTestId('collapse-section')).toHaveCount(0)
    await expect(scenarioToggle(page)).toHaveCount(0)
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'before')
    await expect.poll(() => overlayLayers(page)).not.toContain(COLLAPSE_LAYER_IDS.deposit)
  })
})

test.describe('盛土が崩れたらの 3D（spec 10 §7.2）', { tag: '@3d' }, () => {
  test.describe.configure({ timeout: 120_000 })

  test('3D で崩れた後に切り替えると、data-view3d-range-generation が進む', async ({ page }) => {
    await setup(page, SHIBUYA_URL)
    await openCollapse(page)
    await computeToReady(page)
    await switchTo3d(page)
    const mapEl = mapElement(page)
    const generation = async (): Promise<number> =>
      Number((await mapEl.getAttribute('data-view3d-range-generation')) ?? '0')
    const toggle = scenarioToggle(page)
    // 崩れた後を表示中に 3D にした。崩れる前へ切り替えて落ち着いてから基準を取り、崩れた後へ戻す
    await toggle.getByRole('button', { name: strings.scenario.before, exact: true }).click()
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'before')
    await expect(toggle.getByRole('button', { pressed: true })).toHaveText(strings.scenario.before)
    const base = await generation()
    await toggle.getByRole('button', { name: strings.scenario.after, exact: true }).click()
    // 3D の地形が作り直され、崩れた後の積もった土が出る
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'after')
    await expect(mapEl).toHaveAttribute('data-view3d', '3d')
    await expect.poll(generation, { timeout: 60_000 }).toBeGreaterThan(base)
    await expect
      .poll(() => overlayLayers(page, 'data-visible-overlay-layers'), { timeout: 60_000 })
      .toContain(COLLAPSE_LAYER_IDS.deposit)
  })
})
