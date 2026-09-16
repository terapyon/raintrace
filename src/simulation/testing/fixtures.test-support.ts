/**
 * テストとベンチマーク用の地形と補助関数。純粋な TypeScript（テストの外からも import できる）
 */
import { type EngineOptions, TsSimulationEngine } from '../TsSimulationEngine.ts'
import type { StepStats, TerrainMeta } from '../types.ts'

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

/** settled になるまで step を回し、最後の統計を返す。maxSteps で届かなければ例外 */
export function runUntilSettled(engine: TsSimulationEngine, maxSteps: number): StepStats {
  for (let n = 0; n < maxSteps; n++) {
    const stats = engine.step()
    if (stats.settled) return stats
  }
  throw new Error(`${maxSteps} step で平衡に達しませんでした`)
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

/** 水のあるセル（W > 0）の数と、その水面標高 Z + W の最小・最大 */
export function wetSurfaceRange(
  t: Terrain,
  w: Float64Array,
): { cells: number; min: number; max: number } {
  let cells = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < w.length; i++) {
    if (w[i] === 0) continue
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

/**
 * 窪地のセル（満水時の水面 fill が標高より高い有効セル）を 8 近傍でつないだ成分ごとに、
 * 流出口（成分の外にあって、標高が fill と同じ有効セル）に接する成分内のセルを 0 として、
 * 成分の中を 8 近傍で数えた距離を返す。窪地でないセルは −1
 */
export function outletDistances(t: Terrain, fill: ArrayLike<number>): Int32Array {
  const { width, height } = t.meta
  const n = width * height
  const inDepression = (i: number) => t.validMask[i] !== 0 && fill[i] > t.elevation[i]
  const neighbors = (c: number): number[] => {
    const cx = c % width
    const cy = (c - cx) / width
    const out: number[] = []
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx
        const ny = cy + dy
        if ((dx !== 0 || dy !== 0) && nx >= 0 && ny >= 0 && nx < width && ny < height) {
          out.push(ny * width + nx)
        }
      }
    }
    return out
  }
  // 成分に分ける
  const label = new Int32Array(n).fill(-1)
  let count = 0
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || !inDepression(s)) continue
    const queue = [s]
    label[s] = count
    for (let q = 0; q < queue.length; q++) {
      for (const j of neighbors(queue[q])) {
        if (label[j] !== -1 || !inDepression(j)) continue
        label[j] = count
        queue.push(j)
      }
    }
    count++
  }
  // 流出口に接するセルを 0 として、成分の中で幅優先に数える
  const dist = new Int32Array(n).fill(-1)
  const queue: number[] = []
  for (let i = 0; i < n; i++) {
    if (label[i] < 0) continue
    const touchesOutlet = neighbors(i).some(
      (j) => label[j] !== label[i] && t.validMask[j] !== 0 && t.elevation[j] === fill[i],
    )
    if (touchesOutlet) {
      dist[i] = 0
      queue.push(i)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q]
    for (const j of neighbors(c)) {
      if (label[j] !== label[c] || dist[j] >= 0) continue
      dist[j] = dist[c] + 1
      queue.push(j)
    }
  }
  return dist
}

/** 2 つの配列がビット単位で一致する（+0 と −0、NaN の違いも区別する） */
export function sameBits(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false
  const x = new BigUint64Array(a.buffer, a.byteOffset, a.length)
  const y = new BigUint64Array(b.buffer, b.byteOffset, b.length)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}
