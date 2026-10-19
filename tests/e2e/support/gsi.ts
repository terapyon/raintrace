import { readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import type { BrowserContext, Route } from '@playwright/test'

const demTile = readFileSync(
  new URL('../../fixtures/gsi/dem1a-17-116399-51623.png', import.meta.url),
)
const paleTile = readFileSync(new URL('../fixtures/tile.png', import.meta.url))

/** width × height の PNG（RGB）。pixel(x, y) が各画素の [r, g, b] */
function encodeRgbPng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => readonly [number, number, number],
): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const raw = Buffer.alloc((1 + width * 3) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3)
    raw[row] = 0 // フィルタ無し
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      raw.set([r, g, b], row + 1 + x * 3)
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 256 × 256 の単色の PNG（RGB）。(128, 0, 0) は地理院の標高の無効値 */
export function solidPng(r: number, g: number, b: number): Buffer {
  return encodeRgbPng(256, 256, () => [r, g, b])
}

/**
 * 地理院の標高タイル（標高 = (R × 65536 + G × 256 + B) × 0.01 m。(128, 0, 0) は無効値）の PNG。
 * elevationAt が null を返した画素は無効値にする
 */
export function encodeDemPng(
  width: number,
  height: number,
  elevationAt: (x: number, y: number) => number | null,
): Buffer {
  return encodeRgbPng(width, height, (x, y) => {
    const elevation = elevationAt(x, y)
    if (elevation === null) return [128, 0, 0]
    const value = Math.round(elevation * 100) & 0xffffff // 負は 2^24 を足した値
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
  })
}

const naTile = solidPng(128, 0, 0)

/** 地理院のタイルの URL（E2E の routeGsi と計測の routeDem〈tests/perf/demFixtures.ts〉が共有する） */
export const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/**'

type DemResponse = 'fixture' | 'na' | 'missing' | Buffer
type Rule = DemResponse | ((x: number, y: number) => DemResponse)

/** DEM の種類ごとの応答。既定はすべて実タイル */
export interface GsiScenario {
  dem1a?: Rule
  dem5?: Rule // dem5a・dem5b・dem5c
  demPng?: Rule // DEM10B（dem_png）。海域判定にも使う
  /** 人工地形（experimental_landformclassification2）。既定は 'missing'（すべて 404）、'error' は 500 */
  landform?: 'missing' | 'error' | 'fill'
}

/** 渋谷駅付近を広く覆う盛土地（code 11004）の人工地形の GeoJSON。盛土の履歴の E2E 用 */
export const LANDFORM_FILL_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { code: '11004' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [139.65, 35.61],
            [139.75, 35.61],
            [139.75, 35.71],
            [139.65, 35.71],
            [139.65, 35.61],
          ],
        ],
      },
    },
  ],
}

export interface GsiCounts {
  pale: number
  std: number
  photo: number
  dem: number
}

export const fulfillPng = (route: Route, body: Buffer) =>
  route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    body,
  })

export const fulfillNotFound = (route: Route) =>
  route.fulfill({
    status: 404,
    headers: { 'access-control-allow-origin': '*' },
    body: 'not found',
  })

/** 地理院への要求を差し替える。Worker の中の fetch も捕まえるため browserContext で差し替える */
export async function routeGsi(
  context: BrowserContext,
  scenario: GsiScenario = {},
): Promise<GsiCounts> {
  const counts: GsiCounts = { pale: 0, std: 0, photo: 0, dem: 0 }
  await context.route(GSI_TILE_URL, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('.geojson')) {
      const mode = scenario.landform ?? 'missing'
      if (mode === 'missing') return fulfillNotFound(route)
      if (mode === 'error') {
        return route.fulfill({
          status: 500,
          headers: { 'access-control-allow-origin': '*' },
          body: 'error',
        })
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(LANDFORM_FILL_GEOJSON),
      })
    }
    const match = /\/xyz\/([^/]+)\/\d+\/(\d+)\/(\d+)\.(?:png|jpg)$/.exec(pathname)
    const path = match?.[1]
    // 背景地図は 3 つとも同じ画像で応える。ブラウザは中身で画像の形式を判定する
    if (path === 'pale' || path === 'std' || path === 'seamlessphoto') {
      if (path === 'pale') counts.pale++
      else if (path === 'std') counts.std++
      else counts.photo++
      return fulfillPng(route, paleTile)
    }
    counts.dem++
    const rule: Rule =
      path === 'dem1a_png'
        ? (scenario.dem1a ?? 'fixture')
        : path?.startsWith('dem5') === true
          ? (scenario.dem5 ?? 'fixture')
          : path === 'dem_png'
            ? (scenario.demPng ?? 'fixture')
            : 'missing'
    const outcome = typeof rule === 'function' ? rule(Number(match?.[2]), Number(match?.[3])) : rule
    if (outcome === 'missing') return fulfillNotFound(route)
    if (Buffer.isBuffer(outcome)) return fulfillPng(route, outcome)
    return fulfillPng(route, outcome === 'na' ? naTile : demTile)
  })
  return counts
}
