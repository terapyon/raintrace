/**
 * 降雨の投入先と水深の計算（spec 03 §3.6、R03-4、spec 08 §4）
 */
import type { TerrainMeta } from './types.ts'

/** 降雨の範囲に有効セルが無く、降雨中心のセルも無効（またはグリッドの外）のとき */
export class NoElevationAtRainCenterError extends Error {
  override name = 'NoElevationAtRainCenterError'

  constructor() {
    super('降雨中心に標高データがありません')
  }
}

/** 円の雨（R03-4・R04-8）。amountMm は各セルに置く雨の量（mm） */
export interface CircleRainfall {
  /** グリッドの北西端から東向きの距離（m） */
  x: number
  /** グリッドの北西端から南向きの距離（m） */
  y: number
  radiusM: number
  amountMm: number
}

/** 時間雨量 × 継続時間の雨（spec 08 §4.1〜§4.3）。Task 5 で types.ts の RainfallInput に移す */
export interface TimedRainfall {
  x: number
  y: number
  /** 円の半径（m）。wholeRange のときは使わない */
  radiusM: number
  /** 時間雨量（mm/h）。durationS = 0 のときは一度に置く雨の量（mm） */
  intensityMmPerH: number
  /** 継続時間（s）。0 は開始のときに一度に置く（テスト用） */
  durationS: number
  /** 範囲全体に降らせる（R08-4） */
  wholeRange: boolean
}

/** 登録した雨（spec 08 §4.2）。エンジンは雨の間、各 step の終わりに cells へ rateMPerS × dt を足す */
export interface RainSchedule {
  /** 雨を足すセル（行優先の昇順）。範囲全体の雨はすべての有効セル */
  cells: Int32Array
  /** 各セルの水深の増える速さ ρ（m/s）。durationS = 0 なら 0 */
  rateMPerS: number
  /** 雨の終わりの時刻 T_rain（s）。durationS と同じ */
  endS: number
  /** durationS = 0 のとき、開始のときに一度に置く各セルの水深（m）。それ以外は 0 */
  instantDepthM: number
  /** cells の外接矩形（列 [x0, x1)、行 [y0, y1)） */
  x0: number
  y0: number
  x1: number
  y1: number
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
  rain: CircleRainfall,
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
  // 外接矩形はグリッドで切らずに走査する（R04-8）ので、半径に上限を置き、走査を 1 辺
  // 2 × (width + height) + 2 セル以下に抑える。Worker に postMessage で届く値もここで止める（レビューの推奨 A7）
  if (radiusM > (width + height) * cellSizeM) {
    throw new RangeError(`降雨の半径がグリッドに対して大きすぎます: ${radiusM}`)
  }
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

/**
 * 雨の予定を作る（spec 08 §4.2・§4.3）。円の雨のセルと割合は planRainfall（R03-4・R04-8）のままで、各セルの
 * 水深の増える速さ ρ = I·πr² / (|C|·A)（円がすべて有効なら ≈ I）。範囲全体の雨はすべての有効セルに I。
 * durationS = 0 は intensityMmPerH を「一度に置く雨の量（mm）」と読む（計画で決めたこと 5）
 */
export function planRainSchedule(
  rain: TimedRainfall,
  validMask: Uint8Array,
  meta: TerrainMeta,
): RainSchedule {
  const { intensityMmPerH, durationS, wholeRange } = rain
  if (!Number.isFinite(intensityMmPerH) || intensityMmPerH < 0) {
    throw new RangeError(`時間雨量が不正です: ${intensityMmPerH}`)
  }
  if (!Number.isFinite(durationS) || durationS < 0) {
    throw new RangeError(`継続時間が不正です: ${durationS}`)
  }
  if (typeof wholeRange !== 'boolean') {
    throw new RangeError(`範囲全体の指定が不正です: ${String(wholeRange)}`)
  }
  // 1 時間降り続けたとき（durationS = 0 なら一度に置くとき）の各セルの水深（m）
  let depthM: number
  let cells: Int32Array
  let box: { x0: number; y0: number; x1: number; y1: number }
  if (wholeRange) {
    const { width, height } = meta
    const list: number[] = []
    let x0 = width
    let y0 = height
    let x1 = 0
    let y1 = 0
    for (let i = 0; i < validMask.length; i++) {
      if (validMask[i] === 0) continue
      list.push(i)
      const cx = i % width
      const cy = (i - cx) / width
      if (cx < x0) x0 = cx
      if (cx + 1 > x1) x1 = cx + 1
      if (cy < y0) y0 = cy
      if (cy + 1 > y1) y1 = cy + 1
    }
    if (list.length === 0) throw new NoElevationAtRainCenterError()
    cells = Int32Array.from(list)
    depthM = intensityMmPerH / 1000
    box = { x0, y0, x1, y1 }
  } else {
    const plan = planRainfall(
      { x: rain.x, y: rain.y, radiusM: rain.radiusM, amountMm: intensityMmPerH },
      validMask,
      meta,
    )
    cells = plan.cells
    depthM = plan.depthM
    box = { x0: plan.x0, y0: plan.y0, x1: plan.x1, y1: plan.y1 }
  }
  const instant = durationS === 0
  return {
    cells,
    rateMPerS: instant ? 0 : depthM / 3600,
    endS: durationS,
    instantDepthM: instant ? depthM : 0,
    ...box,
  }
}
