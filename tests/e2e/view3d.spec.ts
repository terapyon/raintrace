import { expect, type Locator, type Page, test } from '@playwright/test'
import { TERRAIN_LAYER_IDS } from '../../src/map/TerrainOverlay'
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
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    // 3D の地図側のモジュール（View3d・Terrain3d ほか）は 3D に切り替えたときに動的 import で読む
    // （spec 05 §3.8、R3。バンドル予算の LAZY_ONLY_MODULES と対）
    expect(requested.some((url) => /\/assets\/View3d-/.test(url))).toBe(false)
    await switchTo3d(page)
    expect(requested.some((url) => /\/assets\/View3d-/.test(url))).toBe(true)
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
    // 重なり順: hillshade が一番下、水面は 2D の水深の上・範囲の枠の下（spec 05 §3.3・§3.6、spec 06 Task 17）
    await expect(mapEl).toHaveAttribute(
      'data-overlay-order',
      [
        VIEW3D_LAYER_IDS.hillshade,
        TERRAIN_LAYER_IDS.elevation,
        TERRAIN_LAYER_IDS.depressions,
        WATER_LAYER_IDS.water,
        VIEW3D_LAYER_IDS.water,
        TERRAIN_LAYER_IDS.outline,
        TERRAIN_LAYER_IDS.flow,
        WATER_LAYER_IDS.arrows,
        TERRAIN_LAYER_IDS.markers,
      ].join(','),
    )
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

  test('3D でズームアウトして、画面の中心で描かれる地形タイルが境界より粗くなると 2D に落ちて知らせ、近づくと 3D に戻る（spec 05 §4.3）', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const warnings = collectWarnings(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await switchTo3d(page)
    const mapEl = mapElement(page)
    // 3D の視点（16.5、pitch 60。中心のタイルは 16）から、Shift + − で 2 段ズームアウトする（MapLibre のキーボード
    // 操作。MapLibre は Shift を押している間、キーボードのズームの増分を 2 倍にする
    // ——keyboard の `zoomDir * (e.shiftKey ? 2 : 1)`——ので、Shift + − 1 回で 2 段動く）。
    // 14.5 では中心のタイルが境界より粗くなる
    await page.locator('canvas.maplibregl-canvas').focus()
    await page.keyboard.press('Shift+Minus')
    await expect(mapEl).toHaveAttribute('data-view3d', 'fallback-2d', { timeout: 10_000 })
    await expect(page.getByTestId('view3d-fallback')).toBeVisible()
    await expect(mapEl).not.toHaveAttribute(
      'data-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.hillshade),
    )
    await expect
      .poll(() => layersOf(mapEl, 'data-visible-overlay-layers'))
      .toContain(WATER_LAYER_IDS.water)
    // 16.5 に戻すと、見込み（約 16.08）が境界 + 0.5 以上なので 3D に戻る
    await page.keyboard.press('Shift+Equal')
    await expect(mapEl).toHaveAttribute('data-view3d', '3d', { timeout: 10_000 })
    await expect(page.getByTestId('view3d-fallback')).toHaveCount(0)
    // 3D に戻した直後は描かれたタイルが無く、印が空（Number('') は 0）。埋まるのを待ってから読む
    await expect(mapEl).toHaveAttribute('data-drawn-tile-zoom', /^\d+$/, { timeout: 30_000 })
    expect(Number(await mapEl.getAttribute('data-drawn-tile-zoom'))).toBeGreaterThanOrEqual(
      MIN_3D_DRAWN_TILE_ZOOM,
    )
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  test('3D の表示中にベースマップを切り替えると（onRestyle → View3d.restore）、写真では hillshade が消えて水面は作り直され、淡色に戻すと hillshade も戻る（R4）', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const warnings = collectWarnings(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await switchTo3d(page)
    await page.getByRole('button', { name: strings.playback.start }).click()
    const mapEl = mapElement(page)
    await expect(mapEl).toHaveAttribute(
      'data-visible-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.water),
      { timeout: 30_000 },
    )
    const builds = Number(await mapEl.getAttribute('data-water-builds'))
    await page.getByRole('button', { name: strings.map.basemaps.photo }).click()
    await expect(mapEl).toHaveAttribute('data-basemap', 'photo')
    // hillshade は写真では付けない（hillshadeEnabled の auto）が、3D 自体と水面は戻る
    await expect(mapEl).not.toHaveAttribute(
      'data-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.hillshade),
    )
    await expect(mapEl).toHaveAttribute('data-view3d', '3d')
    await expect
      .poll(async () => Number(await mapEl.getAttribute('data-water-builds')))
      .toBeGreaterThan(builds)
    await expect(mapEl).toHaveAttribute(
      'data-visible-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.water),
      { timeout: 30_000 },
    )
    // 上の hillshade の無さは、スタイルの読み込み中の空のレイヤーの一覧でも通ってしまう。水面が作り直された
    // （restore が済んだ）後の一覧で、hillshade が足し直されていないことを確かめ直す（05 の最終の再レビューの軽微 2）
    const restoredLayers = await mapEl.getAttribute('data-overlay-layers')
    expect(restoredLayers).toMatch(new RegExp(VIEW3D_LAYER_IDS.water))
    expect(restoredLayers).not.toMatch(new RegExp(VIEW3D_LAYER_IDS.hillshade))
    await page.getByRole('button', { name: strings.map.basemaps.pale }).click()
    await expect(mapEl).toHaveAttribute('data-basemap', 'pale')
    await expect(mapEl).toHaveAttribute(
      'data-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.hillshade),
    )
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
  })

  test('3D の表示中に WebGL のコンテキストを失って戻すと、水面が新しいコンテキストで作り直され、hillshade と 04 の重ね描きが戻り、エラーが出ない（spec 05 §3.7）', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    const warnings = collectWarnings(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await switchTo3d(page)
    await page.getByRole('button', { name: strings.playback.start }).click()
    const mapEl = mapElement(page)
    await expect(mapEl).toHaveAttribute(
      'data-visible-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.water),
      { timeout: 30_000 },
    )
    const builds = Number(await mapEl.getAttribute('data-water-builds'))
    // WEBGL_lose_context で失わせ、1 秒後に同じ拡張で戻す。喪失の間は render が来ず、render で書く印は凍るので
    // （着手前の確かめ P9）、喪失と復帰はブラウザの webglcontextlost・webglcontextrestored で待つ
    const events = await page.evaluate(async () => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.maplibregl-canvas')
      const extension = canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')
      if (canvas === null || extension === undefined || extension === null) {
        throw new Error('WEBGL_lose_context がありません')
      }
      const seen: string[] = []
      const next = (name: string): Promise<void> =>
        new Promise((resolve) => {
          const listener = (): void => {
            seen.push(name)
            resolve()
          }
          canvas.addEventListener(name, listener, { once: true })
        })
      const lost = next('webglcontextlost')
      extension.loseContext()
      await lost
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const restored = next('webglcontextrestored')
      extension.restoreContext()
      await restored
      return seen
    })
    expect(events).toEqual(['webglcontextlost', 'webglcontextrestored'])
    // 復帰の style.load で onRestyle が走り、View3d が水面（three の資源）を新しいコンテキストで作り直す
    await expect
      .poll(async () => Number(await mapEl.getAttribute('data-water-builds')), { timeout: 30_000 })
      .toBeGreaterThan(builds)
    await expect(mapEl).toHaveAttribute(
      'data-visible-overlay-layers',
      new RegExp(VIEW3D_LAYER_IDS.water),
      { timeout: 30_000 },
    )
    await expect
      .poll(() => layersOf(mapEl, 'data-overlay-layers'))
      .toEqual(expect.arrayContaining([VIEW3D_LAYER_IDS.hillshade, TERRAIN_LAYER_IDS.elevation]))
    // 喪失と復帰の経路で rendering を外れる分岐は無いので、ここでの再確認は「壊れていない」証拠というより
    // 直前の確認（30 秒の poll）からの後退が無いことの見張り（ガード）
    await expect(mapEl).toHaveAttribute('data-view3d', '3d')
    expect(errors).toEqual([])
    // このテストだけで許す警告は 2 種類（ほかのテストの collectWarnings は空のまま）:
    // 1. MapLibre は喪失のとき、Custom Layer（水面）を戻せない旨を console.warn で出す（error ではない）
    // 2. MapLibre は 3D の地形を戻すとき、失ったコンテキストの GL の資源を新しいコンテキストで触る
    //    （bindTexture・framebufferTexture2D・delete の "object does not belong to this context"）。
    //    これは本タスクの変更の前（BASE）からあり、足し直しを外して測っても同じ件数（実測 175〜258 件。
    //    実行ごとに揺れる）が出た。2D だけの喪失と復帰では 1 件も出ない（3D の地形の経路に限る）。復帰の後の
    //    描画そのものは正しい（地形タイルのズーム 16 → 16、水の画素 0.829 → 0.757）。MapLibre 側の後始末な
    //    ので 06 へ申し送る
    // 3. Chrome は自分自身の出す警告が多すぎるとき "too many errors, no more errors will be reported" を
    //    出し、以後のこのページの GL の警告は一切コンソールに出なくなる（打ち切り）。つまりこの 1 行を許す
    //    ことは、それ以降の警告全部を見えなくすることも兼ねている。console.error と pageerror はこの打ち切
    //    りの影響を受けず、引き続き厳格（上の expect(errors).toEqual([]) がそのまま効く）
    const allowedWarning = (text: string): boolean =>
      text.includes(`Custom layer with id '${VIEW3D_LAYER_IDS.water}'`) ||
      text.includes('object does not belong to this context') ||
      text.includes('too many errors, no more errors will be reported')
    const ignoredWarnings = warnings.filter(allowedWarning)
    expect(warnings.filter((text) => !allowedWarning(text))).toEqual([])
    // 許した件数（2 の実測 175〜258）に大幅な余裕を持たせた上限。ちょうどの数を固定すると実行ごとの揺れで
    // 落ちるので、桁が変わるような自己回帰（例: 自前のコードが失ったコンテキストの GL 資源に触れ、2 と同じ
    // 文言を出す）を捉えるための緩い天井であって、期待値ではない
    expect(ignoredWarnings.length).toBeLessThan(400)
  })
})
