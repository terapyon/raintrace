import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { COLLAPSE_LAYER_IDS } from '../../src/map/layerIds'
import { strings } from '../../src/ui/strings'
import { acknowledgeDisclaimer, clickMap, mapElement, switchTo3d, waitTerrain } from './support/app'
import { encodeDemPng, type GsiScenario, routeGsi } from './support/gsi'

const SHIBUYA = { lat: 35.658, lon: 139.7016 }
const SHIBUYA_URL = `/?lat=${SHIBUYA.lat.toFixed(6)}&lon=${SHIBUYA.lon.toFixed(6)}`
/** 雨は短く（最短の 10 分）・範囲は 250 m・半径は小さく。比べる計算を速くする */
const FAST_RAIN_URL = `${SHIBUYA_URL}&size=250&mmh=30&dur=10&all=0&r=40`
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
 * 南へ流れる谷。中央の列（地点の経度）が低く、両側が 5% の勾配で上がり、南へ緩やかに下る。
 * withPlatform なら、谷の上流（北）側の東の斜面に +15 m の台（z17 で 64 × 64 画素。範囲の 25% 未満）
 * 位置は z17 の画素で決めて、DEM10B（z14）の画素にも同じ地形を当てる
 */
function valleyElevation(withPlatform: boolean) {
  const origin = worldPixel(17)
  return (z: number, tileX: number, tileY: number) => (px: number, py: number) => {
    const scale = 2 ** (17 - z)
    const u = (tileX * 256 + px + 0.5) * scale - origin.u
    const v = (tileY * 256 + py + 0.5) * scale - origin.v
    const base = 30 + 0.05 * Math.abs(u) - 0.02 * v
    const onPlatform = u >= 30 && u < 94 && v >= -96 && v < -32
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

const overlayLayers = async (page: Page): Promise<string[]> =>
  (await mapElement(page).getAttribute('data-overlay-layers'))?.split(',') ?? []

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
    // せき止めは「N か所」または「ありません」のどちらかの行が出る
    await expect(result).toContainText(/せき止められた場所/)
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

  test('「崩れる前と後を比べる」→ 比べた表が出る（雨は短く・半径を小さく）', async ({ page }) => {
    test.setTimeout(120_000)
    await setup(page, FAST_RAIN_URL)
    await openCollapse(page)
    await computeToReady(page)
    await page.getByRole('button', { name: t.compare }).click()
    const table = page.getByTestId('compare-result')
    await expect(table).toBeVisible({ timeout: 90_000 })
    await expect(table.getByRole('columnheader', { name: t.table.before })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: t.table.after })).toBeVisible()
    await expect(table).toContainText(t.table.maxDepth)
    await expect(table).toContainText(t.table.storedWater)
    await expect(page.getByTestId('compare-progress')).toHaveCount(0)
  })

  test('比べる計算を途中で中止できる', async ({ page }) => {
    test.setTimeout(120_000)
    await setup(page, FAST_RAIN_URL)
    await openCollapse(page)
    await computeToReady(page)
    await page.getByRole('button', { name: t.compare }).click()
    const progress = page.getByTestId('compare-progress')
    await expect(progress).toBeVisible()
    await progress.getByRole('button', { name: t.cancel, exact: true }).click()
    await expect(progress).toHaveCount(0)
    await expect(page.getByRole('button', { name: t.compare })).toBeVisible()
    await expect(page.getByTestId('compare-result')).toHaveCount(0)
    await expect(page.getByText(t.compareFailed)).toHaveCount(0)
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
    // 崩れた後を表示中に 3D にした。崩れる前へ切り替えて落ち着いてから基準を取り、崩れた後へ戻して
    // 3D の地形が作り直されることを見る
    await toggle.getByRole('button', { name: strings.scenario.before, exact: true }).click()
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'before')
    await expect(toggle.getByRole('button', { pressed: true })).toHaveText(strings.scenario.before)
    await expect.poll(generation, { timeout: 60_000 }).toBeGreaterThan(0)
    const base = await generation()
    await toggle.getByRole('button', { name: strings.scenario.after, exact: true }).click()
    await expect(mapEl).toHaveAttribute('data-collapse-view', 'after')
    await expect.poll(generation, { timeout: 60_000 }).toBeGreaterThan(base)
  })
})
