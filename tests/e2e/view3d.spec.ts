import { expect, type Locator, type Page, test } from '@playwright/test'
import { drawnTileZoomForView, MIN_3D_DRAWN_TILE_ZOOM } from '../../src/map/view3d/drawnZoom'
import { VIEW3D_LAYER_IDS } from '../../src/map/view3d/layerIds'
import { WATER_LAYER_IDS } from '../../src/map/WaterOverlay'
import { strings } from '../../src/ui/strings'
import {
  acknowledgeDisclaimer,
  clickMap,
  collectErrors,
  collectWarnings,
  waitTerrain,
} from './support/app'
import { routeGsi } from './support/gsi'

const SHIBUYA = '/?lat=35.658000&lon=139.701600'

const mapElement = (page: Page): Locator => page.locator('[data-map-loaded="true"]')

const layersOf = async (element: Locator, name: string): Promise<string[]> =>
  (await element.getAttribute(name))?.split(',') ?? []

/** パネルの「3D」を押し、3D の視点へ動き終えるまで待つ（SwiftShader では地形の用意に数秒かかる） */
async function switchTo3d(page: Page): Promise<void> {
  await page.getByRole('button', { name: strings.view3d.view3d, exact: true }).click()
  await expect(mapElement(page)).toHaveAttribute('data-view3d', '3d', { timeout: 30_000 })
  await expect(mapElement(page)).toHaveAttribute('data-view3d-framed', 'true', { timeout: 30_000 })
}

test.describe('3D の表示（spec 05 §5）', () => {
  // 一部のテストは 30 秒までの per-assertion wait を複数重ねる。Playwright の既定のテストの timeout
  // （30 秒）はそれより短いので、SwiftShader の遅い CI でも収まるよう引き上げる（着手前の検査 P8 の許容。
  // Task 4 の申し送りの反映）
  test.describe.configure({ timeout: 60_000 })

  test.beforeEach(async ({ context }) => {
    await routeGsi(context)
    await acknowledgeDisclaimer(context)
  })

  test('3D に切り替えると地形と hillshade が出て、2D の水深の canvas は隠れ、コンソールにエラーと警告が出ず、2D に戻せる', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const warnings = collectWarnings(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await switchTo3d(page)
    const mapEl = mapElement(page)
    await expect(mapEl).toHaveAttribute(
      'data-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.hillshade),
    )
    await expect
      .poll(() => layersOf(mapEl, 'data-visible-overlay-layers'))
      .not.toContain(WATER_LAYER_IDS.water)
    // 画面の中心で描かれている地形タイルのズーム（実測）は、境界以上
    await expect(mapEl).toHaveAttribute('data-drawn-tile-zoom', /^\d+$/, { timeout: 30_000 })
    expect(Number(await mapEl.getAttribute('data-drawn-tile-zoom'))).toBeGreaterThanOrEqual(
      MIN_3D_DRAWN_TILE_ZOOM,
    )
    await page.getByRole('button', { name: strings.view3d.view2d, exact: true }).click()
    await expect(mapEl).toHaveAttribute('data-view3d', 'off')
    await expect(mapEl).not.toHaveAttribute(
      'data-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.hillshade),
    )
    await expect
      .poll(() => layersOf(mapEl, 'data-visible-overlay-layers'))
      .toContain(WATER_LAYER_IDS.water)
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  test('3D の視点の画面の中心で、描かれる地形タイルのズームの実測が pitch つきの見込みより粗くない（計画で決めたこと 3）', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await switchTo3d(page)
    // 見込みは画面の中心のタイルの近似で、粗い側にだけ外れる（Task 3）。実測は見込みと同じか細かい
    // （pitch 85 では 2 段細かいこともある）
    await expect
      .poll(
        async () => {
          const el = mapElement(page)
          const { drawnTileZoom, mapZoom, mapPitch } = await el.evaluate((element) => ({
            ...(element as HTMLElement).dataset,
          }))
          if (drawnTileZoom === undefined || mapZoom === undefined || mapPitch === undefined) {
            return 'まだ'
          }
          const predicted = drawnTileZoomForView(Number(mapZoom), Number(mapPitch))
          const measured = Number(drawnTileZoom)
          return measured >= predicted
            ? '合う'
            : `実測 ${drawnTileZoom}・見込み ${predicted}（z ${mapZoom}・pitch ${mapPitch}）`
        },
        { timeout: 30_000 },
      )
      .toBe('合う')
  })

  test('3D で範囲内をクリックするとセル情報が開く（unproject。spec 05 §3.5・§4.1）', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await switchTo3d(page)
    await expect(mapElement(page)).toHaveAttribute('data-drawn-tile-zoom', /\d/, {
      timeout: 30_000,
    })
    // 3D の視点の中心は範囲の中心。右のパネルに隠れない、中心の少し手前をクリックする
    await clickMap(page, 0.5, 0.55)
    await expect(page.getByTestId('cell-info')).toBeVisible()
    await expect(page.getByTestId('cell-elevation')).toHaveText(/^\d+\.\d{2} m$/)
  })
})
