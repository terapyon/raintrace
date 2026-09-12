import { type BrowserContext, expect, type Locator, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../../src/state/persistedSettings'

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
