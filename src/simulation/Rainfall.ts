/**
 * 降雨の投入先と水深の計算（spec 03 §3.6、R03-4）
 */
import type { RainfallInput, TerrainMeta } from './types.ts'

/** 降雨の範囲に有効セルが無く、降雨中心のセルも無効（またはグリッドの外）のとき */
export class NoElevationAtRainCenterError extends Error {
  override name = 'NoElevationAtRainCenterError'

  constructor() {
    super('降雨中心に標高データがありません')
  }
}

export interface RainfallPlan {
  /** 雨を入れるセルの番号（行優先の昇順） */
  cells: Int32Array
  /** 各セルに足す水深（m） */
  depthM: number
  /** 投入総量（m³）。π · radiusM² · amountMm / 1000 */
  volumeM3: number
  /** cells の外接矩形（列 [x0, x1)、行 [y0, y1)） */
  x0: number
  y0: number
  x1: number
  y1: number
}

export function planRainfall(
  rain: RainfallInput,
  validMask: Uint8Array,
  meta: TerrainMeta,
): RainfallPlan {
  const { x, y, radiusM, amountMm } = rain
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`降雨中心の座標が不正です: (${x}, ${y})`)
  }
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    throw new RangeError(`降雨の半径が不正です: ${radiusM}`)
  }
  if (!Number.isFinite(amountMm) || amountMm < 0) {
    throw new RangeError(`雨量が不正です: ${amountMm}`)
  }
  const { width, height, cellSizeM } = meta
  const r2 = radiusM * radiusM
  const cx0 = Math.max(0, Math.floor((x - radiusM) / cellSizeM))
  const cx1 = Math.min(width - 1, Math.floor((x + radiusM) / cellSizeM))
  const cy0 = Math.max(0, Math.floor((y - radiusM) / cellSizeM))
  const cy1 = Math.min(height - 1, Math.floor((y + radiusM) / cellSizeM))

  const cells: number[] = []
  for (let cy = cy0; cy <= cy1; cy++) {
    const dy = (cy + 0.5) * cellSizeM - y
    for (let cx = cx0; cx <= cx1; cx++) {
      const dx = (cx + 0.5) * cellSizeM - x
      const i = cy * width + cx
      if (dx * dx + dy * dy <= r2 && validMask[i] !== 0) cells.push(i)
    }
  }
  if (cells.length === 0) {
    // 半径がセルより小さいなど、中心が円内に入るセルが無いときは、降雨中心を含むセル1つに入れる
    const cx = Math.floor(x / cellSizeM)
    const cy = Math.floor(y / cellSizeM)
    const inside = cx >= 0 && cx < width && cy >= 0 && cy < height
    if (!inside || validMask[cy * width + cx] === 0) throw new NoElevationAtRainCenterError()
    cells.push(cy * width + cx)
  }

  let x0 = width
  let y0 = height
  let x1 = 0
  let y1 = 0
  for (const i of cells) {
    const cx = i % width
    const cy = (i - cx) / width
    if (cx < x0) x0 = cx
    if (cx + 1 > x1) x1 = cx + 1
    if (cy < y0) y0 = cy
    if (cy + 1 > y1) y1 = cy + 1
  }

  const volumeM3 = (Math.PI * r2 * amountMm) / 1000
  const depthM = volumeM3 / (cells.length * cellSizeM * cellSizeM)
  return { cells: Int32Array.from(cells), depthM, volumeM3, x0, y0, x1, y1 }
}
