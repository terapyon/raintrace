/**
 * テストとベンチマーク用の地形と補助関数。純粋な TypeScript（テストの外からも import できる）
 */
import { type EngineOptions, TsSimulationEngine } from '../TsSimulationEngine.ts'
import type { RainfallInput, StepStats, TerrainMeta } from '../types.ts'

export interface Terrain {
  elevation: Float32Array
  validMask: Uint8Array
  meta: TerrainMeta
}

/** f(x, y) は列 x・行 y のセルの標高。NaN を返したセルは無効セルにする */
export function buildTerrain(
  width: number,
  height: number,
  cellSizeM: number,
  f: (x: number, y: number) => number,
): Terrain {
  const elevation = new Float32Array(width * height)
  const validMask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const z = f(x, y)
      const i = y * width + x
      if (Number.isNaN(z)) continue
      elevation[i] = z
      validMask[i] = 1
    }
  }
  return { elevation, validMask, meta: { width, height, cellSizeM } }
}

/** 地形を読み込んだエンジン */
export function engineOn(t: Terrain, options: EngineOptions = {}): TsSimulationEngine {
  const engine = new TsSimulationEngine(options)
  engine.loadTerrain(t.elevation, t.validMask, t.meta)
  return engine
}

/** 列 x・行 y のセルの中心の座標（グリッドの北西端からの m） */
export function cellCenter(x: number, y: number, cellSizeM: number): { x: number; y: number } {
  return { x: (x + 0.5) * cellSizeM, y: (y + 0.5) * cellSizeM }
}

/** stopReason（settled・cap）が付くまで step を回し、最後の統計を返す。maxSteps で届かなければ例外 */
export function runUntilStopped(engine: TsSimulationEngine, maxSteps: number): StepStats {
  for (let n = 0; n < maxSteps; n++) {
    const stats = engine.step()
    if (stats.stopReason !== null) return stats
  }
  throw new Error(`${maxSteps} step で止まりませんでした`)
}

/** 平衡のテストの止め方の閾値（spec 08 §9.1）: 水深の変化 0.1 mm/h（m/s） */
export const QUIET_EQUILIBRIUM_M_PER_S = 0.1 / 1000 / 3600

/** 満水との一致の止め方の閾値（spec 08 §9.1）: 水深の変化 3 mm/h（m/s） */
export const QUIET_FILL_M_PER_S = 3 / 1000 / 3600

/**
 * 平衡のテストの止め方（spec 08 §9.1。UI の停止〈§3.9〉とは別）: 雨が終わった後、流れによる水深の変化の最大
 * max |Δh| / dtS が maxRateMPerS 未満になった step の統計を返す。maxSteps で届かなければ例外
 */
export function runUntilQuiet(
  engine: TsSimulationEngine,
  maxRateMPerS: number,
  maxSteps: number,
): StepStats {
  for (let n = 0; n < maxSteps; n++) {
    const before = engine.waterDepth().slice()
    const stats = engine.step()
    if (stats.raining) continue
    const after = engine.waterDepth()
    let change = 0
    for (let i = 0; i < after.length; i++) {
      const d = Math.abs(after[i] - before[i])
      if (d > change) change = d
    }
    if (change / stats.dtS < maxRateMPerS) return stats
  }
  throw new Error(`${maxSteps} step で水深の変化が ${maxRateMPerS} m/s 未満になりませんでした`)
}

/** 開始のときに一度に置く円の雨（durationS = 0。amountMm の雨を置く。計画で決めたこと 5） */
export function instantRain(
  center: { x: number; y: number },
  radiusM: number,
  amountMm: number,
): RainfallInput {
  return {
    x: center.x,
    y: center.y,
    radiusM,
    intensityMmPerH: amountMm,
    durationS: 0,
    wholeRange: false,
  }
}

/** 縁（外周 1 セル）の標高が rim、内側の標高が floor の盆地 */
export function walledBasin(size: number, floor: number, rim: number): Terrain {
  return buildTerrain(size, size, 1, (x, y) =>
    x === 0 || y === 0 || x === size - 1 || y === size - 1 ? rim : floor,
  )
}

/** 中心 (c, c) からの距離に比例して高くなるすり鉢。外周 1 セルは rim */
export function cone(size: number, slope: number, rim: number): Terrain {
  const c = (size - 1) / 2
  return buildTerrain(size, size, 1, (x, y) =>
    x === 0 || y === 0 || x === size - 1 || y === size - 1 ? rim : slope * Math.hypot(x - c, y - c),
  )
}

/**
 * 峠でつながった 2 つの盆地（31 × 11、セル 1m）。床は 0m、外周と仕切り（列 15）は 5m、
 * 峠（列 15・行 5）は passZ。西の盆地 A は列 1〜14、東の盆地 B は列 16〜29（どちらも行 1〜9）
 */
export function twoBasins(passZ: number): Terrain {
  return buildTerrain(31, 11, 1, (x, y) => {
    if (x === 0 || y === 0 || x === 30 || y === 10) return 5
    if (x === 15) return y === 5 ? passZ : 5
    return 0
  })
}

/** 水深が minDepthM を超えるセルの数と、その水面標高 Z + h の最小・最大（minDepthM の既定 0 は濡れたセルすべて） */
export function wetSurfaceRange(
  t: Terrain,
  w: Float64Array,
  minDepthM = 0,
): { cells: number; min: number; max: number } {
  let cells = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= minDepthM) continue
    const h = t.elevation[i] + w[i]
    cells++
    if (h < min) min = h
    if (h > max) max = h
  }
  return { cells, min, max }
}

/** Σ max(0, h − Z) × A = volumeM3 となる水面標高 h（有効セルすべてが対象。二分法） */
export function levelForVolume(t: Terrain, volumeM3: number): number {
  const area = t.meta.cellSizeM * t.meta.cellSizeM
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < t.elevation.length; i++) {
    if (t.validMask[i] === 0) continue
    lo = Math.min(lo, t.elevation[i])
    hi = Math.max(hi, t.elevation[i])
  }
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2
    let v = 0
    for (let i = 0; i < t.elevation.length; i++) {
      if (t.validMask[i] !== 0) v += Math.max(0, mid - t.elevation[i]) * area
    }
    if (v < volumeM3) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 水の重心の列番号（水深で重み付け） */
export function centroidX(t: Terrain, w: Float64Array): number {
  let sum = 0
  let moment = 0
  for (let i = 0; i < w.length; i++) {
    sum += w[i]
    moment += w[i] * (i % t.meta.width)
  }
  return moment / sum
}

/** 水のあるセルの標高の最大 */
export function maxWetElevation(t: Terrain, w: Float64Array): number {
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < w.length; i++) if (w[i] > 0 && t.elevation[i] > max) max = t.elevation[i]
  return max
}

/** 2 つの配列がビット単位で一致する（+0 と −0、NaN の違いも区別する） */
export function sameBits(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false
  const x = new BigUint64Array(a.buffer, a.byteOffset, a.length)
  const y = new BigUint64Array(b.buffer, b.byteOffset, b.length)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}
