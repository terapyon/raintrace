/**
 * SimulationEngine の TypeScript 実装（tech-spec §6.2、spec 08 §3〜§5.1）。4 近傍の局所慣性式で、
 * 時間刻み dt はエンジンが毎 step 決める
 */
import { MANNING_N, SETTLE_CAP_S, SETTLE_VELOCITY_M_PER_S, SPILL_TOLERANCE_M } from './constants.ts'
import {
  applyFaceFlows,
  cellVelocities,
  clearFaces,
  clearFacesOutside,
  createFaces,
  type Faces,
  type FlowVectors,
  faceVelocityMax,
  limitOutflows,
  type ScanWindow,
  type TerrainArrays,
  timeStep,
  updateFaceFlows,
} from './FlowSolver.ts'
import { planRainSchedule, type RainSchedule } from './Rainfall.ts'
import type {
  RainfallInput,
  SimulationEngine,
  SimulationEvent,
  StepStats,
  StopReason,
  TerrainMeta,
} from './types.ts'
import { WaterGrid } from './WaterGrid.ts'

/** 'bbox': 濡れたセルの外接矩形だけを走査する（既定）。'full': 全セルを走査する（比較用） */
export type ScanMode = 'bbox' | 'full'

export interface EngineOptions {
  scanMode?: ScanMode
  /** Manning の粗度係数（既定 MANNING_N。テストで摩擦を変えるため。R08-3 の値は UI から変えない） */
  manningN?: number
  /** 自動停止の面の流速（m/s。既定 SETTLE_VELOCITY_M_PER_S。テストで止まらない条件を作るため） */
  settleVelocityMPerS?: number
}

interface Depression {
  id: number
  pitIndex: number
  spillElevation: number
}

interface Loaded {
  terrain: TerrainArrays
  meta: TerrainMeta
  grid: WaterGrid
  faces: Faces
}

/** 登録した雨と、その時間雨量（累積雨量の計算に使う） */
type Rain = RainSchedule & { intensityMmPerH: number }

const isNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0

export class TsSimulationEngine implements SimulationEngine {
  readonly scanMode: ScanMode
  readonly manningN: number
  readonly settleVelocityMPerS: number
  private loaded: Loaded | null = null
  private depressions: Depression[] = []
  private notified = new Uint8Array(0)
  private rain: Rain | null = null
  private stepCount = 0
  /**
   * 置いた水（一度に置く雨・setInitialWater の和。m³）。投入水量は、これに今の雨の分を閉じた式で足したもの
   * （計画で決めたこと 35）
   */
  private placedWater = 0
  private outflowWater = 0
  private timeS = 0
  /** この step の始めの最大水深（前の step の endStep の値。spec 08 §3.3） */
  private hMax = 0
  /** 前の step の面の流速の最大（spec 08 §3.3） */
  private uMax = 0
  /** flowVectors の出力（使い回す。loadTerrain で捨てる。spec 06 §5.2） */
  private flow: FlowVectors | undefined = undefined

  constructor(options: EngineOptions = {}) {
    this.scanMode = options.scanMode ?? 'bbox'
    this.manningN = options.manningN ?? MANNING_N
    this.settleVelocityMPerS = options.settleVelocityMPerS ?? SETTLE_VELOCITY_M_PER_S
    if (!isNonNegative(this.manningN)) {
      throw new RangeError(`粗度係数が不正です: ${this.manningN}`)
    }
    if (!isNonNegative(this.settleVelocityMPerS)) {
      throw new RangeError(`停止の流速が不正です: ${this.settleVelocityMPerS}`)
    }
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
    const mask = validMask.slice()
    this.loaded = {
      terrain: { width, height, elevation: elevation.slice(), validMask: mask },
      meta: { width, height, cellSizeM },
      grid: new WaterGrid(width, height, this.scanMode === 'full'),
      faces: createFaces(width, height, mask),
    }
    this.depressions = []
    this.notified = new Uint8Array(0)
    this.flow = undefined
    this.rain = null
    this.resetCounters()
  }

  setRainfall(rain: RainfallInput): void {
    const { terrain, meta, grid } = this.require()
    // 雨の登録は t = 0（reset の後、最初の step の前）だけ（レビューの m1 の裁定 (a)）。t = 0 での登録し直しは、
    // それまでの雨の分が 0 なので、置き換えるだけでよい
    if (this.stepCount > 0) {
      throw new Error('雨の登録は reset の後、最初の step の前にしてください')
    }
    const plan = planRainSchedule(rain, terrain.validMask, meta)
    const area = meta.cellSizeM * meta.cellSizeM
    this.rain = { ...plan, intensityMmPerH: rain.intensityMmPerH }
    grid.include(plan.x0, plan.y0, plan.x1, plan.y1)
    if (plan.instantDepthM > 0) {
      for (const i of plan.cells) {
        grid.current[i] += plan.instantDepthM
        if (grid.current[i] > this.hMax) this.hMax = grid.current[i]
      }
      this.placedWater += plan.instantDepthM * plan.cells.length * area
    }
  }

  /**
   * テスト用（計画で決めたこと 11。SimulationEngine には無い）: 各セルに水深を足し、走査範囲を全体にして、
   * 投入量に数える。無効セルに水を置く・負や有限でない水深・長さの違いは RangeError
   */
  setInitialWater(depth: Float64Array): void {
    const { terrain, meta, grid } = this.require()
    if (depth.length !== grid.current.length) {
      throw new RangeError(`水深の配列の長さがグリッドと合いません: ${depth.length}`)
    }
    let sum = 0
    for (let i = 0; i < depth.length; i++) {
      const d = depth[i]
      if (!isNonNegative(d)) throw new RangeError(`水深が不正です: セル ${i}、${d}`)
      if (d === 0) continue
      if (terrain.validMask[i] === 0) throw new RangeError(`無効セル ${i} に水は置けません`)
      grid.current[i] += d
      if (grid.current[i] > this.hMax) this.hMax = grid.current[i]
      sum += d
    }
    grid.include(0, 0, terrain.width, terrain.height)
    this.placedWater += sum * meta.cellSizeM * meta.cellSizeM
  }

  step(): StepStats {
    const { terrain, meta, grid, faces } = this.require()
    const dx = meta.cellSizeM
    const area = dx * dx
    const rain = this.rain
    const rainEnd = rain === null ? 0 : rain.endS
    const raining = rain !== null && this.timeS < rainEnd
    let dt = timeStep(this.hMax, this.uMax, dx)
    // 雨の終わりで切る（spec 08 §3.3）。投入の総量が 強度 × 継続時間 に一致する
    const endsNow = raining && this.timeS + dt >= rainEnd
    if (endsNow) dt = rainEnd - this.timeS
    const before: ScanWindow = { x0: grid.x0, y0: grid.y0, x1: grid.x1, y1: grid.y1 }
    updateFaceFlows(terrain, grid.current, grid, faces, dt, dx, this.manningN)
    limitOutflows(terrain, grid.current, grid, faces, dt, dx)
    const outflowQ = applyFaceFlows(terrain, grid.current, grid.next, grid, faces, dt, dx)
    if (raining && rain !== null) {
      // 雨のセルは登録のときに走査範囲に含め、降っている間は濡れているので範囲に残る（spec 08 §4.2）。
      // 投入水量は足した量の和ではなく閉じた式で持つ（rainVolume。計画で決めたこと 35）
      const add = rain.rateMPerS * dt
      for (const i of rain.cells) grid.next[i] += add
    }
    const uMax = faceVelocityMax(grid, faces)
    const summary = grid.endStep()
    clearFacesOutside(faces, before, grid)
    this.stepCount++
    // 雨の終わりの step は T_rain をそのまま入れる（t + (T_rain − t) は丸めで T_rain に戻らないことがある）
    this.timeS = endsNow ? rainEnd : this.timeS + dt
    this.hMax = summary.maxDepth
    this.uMax = uMax
    const outflowM3 = outflowQ * dx * dt
    this.outflowWater += outflowM3
    const storedWater = summary.depthSum * area
    const totalWater = this.placedWater + this.rainVolume(area)
    const rainingAfter = rain !== null && this.timeS < rainEnd
    const settled = !rainingAfter && uMax < this.settleVelocityMPerS
    const stopReason: StopReason | null = settled
      ? 'settled'
      : !rainingAfter && this.timeS - rainEnd >= SETTLE_CAP_S
        ? 'cap'
        : null
    return {
      step: this.stepCount,
      totalWater,
      storedWater,
      outflowWater: this.outflowWater,
      maxDepth: summary.maxDepth,
      floodedArea: summary.floodedCells * area,
      settled,
      // セルに実際に足した水と、閉じた式の投入水量の差もここに出る（許容 1e-9。計画で決めたこと 35）
      massError: totalWater - storedWater - this.outflowWater,
      events: this.detectSpills(terrain.elevation, grid.current),
      timeS: this.timeS,
      dtS: dt,
      raining: rainingAfter,
      rainDepthMm: this.rainDepthMm(),
      outflowRateM3PerS: outflowM3 / dt,
      stopReason,
    }
  }

  reset(): void {
    const { grid, faces } = this.require()
    grid.clear()
    clearFaces(faces)
    this.notified.fill(0)
    this.rain = null
    this.resetCounters()
  }

  waterDepth(): Float64Array {
    return this.require().grid.current
  }

  /** テスト用（計画で決めたこと 11）: 面の流量と、この step の始めの h_f。読み取り専用として扱う */
  faceFlows(): { qx: Float64Array; qy: Float64Array; hfx: Float64Array; hfy: Float64Array } {
    const { qx, qy, hfx, hfy } = this.require().faces
    return { qx, qy, hfx, hfy }
  }

  /** テスト用（計画で決めたこと 11）: 今の走査範囲 */
  scanWindow(): ScanWindow {
    const { x0, y0, x1, y1 } = this.require().grid
    return { x0, y0, x1, y1 }
  }

  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void {
    const { terrain } = this.require()
    const n = terrain.width * terrain.height
    for (const d of list) {
      if (!Number.isInteger(d.pitIndex) || d.pitIndex < 0 || d.pitIndex >= n) {
        throw new RangeError(`窪地 ${d.id} の最低点のセル番号が範囲外です: ${d.pitIndex}`)
      }
      if (terrain.validMask[d.pitIndex] !== 1) {
        throw new RangeError(`窪地 ${d.id} の最低点が無効セルです: ${d.pitIndex}`)
      }
      if (!Number.isFinite(d.spillElevation)) {
        throw new RangeError(`窪地 ${d.id} の spill 標高が有限ではありません: ${d.spillElevation}`)
      }
    }
    this.depressions = list.map(({ id, pitIndex, spillElevation }) => ({
      id,
      pitIndex,
      spillElevation,
    }))
    this.notified = new Uint8Array(list.length)
  }

  flowVectors(): { x: Float32Array; y: Float32Array } {
    const { terrain, grid, faces } = this.require()
    this.flow = cellVelocities(terrain, grid.current, grid, faces, this.flow)
    return this.flow
  }

  /**
   * 今の雨の登録で降った水の量（m³）= ρ·|S|·A·min(t, T_rain)（計画で決めたこと 35。雨は t = 0 でだけ登録する）。
   * 雨の終わりの step の時刻は T_rain そのもの（計画で決めたこと 8）なので、雨が終わった時点で ρ·|S|·A·T_rain に
   * 式どおり一致する。
   * durationS = 0 の雨は ρ = 0（置いた水は placedWater に入れてある）
   */
  private rainVolume(area: number): number {
    const rain = this.rain
    if (rain === null) return 0
    return rain.rateMPerS * rain.cells.length * area * Math.min(this.timeS, rain.endS)
  }

  /** 累積雨量（mm）。durationS = 0 の雨は置いた量（計画で決めたこと 5） */
  private rainDepthMm(): number {
    const rain = this.rain
    if (rain === null) return 0
    if (rain.endS === 0) return rain.intensityMmPerH
    return (rain.intensityMmPerH * Math.min(this.timeS, rain.endS)) / 3600
  }

  /** まだ通知していない窪地のうち、最低点の水面標高が spill 標高 − 1cm に達したもの（R03-6。spec 08 §6.2 で変えない） */
  private detectSpills(elevation: Float32Array, w: Float64Array): SimulationEvent[] {
    const events: SimulationEvent[] = []
    for (let k = 0; k < this.depressions.length; k++) {
      if (this.notified[k] !== 0) continue
      const d = this.depressions[k]
      // 最低点が乾いている窪地は溢れていない。深さが越流の余裕（1cm）以下の窪地が、雨なしで通知されるのを防ぐ
      if (
        w[d.pitIndex] > 0 &&
        elevation[d.pitIndex] + w[d.pitIndex] >= d.spillElevation - SPILL_TOLERANCE_M
      ) {
        this.notified[k] = 1
        events.push({
          type: 'spill',
          step: this.stepCount,
          timeS: this.timeS,
          depressionId: d.id,
          spillElevation: d.spillElevation,
        })
      }
    }
    return events
  }

  private resetCounters(): void {
    this.stepCount = 0
    this.placedWater = 0
    this.outflowWater = 0
    this.timeS = 0
    this.hMax = 0
    this.uMax = 0
  }

  private require(): Loaded {
    if (this.loaded === null) throw new Error('loadTerrain を先に呼んでください')
    return this.loaded
  }
}
