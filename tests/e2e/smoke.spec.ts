import { readFileSync } from 'node:fs'
import { test as base, expect } from '@playwright/test'
import { strings } from '../../src/ui/strings'

const tilePng = readFileSync(new URL('./fixtures/tile.png', import.meta.url))

// 地理院への通信を自作の単色 PNG に差し替える。Worker から出るリクエストも捕まえるため、
// page ではなく browserContext で差し替える（tech-spec §11.4）
const test = base.extend<{ gsiTiles: { count: number } }>({
  gsiTiles: [
    async ({ context }, use) => {
      const counter = { count: 0 }
      await context.route('https://cyberjapandata.gsi.go.jp/**', async (route) => {
        counter.count++
        await route.fulfill({
          status: 200,
          contentType: 'image/png',
          headers: { 'access-control-allow-origin': '*' },
          body: tilePng,
        })
      })
      await use(counter)
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
  await expect.poll(() => gsiTiles.count).toBeGreaterThan(0)
})

test('出典が表示される', async ({ page }) => {
  await page.goto('/')
  const link = page.getByRole('link', { name: strings.attribution.text })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', strings.attribution.url)
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
  await expect.poll(() => gsiTiles.count).toBeGreaterThan(0)
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  )
  expect(violations).toEqual([])
})
