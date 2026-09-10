import { describe, expect, it } from 'vitest'
import { massTolerance } from './constants.ts'
import { FLOW_K } from './FlowSolver.ts'
import { NoElevationAtRainCenterError } from './Rainfall.ts'
import { TsSimulationEngine } from './TsSimulationEngine.ts'
import {
  buildTerrain,
  cellCenter,
  cone,
  engineOn,
  runUntilSettled,
  sameBits,
  walledBasin,
} from './testing/fixtures.ts'

describe('loadTerrain', () => {
  it('loadTerrain の前に呼ぶとエラー', () => {
    const engine = new TsSimulationEngine()
    expect(() => engine.step()).toThrow('loadTerrain を先に呼んでください')
    expect(() => engine.waterDepth()).toThrow('loadTerrain を先に呼んでください')
  })

  it('配列の長さ・グリッドの大きさ・セルの大きさが不正なら RangeError', () => {
    const engine = new TsSimulationEngine()
    const z = new Float32Array(6)
    const m = new Uint8Array(6)
    expect(() => engine.loadTerrain(z, m, { width: 2, height: 2, cellSizeM: 1 })).toThrow(
      RangeError,
    )
    expect(() => engine.loadTerrain(z, m, { width: 0, height: 6, cellSizeM: 1 })).toThrow(
      RangeError,
    )
    expect(() => engine.loadTerrain(z, m, { width: 3, height: 2, cellSizeM: 0 })).toThrow(
      RangeError,
    )
  })

  it('標高とマスクを複製して持つ（呼び出し側が後で書き換えても影響しない）', () => {
    const t = walledBasin(5, 0, 10)
    const engine = engineOn(t)
    t.elevation.fill(-100)
    engine.addRainfall({ ...cellCenter(2, 2, 1), radiusM: 0.4, amountMm: 100 })
    const stats = runUntilSettled(engine, 1000)
    expect(stats.outflowWater).toBe(0)
  })
})

describe('addRainfall（spec 03 §3.6）', () => {
  const cases = [0.98, 3.9, 7.8].flatMap((cs) => [1, 10, 100].map((r) => [cs, r]))

  it.each(cases)('セル %f m・半径 %f m: 投入量が πr² × 雨量と相対 1e-12 以内で一致', (cs, r) => {
    const n = Math.ceil(250 / cs)
    const engine = engineOn(buildTerrain(n, n, cs, () => 0))
    engine.addRainfall({ x: 125, y: 125, radiusM: r, amountMm: 100 })
    const expected = (Math.PI * r * r * 100) / 1000
    const placed = engine.waterDepth().reduce((a, d) => a + d, 0) * cs * cs
    expect(Math.abs(placed - expected) / expected).toBeLessThanOrEqual(1e-12)
    const stats = engine.step()
    expect(Math.abs(stats.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
  })

  it('降雨中心に標高データが無ければエラーで、水も統計も変えない', () => {
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    expect(() => engine.addRainfall({ x: 2.5, y: 2.5, radiusM: 0.4, amountMm: 10 })).toThrow(
      NoElevationAtRainCenterError,
    )
    expect(engine.step().totalWater).toBe(0)
  })
})

describe('step の統計（spec 03 §3.8）', () => {
  it('投入量・貯留量・流出量・最大水深・浸水面積・質量誤差', () => {
    const engine = engineOn(walledBasin(7, 0, 10))
    // 中央のセル 1 つに π × 0.4² × 1 m³ ≈ 0.503 m³
    engine.addRainfall({ ...cellCenter(3, 3, 1), radiusM: 0.4, amountMm: 1000 })
    const s = engine.step()
    const v = Math.PI * 0.16
    expect(s.step).toBe(1)
    expect(s.totalWater).toBeCloseTo(v, 12)
    expect(s.storedWater).toBeCloseTo(v, 12)
    expect(s.outflowWater).toBe(0)
    // c = 0.5 なので半分が残る。8 近傍はすべて 1cm 以上になる
    expect(s.maxDepth).toBeCloseTo(v / 2, 12)
    expect(s.floodedArea).toBe(9)
    expect(s.settled).toBe(false)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
    expect(s.events).toEqual([])
  })

  it('水が無ければ settled で、統計はすべて 0', () => {
    const s = engineOn(walledBasin(5, 0, 10)).step()
    expect(s).toEqual({
      step: 1,
      totalWater: 0,
      storedWater: 0,
      outflowWater: 0,
      maxDepth: 0,
      floodedArea: 0,
      settled: true,
      massError: 0,
      events: [],
    })
  })
})

describe('境界と無効セル（spec 03 §3.3、§6.3）', () => {
  it('端のセルの水は流出し、outflowWater に入る', () => {
    // セル 2m（面積 4m²）の平面。角のセル (0, 0) にだけ水を置く
    const engine = engineOn(buildTerrain(3, 3, 2, () => 0))
    engine.addRainfall({ x: 1, y: 1, radiusM: 0.5, amountMm: 1000 })
    const w0 = engine.waterDepth()[0] ?? Number.NaN
    const s = engine.step()
    expect(s.outflowWater).toBeCloseTo(FLOW_K * (2 + 3 * Math.SQRT1_2) * w0 * 4, 12)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
  })

  it('無効セルに接するセルの水も流出する', () => {
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    engine.addRainfall({ ...cellCenter(1, 2, 1), radiusM: 0.4, amountMm: 1000 })
    const w = engine.waterDepth()[2 * 5 + 1] ?? Number.NaN
    const s = engine.step()
    expect(s.outflowWater).toBeCloseTo(FLOW_K * w, 12)
    expect(engine.waterDepth()[2 * 5 + 2]).toBe(0)
  })
})

describe('平衡の検出（§6.3）', () => {
  it('流れている間は settled が false、平衡後に true になり、その後は水が動かない', () => {
    const engine = engineOn(cone(9, 0.1, 5))
    engine.addRainfall({ ...cellCenter(6, 4, 1), radiusM: 1, amountMm: 100 })
    expect(engine.step().settled).toBe(false)
    expect(runUntilSettled(engine, 5000).settled).toBe(true)
    const before = engine.waterDepth().slice()
    expect(engine.step().settled).toBe(true)
    expect(sameBits(engine.waterDepth(), before)).toBe(true)
  })
})

describe('flowVectors（§3.9、§6.3）', () => {
  it('一様な斜面では、濡れたセルのベクトルが下り方向（東）を向き、水は動かない', () => {
    const engine = engineOn(buildTerrain(15, 9, 1, (x) => (14 - x) * 0.2))
    engine.addRainfall({ ...cellCenter(5, 4, 1), radiusM: 2, amountMm: 50 })
    const w = engine.waterDepth().slice()
    const v = engine.flowVectors()
    let wet = 0
    for (let i = 0; i < w.length; i++) {
      if (w[i] === 0) {
        expect([v.x[i], v.y[i]]).toEqual([0, 0])
        continue
      }
      wet++
      expect(v.x[i]).toBeGreaterThan(Math.abs(v.y[i] ?? 0))
    }
    expect(wet).toBe(13)
    expect(sameBits(engine.waterDepth(), w)).toBe(true)
  })
})

describe('reset（§6.3）', () => {
  it('水と統計を初期状態に戻し、地形は残す（以降は新しいエンジンとビット単位で同じ）', () => {
    const t = cone(9, 0.1, 5)
    const a = engineOn(t)
    const b = engineOn(t)
    const rain = { ...cellCenter(4, 4, 1), radiusM: 1.5, amountMm: 200 }
    a.addRainfall(rain)
    for (let n = 0; n < 50; n++) a.step()
    a.reset()
    expect(a.waterDepth().every((d) => d === 0)).toBe(true)
    a.addRainfall(rain)
    b.addRainfall(rain)
    for (let n = 0; n < 30; n++) expect(a.step()).toEqual(b.step())
    expect(sameBits(a.waterDepth(), b.waterDepth())).toBe(true)
  })
})
