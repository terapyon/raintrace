/** 共有できる URL（tech-spec §3.3）。02 では lat・lon・z・size。size は 500 固定（R02-4） */

export interface UrlView {
  point: { lon: number; lat: number } | null
  zoom: number | null
}

const MANAGED_KEYS = ['lat', 'lon', 'z', 'size'] as const

function readNumber(params: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

export function parseUrlView(search: string): UrlView {
  const params = new URLSearchParams(search)
  const lat = readNumber(params, 'lat', -90, 90)
  const lon = readNumber(params, 'lon', -180, 180)
  return {
    point: lat !== null && lon !== null ? { lat, lon } : null,
    zoom: readNumber(params, 'z', 0, 22),
  }
}

/** URL のクエリを作る（先頭の ? を含む。何も無ければ空文字）。管理しないパラメータは残す */
export function formatUrlView(currentSearch: string, view: UrlView): string {
  const params = new URLSearchParams(currentSearch)
  for (const key of MANAGED_KEYS) params.delete(key)
  if (view.point !== null) {
    params.set('lat', view.point.lat.toFixed(6))
    params.set('lon', view.point.lon.toFixed(6))
  }
  if (view.zoom !== null) params.set('z', view.zoom.toFixed(2).replace(/\.?0+$/, ''))
  if (view.point !== null) params.set('size', '500')
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}
