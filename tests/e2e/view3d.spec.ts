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
import { decodePng, waterColoredFraction } from './support/png'

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

  test('3D で降雨を始めると水面が出て、2D の水深の canvas は隠れる。three は 3D に切り替えてから読む。2D に戻すと元に戻る', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const warnings = collectWarnings(page)
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    expect(requested.some((url) => /\/assets\/three-/.test(url))).toBe(false)
    await switchTo3d(page)
    await page.getByRole('button', { name: strings.playback.start }).click()
    const mapEl = mapElement(page)
    await expect(mapEl).toHaveAttribute(
      'data-visible-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.water),
      { timeout: 30_000 },
    )
    expect(requested.some((url) => /\/assets\/three-/.test(url))).toBe(true)
    const visible3d = (await mapEl.getAttribute('data-visible-overlay-layers'))?.split(',') ?? []
    expect(visible3d).not.toContain(WATER_LAYER_IDS.water)
    expect(visible3d).toContain(WATER_LAYER_IDS.arrows)
    await page.getByRole('button', { name: strings.view3d.view2d }).click()
    await expect(mapEl).toHaveAttribute('data-view3d', 'off')
    await expect
      .poll(async () => (await mapEl.getAttribute('data-visible-overlay-layers'))?.split(',') ?? [])
      .toContain(WATER_LAYER_IDS.water)
    expect((await mapEl.getAttribute('data-overlay-layers'))?.split(',')).not.toContain(
      VIEW3D_LAYER_IDS.water,
    )
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  test('3D で強い降雨をすると、範囲の中心付近の画素が実際に水の配色へ変わる（Task 8 の申し送り。着手前の確かめ P6 の probe の常設化）', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // 500 mm・半径 200 m（範囲 500 m 四方の 4 分の 1 の円）は着手前の確かめ P6 と同じ強さ。水面の面積が
    // 画素で判定できるほど広がる（P6: 既定の 100mm・10m では潜水面積が範囲の 0.26% しかなく判定できなかった）
    await page.goto(`${SHIBUYA}&mm=500&r=200`)
    await waitTerrain(page)
    // 矢印（濃い青の icon。#0d47a1）は 3D でも描かれ、水の配色の判定を汚すので消しておく。
    // このテストは three の Custom Layer（水面）だけを見る
    await page.getByLabel(strings.panel.showWaterFlow).click()
    await switchTo3d(page)
    const mapEl = mapElement(page)
    const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
    if (box === null) throw new Error('地図の canvas がありません')
    // 3D の視点は範囲の中心を画面の中心に置く（frame。View3d.ts）ので、中心付近の小さな窓だけを見れば
    // 範囲の中心付近を見たことになる。右のパネルや UI から離れた位置（コントローラーの指示 A: 比率で見る）
    const side = Math.min(box.width, box.height) * 0.25
    const clip = {
      x: box.x + box.width / 2 - side / 2,
      y: box.y + box.height / 2 - side / 2,
      width: side,
      height: side,
    }
    const before = waterColoredFraction(decodePng(await page.screenshot({ clip })))

    await page.getByRole('button', { name: strings.playback.max, exact: true }).click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect(mapEl).toHaveAttribute(
      'data-visible-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.water),
      { timeout: 30_000 },
    )
    // 冠水した面積が範囲（500 m 四方 = 250,000 m²）の 20% を超えるまで待つ。実測では雨を強くした直後
    // （1 秒未満）に到達し、そのまま 140,000〜150,000 m² 前後で安定する
    await expect
      .poll(
        async () => {
          const text = (await page.getByTestId('stat-flooded-area').textContent()) ?? ''
          return Number(text.replace(/[^0-9.]/g, ''))
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(50_000)

    const after = waterColoredFraction(decodePng(await page.screenshot({ clip })))
    // 実測（本タスク、3 回）: before は 0、after は 0.855〜0.859。シェーダを discard させると after も 0 になる
    // （報告に記録）。しきい値は大きな余裕を取っている
    expect(before).toBeLessThan(0.05)
    expect(after - before).toBeGreaterThan(0.3)
  })
})
