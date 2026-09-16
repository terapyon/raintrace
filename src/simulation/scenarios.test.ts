import { describe, expect, it } from 'vitest'
import { SURFACE_ELEVATION_TOLERANCE_M } from './constants.ts'
import {
  buildTerrain,
  cellCenter,
  centroidX,
  cone,
  engineOn,
  levelForVolume,
  maxWetElevation,
  runUntilSettled,
  twoBasins,
  walledBasin,
  wetSurfaceRange,
} from './testing/fixtures.test-support.ts'
import type { SimulationEvent } from './types.ts'

describe('base-spec §47 の 4 ケースと平衡水位（spec 03 §6.1）', () => {
  it('平面: 縁で囲んだ平らな盆地に置いた水が広がり、平衡後の水面の最大と最小の差が 1cm 以内', () => {
    // 12 × 12（床 10 × 10 = 100m²、縁 10m）。約 12.6m³ を床の北西寄りに置く
    const t = walledBasin(12, 0, 10)
    const engine = engineOn(t)
    engine.addRainfall({ ...cellCenter(3, 3, 1), radiusM: 2, amountMm: 1000 })
    const stats = runUntilSettled(engine, 20_000)
    const r = wetSurfaceRange(t, engine.waterDepth())
    expect(r.cells).toBe(100)
    expect(r.max - r.min).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(stats.outflowWater).toBe(0)
  })

  it('傾斜面: 水は下り方向にしか動かず、置いた位置より高いセルは水を得ず、重心が下り方向へ移る', () => {
    // 東へ 1 セルにつき 0.2m 下る斜面。雨の深さ（約 5cm）は 1 セルの高低差より小さい
    const t = buildTerrain(40, 41, 1, (x) => (39 - x) * 0.2)
    const engine = engineOn(t)
    engine.addRainfall({ ...cellCenter(10, 20, 1), radiusM: 3, amountMm: 50 })
    const zTop = maxWetElevation(t, engine.waterDepth())
    const start = centroidX(t, engine.waterDepth())
    let prev = start
    for (let n = 0; n < 15; n++) {
      engine.step()
      expect(maxWetElevation(t, engine.waterDepth())).toBeLessThanOrEqual(zTop)
      const c = centroidX(t, engine.waterDepth())
      expect(c).toBeGreaterThanOrEqual(prev)
      prev = c
    }
    expect(prev).toBeGreaterThan(start + 1)
  })

  it('単純窪地: 窪地の外に置いた水が窪地に集まり、平衡後の水面が 1cm 以内で平ら', () => {
    // すり鉢（中心 (10, 10)、勾配 0.1）。雨は中心から 6 セル東の斜面に降らせる
    const t = cone(21, 0.1, 5)
    const engine = engineOn(t)
    engine.addRainfall({ ...cellCenter(16, 10, 1), radiusM: 1.5, amountMm: 200 })
    const stats = runUntilSettled(engine, 50_000)
    const w = engine.waterDepth()
    const r = wetSurfaceRange(t, w)
    expect(r.max - r.min).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(w[10 * 21 + 10]).toBeGreaterThan(0.1)
    expect(w[10 * 21 + 16]).toBe(0)
    expect(stats.outflowWater).toBe(0)
  })

  it('越流: 峠でつながった 2 つの窪地の一方に容量を超える水を置くと、水位が上がって越流イベントが 1 回だけ出て、もう一方が水を得る', () => {
    // 西の盆地 A（床 14 × 9 = 126m²）と東の盆地 B を、高さ 1m の峠でつなぐ。A の峠までの容量は 126m³。
    // A の最低点（床は平らなので、どのセルでもよい）は北西の角のセル (1, 1) とし、雨の円の外に置く。
    // 雨が最低点に直接落ちて step 1 で通知される、ということが起きないようにするため
    const t = twoBasins(1)
    const engine = engineOn(t)
    engine.setDepressions([
      { id: 1, pitIndex: 1 * 31 + 1, spillElevation: 1 },
      { id: 2, pitIndex: 5 * 31 + 23, spillElevation: 1 },
    ])
    // 中心 (7, 5)・半径 4m に約 150.8m³（A の容量を約 25m³ 超える。B は約 0.2m までしか満ちない）
    engine.addRainfall({ ...cellCenter(7, 5, 1), radiusM: 4, amountMm: 3000 })
    expect(engine.waterDepth()[1 * 31 + 1]).toBe(0)
    const events: SimulationEvent[] = []
    for (let n = 0; n < 3000; n++) events.push(...engine.step().events)
    expect(events.map((e) => e.depressionId)).toEqual([1])
    expect(events[0]?.step).toBeGreaterThan(1)
    const w = engine.waterDepth()
    let inB = 0
    for (let y = 1; y < 10; y++) for (let x = 16; x < 30; x++) inB += w[y * 31 + x] ?? 0
    expect(inB).toBeGreaterThan(1)
  })

  it('平衡水位: 縁に囲まれた窪地に体積 V の水を入れると、平衡後の水面標高が理論値と 1cm 以内で一致', () => {
    const t = cone(21, 0.1, 5)
    const engine = engineOn(t)
    const volume = 20
    const amountMm = (volume * 1000) / (Math.PI * 9)
    engine.addRainfall({ ...cellCenter(10, 10, 1), radiusM: 3, amountMm })
    const stats = runUntilSettled(engine, 100_000)
    const level = levelForVolume(t, volume)
    const r = wetSurfaceRange(t, engine.waterDepth())
    expect(Math.abs(r.min - level)).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(Math.abs(r.max - level)).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(stats.outflowWater).toBe(0)
  })
})
