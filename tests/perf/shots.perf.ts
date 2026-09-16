import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import { drawnTileZoom } from '../../src/dem/tileZoom'
import {
  MIN_3D_DRAWN_TILE_ZOOM,
  MIN_3D_VIEW_ZOOM,
  mapZoomForCentreTileZoom,
} from '../../src/map/view3d/drawnZoom'
import { acknowledgeDisclaimer } from '../e2e/support/app'

// 撮影（spec 05 §5 の手動、§6 の 4）。pnpm build:perf の後に RAINTRACE_SHOTS=<組> pnpm perf:fps -g 撮影 で回す。
// (c) は有効のまま撮る（アプリの見え方）。どの画像が 3D・2D で描かれたかを index.md に書く
const SHIBUYA = { lat: '35.658000', lon: '139.701600' }
// 水が画面で見えるよう、500mm・半径 50m を「最速」で 20 秒回してから撮る（04 の URL の mm・r）
const WATER = { water: '1', mm: '500', r: '50', settle: '20000' }
const VIEWPORT = { width: 960, height: 600 }
const outDir = fileURLToPath(new URL('../../.handoff/05-screenshots/', import.meta.url))

interface Shot {
  file: string
  query: Record<string, string>
}

interface Captured {
  file: string
  view3d: string
  drawnTileZoom: string
  mapZoom: string
}

/**
 * 画面の中心で描かれる地形タイルが z になる（見込み）地図のズーム。実測は同じか細かい（pitch 85 では 2 段細かい
 * こともある）ので、ファイル名の drawnNN は見込みのラベル。実測は index の「画面の中心のタイル」を正とする
 */
const zoomForDrawn = (z: number, pitch: number): string =>
  mapZoomForCentreTileZoom(drawnTileZoom(z), pitch).toFixed(3)

function matrixShots(): Shot[] {
  const shots: Shot[] = []
  for (const z of [15, 16, 17, 18]) {
    for (const ex of [1, 2, 5, 10]) {
      for (const pitch of [0, 45, 60, 85]) {
        shots.push({
          file: `matrix/z${z}-x${ex}-p${pitch}.png`,
          query: { size: '500', z: String(z), ex: String(ex), pitch: String(pitch), ...WATER },
        })
      }
    }
  }
  return shots
}

/** 境界 15 と 16 の比べ（spec 05 §4.3・§6 の 4）。境界 16 のときの見え方は、同じ視点の 2D（mode=2d） */
function boundaryShots(): Shot[] {
  const shots: Shot[] = []
  for (const mode of ['3d', '2d']) {
    // 1000 m の範囲全体を 960 × 600 に収める視点（約 15.0、pitch 60）。アプリの 3D の最初の視点（16.5）ではない。
    // 中心のタイルは 14 なので、境界 15 でも 2D に落ちる（index.md に出る）
    shots.push({
      file: `boundary/1000m-fit-p60-${mode}.png`,
      query: { size: '1000', z: '15', ex: '2', pitch: '60', mode, ...WATER },
    })
    // 画面の中心で描かれる地形タイルが境界（15）になる斜め視点
    for (const pitch of [60, 85]) {
      for (const ex of [1, 10]) {
        shots.push({
          file: `boundary/drawn${MIN_3D_DRAWN_TILE_ZOOM}-p${pitch}-x${ex}-${mode}.png`,
          query: {
            size: '500',
            z: zoomForDrawn(MIN_3D_DRAWN_TILE_ZOOM, pitch),
            ex: String(ex),
            pitch: String(pitch),
            mode,
            ...WATER,
          },
        })
      }
    }
  }
  // 遠景の沈み込み（pitch 85 が最悪。spec 05 §6 の 4）。画面の中心のタイルが 15・16 で、アプリが 3D で描く視点
  for (const drawn of [15, 16]) {
    for (const ex of [1, 10]) {
      shots.push({
        file: `sag/drawn${drawn}-p85-x${ex}.png`,
        query: { size: '1000', z: zoomForDrawn(drawn, 85), ex: String(ex), pitch: '85', ...WATER },
      })
    }
  }
  return shots
}

/** 矢印の密度（spec 05 §3.3。既定の間隔は 1000 m で 20 m、250 m で 5 m） */
function arrowShots(): Shot[] {
  return [
    {
      file: 'arrows/1000m-2d.png',
      query: { size: '1000', z: '15.3', pitch: '0', mode: '2d', ...WATER },
    },
    {
      file: 'arrows/1000m-3d.png',
      query: { size: '1000', z: String(MIN_3D_VIEW_ZOOM), ex: '2', pitch: '60', ...WATER },
    },
    {
      file: 'arrows/250m-2d.png',
      query: { size: '250', z: '17.3', pitch: '0', mode: '2d', ...WATER },
    },
  ]
}

const SETS: Record<string, () => Shot[]> = {
  matrix: matrixShots,
  boundary: boundaryShots,
  arrows: arrowShots,
}

async function capture(page: Page, shot: Shot): Promise<Captured> {
  const query = new URLSearchParams({ ...SHIBUYA, probe: 'view', ...shot.query })
  await page.goto(`/?${query}`)
  await expect(page.locator('html[data-perf-ready="true"], html[data-perf-error]')).toBeAttached({
    timeout: 240_000,
  })
  const failure = await page.locator('html').getAttribute('data-perf-error')
  if (failure !== null) throw new Error(`撮影の失敗（${shot.file}）: ${failure}`)
  await page.screenshot({ path: `${outDir}${shot.file}` })
  const map = page.locator('[data-map-loaded="true"]')
  return {
    file: shot.file,
    view3d: (await map.getAttribute('data-view3d')) ?? 'off',
    drawnTileZoom: (await map.getAttribute('data-drawn-tile-zoom')) ?? '',
    mapZoom: (await map.getAttribute('data-map-zoom')) ?? '',
  }
}

test('撮影', async ({ browser }, testInfo) => {
  const name = process.env.RAINTRACE_SHOTS ?? 'boundary'
  const make = SETS[name]
  if (make === undefined) throw new Error(`撮影の組がありません: ${name}`)
  const shots = make()
  // 1 枚の上限（240 秒）× 枚数。matrix の 64 枚は最悪 256 分で、config の 90 分を超える
  test.setTimeout(shots.length * 240_000)
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL ?? 'http://localhost:4175',
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  })
  await acknowledgeDisclaimer(context)
  const page = await context.newPage()
  for (const dir of ['matrix', 'boundary', 'sag', 'arrows']) {
    mkdirSync(`${outDir}${dir}`, { recursive: true })
  }
  const rows: Captured[] = []
  for (const shot of shots) rows.push(await capture(page, shot))
  await context.close()
  const lines = [
    '| 画像 | 描き方（data-view3d） | 画面の中心のタイル | 地図のズーム |',
    '|---|---|---:|---:|',
    ...rows.map((r) => `| ${r.file} | ${r.view3d} | ${r.drawnTileZoom} | ${r.mapZoom} |`),
  ]
  writeFileSync(`${outDir}index-${name}.md`, `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
})
