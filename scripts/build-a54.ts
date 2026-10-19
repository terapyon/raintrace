/**
 * 国土数値情報 A54（大規模盛土造成地）の GeoJSON を、z10 のタイルごとの JSON に分ける（spec 09 §4.4・R09-6）。
 *
 *   node scripts/build-a54.ts <GeoJSON のあるディレクトリ（下の階層も探す）> <出力先（public/data/a54）>
 *
 * 出力: `<出力先>/10/{x}/{y}.json` = `{ "features": [{ "type", "rings" }] }`。
 * 加工は、種別への読み替え、属性の削除、座標を小数 5 桁に丸める、輪ごとの間引き（Douglas–Peucker、許容 1e-5 度）、
 * 外接矩形が重なるタイルすべてへの振り分け。地物の無いタイルはファイルを作らない
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { A54_TILE_Z } from '../src/dem/fillHistory/constants.ts'

export type A54Type = 'valley' | 'side' | 'unclassified'
export type Position = number[]
export interface A54Feature {
  type: A54Type
  rings: Position[][]
}
export interface GeoJsonFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry:
    | { type: 'Polygon'; coordinates: Position[][] }
    | {
        type: 'MultiPolygon'
        coordinates: Position[][][]
      }
}

/** 間引きの許容誤差（度）。約 1 m */
export const SIMPLIFY_TOLERANCE_DEG = 1e-5
const DECIMALS = 5

const TYPE_BY_CODE: Record<string, A54Type> = { '1': 'valley', '2': 'side', '9': 'unclassified' }

export function roundCoord(v: number): number {
  return Number(v.toFixed(DECIMALS))
}

function distToSegment(p: Position, a: Position, b: Position): number {
  const [px = 0, py = 0] = p
  const [ax = 0, ay = 0] = a
  const [bx = 0, by = 0] = b
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** 開いた折れ線を Douglas–Peucker で間引く（両端は残す）。再帰を使わず、積んだ範囲を順に処理する */
function simplifyOpen(points: Position[], tol: number): Position[] {
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number]
    let maxD = -1
    let idx = -1
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(points[i] as Position, points[lo] as Position, points[hi] as Position)
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx >= 0 && maxD > tol) {
      keep[idx] = 1
      stack.push([lo, idx], [idx, hi])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}

/**
 * 閉じた輪（先頭と末尾が同じ）を間引く。始点から最も遠い点で 2 つに割り、それぞれを間引いて繋ぐ。
 * 結果が閉じた状態で 4 点に満たなければ null（潰れた輪）
 */
export function simplifyRing(ring: Position[], tol: number): Position[] | null {
  const pts = ring.slice(0, -1)
  if (pts.length < 3) return null
  const [x0 = 0, y0 = 0] = pts[0] as Position
  let far = 1
  let farD = -1
  for (let i = 1; i < pts.length; i++) {
    const [x = 0, y = 0] = pts[i] as Position
    const d = Math.hypot(x - x0, y - y0)
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const first = simplifyOpen(pts.slice(0, far + 1), tol)
  const second = simplifyOpen([...pts.slice(far), pts[0] as Position], tol)
  const out = [...first, ...second.slice(1)]
  return out.length >= 4 ? out : null
}

/** 丸めて、連続する同じ点を除き、閉じる。点が足りなければ null */
function roundRing(ring: Position[]): Position[] | null {
  const out: Position[] = []
  for (const p of ring) {
    const q = [roundCoord(p[0] ?? 0), roundCoord(p[1] ?? 0)]
    const last = out[out.length - 1]
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q)
  }
  const a = out[0]
  const b = out[out.length - 1]
  if (a && b && (a[0] !== b[0] || a[1] !== b[1])) out.push([...a])
  return out.length >= 4 ? out : null
}

/** 丸めてから間引く。間引きで潰れる小さな輪は、間引かない丸めただけの輪を使う */
function processRing(ring: Position[]): Position[] | null {
  const rounded = roundRing(ring)
  if (!rounded) return null
  const simplified = simplifyRing(rounded, SIMPLIFY_TOLERANCE_DEG)
  return (simplified ?? rounded).map((p) => [roundCoord(p[0] ?? 0), roundCoord(p[1] ?? 0)])
}

/** GeoJSON の地物 1 つを、種別の分かる地物（MultiPolygon なら複数）に変える。対象外の種別・潰れた外周は捨てる */
export function convertFeature(feature: GeoJsonFeature): A54Feature[] {
  const type = TYPE_BY_CODE[String(feature.properties.A54_001)]
  if (!type) return []
  const polygons =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates
  const out: A54Feature[] = []
  for (const polygon of polygons) {
    // 外周が潰れていたら、穴だけ残さず地物ごと捨てる
    const [outerRing, ...holes] = polygon
    const outer = outerRing && processRing(outerRing)
    if (!outer) continue
    const rings = [outer]
    for (const hole of holes) {
      const r = processRing(hole)
      if (r) rings.push(r)
    }
    out.push({ type, rings })
  }
  return out
}

/** 地物の外接矩形が重なる z10 タイル */
export function tilesForFeature(feature: A54Feature): Array<{ x: number; y: number }> {
  const n = 2 ** A54_TILE_Z
  let minLon = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  for (const ring of feature.rings) {
    for (const [lon = 0, lat = 0] of ring) {
      minLon = Math.min(minLon, lon)
      maxLon = Math.max(maxLon, lon)
      minLat = Math.min(minLat, lat)
      maxLat = Math.max(maxLat, lat)
    }
  }
  const tx = (lon: number) => Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)))
  const ty = (lat: number) => {
    const r = (lat * Math.PI) / 180
    const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
    return Math.min(n - 1, Math.max(0, Math.floor(y)))
  }
  const tiles: Array<{ x: number; y: number }> = []
  // 緯度は大きいほど y が小さい
  for (let x = tx(minLon); x <= tx(maxLon); x++) {
    for (let y = ty(maxLat); y <= ty(minLat); y++) tiles.push({ x, y })
  }
  return tiles
}

function findGeoJson(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...findGeoJson(p))
    else if (e.name.endsWith('.geojson')) out.push(p)
  }
  return out.sort()
}

function main(srcDir: string, outDir: string): void {
  const files = findGeoJson(srcDir)
  if (files.length === 0) throw new Error(`GeoJSON が見つからない: ${srcDir}`)
  const tiles = new Map<string, A54Feature[]>()
  let count = 0
  for (const file of files) {
    const json = JSON.parse(readFileSync(file, 'utf8')) as { features: GeoJsonFeature[] }
    for (const gf of json.features) {
      for (const f of convertFeature(gf)) {
        count++
        for (const { x, y } of tilesForFeature(f)) {
          const key = `${x}/${y}`
          const list = tiles.get(key)
          if (list) list.push(f)
          else tiles.set(key, [f])
        }
      }
    }
  }
  const root = join(outDir, String(A54_TILE_Z))
  rmSync(root, { recursive: true, force: true })
  for (const [key, features] of tiles) {
    const [x = '', y = ''] = key.split('/')
    mkdirSync(join(root, x), { recursive: true })
    writeFileSync(join(root, x, `${y}.json`), JSON.stringify({ features }))
  }
  console.log(`地物 ${count} 件、タイル ${tiles.size} 枚を ${root} に書いた`)
}

if (import.meta.main) {
  const [src, out] = process.argv.slice(2)
  if (!src || !out) {
    console.error('使い方: node scripts/build-a54.ts <GeoJSON のあるディレクトリ> <出力先>')
    process.exit(1)
  }
  main(src, out)
}
