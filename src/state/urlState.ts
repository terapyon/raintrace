import {
  type DurationMin,
  INTENSITY_MM_PER_H,
  isDurationMin,
  isValidIntensityMmPerH,
  maxRadiusM,
  RADIUS_MIN_M,
  RANGE_SIZES,
  type RangeSizeM,
} from './persistedSettings'

/**
 * 共有できる URL（tech-spec §3.3、spec 08 §6.4）: lat・lon・z・size・mmh・dur・all・r。
 * 古い URL の mm（総量の雨量）は読まない（R08-8、N3。無いものとして扱い、雨は保存値になる）
 */
export interface UrlView {
  point: { lon: number; lat: number } | null
  zoom: number | null
  sizeM: RangeSizeM | null
  intensityMmPerH: number | null
  durationMin: DurationMin | null
  wholeRange: boolean | null
  radiusM: number | null
}

/** URL に書く値。size・mmh・dur・all・r は地点があるときだけ書く */
export interface UrlWrite {
  point: { lon: number; lat: number } | null
  zoom: number | null
  sizeM: RangeSizeM
  intensityMmPerH: number
  durationMin: DurationMin
  wholeRange: boolean
  radiusM: number
}

/**
 * 管理するキー。古い mm は読まないが、ここに残して、次に URL を書くときに消す（spec 08 §6.4、N3）
 */
const MANAGED_KEYS = ['lat', 'lon', 'z', 'size', 'mm', 'mmh', 'dur', 'all', 'r'] as const

// Web Mercator（MapLibre）が扱える緯度の範囲。これを超えると地図の座標に変換できない
const MERCATOR_LAT_LIMIT = 85.051129

function readNumber(params: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

export function parseUrlView(search: string): UrlView {
  const params = new URLSearchParams(search)
  // 日本の対応範囲の外でも、地図が扱える緯度なら地点として読む（Worker が out-of-range を返す。クリックと同じ扱い）
  const lat = readNumber(params, 'lat', -MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT)
  const lon = readNumber(params, 'lon', -180, 180)
  const size = readNumber(params, 'size', 0, Number.POSITIVE_INFINITY)
  const intensity = readNumber(params, 'mmh', INTENSITY_MM_PER_H.min, INTENSITY_MM_PER_H.max)
  const duration = readNumber(params, 'dur', 0, Number.POSITIVE_INFINITY)
  const all = params.get('all')
  return {
    point: lat !== null && lon !== null ? { lat, lon } : null,
    zoom: readNumber(params, 'z', 0, 22),
    sizeM: RANGE_SIZES.find((s) => s === size) ?? null,
    intensityMmPerH: isValidIntensityMmPerH(intensity) ? intensity : null,
    durationMin: isDurationMin(duration) ? duration : null,
    wholeRange: all === '1' ? true : all === '0' ? false : null,
    // 範囲の半分との照合は、範囲の大きさが決まる設定のストア（applyUrl）で行う
    radiusM: readNumber(params, 'r', RADIUS_MIN_M, maxRadiusM(1000)),
  }
}

/**
 * URL のクエリを作る（先頭の ? を含む。何も無ければ空文字）。管理しないパラメータは残す。
 * all はオフでも 0 を書く（共有した URL を開いた人の保存値で、円と範囲全体が入れ替わらないようにする。N4）
 */
export function formatUrlView(currentSearch: string, view: UrlWrite): string {
  const params = new URLSearchParams(currentSearch)
  for (const key of MANAGED_KEYS) params.delete(key)
  if (view.point !== null) {
    params.set('lat', view.point.lat.toFixed(6))
    params.set('lon', view.point.lon.toFixed(6))
  }
  // 小数点以下の末尾の 0 だけを落とす（'16.10' → '16.1'、'10.00' → '10'、'0.00' → '0'。空にはならない）
  if (view.zoom !== null) params.set('z', view.zoom.toFixed(2).replace(/\.?0+$/, ''))
  if (view.point !== null) {
    params.set('size', String(view.sizeM))
    params.set('mmh', String(view.intensityMmPerH))
    params.set('dur', String(view.durationMin))
    params.set('all', view.wholeRange ? '1' : '0')
    params.set('r', String(view.radiusM))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}
