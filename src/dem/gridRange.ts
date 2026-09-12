import {
  groundResolutionM,
  lonLatToPixel,
  type PixelPoint,
  type PixelRect,
  pixelToLonLat,
} from './tileMath.ts'

/** 北西・北東・南東・南西の [経度, 緯度]（MapLibre の canvas ソースの coordinates の順） */
export type Corners = [[number, number], [number, number], [number, number], [number, number]]

/** シミュレーションの範囲（spec 02 §3、tech-spec §7.6）。DEM のピクセルをそのままセルにする */
export interface GridRange {
  z: number
  cellSizeM: number
  size: number // 一辺のセル数 N
  originX: number // 北西端のグローバルピクセル（整数）
  originY: number
  center: PixelPoint // クリックした地点のグローバルピクセル pc
}

// グリッドの大きさの上限（最後の砦。緯度は serviceArea・urlState で絞っているが、念のため）。
// 1000m・DEM1A（z17）・北緯 46° でも N = 1206
export const MAX_GRID_SIZE = 4096

export function computeGridRange(lon: number, lat: number, sizeM: number, z: number): GridRange {
  const cellSizeM = groundResolutionM(lat, z)
  const size = Math.ceil(sizeM / cellSizeM)
  // !(size <= MAX_GRID_SIZE) の形にして、size が NaN でも止める。緯度 90° は cos(φ) が
  // 0 に近づいて cellSizeM がほぼ 0 になり、size は Infinity ではなく約 6.8e18 の有限の値になるが、
  // それでも上限の判定で止まる
  if (!(size <= MAX_GRID_SIZE)) {
    throw new RangeError(`グリッドの一辺が大きすぎます（N=${size}、緯度 ${lat}°）`)
  }
  const center = lonLatToPixel(lon, lat, z)
  return {
    z,
    cellSizeM,
    size,
    // round: 範囲の中心（origin + N/2）がクリックした地点から半セル以内に来る（spec 02 §3）
    originX: Math.round(center.x - size / 2),
    originY: Math.round(center.y - size / 2),
    center,
  }
}

export function rangePixelRect(range: GridRange): PixelRect {
  return {
    x0: range.originX,
    y0: range.originY,
    x1: range.originX + range.size,
    y1: range.originY + range.size,
  }
}

export function rangeCorners(range: GridRange): Corners {
  const nw = pixelToLonLat(range.originX, range.originY, range.z)
  const se = pixelToLonLat(range.originX + range.size, range.originY + range.size, range.z)
  return [
    [nw.lon, nw.lat],
    [se.lon, nw.lat],
    [se.lon, se.lat],
    [nw.lon, se.lat],
  ]
}

/** 地点を含むセル。範囲の外なら null */
export function cellAt(
  range: Pick<GridRange, 'z' | 'originX' | 'originY' | 'size'>,
  lon: number,
  lat: number,
): { col: number; row: number } | null {
  const p = lonLatToPixel(lon, lat, range.z)
  const col = Math.floor(p.x - range.originX)
  const row = Math.floor(p.y - range.originY)
  if (col < 0 || row < 0 || col >= range.size || row >= range.size) return null
  return { col, row }
}

/** グリッドの北西端からの距離（m。東・南が正）。(pc − origin) × cellSizeM（spec 02 §3） */
export function gridPositionM(
  range: Pick<GridRange, 'z' | 'originX' | 'originY' | 'cellSizeM'>,
  lon: number,
  lat: number,
): { x: number; y: number } {
  const p = lonLatToPixel(lon, lat, range.z)
  return { x: (p.x - range.originX) * range.cellSizeM, y: (p.y - range.originY) * range.cellSizeM }
}
