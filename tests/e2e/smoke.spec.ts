import { test as base, expect, type Page } from '@playwright/test'
import { strings } from '../../src/ui/strings'
import { acknowledgeDisclaimer } from './support/app'
import { type GsiCounts, routeGsi } from './support/gsi'

// 地理院への通信を差し替える。Worker から出るリクエストも捕まえるため、
// page ではなく browserContext で差し替える（tech-spec §11.4）
const test = base.extend<{ gsiTiles: GsiCounts; disclaimer: void }>({
  gsiTiles: [
    async ({ context }, use) => {
      await use(await routeGsi(context))
    },
    { auto: true },
  ],
  // 免責のダイアログ（モーダル）が出ると、ほかの要素が読み上げの対象から外れる（getByRole で見つからない）
  disclaimer: [
    async ({ context }, use) => {
      await acknowledgeDisclaimer(context)
      await use()
    },
    { auto: true },
  ],
})

const mapLoaded = '[data-map-loaded="true"]'

test('地図の canvas が表示される', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator(mapLoaded)).toBeAttached()
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible()
  expect(errors).toEqual([])
})

test('地図タイルのリクエストが、差し替えた画像で応答される', async ({ page, gsiTiles }) => {
  await page.goto('/')
  await expect.poll(() => gsiTiles.pale).toBeGreaterThan(0)
})

test('出典が表示される', async ({ page }) => {
  await page.goto('/')
  const link = page.getByRole('link', { name: strings.attribution.text })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', strings.attribution.url)
})

test('Worker が起動し、ルート要素に data-worker-ready="true" が付く', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-worker-ready', 'true')
})

test('WebGL 2 が使えないと、非対応の画面が出る', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type === 'webgl2' ? null : Reflect.apply(original, this, [type, ...rest])
      },
    })
  })
  await page.goto('/')
  await expect(page.getByTestId('unsupported')).toBeVisible()
  await expect(page.getByText(strings.unsupported.title)).toBeVisible()
  await expect(page.getByText(strings.unsupported.missing.webgl2)).toBeVisible()
})

test('ビルドの情報（dist/.vite/）は配信しない', async ({ request }) => {
  // ビルドの情報は build-info/ に移すので dist に無い（spec D R-D4）。無いパスには Pages の SPA の判定で
  // index.html が返る。public/ に誤って置いたときの守りとして残す。本当の守りはデプロイの後の応答の検査
  // （scripts/check-deployed-headers.mjs）
  const response = await request.get('/.vite/manifest.json')
  expect(await response.text()).not.toContain('"isEntry"')
})

test('存在しないパスを開いても地図の画面が出る（SPA のフォールバック。dist/404.html を置くと壊れる）', async ({
  page,
  gsiTiles,
}) => {
  const response = await page.goto('/no-such-path')
  expect(response?.status()).toBe(200)
  await expect(page.locator(mapLoaded)).toBeAttached()
  // gsiTiles（auto fixture）が地理院への要求を差し替えている。0 より大きいことは、フォールバックで
  // 返った index.html がタイルを要求し、それが差し替えの応答で満たされたこと（＝地図が実際に動き出した
  // こと）を示す。本物の GSI に届いていないことの直接の証明ではない
  await expect.poll(() => gsiTiles.pale).toBeGreaterThan(0)
})

test('/assets/* は長期キャッシュされ、index.html はキャッシュされない（裁定 RB-1）', async ({
  page,
}) => {
  const assetResponsePromise = page.waitForResponse(
    (r) => new URL(r.url()).pathname.startsWith('/assets/') && r.url().endsWith('.js'),
  )
  const documentResponse = await page.goto('/')
  const assetResponse = await assetResponsePromise
  const assetCacheControl = assetResponse.headers()['cache-control'] ?? ''
  expect(assetCacheControl).toContain('max-age=31536000')
  expect(assetCacheControl).toContain('immutable')
  expect(documentResponse?.headers()['cache-control'] ?? '').not.toContain('immutable')
})

test('応答に CSP が付き、読み込み中に CSP 違反が起きない', async ({ page, gsiTiles }) => {
  await page.addInitScript(() => {
    const violations: string[] = []
    Object.assign(window, { __cspViolations: violations })
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  const response = await page.goto('/')
  expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")
  await expect(page.locator(mapLoaded)).toBeAttached()
  await expect.poll(() => gsiTiles.pale).toBeGreaterThan(0)
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  )
  expect(violations).toEqual([])
})

test('Button・ToggleButton の文字が大文字にならない（単位の m・x が M・X に見えていた不具合の回帰）', async ({
  page,
}) => {
  await page.goto('/')
  // getByRole の name は大文字小文字を区別しないので、text-transform が誤って uppercase に
  // 戻っていても要素は見つかる。実際に見える文字は innerText で確かめる（toHaveText・textContent は
  // CSS の text-transform を反映しないため使えない）。速度のボタン（「10 倍」など。spec 08）は英字を含まず
  // 大文字にしても変わらないので確かめに使えない。ToggleButton は範囲の「250 m」、Button は「1 step」で確かめる
  const rangeButton = page.getByRole('button', { name: strings.rainfall.rangeSizeValue(250) })
  const stepButton = page.getByRole('button', { name: strings.playback.step })
  await expect(rangeButton).toBeVisible()
  await expect(stepButton).toBeVisible()
  expect(await rangeButton.innerText()).toBe(strings.rainfall.rangeSizeValue(250))
  expect(await stepButton.innerText()).toBe(strings.playback.step)
})

// 出典はパネルに隠れてはならない（tech-spec §16.1・spec 09 裁定 R17）。
// 出典・パネル・左上の切り替えの外接矩形が重ならず、出典が画面の中に収まることを確かめる
async function expectAttributionClear(page: Page, viewport: { width: number; height: number }) {
  const box = async (selector: string) => {
    const b = await page.locator(selector).first().boundingBox()
    if (b === null) throw new Error(`${selector} の位置が取れない`)
    return b
  }
  const attribution = await box('.maplibregl-ctrl-attrib')
  const overlaps = (a: typeof attribution, b: typeof attribution) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  expect(attribution.x).toBeGreaterThanOrEqual(0)
  expect(attribution.y).toBeGreaterThanOrEqual(0)
  expect(attribution.x + attribution.width).toBeLessThanOrEqual(viewport.width)
  expect(attribution.y + attribution.height).toBeLessThanOrEqual(viewport.height)
  expect(overlaps(attribution, await box('.MuiDrawer-paper'))).toBe(false)
  expect(overlaps(attribution, await box(`[aria-label="${strings.view3d.mode}"]`))).toBe(false)
}

test('出典が、広い画面（1280×800）で右のパネルに隠れない', async ({ page }) => {
  const viewport = { width: 1280, height: 800 }
  await page.setViewportSize(viewport)
  await page.goto('/')
  await expect(page.getByRole('link', { name: strings.attribution.text })).toBeVisible()
  await expectAttributionClear(page, viewport)
})

test('出典が、狭い画面（390×844）で下のパネルを開いていてもたたんでいても隠れない', async ({
  page,
}) => {
  const viewport = { width: 390, height: 844 }
  await page.setViewportSize(viewport)
  await page.goto('/')
  await expect(page.getByRole('link', { name: strings.attribution.text })).toBeVisible()
  await expectAttributionClear(page, viewport)
  await page.getByRole('button', { name: strings.panel.collapse }).click()
  await expect(page.getByRole('button', { name: strings.panel.expand })).toBeVisible()
  await expectAttributionClear(page, viewport)
})
