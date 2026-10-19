import { createLimiter, GSI_RETRY_DELAYS_MS, retry } from '../dem/async'
import type { DemTileData } from '../dem/DemGrid'
import type { FetchDemTile } from '../dem/demSelection'
import { A54_TILE_Z } from '../dem/fillHistory/constants.ts'
import { correctedDelta } from '../dem/fillHistory/correctedDelta.ts'
import {
  classifyEvidence,
  type EvidencePolygon,
  rasterizePolygons,
} from '../dem/fillHistory/evidence.ts'
import { findCandidates } from '../dem/fillHistory/findCandidates.ts'
import { pastTileCoords, resamplePast } from '../dem/fillHistory/resamplePast.ts'
import {
  lonLatToPixel,
  type PixelRect,
  pixelToLonLat,
  type TileCoord,
  tilesInPixelRect,
} from '../dem/tileMath'
import type {
  A54Type,
  FillCandidate,
  FillEvidence,
  FillHistoryFailureReason,
  FillHistoryPayload,
  TerrainGeo,
} from '../shared/protocol'
import { HttpError, NetworkError, TILE_FETCH_TIMEOUT_MS } from './demLoader'

/** 人工地形タイルのズームレベル。実データは z14 までで、z15 以上は 404 */
const LANDFORM_TILE_Z = 14

/** 盛土地・埋立地（盛土の根拠に使う） */
const FILL_CODES: ReadonlySet<string> = new Set([
  '11004',
  '11005',
  '11006',
  '11007',
  '11014',
  '4010201',
])
/** 切土地・改変工事中（地図にだけ描く） */
const MAP_ONLY_CODES: ReadonlySet<string> = new Set([
  '11001',
  '11003',
  '11009',
  '11011',
  '4010301',
  '11010',
])

const landformUrl = (tile: TileCoord): string =>
  `https://cyberjapandata.gsi.go.jp/xyz/experimental_landformclassification2/${tile.z}/${tile.x}/${tile.y}.geojson`
const a54Url = (tile: TileCoord): string => `/data/a54/${tile.z}/${tile.x}/${tile.y}.json`

export class FillHistoryError extends Error {
  readonly reason: FillHistoryFailureReason
  constructor(reason: FillHistoryFailureReason, message: string) {
    super(message)
    this.reason = reason
  }
}

export interface FillHistoryInput {
  terrainId: number
  geo: TerrainGeo
  elevation: Float32Array
  validMask: Uint8Array
}

export interface FillHistoryDeps {
  fetchDem: FetchDemTile
  /** 404 は null、それ以外の失敗は reject */
  fetchJson: (url: string) => Promise<unknown | null>
}

type Rings = Array<Array<[number, number]>>

const EVIDENCE_ORDER: Record<FillEvidence, number> = { strong: 0, moderate: 1, limited: 2 }

/** 格子の範囲を zoom の z のタイルに写して、かかるタイルを返す */
function tilesCovering(geo: TerrainGeo, z: number): TileCoord[] {
  const k = 2 ** (z - geo.z)
  const rect: PixelRect = {
    x0: geo.originX * k,
    y0: geo.originY * k,
    x1: (geo.originX + geo.size) * k,
    y1: (geo.originY + geo.size) * k,
  }
  return tilesInPixelRect(rect, z)
}

function parseRings(value: unknown): Rings {
  if (!Array.isArray(value)) throw new Error('rings が配列ではない')
  return value.map((ring) => {
    if (!Array.isArray(ring)) throw new Error('ring が配列ではない')
    return ring.map((pt) => {
      if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') {
        throw new Error('座標の形式が誤り')
      }
      return [pt[0], pt[1]] as [number, number]
    })
  })
}

function parseA54Tile(json: unknown): Array<{ rings: Rings; a54Type: A54Type }> {
  const features = (json as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) throw new Error('A54 タイルの形式が誤り')
  return features.map((f) => {
    const type = (f as { type?: unknown }).type
    if (type !== 'valley' && type !== 'side' && type !== 'unclassified') {
      throw new Error('A54 の type が誤り')
    }
    return { rings: parseRings((f as { rings?: unknown }).rings), a54Type: type }
  })
}

/** 人工地形の GeoJSON から、対象の code のポリゴン（MultiPolygon は分ける）を取り出す */
function parseLandformTile(json: unknown): Array<{ rings: Rings; code: string }> {
  const features = (json as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) throw new Error('人工地形タイルの形式が誤り')
  const out: Array<{ rings: Rings; code: string }> = []
  for (const f of features) {
    const code = (f as { properties?: { code?: unknown } }).properties?.code
    if (typeof code !== 'string') throw new Error('人工地形の code が誤り')
    if (!FILL_CODES.has(code) && !MAP_ONLY_CODES.has(code)) continue
    const geometry = (f as { geometry?: { type?: unknown; coordinates?: unknown } }).geometry
    if (geometry?.type === 'Polygon') {
      out.push({ rings: parseRings(geometry.coordinates), code })
    } else if (geometry?.type === 'MultiPolygon') {
      if (!Array.isArray(geometry.coordinates)) throw new Error('MultiPolygon の形式が誤り')
      for (const polygon of geometry.coordinates) out.push({ rings: parseRings(polygon), code })
    } else {
      throw new Error('人工地形の geometry が誤り')
    }
  }
  return out
}

/** ポリゴンの外接矩形が格子の範囲にかかるか（地図に描く分を絞る） */
function overlapsRange(rings: Rings, geo: TerrainGeo): boolean {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      const p = lonLatToPixel(lon, lat, geo.z)
      if (p.x < minX) minX = p.x
      if (p.x > maxX) maxX = p.x
      if (p.y < minY) minY = p.y
      if (p.y > maxY) maxY = p.y
    }
  }
  return (
    maxX >= geo.originX &&
    minX <= geo.originX + geo.size &&
    maxY >= geo.originY &&
    minY <= geo.originY + geo.size
  )
}

async function loadA54(
  geo: TerrainGeo,
  fetchJson: FillHistoryDeps['fetchJson'],
): Promise<Array<{ rings: Rings; a54Type: A54Type }> | null> {
  try {
    const tiles = await Promise.all(
      tilesCovering(geo, A54_TILE_Z).map(async (tile) => {
        const json = await fetchJson(a54Url(tile))
        return json === null ? [] : parseA54Tile(json) // 404 は地物なし
      }),
    )
    return tiles.flat().filter((p) => overlapsRange(p.rings, geo))
  } catch {
    return null
  }
}

async function loadLandform(
  geo: TerrainGeo,
  fetchJson: FillHistoryDeps['fetchJson'],
): Promise<Array<{ rings: Rings; code: string }> | null> {
  try {
    const tiles = await Promise.all(
      tilesCovering(geo, LANDFORM_TILE_Z).map(async (tile) => {
        const json = await fetchJson(landformUrl(tile))
        return json === null ? [] : parseLandformTile(json)
      }),
    )
    return tiles.flat().filter((p) => overlapsRange(p.rings, geo))
  } catch {
    return null
  }
}

/**
 * 昔の標高・A54・人工地形を取得し、標高差の大きい範囲（盛土の候補）を計算する（spec 09 §4.1・§4.5）。
 * 昔の標高の取得の失敗は reject（呼び出し側が network にする）。A54・人工地形の失敗は結果の
 * a54Available・landformAvailable を false にして続ける
 */
export async function computeFillHistory(
  input: FillHistoryInput,
  deps: FillHistoryDeps,
): Promise<FillHistoryPayload> {
  const { terrainId, geo, elevation, validMask } = input
  if (geo.level === 3) {
    throw new FillHistoryError('unavailable', '段 3（DEM10B）の地形では昔の標高と比べられない')
  }

  const [pastTiles, a54, landform] = await Promise.all([
    Promise.all(
      pastTileCoords(geo).map(async (tile) => {
        const r = await deps.fetchDem('dem10b', tile)
        return [`${tile.x}/${tile.y}`, r.status === 'ok' ? r.data : undefined] as const
      }),
    ),
    loadA54(geo, deps.fetchJson),
    loadLandform(geo, deps.fetchJson),
  ])
  const pastMap = new Map<string, DemTileData | undefined>(pastTiles)
  const pastElevation = resamplePast(geo, (tx, ty) => pastMap.get(`${tx}/${ty}`))

  const corrected = correctedDelta(elevation, validMask, pastElevation)
  if (corrected === null) {
    throw new FillHistoryError('no-overlap', '昔の標高と重なる有効なセルが無い')
  }
  const { delta, offsetM } = corrected
  const { labels, candidates: stats } = findCandidates(delta, geo)

  const a54Polygons = a54 ?? []
  const landformPolygons = landform ?? []
  const a54Evidence: EvidencePolygon[] = a54Polygons
  const landformEvidence: EvidencePolygon[] = landformPolygons.filter((p) => FILL_CODES.has(p.code))
  const evidence = classifyEvidence(
    labels,
    stats,
    a54 === null ? null : { mask: rasterizePolygons(geo, a54Evidence), polygons: a54Evidence },
    landform === null ? null : rasterizePolygons(geo, landformEvidence),
  )

  const candidates: FillCandidate[] = stats.map((c) => {
    const e = evidence.get(c.id)
    const centroid = pixelToLonLat(
      geo.originX + c.centroid.col + 0.5,
      geo.originY + c.centroid.row + 0.5,
      geo.z,
    )
    const candidate: FillCandidate = {
      id: c.id,
      areaM2: c.areaM2,
      maxRiseM: c.maxRiseM,
      volumeM3: c.volumeM3,
      centroid,
      evidence: e?.level ?? 'limited',
      evidenceSources: e?.sources ?? [],
    }
    if (e?.a54Type) candidate.a54Type = e.a54Type
    return candidate
  })
  candidates.sort(
    (a, b) => EVIDENCE_ORDER[a.evidence] - EVIDENCE_ORDER[b.evidence] || b.volumeM3 - a.volumeM3,
  )

  return {
    terrainId,
    pastElevation,
    deltaCorrected: delta,
    candidateLabels: labels,
    offsetM,
    candidates,
    a54Polygons,
    landformPolygons,
    a54Available: a54 !== null,
    landformAvailable: landform !== null,
  }
}

/**
 * JSON の取得関数を作る。404 は null、それ以外の HTTP エラーとネットワークエラーは
 * 0.5・1・2 秒の間隔で最大 3 回再試行し、1 回の取得は 20 秒で打ち切る。相対 URL は origin に対して解決する。
 * 同時に 6 件まで。signal で取り消す
 */
export function createJsonFetcher(
  signal: AbortSignal,
  origin: string,
): (url: string) => Promise<unknown | null> {
  const limit = createLimiter(6)
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(signal.reason)
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  const fetchOnce = async (url: string): Promise<unknown | null> => {
    const attempt = AbortSignal.any([signal, AbortSignal.timeout(TILE_FETCH_TIMEOUT_MS)])
    let response: Response
    try {
      response = await fetch(new URL(url, origin), { signal: attempt })
    } catch (error) {
      if (signal.aborted) throw error
      throw new NetworkError(error)
    }
    if (response.status === 404) return null
    if (!response.ok) throw new HttpError(response.status)
    try {
      return await response.json()
    } catch (error) {
      if (signal.aborted) throw error
      throw new NetworkError(error)
    }
  }
  return (url) =>
    retry(() => limit(() => fetchOnce(url)), {
      delaysMs: GSI_RETRY_DELAYS_MS,
      sleep,
      shouldRetry: (error) =>
        !signal.aborted && (error instanceof NetworkError || error instanceof HttpError),
    })
}
