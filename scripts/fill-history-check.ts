/**
 * 盛土の履歴を実際の地理院タイルで確かめる（spec 09 §3.6・§7.3）。Node 24 で直接実行する:
 *
 *   node scripts/fill-history-check.ts <lat> <lon> <sizeM> [--shift-past <m>] [--limit <N>]
 *
 * 今の DEM は src/dem の段の選び方（selectDem）で取り、昔の標高（dem_png z14）を今の格子に補間して、
 * ずれの補正・候補の抽出・根拠（A54・人工地形）まで求める。使った DEM・ずれ・候補（面積・最大・体積・根拠）と、
 * タイルの取得を除いた計算の時間を Markdown で出す。候補の一覧はアプリ（Worker）と同じ並び（根拠の強い順、同じなら体積の大きい順）で、
 * 「#」は候補の id（面積の大きい順）。--limit <N> で表示する件数を変える（既定 15）。
 * 注意: タイルの取得の層（DEM・A54・人工地形の取得と読み取り）は src/workers/fillHistory.ts から複製したもので、
 * 共有しているのは計算（src/dem/fillHistory の関数）だけ。--shift-past は昔の標高を東へ <m> ずらす（位置のずれの記録用）。
 * 合否は判定しない。A54 は public/data/a54 から、人工地形（z14）は地理院から取る
 */
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import type { DemTileData } from '../src/dem/DemGrid.ts'
import { assembleGrid } from '../src/dem/DemGrid.ts'
import { type FetchDemTile, selectDem } from '../src/dem/demSelection.ts'
import { demTileUrl } from '../src/dem/demSources.ts'
import { A54_TILE_Z } from '../src/dem/fillHistory/constants.ts'
import { correctedDelta } from '../src/dem/fillHistory/correctedDelta.ts'
import {
  type A54Type,
  classifyEvidence,
  type EvidencePolygon,
  rasterizePolygons,
} from '../src/dem/fillHistory/evidence.ts'
import { findCandidates } from '../src/dem/fillHistory/findCandidates.ts'
import {
  type GridFrame,
  pastTileCoords,
  resamplePast,
} from '../src/dem/fillHistory/resamplePast.ts'
import { decodeGsiDem } from '../src/dem/GsiDemDecoder.ts'
import { pixelToLonLat, type TileCoord, tilesInPixelRect } from '../src/dem/tileMath.ts'
import { decodePng } from '../tests/e2e/support/png.ts'

const FILL_CODES = new Set(['11004', '11005', '11006', '11007', '11014', '4010201'])
const LANDFORM_Z = 14
type Rings = Array<Array<[number, number]>>

const args = process.argv.slice(2)
const shiftIdx = args.indexOf('--shift-past')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 15
const shiftM = shiftIdx >= 0 ? Number(args[shiftIdx + 1]) : 0
// 位置引数だけ残す（後ろの添字から消すので、順序によらず添字がずれない）
for (const idx of [limitIdx, shiftIdx].filter((i) => i >= 0).sort((a, b) => b - a))
  args.splice(idx, 2)
const [lat, lon, sizeM] = args.map(Number) as [number, number, number]
if (![lat, lon, sizeM].every(Number.isFinite) || !Number.isFinite(shiftM) || !(limit >= 0)) {
  console.error(
    '使い方: node scripts/fill-history-check.ts <lat> <lon> <sizeM> [--shift-past <m>] [--limit <N>]',
  )
  process.exit(1)
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url)
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return Buffer.from(await r.arrayBuffer())
    } catch (e) {
      if (attempt >= 2) throw e
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt))
    }
  }
}

let networkMs = 0
const demCache = new Map<
  string,
  Promise<ReturnType<FetchDemTile> extends Promise<infer R> ? R : never>
>()
const fetchDem: FetchDemTile = (dem, tile) => {
  const url = demTileUrl(dem, tile)
  let p = demCache.get(url)
  if (!p) {
    p = (async () => {
      const buf = await fetchBuffer(url)
      if (buf === null) return { status: 'missing' as const }
      const img = decodePng(buf)
      let rgba: Uint8Array = img.data
      if (img.channels === 3) {
        rgba = new Uint8Array(img.width * img.height * 4)
        for (let i = 0; i < img.width * img.height; i++) {
          rgba[i * 4] = img.data[i * 3] as number
          rgba[i * 4 + 1] = img.data[i * 3 + 1] as number
          rgba[i * 4 + 2] = img.data[i * 3 + 2] as number
          rgba[i * 4 + 3] = 255
        }
      }
      return { status: 'ok' as const, data: decodeGsiDem(rgba) }
    })()
    demCache.set(url, p)
  }
  return p
}

function tilesCovering(frame: GridFrame, z: number): TileCoord[] {
  const k = 2 ** (z - frame.z)
  return tilesInPixelRect(
    {
      x0: frame.originX * k,
      y0: frame.originY * k,
      x1: (frame.originX + frame.size) * k,
      y1: (frame.originY + frame.size) * k,
    },
    z,
  )
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US')

const t0 = performance.now()
const selection = await selectDem(lon, lat, sizeM, fetchDem)
const { range, tier } = selection
const current = assembleGrid(range, (tx, ty) => selection.tiles.get(`${tx}/${ty}`))
const frame: GridFrame = {
  z: range.z,
  originX: range.originX,
  originY: range.originY,
  size: range.size,
  cellSizeM: range.cellSizeM,
}

console.log(`## ${lat}, ${lon} / ${sizeM} m${shiftM ? ` / 昔を東へ ${shiftM} m ずらす` : ''}`)
console.log('')
console.log(
  `- 今の DEM: 段 ${tier.level}（z${range.z}）、内訳 ${JSON.stringify(selection.breakdown)}`,
)
console.log(
  `- 格子: ${range.size} x ${range.size} セル（セル ${range.cellSizeM.toFixed(3)} m）、無効 ${(current.invalidRatio * 100).toFixed(1)}%`,
)
if (tier.level === 3) {
  console.log('- 段 3（DEM10B）のため、昔と比べられない（機能は unavailable）')
  process.exit(0)
}

// 昔の標高（dem_png z14）
const pastCoords = pastTileCoords(frame)
const pastTiles = new Map<string, DemTileData | undefined>()
await Promise.all(
  pastCoords.map(async (tile) => {
    const r = await fetchDem('dem10b', tile)
    pastTiles.set(`${tile.x}/${tile.y}`, r.status === 'ok' ? r.data : undefined)
  }),
)

// A54（ローカルの静的タイル）と人工地形（z14、全部 404 なら使えない）
const a54Polys: EvidencePolygon[] = []
for (const tile of tilesCovering(frame, A54_TILE_Z)) {
  try {
    const json = JSON.parse(
      readFileSync(
        new URL(`../public/data/a54/${tile.z}/${tile.x}/${tile.y}.json`, import.meta.url),
        'utf8',
      ),
    ) as { features: Array<{ type: A54Type; rings: Rings }> }
    for (const f of json.features) a54Polys.push({ rings: f.rings, a54Type: f.type })
  } catch {
    // タイルが無い = 地物なし
  }
}
const landformPolys: EvidencePolygon[] = []
let landformFound = 0
for (const tile of tilesCovering(frame, LANDFORM_Z)) {
  const url = `https://cyberjapandata.gsi.go.jp/xyz/experimental_landformclassification2/${tile.z}/${tile.x}/${tile.y}.geojson`
  const buf = await fetchBuffer(url)
  if (buf === null) continue
  landformFound++
  const json = JSON.parse(buf.toString('utf8')) as {
    features: Array<{
      properties: { code: string }
      geometry: { type: string; coordinates: unknown }
    }>
  }
  for (const f of json.features) {
    if (!FILL_CODES.has(f.properties.code)) continue
    if (f.geometry.type === 'Polygon')
      landformPolys.push({ rings: f.geometry.coordinates as Rings })
    else if (f.geometry.type === 'MultiPolygon') {
      for (const p of f.geometry.coordinates as Rings[]) landformPolys.push({ rings: p })
    }
  }
}
const landformAvailable = landformFound > 0
networkMs = performance.now() - t0

// 計算（タイル取得を除く）
const lookup = (tx: number, ty: number) => pastTiles.get(`${tx}/${ty}`)
const tc = performance.now()
// 昔を東へ shiftM ずらす = 昔の標高を（今の格子で）西へ shiftM の位置から読む
const shiftedFrame: GridFrame = { ...frame, originX: frame.originX - shiftM / frame.cellSizeM }
const pastElev = resamplePast(shiftedFrame, lookup)
const tResample = performance.now()
const corrected = correctedDelta(current.elevation, current.validMask, pastElev)
if (corrected === null) {
  console.log('- 昔と今の両方に標高があるセルが無い（no-overlap）')
  process.exit(0)
}
const tDelta = performance.now()
const { labels, candidates } = findCandidates(corrected.delta, frame)
const tFind = performance.now()
const evidence = classifyEvidence(
  labels,
  candidates,
  { mask: rasterizePolygons(frame, a54Polys), polygons: a54Polys },
  landformAvailable ? rasterizePolygons(frame, landformPolys) : null,
)
const tEnd = performance.now()

console.log(`- ずれの補正値（今 − 昔の中央値）: ${corrected.offsetM.toFixed(2)} m`)
console.log(
  `- A54: ${a54Polys.length} ポリゴン、人工地形（盛土地）: ${landformAvailable ? `${landformPolys.length} ポリゴン` : '取得できず（全タイル 404）'}`,
)
console.log(
  `- 時間: タイル・データ取得 ${(networkMs / 1000).toFixed(2)} s / 計算 合計 ${(tEnd - tc).toFixed(0)} ms（補間 ${(tResample - tc).toFixed(0)}、ずれの補正 ${(tDelta - tResample).toFixed(0)}、候補抽出 ${(tFind - tDelta).toFixed(0)}、根拠 ${(tEnd - tFind).toFixed(0)}）`,
)
console.log(
  `- 候補 ${candidates.length} 件、面積の合計 ${fmtInt(candidates.reduce((s, c) => s + c.areaM2, 0))} m²`,
)
console.log('')
console.log('| # | 面積 m² | 最大 m | 体積 m³ | 中心 | 根拠 |')
console.log('| --- | ---: | ---: | ---: | --- | --- |')
const levelText = { strong: '強い', moderate: '中くらい', limited: '限られる' } as const
const levelOrder = { strong: 0, moderate: 1, limited: 2 } as const
const levelOf = (id: number) => evidence.get(id)?.level ?? 'limited'
// アプリの一覧と同じ並び（根拠の強い順、同じなら体積の大きい順）
const shown = [...candidates].sort(
  (a, b) => levelOrder[levelOf(a.id)] - levelOrder[levelOf(b.id)] || b.volumeM3 - a.volumeM3,
)
for (const c of shown.slice(0, limit)) {
  const e = evidence.get(c.id)
  const p = pixelToLonLat(
    frame.originX + c.centroid.col + 0.5,
    frame.originY + c.centroid.row + 0.5,
    frame.z,
  )
  const src = e?.sources
    .map((s) => (s === 'a54' ? `A54${e.a54Type ? `(${e.a54Type})` : ''}` : '人工地形'))
    .join('+')
  console.log(
    `| ${c.id} | ${fmtInt(c.areaM2)} | +${c.maxRiseM.toFixed(1)} | ${fmtInt(c.volumeM3)} | ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} | ${levelText[e?.level ?? 'limited']}${src ? ` [${src}]` : ''} |`,
  )
}
if (shown.length > limit) console.log(`| … | 他 ${shown.length - limit} 件 | | | | |`)
