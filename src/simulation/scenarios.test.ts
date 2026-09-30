import { describe, expect, it } from 'vitest'
import { SURFACE_ELEVATION_TOLERANCE_M } from './constants.ts'
import {
  buildTerrain,
  cellCenter,
  centroidX,
  cone,
  engineOn,
  instantRain,
  levelForVolume,
  maxWetElevation,
  QUIET_EQUILIBRIUM_M_PER_S,
  runUntilQuiet,
  twoBasins,
  walledBasin,
  wetSurfaceRange,
} from './testing/fixtures.test-support.ts'
import type { SimulationEvent } from './types.ts'

/** 平衡のテストの摩擦（spec 08 §9.1。n = 0.03 では排水の慣性で池の水位が下がったまま残る地形がある） */
const EQUILIBRIUM = { manningN: 0.1 } as const
/** 水面が平らかを見るセルの水深の下限（斜面に残る 0.1 mm 以下の膜を除く。spec 08 §9.1） */
const FILM_M = 1e-4
/** 平衡のテストの上限の step 数（spec 08 §9.1） */
const MAX_STEPS = 1_000_000

describe('base-spec §47 の 4 ケースと平衡水位（spec 08 §9.1）', () => {
  it('平面: 縁で囲んだ平らな盆地に一度に置いた水が広がり、止めた後の水面の最大と最小の差が 1cm 以内', () => {
    // 12 × 12（床 10 × 10 = 100m²、縁 10m）。約 12.6m³ を床の北西寄りに置く
    const t = walledBasin(12, 0, 10)
    const engine = engineOn(t, EQUILIBRIUM)
    engine.setRainfall(instantRain(cellCenter(3, 3, 1), 2, 1000))
    const stats = runUntilQuiet(engine, QUIET_EQUILIBRIUM_M_PER_S, MAX_STEPS)
    const r = wetSurfaceRange(t, engine.waterDepth(), FILM_M)
    expect(r.cells).toBe(100)
    expect(r.max - r.min).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(stats.outflowWater).toBe(0)
  })

  it('傾斜面: 重心が下り方向へ移り、置いた位置より 1cm 以上高い標高のセルは水を得ない（慣性で上る分を 1cm まで許す）', () => {
    // 東へ 1 セルにつき 0.2m 下る斜面。雨の深さ（約 5cm）は 1 セルの高低差より小さい
    const t = buildTerrain(40, 41, 1, (x) => (39 - x) * 0.2)
    const engine = engineOn(t)
    engine.setRainfall(instantRain(cellCenter(10, 20, 1), 3, 50))
    const zTop = maxWetElevation(t, engine.waterDepth())
    const start = centroidX(t, engine.waterDepth())
    for (let n = 0; n < 30; n++) {
      engine.step()
      expect(maxWetElevation(t, engine.waterDepth())).toBeLessThanOrEqual(zTop + 0.01)
    }
    expect(centroidX(t, engine.waterDepth())).toBeGreaterThan(start + 1)
  })

  it('単純窪地: 窪地の外に置いた水が窪地に集まり、止めた後の水面が 1cm 以内で平ら', () => {
    // すり鉢（中心 (10, 10)、勾配 0.1）。雨は中心から 6 セル東の斜面に置く
    const t = cone(21, 0.1, 5)
    const engine = engineOn(t, EQUILIBRIUM)
    engine.setRainfall(instantRain(cellCenter(16, 10, 1), 1.5, 200))
    const stats = runUntilQuiet(engine, QUIET_EQUILIBRIUM_M_PER_S, MAX_STEPS)
    const w = engine.waterDepth()
    const r = wetSurfaceRange(t, w, FILM_M)
    expect(r.max - r.min).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(w[10 * 21 + 10]).toBeGreaterThan(0.1)
    expect(w[10 * 21 + 16]).toBeLessThanOrEqual(FILM_M)
    expect(stats.outflowWater).toBe(0)
  })

  it('越流: 峠でつながった 2 つの窪地の一方に容量を超える水を置くと、越流イベントが 1 回だけ出て（経過時間つき）、もう一方が水を得る', () => {
    // 西の盆地 A（床 14 × 9 = 126m²）と東の盆地 B を、高さ 1m の峠でつなぐ。A の峠までの容量は 126m³。
    // A の最低点（床は平らなので、どのセルでもよい）は北西の角のセル (1, 1) とし、雨の円の外に置く
    const t = twoBasins(1)
    const engine = engineOn(t)
    engine.setDepressions([
      { id: 1, pitIndex: 1 * 31 + 1, spillElevation: 1 },
      { id: 2, pitIndex: 5 * 31 + 23, spillElevation: 1 },
    ])
    // 中心 (7, 5)・半径 4m に約 150.8m³（A の容量を約 25m³ 超える。B は約 0.2m までしか満ちない）
    engine.setRainfall(instantRain(cellCenter(7, 5, 1), 4, 3000))
    expect(engine.waterDepth()[1 * 31 + 1]).toBe(0)
    const events: SimulationEvent[] = []
    for (let n = 0; n < 3000; n++) events.push(...engine.step().events)
    expect(events.map((e) => e.depressionId)).toEqual([1])
    expect(events[0]?.step).toBeGreaterThan(1)
    expect(events[0]?.timeS).toBeGreaterThan(0)
    const w = engine.waterDepth()
    let inB = 0
    for (let y = 1; y < 10; y++) for (let x = 16; x < 30; x++) inB += w[y * 31 + x] ?? 0
    expect(inB).toBeGreaterThan(1)
  })

  it('平衡水位: 縁に囲まれた窪地に体積 V の水を入れると、止めた後の水面標高が理論値と 1cm 以内で一致', () => {
    const t = cone(21, 0.1, 5)
    const engine = engineOn(t, EQUILIBRIUM)
    const volume = 20
    const amountMm = (volume * 1000) / (Math.PI * 9)
    engine.setRainfall(instantRain(cellCenter(10, 10, 1), 3, amountMm))
    const stats = runUntilQuiet(engine, QUIET_EQUILIBRIUM_M_PER_S, MAX_STEPS)
    const level = levelForVolume(t, volume)
    const r = wetSurfaceRange(t, engine.waterDepth(), FILM_M)
    expect(Math.abs(r.min - level)).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(Math.abs(r.max - level)).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(stats.outflowWater).toBe(0)
  })
})
