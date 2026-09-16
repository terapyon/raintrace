/** 対応範囲: 地理院の DEM が覆う日本（与那国島 122.9°E、南鳥島 154.0°E、沖ノ鳥島 20.4°N、北海道の北端 45.5°N を含む矩形） */
export const SERVICE_AREA = { minLat: 20, maxLat: 46, minLon: 122, maxLon: 154 } as const

export function inServiceArea(lon: number, lat: number): boolean {
  return (
    lon >= SERVICE_AREA.minLon &&
    lon <= SERVICE_AREA.maxLon &&
    lat >= SERVICE_AREA.minLat &&
    lat <= SERVICE_AREA.maxLat
  )
}
