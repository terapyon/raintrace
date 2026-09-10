/**
 * SimulationEngine の TypeScript 実装（tech-spec §6.2、spec 03）
 */
import {
  computeFlowVectors,
  createScratch,
  type Scratch,
  solveStep,
  type TerrainArrays,
} from './FlowSolver.ts'
import { planRainfall } from './Rainfall.ts'
import type { RainfallInput, SimulationEngine, StepStats, TerrainMeta } from './types.ts'
import { WaterGrid } from './WaterGrid.ts'

/** 'bbox': 濡れたセルの外接矩形だけを走査する（既定）。'full': 全セルを走査する（比較用） */
export type ScanMode = 'bbox' | 'full'

export interface EngineOptions {
  scanMode?: ScanMode
}

interface Loaded {
  terrain: TerrainArrays
  meta: TerrainMeta
  grid: WaterGrid
}

export class TsSimulationEngine implements SimulationEngine {
  readonly scanMode: ScanMode
  private loaded: Loaded | null = null
  private stepCount = 0
  private totalWater = 0
  private outflowWater = 0
  private readonly scratch: Scratch = createScratch()

  constructor(options: EngineOptions = {}) {
    this.scanMode = options.scanMode ?? 'bbox'
  }

  loadTerrain(elevation: Float32Array, validMask: Uint8Array, meta: TerrainMeta): void {
    const { width, height, cellSizeM } = meta
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`グリッドの大きさが不正です: ${width} × ${height}`)
    }
    if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
      throw new RangeError(`セルの大きさが不正です: ${cellSizeM}`)
    }
    const n = width * height
    if (elevation.length !== n || validMask.length !== n) {
      throw new RangeError(
        `配列の長さがグリッドと合いません: 標高 ${elevation.length}、マスク ${validMask.length}、セル数 ${n}`,
      )
    }
    this.loaded = {
      terrain: { width, height, elevation: elevation.slice(), validMask: validMask.slice() },
      meta: { width, height, cellSizeM },
      grid: new WaterGrid(width, height, this.scanMode === 'full'),
    }
    this.resetCounters()
  }

  addRainfall(rain: RainfallInput): void {
    const { terrain, meta, grid } = this.require()
    const plan = planRainfall(rain, terrain.validMask, meta)
    for (const i of plan.cells) grid.current[i] += plan.depthM
    grid.include(plan.x0, plan.y0, plan.x1, plan.y1)
    this.totalWater += plan.volumeM3
  }

  step(): StepStats {
    const { terrain, meta, grid } = this.require()
    const area = meta.cellSizeM * meta.cellSizeM
    grid.beginStep()
    const flow = solveStep(terrain, grid.current, grid.next, grid, this.scratch)
    const summary = grid.endStep()
    this.stepCount++
    this.outflowWater += flow.outflowDepth * area
    const storedWater = summary.depthSum * area
    return {
      step: this.stepCount,
      totalWater: this.totalWater,
      storedWater,
      outflowWater: this.outflowWater,
      maxDepth: summary.maxDepth,
      floodedArea: summary.floodedCells * area,
      settled: !flow.flowed,
      massError: this.totalWater - storedWater - this.outflowWater,
      events: [],
    }
  }

  reset(): void {
    this.require().grid.clear()
    this.resetCounters()
  }

  waterDepth(): Float64Array {
    return this.require().grid.current
  }

  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void {
    const { terrain } = this.require()
    const n = terrain.width * terrain.height
    for (const d of list) {
      if (!Number.isInteger(d.pitIndex) || d.pitIndex < 0 || d.pitIndex >= n) {
        throw new RangeError(`窪地 ${d.id} の最低点のセル番号が範囲外です: ${d.pitIndex}`)
      }
    }
  }

  flowVectors(): { x: Float32Array; y: Float32Array } {
    const { terrain, grid } = this.require()
    return computeFlowVectors(terrain, grid.current, grid, this.scratch)
  }

  private resetCounters(): void {
    this.stepCount = 0
    this.totalWater = 0
    this.outflowWater = 0
  }

  private require(): Loaded {
    if (this.loaded === null) throw new Error('loadTerrain を先に呼んでください')
    return this.loaded
  }
}
