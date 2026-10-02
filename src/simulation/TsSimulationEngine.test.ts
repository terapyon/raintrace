import { describe, expect, it } from 'vitest'
import {
  CFL_ALPHA,
  DT_MAX_S,
  GRAVITY,
  MANNING_N,
  massTolerance,
  SETTLE_VELOCITY_M_PER_S,
} from './constants.ts'
import { NoElevationAtRainCenterError } from './Rainfall.ts'
import { TsSimulationEngine } from './TsSimulationEngine.ts'
import {
  buildTerrain,
  cellCenter,
  cone,
  engineOn,
  instantRain,
  sameBits,
  walledBasin,
} from './testing/fixtures.test-support.ts'
import type { RainfallInput } from './types.ts'

/** 円の雨（時間雨量 × 継続時間） */
function circle(
  x: number,
  y: number,
  radiusM: number,
  intensityMmPerH: number,
  durationS: number,
): RainfallInput {
  return { x, y, radiusM, intensityMmPerH, durationS, wholeRange: false }
}

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
    engine.setRainfall(instantRain(cellCenter(2, 2, 1), 0.4, 100))
    let stats = engine.step()
    for (let n = 0; n < 200; n++) stats = engine.step()
    expect(stats.outflowWater).toBe(0)
  })
})

describe('EngineOptions（spec 08 §3.12）', () => {
  it('既定は MANNING_N と SETTLE_VELOCITY_M_PER_S。差し替えられる', () => {
    const engine = new TsSimulationEngine()
    expect(engine.manningN).toBe(MANNING_N)
    expect(engine.settleVelocityMPerS).toBe(SETTLE_VELOCITY_M_PER_S)
    const custom = new TsSimulationEngine({ manningN: 0.1, settleVelocityMPerS: 0 })
    expect(custom.manningN).toBe(0.1)
    expect(custom.settleVelocityMPerS).toBe(0)
  })

  it.each([-0.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'manningN・settleVelocityMPerS が有限で 0 以上でなければ RangeError（%s）',
    (value) => {
      expect(() => new TsSimulationEngine({ manningN: value })).toThrow(RangeError)
      expect(() => new TsSimulationEngine({ settleVelocityMPerS: value })).toThrow(RangeError)
    },
  )
})

describe('setRainfall（spec 08 §4.2）', () => {
  it('継続時間のある雨は登録するだけで、最初の step までは水を置かない', () => {
    const engine = engineOn(buildTerrain(20, 20, 1, () => 0))
    engine.setRainfall(circle(10, 10, 3, 100, 600))
    expect(engine.waterDepth().every((d) => d === 0)).toBe(true)
    const s = engine.step()
    expect(s.totalWater).toBeGreaterThan(0)
    expect(s.raining).toBe(true)
  })

  it('durationS = 0 は開始のときに一度に置く（量は intensityMmPerH の mm）。雨は降っていない扱い', () => {
    const engine = engineOn(buildTerrain(250, 250, 1, () => 0))
    engine.setRainfall(instantRain({ x: 125, y: 125 }, 10, 100))
    const expected = (Math.PI * 100 * 100) / 1000
    const placed = engine.waterDepth().reduce((a, d) => a + d, 0)
    expect(Math.abs(placed - expected) / expected).toBeLessThanOrEqual(1e-12)
    const s = engine.step()
    expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
    expect(s.raining).toBe(false)
    expect(s.rainDepthMm).toBe(100)
  })

  it('投入水量の雨の分は閉じた式 ρ·|S|·A·min(t, T_rain)（足し算の丸めを積まない。計画で決めたこと 35）。セルに足した水との差は質量誤差に出る', () => {
    const engine = engineOn(walledBasin(20, 0, 10))
    engine.setRainfall(circle(10, 10, 3, 100, 600.5))
    let s = engine.step()
    while (s.raining) s = engine.step()
    const expected = (100 / 1000 / 3600) * 600.5 * Math.PI * 9
    expect(s.timeS).toBe(600.5)
    expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-14)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
    // 雨の後は増えない
    expect(engine.step().totalWater).toBe(s.totalWater)
  })

  it('2 回目の登録は前の登録を置き換える', () => {
    const engine = engineOn(buildTerrain(20, 20, 1, () => 0))
    engine.setRainfall(circle(10, 10, 3, 100, 600))
    engine.setRainfall(circle(10, 10, 3, 300, 1200))
    const s = engine.step()
    expect(s.rainDepthMm).toBeCloseTo((300 * s.timeS) / 3600, 12)
  })

  it('最初の step の後（t > 0）の登録はエラーで、登録も水も変えない（reset の後なら登録できる）', () => {
    const engine = engineOn(buildTerrain(20, 20, 1, () => 0))
    engine.setRainfall(circle(10, 10, 3, 100, 600))
    const first = engine.step()
    expect(first.timeS).toBeGreaterThan(0)
    const before = engine.waterDepth().slice()
    expect(() => engine.setRainfall(circle(10, 10, 3, 300, 1200))).toThrow(Error)
    expect(sameBits(engine.waterDepth(), before)).toBe(true)
    // 前の登録のまま降り続ける
    expect(engine.step().rainDepthMm).toBeCloseTo((100 * (first.timeS + first.dtS)) / 3600, 12)
    engine.reset()
    engine.setRainfall(circle(10, 10, 3, 300, 1200))
    expect(engine.step().rainDepthMm).toBeCloseTo((300 * DT_MAX_S) / 3600, 12)
  })

  it('降雨中心に標高データが無ければエラーで、水も統計も変えない', () => {
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    expect(() => engine.setRainfall(instantRain({ x: 2.5, y: 2.5 }, 0.4, 10))).toThrow(
      NoElevationAtRainCenterError,
    )
    const s = engine.step()
    expect(s.totalWater).toBe(0)
    expect(s.rainDepthMm).toBe(0)
  })

  it('範囲全体の雨はすべての有効セルに同じ速さで降り、無効セルには降らない', () => {
    // 6 × 5・セル 2 m、(0, 0) だけ無効。360 mm/h は 1e-4 m/s。乾いた地形の最初の step の dt は DT_MAX_S
    const t = buildTerrain(6, 5, 2, (x, y) => (x === 0 && y === 0 ? Number.NaN : 0))
    const engine = engineOn(t)
    engine.setRainfall({
      x: 0,
      y: 0,
      radiusM: 1,
      intensityMmPerH: 360,
      durationS: 600,
      wholeRange: true,
    })
    const s = engine.step()
    const w = engine.waterDepth()
    expect(w[0]).toBe(0)
    for (let i = 1; i < 30; i++) expect(w[i]).toBeCloseTo(1e-4 * DT_MAX_S, 15)
    expect(s.totalWater).toBeCloseTo(1e-4 * DT_MAX_S * 29 * 4, 12)
  })
})

describe('step の統計（spec 08 §5.1）', () => {
  it('雨も水も無ければ dt は DT_MAX_S で、流れも無いので settled（stopReason は settled）', () => {
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
      timeS: DT_MAX_S,
      dtS: DT_MAX_S,
      raining: false,
      rainDepthMm: 0,
      outflowRateM3PerS: 0,
      stopReason: 'settled',
    })
  })

  it('経過時間は dt の和。乾いた地形に降り始めた最初の step の dt は DT_MAX_S', () => {
    const engine = engineOn(buildTerrain(20, 20, 1, () => 0))
    engine.setRainfall(circle(10, 10, 3, 100, 600))
    let t = 0
    for (let n = 0; n < 5; n++) {
      const s = engine.step()
      if (n === 0) expect(s.dtS).toBe(DT_MAX_S)
      t += s.dtS
      expect(s.timeS).toBe(t)
    }
  })

  it('一度に置いた水の最初の step の dt は α·Δx / √(g·h_max)', () => {
    const engine = engineOn(walledBasin(7, 0, 10))
    engine.setRainfall(instantRain(cellCenter(3, 3, 1), 0.4, 1000))
    const h = engine.waterDepth()[3 * 7 + 3] ?? 0
    expect(engine.step().dtS).toBe((CFL_ALPHA * 1) / Math.sqrt(GRAVITY * h))
  })

  it('投入量・貯留量・最大水深・質量誤差。閉じた盆地では流出 0', () => {
    const engine = engineOn(walledBasin(7, 0, 10))
    // 中央のセル 1 つに π × 0.4² × 1 m³ ≈ 0.503 m³
    engine.setRainfall(instantRain(cellCenter(3, 3, 1), 0.4, 1000))
    const v = Math.PI * 0.16
    for (let n = 0; n < 50; n++) {
      const s = engine.step()
      expect(s.totalWater).toBeCloseTo(v, 12)
      expect(s.outflowWater).toBe(0)
      expect(s.outflowRateM3PerS).toBe(0)
      expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
      expect(s.maxDepth).toBeGreaterThan(0)
    }
  })
})

describe('境界と無効セル（spec 08 §3.6・§9.3）', () => {
  it('端のセルの水は流出し、outflowWater と流出の速さ（× dt）に入る', () => {
    // セル 2 m の平面。角のセル (0, 0) にだけ水を置く
    const engine = engineOn(buildTerrain(3, 3, 2, () => 0))
    engine.setRainfall(instantRain({ x: 1, y: 1 }, 0.5, 1000))
    const s = engine.step()
    expect(s.outflowWater).toBeGreaterThan(0)
    expect(s.outflowRateM3PerS * s.dtS).toBeCloseTo(s.outflowWater, 12)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
  })

  it('無効セルに上下左右で接するセルの水も流出し、無効セルは水を持たない', () => {
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    engine.setRainfall(instantRain(cellCenter(1, 2, 1), 0.4, 1000))
    const s = engine.step()
    expect(s.outflowWater).toBeGreaterThan(0)
    expect(engine.waterDepth()[2 * 5 + 2]).toBe(0)
  })

  it('無効セルに斜めにだけ接するセルからは流出しない（4 近傍）', () => {
    // (1, 1) は無効セル (2, 2) と斜めにだけ接する。最初の step で濡れているのは (1, 1) だけ
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    engine.setRainfall(instantRain(cellCenter(1, 1, 1), 0.4, 1000))
    expect(engine.step().outflowWater).toBe(0)
  })
})

describe('flowVectors（spec 08 §3.10）', () => {
  it('面の流量が 0 の間（最初の step の前）はすべて 0。東へ下る斜面では 1 step 後に濡れたセルが東を向く（m/s）', () => {
    const engine = engineOn(buildTerrain(15, 9, 1, (x) => (14 - x) * 0.2))
    engine.setRainfall(instantRain(cellCenter(5, 4, 1), 2, 50))
    const before = engine.flowVectors()
    expect(before.x.every((v) => v === 0)).toBe(true)
    engine.step()
    const w = engine.waterDepth()
    const v = engine.flowVectors()
    let moving = 0
    for (let i = 0; i < w.length; i++) {
      if ((w[i] ?? 0) === 0) {
        expect([v.x[i], v.y[i]]).toEqual([0, 0])
        continue
      }
      if ((v.x[i] ?? 0) > Math.abs(v.y[i] ?? 0)) moving++
    }
    expect(moving).toBeGreaterThan(0)
  })

  it('同じ配列を使い回し、呼ぶたびに今の状態で書き直す（新しいエンジンの値と同じ）', () => {
    const t = buildTerrain(15, 9, 1, (x) => (14 - x) * 0.2)
    const rain = instantRain(cellCenter(5, 4, 1), 2, 50)
    const a = engineOn(t)
    a.setRainfall(rain)
    const first = a.flowVectors()
    for (let n = 0; n < 20; n++) a.step()
    const second = a.flowVectors()
    expect(second.x).toBe(first.x)
    expect(second.y).toBe(first.y)
    const fresh = engineOn(t)
    fresh.setRainfall(rain)
    for (let n = 0; n < 20; n++) fresh.step()
    const expected = fresh.flowVectors()
    expect(Array.from(second.x)).toEqual(Array.from(expected.x))
    expect(Array.from(second.y)).toEqual(Array.from(expected.y))
  })

  it('loadTerrain で大きさが変わったら、新しい大きさの配列にする', () => {
    const engine = engineOn(buildTerrain(4, 4, 1, () => 0))
    expect(engine.flowVectors().x.length).toBe(16)
    const t = buildTerrain(6, 5, 1, () => 0)
    engine.loadTerrain(t.elevation, t.validMask, t.meta)
    expect(engine.flowVectors().x.length).toBe(30)
  })
})

describe('走査範囲（spec 08 §3.8、計画で決めたこと 10）', () => {
  it("水が走査範囲の端を越えて広がり、グリッドの端から流出しても、'bbox' と 'full' で水深・面の流量・統計がビット単位で一致し、質量が保存される", () => {
    // 東へ下る斜面（15 × 9）の西寄りに一度に置いた水が、走査範囲を広げながら東の端まで流れて流出する
    const t = buildTerrain(15, 9, 1, (x, y) => (14 - x) * 0.05 + (y === 4 ? 0 : 0.01))
    const rain = instantRain(cellCenter(4, 4, 1), 1.5, 200)
    const bbox = engineOn(t, { scanMode: 'bbox' })
    const full = engineOn(t, { scanMode: 'full' })
    bbox.setRainfall(rain)
    full.setRainfall(rain)
    const start = bbox.scanWindow()
    expect(start.x1 - start.x0).toBeLessThan(15)
    let widest = 0
    let last = bbox.step()
    expect(last).toEqual(full.step())
    for (let n = 0; n < 400; n++) {
      last = bbox.step()
      expect(last).toEqual(full.step())
      expect(Math.abs(last.massError)).toBeLessThanOrEqual(massTolerance(last.totalWater))
      const win = bbox.scanWindow()
      widest = Math.max(widest, win.x1 - win.x0)
      expect(sameBits(bbox.waterDepth(), full.waterDepth())).toBe(true)
      expect(sameBits(bbox.faceFlows().qx, full.faceFlows().qx)).toBe(true)
      expect(sameBits(bbox.faceFlows().qy, full.faceFlows().qy)).toBe(true)
    }
    // 走査範囲は最初より広がり、水はグリッドの東の端から出ている
    expect(widest).toBeGreaterThan(start.x1 - start.x0)
    expect(last.outflowWater).toBeGreaterThan(0)
  })
})

describe('reset（spec 08 §9.3、計画で決めたこと 6）', () => {
  it('水・流量・経過時間・統計を戻し、雨の登録を消す。地形は残す（以降は新しいエンジンとビット単位で同じ）', () => {
    const t = cone(9, 0.1, 5)
    const rain = circle(4.5, 4.5, 1.5, 200, 120)
    const a = engineOn(t)
    const b = engineOn(t)
    a.setRainfall(rain)
    for (let n = 0; n < 50; n++) a.step()
    a.reset()
    expect(a.waterDepth().every((d) => d === 0)).toBe(true)
    const { qx, qy, hfx, hfy } = a.faceFlows()
    expect(qx.every((q) => q === 0) && qy.every((q) => q === 0)).toBe(true)
    expect(hfx.every((q) => q === 0) && hfy.every((q) => q === 0)).toBe(true)
    // 雨の登録は残らない（登録せずに回しても水は増えない）
    const idle = a.step()
    expect(idle).toMatchObject({ step: 1, totalWater: 0, timeS: DT_MAX_S, rainDepthMm: 0 })
    a.reset()
    a.setRainfall(rain)
    b.setRainfall(rain)
    for (let n = 0; n < 30; n++) expect(a.step()).toEqual(b.step())
    expect(sameBits(a.waterDepth(), b.waterDepth())).toBe(true)
  })
})

describe('テスト用の口（計画で決めたこと 11）', () => {
  it('setInitialWater は水深を置いて走査範囲を全体にし、投入量に数える。無効セルや負の水深は RangeError', () => {
    const t = buildTerrain(3, 3, 2, (x, y) => (x === 0 && y === 0 ? Number.NaN : 0))
    const engine = engineOn(t)
    const depth = new Float64Array(9).fill(0.1)
    depth[0] = 0
    engine.setInitialWater(depth)
    expect(engine.scanWindow()).toEqual({ x0: 0, y0: 0, x1: 3, y1: 3 })
    expect(engine.step().totalWater).toBeCloseTo(0.1 * 8 * 4, 12)
    const bad = new Float64Array(9)
    bad[0] = 0.1
    expect(() => engineOn(t).setInitialWater(bad)).toThrow(RangeError)
    expect(() => engineOn(t).setInitialWater(new Float64Array(9).fill(-1))).toThrow(RangeError)
    expect(() => engineOn(t).setInitialWater(new Float64Array(4))).toThrow(RangeError)
  })
})
