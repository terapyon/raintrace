/**
 * spec 08 の M0 の試作（使い捨て。計画の最後に消す。spec 08 §11）: 固定の DEM のフィクスチャ（spec 06 §4.1）から
 * 3 地点の範囲を組み立てる。アプリと同じ selectDem・assembleGrid・decodeGsiDem を使い、タイルは
 * tests/perf/fixtures/dem-manifest.json と .cache/perf-dem/<SHA-256>.png から読む（地理院には接続しない）
 */
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { assembleGrid } from '../../src/dem/DemGrid.ts'
import { type DemSelection, selectDem, tileKey } from '../../src/dem/demSelection.ts'
import { demTileUrl } from '../../src/dem/demSources.ts'
import { decodeGsiDem } from '../../src/dem/GsiDemDecoder.ts'

export const SITES = {
  ayase: { label: '綾瀬', lat: 35.7623, lon: 139.8246 },
  shibuya: { label: '渋谷', lat: 35.658, lon: 139.7016 },
  minatomirai: { label: 'みなとみらい', lat: 35.4575, lon: 139.632 },
} as const
export type SiteName = keyof typeof SITES

type Entry = { status: 200; sha256: string } | { status: 404 }
const root = new URL('../../', import.meta.url)
const manifest = JSON.parse(
  readFileSync(new URL('tests/perf/fixtures/dem-manifest.json', root), 'utf8'),
) as Record<string, Entry>

/** 8 bit・RGB（色の型 2）・インターレース無しの PNG だけを復号し、RGBA を返す（地理院の標高タイルの形） */
export function decodePng(buf: Buffer): { width: number; height: number; rgba: Uint8Array } {
  let pos = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('latin1', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 2 || data[12] !== 0) throw new Error('未対応の PNG')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 3
  const stride = width * bpp
  const out = new Uint8Array(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? (out[dst + x - bpp] ?? 0) : 0
      const b = y > 0 ? (out[dst - stride + x] ?? 0) : 0
      const c = x >= bpp && y > 0 ? (out[dst - stride + x - bpp] ?? 0) : 0
      let v = raw[src + x] ?? 0
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      out[dst + x] = v & 255
    }
  }
  const rgba = new Uint8Array(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = out[p * 3] ?? 0
    rgba[p * 4 + 1] = out[p * 3 + 1] ?? 0
    rgba[p * 4 + 2] = out[p * 3 + 2] ?? 0
    rgba[p * 4 + 3] = 255
  }
  return { width, height, rgba }
}

export interface SiteGrid {
  name: SiteName
  elevation: Float32Array
  validMask: Uint8Array
  width: number
  height: number
  cellSizeM: number
  invalidRatio: number
  demLevel: number
  /** クリックした地点（降雨中心）のグリッドの北西端からの距離（m） */
  center: { x: number; y: number }
}

export async function loadSite(name: SiteName, sizeM: number): Promise<SiteGrid> {
  const site = SITES[name]
  const selection: DemSelection = await selectDem(site.lon, site.lat, sizeM, async (dem, tile) => {
    const path = new URL(demTileUrl(dem, tile)).pathname
    const entry = manifest[path]
    if (entry === undefined) throw new Error(`manifest に無い: ${path}`)
    if (entry.status === 404) return { status: 'missing' }
    const png = decodePng(readFileSync(new URL(`.cache/perf-dem/${entry.sha256}.png`, root)))
    return { status: 'ok', data: decodeGsiDem(png.rgba) }
  })
  const grid = assembleGrid(selection.range, (tx, ty) => selection.tiles.get(tileKey(tx, ty)))
  const r = selection.range
  return {
    name,
    ...grid,
    demLevel: selection.tier.level,
    center: {
      x: (r.center.x - r.originX) * r.cellSizeM,
      y: (r.center.y - r.originY) * r.cellSizeM,
    },
  }
}
