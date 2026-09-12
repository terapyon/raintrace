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
  /** 投入総量（m³）。π · radiusM² · amountMm / 1000 × |S| / |C|（R04-8。円がすべて有効なら π · radiusM² · amountMm / 1000） */
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
  // C（中心が円内にあるセル）は、グリッドの外のセルも含めて数える。外接矩形をグリッドで切らない（R04-8）。
  // S（雨を入れるセル）は、C のうちグリッドの中の有効セル
  const gx0 = Math.floor((x - radiusM) / cellSizeM)
  const gx1 = Math.floor((x + radiusM) / cellSizeM)
  const gy0 = Math.floor((y - radiusM) / cellSizeM)
  const gy1 = Math.floor((y + radiusM) / cellSizeM)
  const cells: number[] = []
  let inCircle = 0
  for (let cy = gy0; cy <= gy1; cy++) {
    const dy = (cy + 0.5) * cellSizeM - y
    for (let cx = gx0; cx <= gx1; cx++) {
      const dx = (cx + 0.5) * cellSizeM - x
      if (dx * dx + dy * dy > r2) continue
      inCircle++
      if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue
      const i = cy * width + cx
      if (validMask[i] !== 0) cells.push(i)
    }
  }
  if (inCircle === 0) {
    // 半径がセルより小さいなど、中心が円内に入るセルが無いときは、降雨中心を含むセル1つを C = S とする
    const cx = Math.floor(x / cellSizeM)
    const cy = Math.floor(y / cellSizeM)
    const inside = cx >= 0 && cx < width && cy >= 0 && cy < height
    if (!inside || validMask[cy * width + cx] === 0) throw new NoElevationAtRainCenterError()
    cells.push(cy * width + cx)
    inCircle = 1
  }
  // 円内のセルがあっても、すべてグリッドの外か無効セル（正方格子では、降雨中心を含むセルの中心が最も近いので、
  // そのセルも無効かグリッドの外）
  if (cells.length === 0) throw new NoElevationAtRainCenterError()

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

  // 円が切れていなければ割合を掛けない（円がすべて有効なら投入量は従来の値とビット単位で同じ）
  const fullVolumeM3 = (Math.PI * r2 * amountMm) / 1000
  const volumeM3 =
    cells.length === inCircle ? fullVolumeM3 : (fullVolumeM3 * cells.length) / inCircle
  const depthM = volumeM3 / (cells.length * cellSizeM * cellSizeM)
  return { cells: Int32Array.from(cells), depthM, volumeM3, x0, y0, x1, y1 }
}
