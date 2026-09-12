import type { BrowserContext } from '@playwright/test'

export interface Shot {
  label: string
  png: Buffer
}

/** スクリーンショットを 1 枚の JPEG に並べる（計画 D10）。1 コマ 240 × 150、品質 70 */
export async function writeContactSheet(
  context: BrowserContext,
  shots: Shot[],
  columns: number,
  title: string,
  path: string,
): Promise<void> {
  const page = await context.newPage()
  await page.setViewportSize({ width: columns * 240 + 16, height: 600 })
  const cells = shots
    .map(
      (shot) =>
        `<figure><img src="data:image/png;base64,${shot.png.toString('base64')}"><figcaption>${shot.label}</figcaption></figure>`,
    )
    .join('')
  await page.setContent(`<style>
    body { margin: 8px; font: 11px sans-serif; }
    h1 { margin: 0 0 4px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(${columns}, 240px); }
    figure { position: relative; margin: 0; }
    img { display: block; width: 240px; height: 150px; }
    figcaption { position: absolute; top: 2px; left: 2px; padding: 0 3px; background: #ffffffcc; }
  </style><h1>${title}</h1><div class="grid">${cells}</div>`)
  await page.screenshot({ path, type: 'jpeg', quality: 70, fullPage: true })
  await page.close()
}
