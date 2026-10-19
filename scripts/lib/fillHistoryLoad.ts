/**
 * 開発機のスクリプト（scripts/fill-history-check.ts）が使う、盛土の履歴の取得と計算。
 * 今の DEM は src/dem の段の選び方（selectDem）で取り、昔の標高（dem_png z14）を今の格子に補間して、
 * ずれの補正・候補の抽出・根拠（A54・人工地形）まで求める。
 * 注意: タイルの取得の層（DEM・A54・人工地形の取得と読み取り）は src/workers/fillHistory.ts から複製したもので、
 * 共有しているのは計算（src/dem/fillHistory の関数）だけ。A54 は public/data/a54 から、人工地形（z14）は地理院から取る
 */
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import type { AssembledGrid, DemTileData } from '../../src/dem/DemGrid.ts'
import { assembleGrid } from '../../src/dem/DemGrid.ts'
import { type DemSelection, type FetchDemTile, selectDem } from '../../src/dem/demSelection.ts'
import { demTileUrl } from '../../src/dem/demSources.ts'
import { A54_TILE_Z } from '../../src/dem/fillHistory/constants.ts'
import { correctedDelta } from '../../src/dem/fillHistory/correctedDelta.ts'
import {
  type A54Type,
  classifyEvidence,
  type EvidencePolygon,
  rasterizePolygons,
} from '../../src/dem/fillHistory/evidence.ts'
import { findCandidates } from '../../src/dem/fillHistory/findCandidates.ts'
import {
  type GridFrame,
  pastTileCoords,
  resamplePast,
} from '../../src/dem/fillHistory/resamplePast.ts'
import { decodeGsiDem } from '../../src/dem/GsiDemDecoder.ts'
import { type TileCoord, tilesInPixelRect } from '../../src/dem/tileMath.ts'
import { decodePng } from '../../tests/e2e/support/png.ts'

const FILL_CODES = new Set(['11004', '11005', '11006', '11007', '11014', '4010201'])
const LANDFORM_Z = 14
type Rings = Array<Array<[number, number]>>

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

type Candidates = ReturnType<typeof findCandidates>['candidates']
type Evidence = ReturnType<typeof classifyEvidence>

interface Loaded {
  selection: DemSelection
  current: AssembledGrid
  frame: GridFrame
}

export type FillHistoryLoad =
  | (Loaded & { status: 'tier3' })
  | (Loaded & { status: 'no-overlap' })
  | (Loaded & {
      status: 'ok'
      offsetM: number
      /** 昔の標高（offsetM を足す前。NaN は無効） */
      pastElevation: Float32Array
      /** 補正後の標高差（今 − 昔 − 補正値） */
      delta: Float32Array
      labels: Int32Array
      candidates: Candidates
      evidence: Evidence
      a54Count: number
      /** 人工地形の盛土地のポリゴンの数。全タイル 404 なら null */
      landformCount: number | null
      /** タイル・データの取得（ms） */
      networkMs: number
      /** 取得を除く計算（ms） */
      timesMs: { total: number; resample: number; delta: number; find: number; evidence: number }
    })

/** 盛土の履歴を、アプリの Worker と同じ関数で求める。shiftM は昔の標高を東へ <m> ずらす（位置のずれの記録用） */
export async function loadFillHistory(
  lat: number,
  lon: number,
  sizeM: number,
  shiftM = 0,
): Promise<FillHistoryLoad> {
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
  if (tier.level === 3) return { status: 'tier3', selection, current, frame }

  // 昔の標高（dem_png z14）
  const pastTiles = new Map<string, DemTileData | undefined>()
  await Promise.all(
    pastTileCoords(frame).map(async (tile) => {
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
          new URL(`../../public/data/a54/${tile.z}/${tile.x}/${tile.y}.json`, import.meta.url),
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
  const networkMs = performance.now() - t0

  // 計算（タイル取得を除く）
  const lookup = (tx: number, ty: number) => pastTiles.get(`${tx}/${ty}`)
  const tc = performance.now()
  // 昔を東へ shiftM ずらす = 昔の標高を（今の格子で）西へ shiftM の位置から読む
  const shiftedFrame: GridFrame = { ...frame, originX: frame.originX - shiftM / frame.cellSizeM }
  const pastElev = resamplePast(shiftedFrame, lookup)
  const tResample = performance.now()
  const corrected = correctedDelta(current.elevation, current.validMask, pastElev)
  if (corrected === null) return { status: 'no-overlap', selection, current, frame }
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
  return {
    status: 'ok',
    selection,
    current,
    frame,
    offsetM: corrected.offsetM,
    pastElevation: pastElev,
    delta: corrected.delta,
    labels,
    candidates,
    evidence,
    a54Count: a54Polys.length,
    landformCount: landformAvailable ? landformPolys.length : null,
    networkMs,
    timesMs: {
      total: tEnd - tc,
      resample: tResample - tc,
      delta: tDelta - tResample,
      find: tFind - tDelta,
      evidence: tEnd - tFind,
    },
  }
}

const LEVEL_ORDER = { strong: 0, moderate: 1, limited: 2 } as const

/** アプリの一覧と同じ並び（根拠の強い順、同じなら体積の大きい順） */
export function inAppOrder(candidates: Candidates, evidence: Evidence): Candidates {
  const levelOf = (id: number) => evidence.get(id)?.level ?? 'limited'
  return [...candidates].sort(
    (a, b) => LEVEL_ORDER[levelOf(a.id)] - LEVEL_ORDER[levelOf(b.id)] || b.volumeM3 - a.volumeM3,
  )
}
