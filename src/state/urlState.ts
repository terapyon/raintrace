import {
  AMOUNT_MM,
  isValidAmountMm,
  maxRadiusM,
  RADIUS_MIN_M,
  RANGE_SIZES,
  type RangeSizeM,
} from './persistedSettings'

/** 共有できる URL（tech-spec §3.3）: lat・lon・z・size・mm・r */
export interface UrlView {
  point: { lon: number; lat: number } | null
  zoom: number | null
  sizeM: RangeSizeM | null
  amountMm: number | null
  radiusM: number | null
}

/** URL に書く値。size・mm・r は地点があるときだけ書く */
export interface UrlWrite {
  point: { lon: number; lat: number } | null
  zoom: number | null
  sizeM: RangeSizeM
  amountMm: number
  radiusM: number
}

const MANAGED_KEYS = ['lat', 'lon', 'z', 'size', 'mm', 'r'] as const

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
  const amount = readNumber(params, 'mm', AMOUNT_MM.min, AMOUNT_MM.max)
  return {
    point: lat !== null && lon !== null ? { lat, lon } : null,
    zoom: readNumber(params, 'z', 0, 22),
    sizeM: RANGE_SIZES.find((s) => s === size) ?? null,
    amountMm: isValidAmountMm(amount) ? amount : null,
    // 範囲の半分との照合は、範囲の大きさが決まる設定のストア（applyUrl）で行う
    radiusM: readNumber(params, 'r', RADIUS_MIN_M, maxRadiusM(1000)),
  }
}

/** URL のクエリを作る（先頭の ? を含む。何も無ければ空文字）。管理しないパラメータは残す */
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
    params.set('mm', String(view.amountMm))
    params.set('r', String(view.radiusM))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}
