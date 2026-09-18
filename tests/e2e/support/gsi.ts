import { readFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import type { BrowserContext, Route } from '@playwright/test'

const demTile = readFileSync(
  new URL('../../fixtures/gsi/dem1a-17-116399-51623.png', import.meta.url),
)
const paleTile = readFileSync(new URL('../fixtures/tile.png', import.meta.url))

/** 256 × 256 の単色の PNG（RGB）。(128, 0, 0) は地理院の標高の無効値 */
export function solidPng(r: number, g: number, b: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(256, 0)
  header.writeUInt32BE(256, 4)
  header[8] = 8
  header[9] = 2
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: 256 }, () => [r, g, b]).flat()),
  ])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array(256).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const naTile = solidPng(128, 0, 0)

/** 地理院のタイルの URL（E2E の routeGsi と計測の routeDem〈tests/perf/demFixtures.ts〉が共有する） */
export const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/**'

type DemResponse = 'fixture' | 'na' | 'missing'
type Rule = DemResponse | ((x: number, y: number) => DemResponse)

/** DEM の種類ごとの応答。既定はすべて実タイル */
export interface GsiScenario {
  dem1a?: Rule
  dem5?: Rule // dem5a・dem5b・dem5c
  demPng?: Rule // DEM10B（dem_png）。海域判定にも使う
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
    const match = /\/xyz\/([^/]+)\/\d+\/(\d+)\/(\d+)\.(?:png|jpg)$/.exec(
      new URL(route.request().url()).pathname,
    )
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
    return fulfillPng(route, outcome === 'na' ? naTile : demTile)
  })
  return counts
}
