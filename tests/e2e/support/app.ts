import { type BrowserContext, expect, type Locator, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../../src/state/persistedSettings'
import { strings } from '../../../src/ui/strings'

/**
 * 免責の了解を済ませた設定を、ページのスクリプトより前に書く。保存が無いときだけ書くので、
 * テストの中の再読み込みで設定を戻さない。Playwright はテストごとに新しい context を作るので、
 * 保存はテストごとにまっさら（計画で決めたこと 22）
 */
export async function acknowledgeDisclaimer(context: BrowserContext): Promise<void> {
  const value = JSON.stringify({
    ...DEFAULT_SETTINGS,
    disclaimerAcknowledgedAt: '2026-09-12T00:00:00.000Z',
  })
  await context.addInitScript(
    ({ key, value }) => {
      if (window.localStorage.getItem(key) === null) window.localStorage.setItem(key, value)
    },
    { key: SETTINGS_KEY, value },
  )
}

export async function waitTerrain(page: Page): Promise<void> {
  await expect(page.locator('[data-range-shown="true"]')).toBeAttached({ timeout: 20_000 })
}

/** 地図の canvas の中の位置（幅・高さの割合）をクリックする。既定は左 3 分の 1 の中ほど（右のパネルに隠れない） */
export async function clickMap(page: Page, fx = 1 / 3, fy = 1 / 2): Promise<void> {
  await expect(page.locator('[data-map-loaded="true"]')).toBeAttached()
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
  if (box === null) throw new Error('地図の canvas がありません')
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
}

/** キーボードの Tab だけで target に焦点を移す（tech-spec §9.5 の確かめ） */
export async function tabTo(page: Page, target: Locator, max = 40): Promise<void> {
  for (let n = 0; n < max; n++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`Tab を ${max} 回押しても焦点が届きません`)
}

/** ページの例外とコンソールのエラーを集める */
export function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

/**
 * console の warning を集める（spec 05 の 3D の E2E）。SwiftShader の GL の性能のヒント（`GPU stall due to
 * ReadPixels` など。着手前の確かめ P9 で 04 のアプリでも出た）は描画の誤りではないので除く
 */
export function collectWarnings(page: Page): string[] {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.type() !== 'warning') return
    const text = message.text()
    if (/GL Driver Message|GPU stall due to ReadPixels/.test(text)) return
    warnings.push(text)
  })
  return warnings
}

export const mapElement = (page: Page): Locator => page.locator('[data-map-loaded="true"]')

/** パネルの「3D」を押し、3D の視点へ動き終えるまで待つ（SwiftShader では地形の用意に数秒かかる） */
export async function switchTo3d(page: Page): Promise<void> {
  await page.getByRole('button', { name: strings.view3d.view3d, exact: true }).click()
  await expect(mapElement(page)).toHaveAttribute('data-view3d', '3d', { timeout: 30_000 })
  await expect(mapElement(page)).toHaveAttribute('data-view3d-framed', 'true', { timeout: 30_000 })
}

/** 標高・窪地・地形の流向・水の流れの矢印を切る（画素の色の判定を汚さない。spec 07 の E2E） */
export async function hideTerrainOverlays(page: Page): Promise<void> {
  for (const label of [
    strings.panel.showElevation,
    strings.panel.showDepressions,
    strings.panel.showFlow,
    strings.panel.showWaterFlow,
  ]) {
    await page.getByLabel(label, { exact: true }).uncheck()
  }
}

/** 描画フレームを 2 つ待つ（rAF で描く canvas・シェーダの変化が画面に出るまで） */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}
