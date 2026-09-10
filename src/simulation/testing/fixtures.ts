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

/** 2 つの配列がビット単位で一致する（+0 と −0、NaN の違いも区別する） */
export function sameBits(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false
  const x = new BigUint64Array(a.buffer, a.byteOffset, a.length)
  const y = new BigUint64Array(b.buffer, b.byteOffset, b.length)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}
