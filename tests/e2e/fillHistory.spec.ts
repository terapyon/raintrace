import { readFileSync } from 'node:fs'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { FILL_LAYER_IDS } from '../../src/map/layerIds'
import { VIEW3D_LAYER_IDS } from '../../src/map/view3d/layerIds'
import { strings } from '../../src/ui/strings'
import { acknowledgeDisclaimer, mapElement, switchTo3d, waitTerrain } from './support/app'
import { encodeDemPng, type GsiScenario, routeGsi } from './support/gsi'

const SHIBUYA = { lat: 35.658, lon: 139.7016 }
const SHIBUYA_URL = `/?lat=${SHIBUYA.lat.toFixed(6)}&lon=${SHIBUYA.lon.toFixed(6)}`
const t = strings.fillHistory

const a54Fixture = readFileSync(new URL('../fixtures/fill/a54.json', import.meta.url), 'utf8')

/** 経緯度を含む A54 のタイル（ズーム 10）の番号 */
function a54TileOf(lat: number, lon: number): { x: number; y: number } {
  const n = 2 ** 10
  const rad = (lat * Math.PI) / 180
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  }
}

/** 標高 10 m の平面。各タイルの中央 64 × 64 画素だけ 30 m の台（セルの 25% 未満なので中央値のずれは 0） */
const platformTile = encodeDemPng(256, 256, (x, y) =>
  x >= 96 && x < 160 && y >= 96 && y < 160 ? 30 : 10,
)
const flatTile = encodeDemPng(256, 256, () => 10)

/** 今は DEM1A（台つき）、昔は平面の DEM10B。人工地形は盛土地 */
const FILL_SCENARIO: GsiScenario = {
  dem1a: platformTile,
  dem5: 'missing',
  demPng: flatTile,
  landform: 'fill',
}

/** 範囲にかかる A54 のタイルにだけ fixture を返す（Worker の要求も捕まえるため context で差し替える） */
async function routeA54(page: Page): Promise<void> {
  const tile = a54TileOf(SHIBUYA.lat, SHIBUYA.lon)
  await page.context().route('**/data/a54/**', (route) => {
    const { pathname } = new URL(route.request().url())
    if (pathname === `/data/a54/10/${tile.x}/${tile.y}.json`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: a54Fixture,
      })
    }
    return route.fulfill({ status: 404, body: 'not found' })
  })
}

async function setup(page: Page, scenario: GsiScenario = FILL_SCENARIO): Promise<void> {
  await routeGsi(page.context(), scenario)
  await routeA54(page)
  await acknowledgeDisclaimer(page.context())
  await page.goto(SHIBUYA_URL)
}

/**
 * 経緯度を含む DEM1A のタイル（ズーム 17）の中心（台の中心）が、その経緯度から画面で何 px ずれるか。
 * MapLibre のズーム z では世界の幅が 512 × 2^z px
 */
function platformCenterOffsetPx(
  lat: number,
  lon: number,
  zoom: number,
): { dx: number; dy: number } {
  const worldPx = 512 * 2 ** zoom
  const toWorld = (la: number, lo: number) => {
    const rad = (la * Math.PI) / 180
    return {
      x: ((lo + 180) / 360) * worldPx,
      y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * worldPx,
    }
  }
  const here = toWorld(lat, lon)
  const tile = 2 ** 17
  const tileSize = worldPx / tile
  return {
    dx: (Math.floor(here.x / tileSize) + 0.5) * tileSize - here.x,
    dy: (Math.floor(here.y / tileSize) + 0.5) * tileSize - here.y,
  }
}

/**
 * URL の経緯度で選んだ地点の地形が出てから、盛土の履歴をオンにする。地図をクリックしない（セル情報の
 * ポップオーバーが開くと、MUI が残りの画面を aria-hidden にして getByRole で見つからなくなる）
 */
async function enableFillHistory(page: Page): Promise<void> {
  await waitTerrain(page)
  await page.getByLabel(t.enable, { exact: true }).check()
}

const layersOf = async (element: Locator, name: string): Promise<string[]> =>
  (await element.getAttribute(name))?.split(',') ?? []

test.describe('盛土の履歴（spec 09 §7.2）', () => {
  test('オンにすると標高差のレイヤーと一覧が出て、行を押すと詳しい欄が開く', async ({ page }) => {
    await setup(page)
    await waitTerrain(page)
    const mapEl = mapElement(page)
    await expect(mapEl).not.toHaveAttribute('data-overlay-layers', new RegExp(FILL_LAYER_IDS.delta))
    await enableFillHistory(page)
    await expect(mapEl).toHaveAttribute('data-overlay-layers', new RegExp(FILL_LAYER_IDS.delta))
    const row = page.getByTestId('fill-row-1')
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText(t.evidence.strong)
    await expect(page.getByTestId('fill-detail')).toHaveCount(0)
    await row.click()
    const detail = page.getByTestId('fill-detail')
    await expect(detail).toBeVisible()
    await expect(detail).toContainText(t.evidence.strong)
    await expect(detail).toContainText(t.a54Overlap(t.a54Types.valley))
    await expect(detail).toContainText(t.landformOverlap)
    // 詳しい欄は押した行の <li> の中に出る
    await expect(page.locator('li', { has: row }).getByTestId('fill-detail')).toBeVisible()
  })

  test('地図の候補の印を押すと、セル情報ではなく、その候補が選ばれる', async ({ page }) => {
    await setup(page)
    await enableFillHistory(page)
    await expect(page.getByTestId('fill-row-1')).toBeVisible({ timeout: 30_000 })
    await expect(mapElement(page)).toHaveAttribute(
      'data-overlay-layers',
      new RegExp(FILL_LAYER_IDS.markers),
    )
    await expect(page.locator('[aria-pressed="true"][data-testid^="fill-row-"]')).toHaveCount(0)
    // 範囲に合わせた拡大率は URL の z に書かれる。選んだ地点のピン（先端が地点）から印の画面の位置を計算する
    await expect(page).toHaveURL(/[?&]z=\d/)
    const zoom = Number(new URL(page.url()).searchParams.get('z'))
    const pin = await page.locator('.maplibregl-marker').boundingBox()
    if (pin === null) throw new Error('地点のピンがありません')
    // 選んだ地点を含む DEM1A のタイルの台の中心（タイルの中央）に、候補の印がある
    const marker = platformCenterOffsetPx(SHIBUYA.lat, SHIBUYA.lon, zoom)
    const cx = pin.x + pin.width / 2
    const cy = pin.y + pin.height
    await page.mouse.click(cx + marker.dx, cy + marker.dy)
    // 印を押した処理が候補を選ぶ。その処理はセル情報を開かずに戻る（開くなら同じ処理の中で開く）
    await expect(page.getByTestId('fill-detail')).toBeVisible()
    await expect(page.locator('[aria-pressed="true"][data-testid^="fill-row-"]')).toHaveCount(1)
    await expect(page.getByTestId('cell-info')).toHaveCount(0)
    // 対照: 印の無い所を押せば、セル情報が開く
    await page.mouse.click(cx + marker.dx, cy + marker.dy + 120)
    await expect(page.getByTestId('cell-info')).toBeVisible()
  })

  test('今の地形が DEM10B の範囲では、比べられないと知らせる', async ({ page }) => {
    await setup(page, { dem1a: 'missing', dem5: 'missing', demPng: flatTile })
    await enableFillHistory(page)
    await expect(page.getByText(t.unavailable)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('fill-row-1')).toHaveCount(0)
  })

  test('人工地形の取得が失敗しても、一覧は出て、失敗の知らせが出る', async ({ page }) => {
    await setup(page, { ...FILL_SCENARIO, landform: 'error' })
    await enableFillHistory(page)
    await expect(page.getByTestId('fill-row-1')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(t.landformFailed)).toBeVisible()
  })

  test('出典に「加工して RainTrace が作成」と、オンのとき A54 の出典が出る', async ({ page }) => {
    await setup(page)
    await waitTerrain(page)
    const attribution = page.locator('.maplibregl-ctrl-attrib')
    await expect(attribution).toContainText(strings.attribution.note)
    await expect(attribution).not.toContainText(t.a54Attribution)
    await expect(attribution).not.toContainText(t.landformAttribution)
    await page.getByLabel(t.enable, { exact: true }).check()
    await expect(page.getByTestId('fill-row-1')).toBeVisible({ timeout: 30_000 })
    await expect(attribution).toContainText(strings.attribution.note)
    await expect(attribution).toContainText(t.a54Attribution)
    await expect(attribution).toContainText(t.landformAttribution)
  })
})

test.describe('盛土の履歴の 3D（spec 09 §4.3）', { tag: '@3d' }, () => {
  test.describe.configure({ timeout: 120_000 })

  test('3D で「昔」にすると水の 3D レイヤーが消え、「今」で戻る', async ({ page }) => {
    await setup(page)
    await enableFillHistory(page)
    await expect(page.getByTestId('fill-row-1')).toBeVisible({ timeout: 30_000 })
    await switchTo3d(page)
    const mapEl = mapElement(page)
    await expect
      .poll(() => layersOf(mapEl, 'data-visible-overlay-layers'), { timeout: 60_000 })
      .toContain(VIEW3D_LAYER_IDS.water)
    const group = page.getByRole('group', { name: strings.epoch.label })
    await group.getByRole('button', { name: strings.epoch.past, exact: true }).click()
    await expect
      .poll(() => layersOf(mapEl, 'data-visible-overlay-layers'), { timeout: 60_000 })
      .not.toContain(VIEW3D_LAYER_IDS.water)
    await group.getByRole('button', { name: strings.epoch.now, exact: true }).click()
    await expect
      .poll(() => layersOf(mapEl, 'data-visible-overlay-layers'), { timeout: 60_000 })
      .toContain(VIEW3D_LAYER_IDS.water)
  })
})
