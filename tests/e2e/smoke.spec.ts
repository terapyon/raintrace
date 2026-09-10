import { expect, test } from '@playwright/test'
import { strings } from '../../src/ui/strings'

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
