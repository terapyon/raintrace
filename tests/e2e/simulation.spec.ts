import { expect, test } from '@playwright/test'
import { TERRAIN_LAYER_IDS } from '../../src/map/TerrainOverlay'
import { WATER_LAYER_IDS } from '../../src/map/WaterOverlay'
import { strings } from '../../src/ui/strings'
import { acknowledgeDisclaimer, clickMap, collectErrors, tabTo, waitTerrain } from './support/app'
import { routeGsi } from './support/gsi'

const SHIBUYA = '/?lat=35.658000&lon=139.701600'
/** ダークのときに <html> に付くクラス（Task 10 Step 5 で実ブラウザで確かめた名前。違えばここを直す） */
const DARK_CLASS = 'dark'
// MapController が render のたびに data-overlay-layers へ書く並びと同じ（レビュー指摘の修正・fix round 1）。
// data-range-shown は addAll が立てるだけで setStyle で消えても消されないため、ベースマップの切り替えで
// レイヤーが戻っているかの確かめには使えない。map.getLayer() で今のスタイルの実物を数えたこの印を使う
const OVERLAY_LAYER_IDS = [
  ...Object.values(TERRAIN_LAYER_IDS),
  ...Object.values(WATER_LAYER_IDS),
].join(',')
// 2D の重ね描きの下から上への重なり順（src/map/layerIds.ts の OVERLAY_LAYER_ORDER から 3D のレイヤーを抜いた並び）。
// 地形の重ね描きは複数のタスクに分けて足すので、足す順ではなくこの並びで重なることを確かめる（spec 06 Task 17）
const OVERLAY_ORDER_2D = [
  TERRAIN_LAYER_IDS.elevation,
  TERRAIN_LAYER_IDS.depressions,
  WATER_LAYER_IDS.water,
  TERRAIN_LAYER_IDS.outline,
  TERRAIN_LAYER_IDS.flow,
  WATER_LAYER_IDS.arrows,
  TERRAIN_LAYER_IDS.markers,
].join(',')

test.describe('降雨と再生（spec 04 §11.2 の 4・5）', () => {
  test.beforeEach(async ({ context }) => {
    await routeGsi(context)
    await acknowledgeDisclaimer(context)
  })

  test('既定の設定（100mm・10m）で開始すると、投入水量が「31.4 m³」になり、Step が進む', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
    await page.getByRole('button', { name: strings.playback.start }).click()
    // 実タイルの範囲は円の中がすべて有効セルなので、πr² × 雨量のまま（R04-8）
    await expect(page.getByTestId('stat-total')).toHaveText('31.4 m³')
    await expect(page.getByTestId('stat-step')).not.toHaveText('Step 0')
    expect(errors).toEqual([])
  })

  test('地形を読み込むと、重ね描きのレイヤーが固定の並び（標高・窪地・水深・枠・流向・矢印・最低点）の順に重なる', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const mapEl = page.locator('[data-map-loaded="true"]')
    await expect(mapEl).toHaveAttribute('data-overlay-layers', OVERLAY_LAYER_IDS)
    await expect(mapEl).toHaveAttribute('data-overlay-order', OVERLAY_ORDER_2D)
  })

  test('Reset で、投入水量が 0 に、Step が 0 に戻り、もう一度開始すると新しい実行が進む', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect(page.getByTestId('stat-total')).toHaveText('31.4 m³')
    // 降雨中心のすぐ南のセルを開き、水があることを確かめておく（マーカーの画像は下端が地点）。
    // ポップオーバー（MUI の Modal）が開いている間はパネルが読み上げの木から外れるので、見たら閉じる
    const marker = await page.locator('.maplibregl-marker').boundingBox()
    if (marker === null) throw new Error('マーカーがありません')
    const nearCenter = { x: marker.x + marker.width / 2, y: marker.y + marker.height + 4 }
    await page.mouse.click(nearCenter.x, nearCenter.y)
    await expect(page.getByTestId('cell-depth')).not.toHaveText('0.00 m')
    await page.getByRole('button', { name: strings.cellInfo.close }).click()
    await page.getByRole('button', { name: strings.playback.reset }).click()
    await expect(page.getByTestId('stat-total')).toHaveText('0.00 m³')
    await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
    await expect(page.getByLabel(strings.rainfall.amount)).toBeEnabled()
    // セル情報は SimulationClient の手元の水深を読む。client は runId に関わらず届いた frame の水深を持つので、
    // Worker が reset を処理して step 0 の frame（水深 0）を送ったときだけ 0 になる。Worker が reset を無視して
    // 前の実行を続けると、session が捨てる frame の水が残り、ここで落ちる（最終レビューの重要な指摘）
    await page.mouse.click(nearCenter.x, nearCenter.y)
    await expect(page.getByTestId('cell-depth')).toHaveText('0.00 m')
    await page.getByRole('button', { name: strings.cellInfo.close }).click()
    // 上の 0 は Reset を押した時点でストアが出すので、Worker が reset を処理した後の実行が進むかは分からない。
    // もう一度開始し、新しい runId の frame が届いて統計が進むことを確かめる（runId の食い違い・バッファの
    // 取りこぼしがあると frame が捨てられ、0 のまま止まる）。前の実行の水が残っていれば 31.4 にならない
    // （最終レビューの重要な指摘）
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect(page.getByTestId('stat-total')).toHaveText('31.4 m³')
    await expect(page.getByTestId('stat-step')).not.toHaveText('Step 0')
  })
})

test('免責ダイアログは初回だけ表示される（spec 04 §11.2 の 6）', async ({ page, context }) => {
  await routeGsi(context)
  await page.goto('/')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(strings.disclaimer.lines[0])
  await page.getByRole('button', { name: strings.disclaimer.acknowledge }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('disclaimer-notice')).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-map-loaded="true"]')).toBeAttached()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test.describe('URL と設定（spec 04 §7）', () => {
  test.beforeEach(async ({ context }) => {
    await routeGsi(context)
    await acknowledgeDisclaimer(context)
  })

  test('?mm=50&r=20 を付けて開くと、入力欄にその値が入っている（§11.2 の 7）', async ({ page }) => {
    await page.goto(`${SHIBUYA}&mm=50&r=20`)
    await expect(page.getByLabel(strings.rainfall.amount)).toHaveValue('50')
    await expect(page.getByLabel(strings.rainfall.radius)).toHaveValue('20')
    await waitTerrain(page)
    await expect(page).toHaveURL(/size=500&mm=50&r=20/)
  })

  test('変えた雨量は localStorage に保存され、URL に無くても次に開いたときに入っている', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await page.getByLabel(strings.rainfall.amount).fill('80')
    await expect(page).toHaveURL(/mm=80/)
    await page.goto('/')
    await expect(page.getByLabel(strings.rainfall.amount)).toHaveValue('80')
  })

  test('範囲の大きさを 250 m にすると、読み込み直して URL に size=250 が入る', async ({ page }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await page.getByRole('button', { name: strings.rainfall.rangeSizeValue(250) }).click()
    await waitTerrain(page)
    await expect(page).toHaveURL(/size=250/)
    await expect(page.getByTestId('panel')).toContainText(strings.panel.rangeValue(250))
  })
})

test.describe('地図のクリック（spec 04 §4、R04-1）', () => {
  test.beforeEach(async ({ context }) => {
    await routeGsi(context)
    await acknowledgeDisclaimer(context)
  })

  test('範囲内をクリックするとセル情報が開き、「ここを降雨中心にする」で範囲が読み込み直される（§11.2 の 8）', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const before = await page.getByTestId('selected-point').textContent()
    // fitBounds の後、範囲は画面の中央の正方形（1280 × 720 なら横 320〜960）。右のパネルに隠れない位置
    await clickMap(page, 0.4, 0.4)
    await expect(page.getByTestId('cell-info')).toBeVisible()
    await expect(page.getByTestId('cell-elevation')).toHaveText(/^\d+\.\d{2} m$/)
    await expect(page.getByTestId('cell-depth')).toHaveText('0.00 m')
    // ポップオーバーは背景を持たないので、開いたまま範囲の別の場所（ポップオーバーの左上の外）をクリックすると、
    // そこに開き直す（Task 8。384 × 216 は範囲の中）
    const first = await page.getByTestId('cell-info').boundingBox()
    await clickMap(page, 0.3, 0.3)
    await expect
      .poll(async () => (await page.getByTestId('cell-info').boundingBox())?.x ?? 0)
      .toBeLessThan((first?.x ?? 0) - 50)
    await page.getByRole('button', { name: strings.cellInfo.useAsCenter }).click()
    await expect(page.getByTestId('selected-point')).not.toHaveText(before ?? '')
    await waitTerrain(page)
  })

  test('範囲の外をクリックすると「ここを新しい地点にする」だけが出て、押すとその地点を読み込む', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const before = await page.getByTestId('selected-point').textContent()
    await clickMap(page, 0.1, 0.5)
    await expect(page.getByTestId('cell-elevation')).toHaveCount(0)
    await page.getByRole('button', { name: strings.cellInfo.newPoint }).click()
    await expect(page.getByTestId('selected-point')).not.toHaveText(before ?? '')
    await waitTerrain(page)
  })

  test('降雨マーカーをドラッグして離すと、その位置が新しい地点になる', async ({ page }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const before = await page.getByTestId('selected-point').textContent()
    const box = await page.locator('.maplibregl-marker').boundingBox()
    if (box === null) throw new Error('マーカーがありません')
    // マーカーの画像は下端が地点。少し上をつかむ
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 + 40, { steps: 10 })
    await page.mouse.up()
    await expect(page.getByTestId('selected-point')).not.toHaveText(before ?? '')
    await waitTerrain(page)
  })
})

test('キーボードだけで、雨量・半径の入力から Start・Pause・Reset まで操作できる（§11.2 の 9、tech-spec §9.5）', async ({
  page,
  context,
}) => {
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  // 起点として雨量の入力欄に焦点を置く。ここから先はキーボードだけ
  const amount = page.getByLabel(strings.rainfall.amount)
  await amount.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('120')
  await tabTo(page, page.getByLabel(strings.rainfall.radius))
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('15')
  const primary = page.getByRole('button', { name: strings.playback.start })
  await tabTo(page, primary)
  await page.keyboard.press('Enter')
  // 120mm・半径 15m: π × 15² × 0.12 = 84.8 m³
  await expect(page.getByTestId('stat-total')).toHaveText('84.8 m³')
  // 同じボタンが「一時停止」になり、焦点は外れない
  await expect(page.getByRole('button', { name: strings.playback.pause })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: strings.playback.resume })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: strings.playback.reset }))
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
  await expect(page.getByTestId('stat-total')).toHaveText('0.00 m³')
})

test.describe('表示の設定（spec 04 §2）', () => {
  test('ベースマップを写真に切り替えると写真のタイルを読み、範囲の重ね描きが残り、エラーが出ない', async ({
    page,
    context,
  }) => {
    const counts = await routeGsi(context)
    await acknowledgeDisclaimer(context)
    const errors = collectErrors(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const mapEl = page.locator('[data-map-loaded="true"]')
    await page.getByRole('button', { name: strings.playback.start }).click()
    await page.getByRole('button', { name: strings.map.basemaps.photo }).click()
    await expect.poll(() => counts.photo).toBeGreaterThan(0)
    // data-range-shown は addAll が立てるだけで setStyle で消えても消されないので、
    // 切り替え後にレイヤーが本当に戻っているかは map.getLayer() の実物を数えた印で確かめる
    await expect(mapEl).toHaveAttribute('data-basemap', 'photo')
    await expect(mapEl).toHaveAttribute('data-overlay-layers', OVERLAY_LAYER_IDS)
    await expect(mapEl).toHaveAttribute('data-overlay-order', OVERLAY_ORDER_2D)
    await page.getByRole('button', { name: strings.map.basemaps.std }).click()
    await expect.poll(() => counts.std).toBeGreaterThan(0)
    await expect(mapEl).toHaveAttribute('data-basemap', 'std')
    await expect(mapEl).toHaveAttribute('data-overlay-layers', OVERLAY_LAYER_IDS)
    // 切り替えの後も、表示の切り替えが効く（消えたレイヤーを足し直している）
    await page.getByLabel(strings.panel.showWaterFlow).click()
    await page.getByLabel(strings.panel.showElevation).click()
    expect(errors).toEqual([])
  })

  test('ベースマップを続けて素早く切り替えても、最後の切り替え先の重ね描きが残り、エラーが出ない', async ({
    page,
    context,
  }) => {
    const counts = await routeGsi(context)
    await acknowledgeDisclaimer(context)
    const errors = collectErrors(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const mapEl = page.locator('[data-map-loaded="true"]')
    // 既定は「淡色」なので、まず「標準」に切り替え、その style.load を待たずに続けて「写真」へ切り替える
    await page.getByRole('button', { name: strings.map.basemaps.std }).click()
    await page.getByRole('button', { name: strings.map.basemaps.photo }).click()
    await expect.poll(() => counts.photo).toBeGreaterThan(0)
    await expect(mapEl).toHaveAttribute('data-basemap', 'photo')
    await expect(mapEl).toHaveAttribute('data-overlay-layers', OVERLAY_LAYER_IDS)
    expect(errors).toEqual([])
  })

  test('テーマをダークにすると、画面の配色が変わり、再読み込みしても残る', async ({
    page,
    context,
  }) => {
    await routeGsi(context)
    await acknowledgeDisclaimer(context)
    await page.goto('/')
    await page.getByRole('button', { name: strings.map.themes.dark }).click()
    // toContainClass はクラスを語として比べる（/\bdark\b/ の正規表現は 'mode-dark' にも当たるので使わない）
    await expect(page.locator('html')).toContainClass(DARK_CLASS)
    await page.reload()
    await expect(page.locator('html')).toContainClass(DARK_CLASS)
  })
})
