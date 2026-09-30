import { expect, type Page, test } from '@playwright/test'
import { TERRAIN_LAYER_IDS } from '../../src/map/TerrainOverlay'
import { WATER_LAYER_IDS } from '../../src/map/WaterOverlay'
import { strings } from '../../src/ui/strings'
import {
  acknowledgeDisclaimer,
  clickMap,
  collectErrors,
  nextFrames,
  tabTo,
  waitTerrain,
} from './support/app'
import { routeGsi } from './support/gsi'
import { clearOfMarkers, findAllMarkers } from './support/markers'

const SHIBUYA = '/?lat=35.658000&lon=139.701600'

/** 「降雨中（残り …）」（spec 08 §6.2） */
const RAINING = new RegExp(strings.stats.raining('.+'))

/** 「60 mm / 200 mm」の降った量（mm） */
async function fallenMm(page: Page): Promise<number> {
  const text = (await page.getByTestId('stat-rain-depth').textContent()) ?? ''
  return Number(/^(\d+) mm/.exec(text)?.[1] ?? Number.NaN)
}

/** 「1234.5 m³」の数 */
async function volumeM3(page: Page): Promise<number> {
  const text = (await page.getByTestId('stat-total').textContent()) ?? ''
  return Number(text.replace(/[^0-9.]/g, ''))
}

/** 一時停止の後、表示中の step が動かなくなるまで待って返す（最後の frame が届くまで） */
async function stableStep(page: Page): Promise<number> {
  const read = async (): Promise<number> =>
    Number(/Step (\d+)/.exec((await page.getByTestId('stat-step').textContent()) ?? '')?.[1])
  let last = -1
  await expect
    .poll(
      async () => {
        const previous = last
        last = await read()
        return last === previous
      },
      { timeout: 10_000, intervals: [300] },
    )
    .toBe(true)
  return last
}

/**
 * 降雨マーカーの下（マーカーの画像の下端が地点）の近くで、水深が 0.00 m でないセルを探して、その画面の位置を返す
 * （セル情報のポップオーバーで読む）。マーカーの画像に当たらないよう、下端より下だけを試す
 */
async function findWetPoint(page: Page): Promise<{ x: number; y: number }> {
  const marker = await page.locator('.maplibregl-marker').boundingBox()
  if (marker === null) throw new Error('マーカーがありません')
  const base = { x: marker.x + marker.width / 2, y: marker.y + marker.height }
  const offsets = [
    [0, 4],
    [20, 4],
    [-20, 4],
    [0, 24],
    [20, 24],
    [-20, 24],
    [0, 44],
    [40, 4],
    [-40, 4],
  ] as const
  for (const [dx, dy] of offsets) {
    const p = { x: base.x + dx, y: base.y + dy }
    await page.mouse.click(p.x, p.y)
    const depth = page.getByTestId('cell-depth')
    await expect(depth).toBeVisible()
    const text = await depth.textContent()
    await page.getByRole('button', { name: strings.cellInfo.close }).click()
    if (text !== '0.00 m') return p
  }
  throw new Error('マーカーの近くに水のあるセルが見つかりません')
}
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
  WATER_LAYER_IDS.outflow,
  TERRAIN_LAYER_IDS.outline,
  TERRAIN_LAYER_IDS.flow,
  WATER_LAYER_IDS.arrows,
  TERRAIN_LAYER_IDS.markers,
].join(',')

test.describe('降雨と再生（spec 08 §9.4 の 4・5・10）', () => {
  test.beforeEach(async ({ context }) => {
    await routeGsi(context)
    await acknowledgeDisclaimer(context)
  })

  test('既定の設定（100 mm/h・1 時間・10 m）で開始し、最速にすると経過時間が進んで「降雨中」と出て、雨が終わると「降雨終了」になり、投入水量が「31.4 m³」になる', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const errors = collectErrors(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
    await expect(page.getByTestId('stat-time')).toHaveText(strings.format.seconds(0))
    await page.getByRole('button', { name: strings.playback.max, exact: true }).click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect(page.getByTestId('stat-rain-status')).toHaveText(RAINING)
    await expect(page.getByTestId('stat-time')).not.toHaveText(strings.format.seconds(0))
    await expect(page.getByTestId('stat-rain-status')).toHaveText(strings.stats.rainEnded, {
      timeout: 150_000,
    })
    // 実タイルの範囲は円の中がすべて有効セルなので、I·T·πr² のまま（R04-8）
    await expect(page.getByTestId('stat-total')).toHaveText('31.4 m³')
    await expect(page.getByTestId('stat-rain-depth')).toHaveText(strings.format.rainDepth(100, 100))
    expect(errors).toEqual([])
  })

  test('地形を読み込むと、重ね描きのレイヤーが固定の並び（標高・窪地・水深・流出の帯・枠・流向・矢印・○）の順に重なる', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const mapEl = page.locator('[data-map-loaded="true"]')
    await expect(mapEl).toHaveAttribute('data-overlay-layers', OVERLAY_LAYER_IDS)
    await expect(mapEl).toHaveAttribute('data-overlay-order', OVERLAY_ORDER_2D)
  })

  test('Reset で、投入水量・経過時間・Step が 0 に戻り、もう一度開始すると新しい実行が 0 から進む', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    // 半径 50 m に 300 mm/h。60 倍（既定）で 20 mm 以上降るまで回すと、マーカーの近く（findWetPoint が試す
    // 40 px ≒ 40 m 以内）のどこかに 5 mm 以上の水がある（雨の間の斜面の膜と、低い所の溜まり）
    await page.goto(`${SHIBUYA}&mmh=300&dur=60&r=50`)
    await waitTerrain(page)
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect.poll(() => fallenMm(page), { timeout: 120_000 }).toBeGreaterThanOrEqual(20)
    await page.getByRole('button', { name: strings.playback.pause }).click()
    await stableStep(page)
    const firstTotal = await volumeM3(page)
    // ポップオーバー（MUI の Modal）が開いている間はパネルが読み上げの木から外れるので、見たら閉じる
    const wet = await findWetPoint(page)
    await page.getByRole('button', { name: strings.playback.reset }).click()
    await expect(page.getByTestId('stat-total')).toHaveText('0.00 m³')
    await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
    await expect(page.getByTestId('stat-time')).toHaveText(strings.format.seconds(0))
    await expect(page.getByLabel(strings.rainfall.intensity)).toBeEnabled()
    // セル情報は SimulationClient の手元の水深を読む。Worker が reset を処理して step 0 の frame（水深 0）を
    // 送ったときだけ 0 になる（04 の最終レビューの重要な指摘）
    // 全体の E2E の負荷の下で、Reset の直後のクリックでポップオーバーが開かないことが 1 回あった（Task 14）。
    // 開くまでクリックし直す（読む値の判定は変えない）
    await expect
      .poll(
        async () => {
          await page.mouse.click(wet.x, wet.y)
          return page.getByTestId('cell-depth').isVisible()
        },
        { timeout: 15_000, intervals: [500] },
      )
      .toBe(true)
    await expect(page.getByTestId('cell-depth')).toHaveText('0.00 m')
    await page.getByRole('button', { name: strings.cellInfo.close }).click()
    // もう一度開始すると、新しい runId の frame が届いて統計が 0 から進む（runId の食い違い・バッファの取りこぼしが
    // あると frame が捨てられ、0 のまま止まる。前の実行の水が残れば、すぐに止めた投入水量が前の値を下回らない）
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect(page.getByTestId('stat-step')).not.toHaveText('Step 0')
    await page.getByRole('button', { name: strings.playback.pause }).click()
    await stableStep(page)
    const secondTotal = await volumeM3(page)
    expect(secondTotal).toBeGreaterThan(0)
    expect(secondTotal).toBeLessThan(firstTotal)
  })

  test('範囲全体の雨をオンにすると半径の欄が無効になり、開始すると投入水量が範囲の有効セルの面積 × 雨量で増えていく（計画で決めたこと 25）', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await page.getByLabel(strings.rainfall.wholeRange).check()
    await expect(page.getByLabel(strings.rainfall.radius)).toBeDisabled()
    // 実時間で開始してすぐ止め、「1 step 進める」で進める（乾いた地形の最初の step の dt は 1 秒）
    await page.getByRole('button', { name: strings.playback.speedValue(1), exact: true }).click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    await page.getByRole('button', { name: strings.playback.pause }).click()
    let step = await stableStep(page)
    for (let n = 0; n < 5; n++) {
      await page.getByRole('button', { name: strings.playback.step, exact: true }).click()
      step += 1
      await expect(page.getByTestId('stat-step')).toHaveText(`Step ${step}`)
    }
    await expect(page.getByTestId('stat-time')).toHaveText(strings.format.seconds(step))
    // 投入水量 ÷（step 数 × 100 mm/h の 1 秒分）= 雨が降ったセルの面積。渋谷の 500 m の範囲は無効セルが無い
    const area = (await volumeM3(page)) / (step * (100 / 1000 / 3600))
    expect(area).toBeGreaterThan(200_000)
    expect(area).toBeLessThan(280_000)
  })
})

test('免責ダイアログは初回だけ表示される（spec 04 §11.2 の 6）', async ({ page, context }) => {
  await routeGsi(context)
  await page.goto('/')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(strings.disclaimer.lines[0])
  await expect(dialog).toContainText(strings.disclaimer.author)
  const sourceLink = page.getByRole('link', { name: strings.disclaimer.sourceCode.linkText })
  await expect(sourceLink).toBeVisible()
  await expect(sourceLink).toHaveAttribute('href', strings.disclaimer.sourceCode.url)
  await expect(sourceLink).toHaveAttribute('target', '_blank')
  await expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer')
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

  test('?mmh=50&dur=120&all=0&r=20 を付けて開くと、入力欄にその値が入っている（spec 08 §9.4 の 7）', async ({
    page,
  }) => {
    await page.goto(`${SHIBUYA}&mmh=50&dur=120&all=0&r=20`)
    await expect(page.getByLabel(strings.rainfall.intensity)).toHaveValue('50')
    await expect(page.getByLabel(strings.rainfall.duration)).toHaveValue('120')
    await expect(page.getByLabel(strings.rainfall.wholeRange)).not.toBeChecked()
    await expect(page.getByLabel(strings.rainfall.radius)).toHaveValue('20')
    await waitTerrain(page)
    await expect(page).toHaveURL(/size=500&mmh=50&dur=120&all=0&r=20/)
  })

  test('古い ?mm=50&r=20 を付けて開くと、雨は既定（100 mm/h・1 時間）で半径は 20 m になり、URL から mm が消える（R08-8、N3）', async ({
    page,
  }) => {
    await page.goto(`${SHIBUYA}&mm=50&r=20`)
    await expect(page.getByLabel(strings.rainfall.intensity)).toHaveValue('100')
    await expect(page.getByLabel(strings.rainfall.duration)).toHaveValue('60')
    await expect(page.getByLabel(strings.rainfall.radius)).toHaveValue('20')
    await waitTerrain(page)
    await expect(page).toHaveURL(/size=500&mmh=100&dur=60&all=0&r=20/)
    await expect(page).not.toHaveURL(/[?&]mm=/)
  })

  test('変えた時間雨量は localStorage に保存され、URL に無くても次に開いたときに入っている', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await page.getByLabel(strings.rainfall.intensity).fill('80')
    await expect(page).toHaveURL(/mmh=80/)
    await page.goto('/')
    await expect(page.getByLabel(strings.rainfall.intensity)).toHaveValue('80')
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

/**
 * 画面の割合 (fx, fy) の点に近く、どの ○ からも離れた点（ページの座標）。4 px 刻みで ±40 px まで、近い順に探す。
 * accept で追加の条件を付けられる。○ の位置は窪地の解析で変わる（spec 08 で 4 近傍になり、(0.4, 0.4) が
 * あふれ出し点の ○ に当たるようになった）ので、決まった点ではなく ○ を避けた点をクリックする（spec 07 の
 * Review Focus 1 と同じ扱い。アプリの挙動は変えない）
 */
async function pointClearOfMarkers(
  page: Page,
  fx: number,
  fy: number,
  accept: (p: { x: number; y: number }) => boolean = () => true,
): Promise<{ x: number; y: number }> {
  const markers = await findAllMarkers(page)
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
  if (box === null) throw new Error('地図の canvas がありません')
  const base = { x: box.x + box.width * fx, y: box.y + box.height * fy }
  const candidates: { x: number; y: number }[] = []
  for (let dx = -40; dx <= 40; dx += 4) {
    for (let dy = -40; dy <= 40; dy += 4) candidates.push({ x: base.x + dx, y: base.y + dy })
  }
  candidates.sort(
    (a, b) => Math.hypot(a.x - base.x, a.y - base.y) - Math.hypot(b.x - base.x, b.y - base.y),
  )
  const found = candidates.find((p) => clearOfMarkers(p, markers) && accept(p))
  if (found === undefined) throw new Error(`(${fx}, ${fy}) の近くに ○ から離れた点がありません`)
  return found
}

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
    // fitBounds の後、範囲は画面の中央の正方形（1280 × 720 なら横 320〜960）。右のパネルに隠れない位置。
    // ○ に当たると印の説明が開くので、(0.4, 0.4) の近くで ○ から離れた点を選ぶ（2 点目も先に選んでおく）
    // ○ が描かれてから選ぶ（描かれる前の絵では ○ を避けられない）
    await expect.poll(async () => (await findAllMarkers(page)).length).toBeGreaterThan(0)
    await nextFrames(page)
    const p1 = await pointClearOfMarkers(page, 0.4, 0.4)
    const p2 = await pointClearOfMarkers(
      page,
      0.3,
      0.3,
      (p) => p.x <= p1.x - 100 && p.y <= p1.y - 50,
    )
    await page.mouse.click(p1.x, p1.y)
    await expect(page.getByTestId('cell-info')).toBeVisible()
    await expect(page.getByTestId('cell-elevation')).toHaveText(/^\d+\.\d{2} m$/)
    await expect(page.getByTestId('cell-depth')).toHaveText('0.00 m')
    // ポップオーバーは背景を持たないので、開いたまま範囲の別の場所（ポップオーバーの左上の外）をクリックすると、
    // そこに開き直す（Task 8。384 × 216 は範囲の中）
    const first = await page.getByTestId('cell-info').boundingBox()
    await page.mouse.click(p2.x, p2.y)
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

test('キーボードだけで、時間雨量・継続時間・範囲全体・半径の入力から開始・一時停止・リセットまで操作できる（spec 08 §9.4 の 9、tech-spec §9.5）', async ({
  page,
  context,
}) => {
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  // 起点として時間雨量の入力欄に焦点を置く。ここから先はキーボードだけ
  const intensity = page.getByLabel(strings.rainfall.intensity)
  await intensity.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('120')
  // 継続時間の select で上矢印を 3 回（1 時間 → 10 分。計画で決めたこと 33）
  const duration = page.getByLabel(strings.rainfall.duration)
  await tabTo(page, duration)
  for (let n = 0; n < 3; n++) await page.keyboard.press('ArrowUp')
  await expect(duration).toHaveValue('10')
  // 範囲全体のスイッチは Space でオンにすると半径の欄が無効になり、もう一度 Space でオフに戻す
  const whole = page.getByLabel(strings.rainfall.wholeRange)
  await tabTo(page, whole)
  await page.keyboard.press('Space')
  await expect(whole).toBeChecked()
  await expect(page.getByLabel(strings.rainfall.radius)).toBeDisabled()
  await page.keyboard.press('Space')
  await expect(whole).not.toBeChecked()
  await tabTo(page, page.getByLabel(strings.rainfall.radius))
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('15')
  const primary = page.getByRole('button', { name: strings.playback.start })
  await tabTo(page, primary)
  await page.keyboard.press('Enter')
  // 120 mm/h × 10 分 = 総量 20 mm
  await expect(page.getByTestId('stat-rain-depth')).toHaveText(/ \/ 20 mm$/)
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
