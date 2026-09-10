/**
 * 地理院タイル（Web メルカトル）の座標計算（tech-spec §7.6）。
 * ピクセル座標は、ズーム z の世界全体を 256 × 2^z ピクセルとしたときの座標（グローバルピクセル）
 */

export const TILE_SIZE = 256
export const EARTH_RADIUS_M = 6378137

export interface PixelPoint {
  x: number
  y: number
}

export interface LonLat {
  lon: number
  lat: number
}

export interface TileCoord {
  z: number
  x: number
  y: number
}

/** グローバルピクセルの矩形。x1・y1 を含まない半開区間 */
export interface PixelRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function worldSizePx(z: number): number {
  return TILE_SIZE * 2 ** z
}

export function lonLatToPixel(lon: number, lat: number, z: number): PixelPoint {
  const size = worldSizePx(z)
  const phi = (lat * Math.PI) / 180
  return {
    x: ((lon + 180) / 360) * size,
    y: (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * size,
  }
}

export function pixelToLonLat(x: number, y: number, z: number): LonLat {
  const size = worldSizePx(z)
  const n = Math.PI - (2 * Math.PI * y) / size
  return {
    lon: (x / size) * 360 - 180,
    lat: (Math.atan(Math.sinh(n)) * 180) / Math.PI,
  }
}

/**
 * 経度を [−180, 180) に収める。MapLibre は世界のコピーを描く（renderWorldCopies）ので、
 * 地図のクリックの経度は ±180 を超えうる。NaN は NaN のまま
 */
export function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

/** 地上解像度（m／ピクセル）。cellSizeM = 2π × 6378137 × cos(φ) / (256 × 2^z) */
export function groundResolutionM(lat: number, z: number): number {
  return (2 * Math.PI * EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180)) / worldSizePx(z)
}

/**
 * 矩形に少しでもかかるタイルを、行優先（北から、西から）で返す。
 * 世界の範囲（0 ≤ x, y < 256 × 2^z）の外はクランプしない。日本国内の範囲だけを扱う前提
 */
export function tilesInPixelRect(rect: PixelRect, z: number): TileCoord[] {
  if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) return []
  const tx0 = Math.floor(rect.x0 / TILE_SIZE)
  const ty0 = Math.floor(rect.y0 / TILE_SIZE)
  const tx1 = Math.ceil(rect.x1 / TILE_SIZE) - 1
  const ty1 = Math.ceil(rect.y1 / TILE_SIZE) - 1
  const tiles: TileCoord[] = []
  for (let y = ty0; y <= ty1; y++) {
    for (let x = tx0; x <= tx1; x++) tiles.push({ z, x, y })
  }
  return tiles
}
