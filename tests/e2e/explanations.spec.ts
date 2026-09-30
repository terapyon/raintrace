import { expect, type Page, test } from '@playwright/test'
import { hexToRgb, MARKER_COLORS } from '../../src/map/overlayColors'
import { WATER_LAYER_IDS } from '../../src/map/WaterOverlay'
import { strings } from '../../src/ui/strings'
import {
  acknowledgeDisclaimer,
  collectErrors,
  hideTerrainOverlays,
  mapElement,
  nextFrames,
  switchTo3d,
  tabTo,
  waitTerrain,
} from './support/app'
import { routeGsi } from './support/gsi'
import { type Blob, colorBlobs, decodePng, outflowBandCount } from './support/png'

const SHIBUYA = '/?lat=35.658000&lon=139.701600'
/**
 * 範囲全体の雨（spec 08 §9.4、R3 の裁定）。縁の全周が同時に濡れ、流出の帯が決定的に出る（円の雨は縁に届くまでに
 * 時間がかかり、07 の「最初の数 step で帯が出る」前提が崩れる）。強さは spec の 250 mm/h から下げた（計画で決めた
 * こと 37）: 250 mm/h では縁が約 15 step で 1 mm に届いて帯が一度に飽和し、t1 → t2 で増えない。
 * 20 mm/h の推移（2026-09-30、3D・SwiftShader、60 倍で再生しながら約 0.5 秒ごとに読んだ 1 回。帯の色の画素数）:
 * step 4 で 0、45 で 202、95 で 688、198 で 1340、278 で 1622、324 で 4538、370 で 4734、以後は 12,821 step まで
 * 5411 へゆっくり増えるだけ（ほぼ飽和）。増え始め（約 45 step）から飽和（約 370 step）まで約 325 step あり、
 * t1・t2 がその間に入るので 20 mm/h にした
 */
const EDGE_RAIN = '&mmh=20&dur=120&all=1'
/** ○ を探す画面（md 未満。パネルは下で、たためる。範囲の端の ○ が右のパネルに隠れない。計画で決めたこと 14） */
const NARROW = { width: 800, height: 900 }
/** たたんだ下のパネルの見出しの分（px） */
const BOTTOM_BAR_PX = 100
/** 右のパネル（幅 320 px）の分（px） */
const SIDE_PANEL_PX = 340
/**
 * ○ の色の許容（各成分）。circle の中は指定の色そのものなので小さくてよい。MUI の青（#1976d2）は最低点の青と
 * 各成分 17〜18 違うので、12 なら区別できる。○ のテストでは雨を降らせない（水の色が最低点の色の許容に入る）
 */
const MARKER_TOLERANCE = 12
/** ○ とみなす塊の最小の画素数（3D の遠い ○ は小さく描かれる） */
const MARKER_MIN_PX = 10
/**
 * 流出の帯の画素のしきい値（降雨の前との差）。実測を報告に書き、しきい値は大きな余裕を取る（06 の慣習）。
 * スパイク（実 GPU）では 500 m・1 セル幅の帯でも 3D で 240〜420 px だった。帯は 6 セル幅なので、それより多い。
 * 実測（2026-09-29、SwiftShader）: 2D の c1 − c0 = 856〜2040（最速で再生しながら読む）。3D は step 1 で
 * 読むので c1 − c0 = 1057（3 回とも同じ）。以上は枠の赤も含む判定での値。
 * 帯の色だけで数える今の版（spec 08 Task 9 の修正ラウンド 2、2026-09-30）: 2D の c0 = 0、c1 − c0 = 1870。
 * 3D は c0 = 0、step 1 で c1 = 1032。
 * 実測（2026-09-30、SwiftShader、範囲全体の 20 mm/h。spec 08 Task 14）: 2D の c1 − c0 = 223〜672（最速で再生しながら
 * 読み、200 を超えた最初の読み）、3D は 663〜1500（10 倍で再生しながら待ち、step 111〜249 で一時停止）。計画で決めた
 * こと 24 の規則（最小 ÷ 4）では 55 になるが、200 から緩めない（コントローラーの指示）
 */
const OUTFLOW_MIN_PX = 200
/**
 * t1 から t2 への増え方の下限（3D。M2）。SwiftShader の揺れ（色の分類ではほぼ 0）より十分大きく。
 * 実測（2026-09-29、3 回）: step 1 → 31 で c2 − c1 = 1315（3 回とも同じ）。同じカメラで 3 回読んだ数は ×2・×1 とも
 * 完全に一致した。一時停止が遅れた場合も、step 11〜30 から 30 step で 454〜640 増えた（修正前の版での実測）。
 * 帯の色だけで数える今の版（2026-09-30）: step 1 → 31 で c2 − c1 = 1442（c2 = 2474）。
 * 実測（2026-09-30、SwiftShader、範囲全体の 20 mm/h。spec 08 Task 14）: t1 → t2（160 step）で、t1 を 10 倍で待つ今の版
 * は 8 回で c2 − c1 = 878〜3407（t1 = step 111〜112 で 878〜881、172 で 2171、208〜249 で 3261〜3407）。帯は step 約 335 まではゆっくり
 * 増え（112 で 666、249 で 1500、331 で 1879）、その後の数 step で約 4500 に跳ねるので、t2 がその跳ねを越えるかで
 * 増え方が変わる。計画で決めたこと 24 の規則（4 回の最小 ÷ 4）で 219 にした。
 * t1 を 60 倍で待つ版は、負荷なしで t1 = step 177〜196・c2 − c1 = 3154〜3443 だったが、並列の負荷で t1 が 296〜331 に
 * 遅れると帯が飽和に近づき、335 まで落ちた
 */
const OUTFLOW_GROWTH_PX = 219
/**
 * t1 から t2 までに進める step 数（3D。M2）。決まった量だけ進め、再生の速さと競争しない。
 * EDGE_RAIN の推移で、t1（帯が OUTFLOW_MIN_PX を超える約 45 step）から飽和（約 370 step）までの半分を 10 刻みに
 * 切り下げた（計画で決めたこと 37）
 */
const T2_STEPS = 160
/**
 * 帯を消した後の許容（揺れ）。画素はすべて帯そのものの色だけで数える（outflowCount → outflowBandCount。
 * 範囲の枠・降雨マーカーの赤を色で除く）。2D は降雨の前との差、3D は切った後に残る帯の色の画素の数と比べる。
 * 枠の赤も含む判定では 3D の降雨の前との差が帯と関係なく動いた（spec 08 Task 9 の修正ラウンド 1・2）: 持ち上がった
 * 水面が枠の赤い線の一部を覆って減り（07 の実測 −21〜−16、08 の流れで −37）、負荷が高いと降雨の前の読みが 3D の
 * 枠を描き終わる前になって、枠の分だけ増えて見えた（+118〜+984）。
 * 実測（2026-09-30、帯の色だけ）: 2D の差 0。3D の切った後 0（×2・×1）、切る前 2474（×2）・2783（×1）
 */
const OUTFLOW_NOISE_PX = 30

type Clip = { x: number; y: number; width: number; height: number }

/** 地図のうちパネルに隠れない部分（狭い画面は下の見出し、広い画面は右のパネルを除く） */
async function mapClip(page: Page, narrow: boolean): Promise<Clip> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
  if (box === null) throw new Error('地図の canvas がありません')
  return narrow
    ? { x: box.x, y: box.y, width: box.width, height: box.height - BOTTOM_BAR_PX }
    : { x: box.x, y: box.y, width: box.width - SIDE_PANEL_PX, height: box.height }
}

/** 色 hex の ○ を、狭い画面の地図の見えている部分から探す（ページの座標。大きい順） */
async function findMarkers(page: Page, hex: string): Promise<Blob[]> {
  const clip = await mapClip(page, true)
  const blobs = colorBlobs(
    decodePng(await page.screenshot({ clip })),
    hexToRgb(hex),
    MARKER_TOLERANCE,
  )
  return blobs
    .filter((b) => b.count >= MARKER_MIN_PX)
    .map((b) => ({ ...b, x: clip.x + b.x, y: clip.y + b.y }))
}

/** どの ○ からも 24 px 以上離れた、範囲の中の点（地図の中心の近くから探す） */
function awayFrom(clip: Clip, markers: readonly Blob[]): { x: number; y: number } {
  for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const p = { x: clip.x + clip.width * fx, y: clip.y + clip.height * fy }
      if (markers.every((m) => Math.hypot(m.x - p.x, m.y - p.y) >= 24)) return p
    }
  }
  throw new Error('○ から離れた点が見つかりません')
}

/**
 * 色 hex の ○ をクリックして、行 testId の説明が開くまで繰り返す（3D は垂直強調を変えた直後に ○ の位置が動く）。
 * 見つからなければ 'no-marker' のまま時間切れになる
 */
async function clickMarker(page: Page, hex: string, testId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const [blob] = await findMarkers(page, hex)
        if (blob === undefined) return 'no-marker'
        await page.mouse.click(blob.x, blob.y)
        return (await page.getByTestId(testId).first().isVisible()) ? 'open' : 'closed'
      },
      { timeout: 30_000 },
    )
    .toBe('open')
}

/**
 * 流出の帯そのものの色の画素の数（outflowBandCount。範囲の枠・降雨マーカーの赤を色で除く）。3D では負荷が高いと
 * 降雨の前の読みが枠を描き終わる前になり、枠の赤を含む 07 の判定では c1 − c0 が帯なしで
 * しきい値を超えることがあった（spec 08 Task 9 の修正ラウンド 2）。2D も同じ関数で数える
 */
async function outflowCount(page: Page, clip: Clip): Promise<number> {
  return outflowBandCount(decodePng(await page.screenshot({ clip })))
}

/** 実測の値を標準出力に残す（しきい値の根拠。報告に書く） */
function logMeasured(name: string, values: Record<string, number | readonly number[]>): void {
  console.log(`[実測] ${name} ${JSON.stringify(values)}`)
}

/** 表示中の step の数（「Step 12」の 12） */
async function shownStep(page: Page): Promise<number> {
  const text = (await page.getByTestId('stat-step').textContent()) ?? ''
  const match = /Step (\d+)/.exec(text)
  if (match === null) throw new Error(`step の表示が読めません: ${text}`)
  return Number(match[1])
}

/** 一時停止の後、表示中の step が動かなくなるまで待って返す（最後のフレームが届くまで） */
async function settledStep(page: Page): Promise<number> {
  let last = -1
  await expect
    .poll(
      async () => {
        const previous = last
        last = await shownStep(page)
        return last === previous
      },
      { timeout: 10_000, intervals: [300] },
    )
    .toBe(true)
  await nextFrames(page)
  return last
}

/** 一時停止のまま「1 step 進める」を押し、表示が step + 1 になって描かれるまで待つ */
async function stepOnce(page: Page, step: number): Promise<number> {
  await page.getByRole('button', { name: strings.playback.step, exact: true }).click()
  await expect(page.getByTestId('stat-step')).toHaveText(`Step ${step + 1}`)
  await nextFrames(page)
  await nextFrames(page)
  return step + 1
}

/** 垂直強調のボタンを押す */
async function setExaggeration(page: Page, value: number): Promise<void> {
  const button = page
    .getByRole('group', { name: strings.view3d.exaggeration })
    .getByRole('button', { name: strings.view3d.exaggerationValue(value), exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

test.describe('地図の印の説明と流出の表示（spec 07 §7.2）', () => {
  test.describe.configure({ timeout: 90_000 })

  test.beforeEach(async ({ context }) => {
    await routeGsi(context)
    await acknowledgeDisclaimer(context)
  })

  test('2D: 最低点の ○ の上ではカーソルが指の形になり、クリックすると説明と標高が出る。○ でない所はセル情報を開く（§3.1・§3.4・§3.5）', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await page.setViewportSize(NARROW)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    await page.getByRole('button', { name: strings.panel.collapse }).click()
    await expect
      .poll(async () => (await findMarkers(page, MARKER_COLORS.lowest)).length, { timeout: 10_000 })
      .toBeGreaterThan(0)
    const lowest = await findMarkers(page, MARKER_COLORS.lowest)
    const spills = await findMarkers(page, MARKER_COLORS.spill)
    const target = lowest[0] as Blob
    const canvas = page.locator('canvas.maplibregl-canvas')
    await page.mouse.move(target.x, target.y)
    await expect(canvas).toHaveCSS('cursor', 'pointer')
    await page.mouse.click(target.x, target.y)
    const row = page.getByTestId('marker-info-lowest')
    await expect(row).toContainText(strings.markerInfo.lowest.title)
    await expect(row).toContainText(strings.markerInfo.lowest.body)
    await expect(row.getByTestId('marker-elevation')).toHaveText(/^-?\d+\.\d{2} m$/)
    await expect(page.getByTestId('cell-info')).toBeHidden()
    // ○ から離れた範囲の中の点は、今までどおりセル情報（spec 07 §7.2）
    const away = awayFrom(await mapClip(page, true), [...lowest, ...spills])
    await page.mouse.move(away.x, away.y)
    await expect(canvas).not.toHaveCSS('cursor', 'pointer')
    await page.mouse.click(away.x, away.y)
    await expect(page.getByTestId('cell-info')).toBeVisible()
    await expect(page.getByTestId('marker-info')).toBeHidden()
    expect(errors).toEqual([])
  })

  test('2D: あふれ出し点の ○ をクリックすると、説明と 4 つの数値が出る（§3.4）', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await page.setViewportSize(NARROW)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    await page.getByRole('button', { name: strings.panel.collapse }).click()
    await clickMarker(page, MARKER_COLORS.spill, 'marker-info-spill')
    const row = page.getByTestId('marker-info-spill').first()
    await expect(row).toContainText(strings.markerInfo.spill.title)
    await expect(row).toContainText(strings.markerInfo.spill.body)
    await expect(row.getByTestId('marker-spill-elevation')).toHaveText(/^-?\d+\.\d{2} m$/)
    await expect(row.getByTestId('marker-max-depth')).toHaveText(/^\d+\.\d{2} m$/)
    await expect(row.getByTestId('marker-capacity')).toHaveText(/ m³$/)
    await expect(row.getByTestId('marker-area')).toHaveText(/^\d+ m²$/)
    expect(errors).toEqual([])
  })

  test('3D: ○ のクリックで説明が開く（垂直強調 ×1 は最低点、×5 はあふれ出し点。§3.1、軽微 m1）', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const errors = collectErrors(page)
    await page.setViewportSize(NARROW)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    await switchTo3d(page)
    // ×5 では、この地点の最低点の ○（タイルの継ぎ目の深い窪みの底）が淡く描かれ（実測 #4c82be）、色で探せない。
    // そこで ×5 はあふれ出し点の ○ を使う。淡くなるのは MapLibre の circle の地形による遮蔽（calculate_visibility、
    // maplibre-gl-dev.mjs 8762・8780）で仕様どおり。queryRenderedFeatures は遮蔽を見ないので、クリックは当たる
    const cases = [
      { ex: 1, kind: 'lowest', elevation: 'marker-elevation' },
      { ex: 5, kind: 'spill', elevation: 'marker-spill-elevation' },
    ] as const
    for (const { ex, kind, elevation } of cases) {
      await setExaggeration(page, ex)
      await page.getByRole('button', { name: strings.panel.collapse }).click()
      await clickMarker(page, MARKER_COLORS[kind], `marker-info-${kind}`)
      await expect(page.getByTestId(elevation).first()).toHaveText(/^-?\d+\.\d{2} m$/)
      await page.getByRole('button', { name: strings.markerInfo.close }).click()
      await expect(page.getByTestId('marker-info')).toBeHidden()
      await page.getByRole('button', { name: strings.panel.expand }).click()
    }
    expect(errors).toEqual([])
  })

  test('2D: 範囲全体に雨を降らせて再生すると water-outflow に流出の色が出て、切ると消え、切っている間の Reset の後に入れ直しても古い帯は出ない（§5.2・§5.3、推奨 R4、Review Focus 4）', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const errors = collectErrors(page)
    await page.goto(`${SHIBUYA}${EDGE_RAIN}`)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    const mapEl = mapElement(page)
    const visibleLayers = async (): Promise<string> =>
      (await mapEl.getAttribute('data-visible-overlay-layers')) ?? ''
    await expect.poll(visibleLayers).toContain(WATER_LAYER_IDS.outflow)
    const clip = await mapClip(page, false)
    const c0 = await outflowCount(page, clip)
    await page.getByRole('button', { name: strings.playback.max, exact: true }).click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    let c1 = 0
    await expect
      .poll(
        async () => {
          c1 = await outflowCount(page, clip)
          return c1 - c0
        },
        { timeout: 120_000 },
      )
      .toBeGreaterThan(OUTFLOW_MIN_PX)
    // 切ると消える
    await page.getByLabel(strings.panel.showOutflow).uncheck()
    await expect.poll(visibleLayers).not.toContain(WATER_LAYER_IDS.outflow)
    await nextFrames(page)
    const offDiff = (await outflowCount(page, clip)) - c0
    expect(offDiff).toBeLessThanOrEqual(OUTFLOW_NOISE_PX)
    // 切っている間に Reset（setWater(null)）。入れ直しても古い帯は出ない
    await page.getByRole('button', { name: strings.playback.reset }).click()
    await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
    await page.getByLabel(strings.panel.showOutflow).check()
    await expect.poll(visibleLayers).toContain(WATER_LAYER_IDS.outflow)
    await nextFrames(page)
    await nextFrames(page)
    const afterResetDiff = (await outflowCount(page, clip)) - c0
    logMeasured('2D', { c0, c1MinusC0: c1 - c0, offDiff, afterResetDiff })
    expect(afterResetDiff).toBeLessThanOrEqual(OUTFLOW_NOISE_PX)
    expect(errors).toEqual([])
  })

  test('3D: 流出の帯はカメラを固定したまま再生中に増える（t1 < t2。must-fix M2）。切ると帯の色が残らない', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const errors = collectErrors(page)
    await page.goto(`${SHIBUYA}${EDGE_RAIN}`)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    await switchTo3d(page)
    // ここから先はカメラを動かさない（3D の視点へ動き終えた後）
    const clip = await mapClip(page, false)
    const mapEl = mapElement(page)
    // 流出の帯は水面のシェーダで描く（tech-spec §9.7）ので、水面がすべての区画を初めて描き終えた回数
    // （data-water-ready。spec 06 §5.2、Task 17a）が 1 以上になるまで待ってから読む（読み直しての一致待ちは
    // しない。最終レビューの指摘）。GPU への転送が描画の完了より少し遅れることがあるので、直後ではなく
    // さらに数フレーム後に 1 回だけ読む
    await expect
      .poll(async () => Number(await mapEl.getAttribute('data-water-ready')), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1)
    await nextFrames(page)
    await nextFrames(page)
    await nextFrames(page)
    const c0 = await outflowCount(page, clip)
    // t1: 10 倍で再生しながら、帯が出るまで待って一時停止する（範囲全体の雨は 1 step が 1 秒前後なので、
    // 1 step ずつ進めると t1 までの往復が長い。計画で決めたこと 24）。計画の 60 倍では、並列の負荷で一時停止が
    // 遅れて t1 が step 296〜331 になり、帯が飽和に近づいて t1 → t2 の増え方が 335 まで落ちた（Task 14 の実測）。
    // 10 倍なら一時停止の遅れが数十 step に収まる
    await page.getByRole('button', { name: strings.playback.speedValue(10), exact: true }).click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect
      .poll(async () => (await outflowCount(page, clip)) - c0, {
        timeout: 120_000,
        intervals: [500],
      })
      .toBeGreaterThan(OUTFLOW_MIN_PX)
    await page.getByRole('button', { name: strings.playback.pause }).click()
    await expect(page.getByRole('button', { name: strings.playback.resume })).toBeVisible()
    let step = await settledStep(page)
    const pausedStep = step
    await nextFrames(page)
    const c1 = await outflowCount(page, clip)
    expect(c1 - c0).toBeGreaterThan(OUTFLOW_MIN_PX)
    const s1 = step
    // t2: 同じカメラのまま、決まった step 数だけ進めると、さらに増える（最初に描いた 1 回で凍ると c1 のまま）
    for (let n = 0; n < T2_STEPS; n++) step = await stepOnce(page, step)
    const s2 = step
    expect(s2).toBe(s1 + T2_STEPS)
    const c2 = await outflowCount(page, clip)
    expect(c2 - c1).toBeGreaterThan(OUTFLOW_GROWTH_PX)
    // 一時停止のまま、同じカメラで 3 回読んだ画素数が一致する（ちらつかない）。垂直強調 ×2 と ×1（推奨 R3）。
    // 各垂直強調で帯を切った画素数も読み、切ると帯の分が消えることを確かめる
    const flicker: Record<string, number[]> = {}
    const offCounts: Record<string, number> = {}
    let offDiff = 0
    // 既定の垂直強調は ×2（DEFAULT_SETTINGS）。c0 は ×2 で読んだので、×2 を先に読む
    let previousShot: Buffer | null = null
    for (const ex of [2, 1] as const) {
      await setExaggeration(page, ex)
      if (previousShot !== null) {
        // 垂直強調が画面に効くまで待つ（前の垂直強調の絵から変わるまで。読みが揃うまでは待たない）
        const before = previousShot
        await expect
          .poll(async () => (await page.screenshot({ clip })).equals(before), { timeout: 10_000 })
          .toBe(false)
        await page.waitForTimeout(500)
      }
      await nextFrames(page)
      const reads: number[] = []
      for (let n = 0; n < 3; n++) {
        reads.push(await outflowCount(page, clip))
        await nextFrames(page)
      }
      previousShot = await page.screenshot({ clip })
      flicker[`x${ex}`] = reads
      expect(reads).toEqual([reads[0], reads[0], reads[0]])
      // 切ると u_showOutflow が 0 になり、帯の分が消える
      await page.getByLabel(strings.panel.showOutflow).uncheck()
      await nextFrames(page)
      let off = 0
      await expect
        .poll(
          async () => {
            off = await outflowCount(page, clip)
            return (reads[0] as number) - off
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThan(OUTFLOW_MIN_PX)
      offCounts[`x${ex}`] = off
      // 帯の色は残らない（OUTFLOW_NOISE_PX の説明。c0 との差は参考に記録する）
      if (ex === 2) offDiff = off - c0
      expect(off).toBeLessThanOrEqual(OUTFLOW_NOISE_PX)
      await page.getByLabel(strings.panel.showOutflow).check()
      await nextFrames(page)
      previousShot = await page.screenshot({ clip })
    }
    logMeasured('3D', {
      pausedStep,
      s1,
      s2,
      c0,
      c1,
      c2,
      c1MinusC0: c1 - c0,
      c2MinusC1: c2 - c1,
      offDiff,
      flickerX1: flicker.x1 ?? [],
      flickerX2: flicker.x2 ?? [],
      offX1: offCounts.x1 ?? 0,
      offX2: offCounts.x2 ?? 0,
    })
    expect(errors).toEqual([])
  })

  test('領域外流出量の説明のアイコンに Tab で焦点を移すとツールチップが出る。水深の凡例の注記と ○・流出の凡例が出る（§3.6・§4.1・§4.2）', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const help = page.getByRole('button', { name: strings.stats.outflowHelpLabel })
    await tabTo(page, help, 80)
    await expect(page.getByRole('tooltip')).toHaveText(strings.stats.outflowHelp)
    await expect(page.getByTestId('water-legend-note')).toHaveText(strings.legend.waterThinNote)
    await expect(page.getByRole('img', { name: strings.legend.markersAria })).toBeVisible()
    await expect(page.getByRole('img', { name: strings.legend.outflowAria })).toBeVisible()
    expect(errors).toEqual([])
  })
})
