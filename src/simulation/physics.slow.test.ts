import { describe, expect, it } from 'vitest'
import { MANNING_N, massTolerance, SETTLE_HOLD_S, SETTLE_VELOCITY_M_PER_S } from './constants.ts'
import { planRainfall } from './Rainfall.ts'
import type { TsSimulationEngine } from './TsSimulationEngine.ts'
import {
  buildTerrain,
  engineOn,
  faceSpeedMax,
  sheetDepth,
  sheetOnSlope,
  type Terrain,
  walledBasin,
} from './testing/fixtures.test-support.ts'
import type { RainfallInput, StepStats } from './types.ts'

/** 時間雨量（mm/h）を m/s にする */
const mmhToMps = (mmh: number): number => mmh / 1000 / 3600

/** 範囲全体の雨（中心・半径は使わない） */
const wholeRange = (intensityMmPerH: number, durationS: number): RainfallInput => ({
  x: 0,
  y: 0,
  radiusM: 1,
  intensityMmPerH,
  durationS,
  wholeRange: true,
})

/** 雨が終わる step まで回し、その統計を返す */
function runRain(engine: TsSimulationEngine, maxSteps = 1_000_000): StepStats {
  for (let n = 0; n < maxSteps; n++) {
    const s = engine.step()
    if (!s.raining) return s
  }
  throw new Error(`${maxSteps} step で雨が終わりませんでした`)
}

/**
 * 降雨の総量のテストの地形: 範囲 250 m 四方、雨の円より 2 セル広い平らな床（標高 0）を高さ 10 m の壁で囲む。
 * 水は床に留まり、走査範囲が円の近くに留まる（計画で決めたこと 16）
 */
function floorFor(cellSizeM: number, radiusM: number): Terrain {
  const n = Math.ceil(250 / cellSizeM)
  const inner = radiusM + 2 * cellSizeM
  return buildTerrain(n, n, cellSizeM, (x, y) =>
    Math.hypot((x + 0.5) * cellSizeM - 125, (y + 0.5) * cellSizeM - 125) <= inner ? 0 : 10,
  )
}

describe('降雨の総量（spec 08 §4.2・§9.3、重いテスト。計画で決めたこと 36）', () => {
  // physics.test.ts の CASES のうち 750 ms を超えた 2 組
  const CASES: [number, number, number, number][] = [
    [0.98, 10, 1, 21_600],
    [3.9, 100, 1, 3600],
  ]

  it.each(CASES)(
    'セル %f m・半径 %f m・%f mm/h・%f 秒: 雨が終わった時点の投入量が I·T·πr² と相対 1e-12 以内',
    (cellSizeM, radiusM, mmh, durationS) => {
      const engine = engineOn(floorFor(cellSizeM, radiusM))
      engine.setRainfall({
        x: 125,
        y: 125,
        radiusM,
        intensityMmPerH: mmh,
        durationS,
        wholeRange: false,
      })
      const s = runRain(engine)
      const expected = mmhToMps(mmh) * durationS * Math.PI * radiusM * radiusM
      expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
      expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
    },
    120_000,
  )

  it('円がグリッドの西の端で切れると、総量は I·T·πr²·|S|/|C|（R04-8。Review Focus 1）', {
    timeout: 120_000,
  }, () => {
    const t = buildTerrain(250, 250, 1, () => 0)
    const engine = engineOn(t)
    engine.setRainfall({
      x: 0,
      y: 125,
      radiusM: 10,
      intensityMmPerH: 100,
      durationS: 3600,
      wholeRange: false,
    })
    const s = runRain(engine)
    // 1 mm の雨の投入量（πr²·0.001·|S|/|C|）× 100 mm/h × 1 時間
    const perMm = planRainfall({ x: 0, y: 125, radiusM: 10, amountMm: 1 }, t.validMask, t.meta)
    const expected = perMm.volumeM3 * 100
    expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
    expect(expected).toBeLessThan(mmhToMps(100) * 3600 * Math.PI * 100 * 0.6)
  })
})

describe('平らな盆地と流出の速さ（spec 08 §4.3・§9.3、重いテスト。計画で決めたこと 36）', () => {
  it('縁で囲んだ平らな盆地に範囲全体の雨 100 mm/h × 2 時間: 雨の終わりに盆地の水深は平らで 0.2 m 以上、流出は縁に降った量以下。Σ 流出の速さ × dt = 領域外流出量', {
    timeout: 120_000,
  }, () => {
    // 30 × 30・セル 1 m、縁（外周 1 セル）は高さ 5 m の有効セル。範囲全体の雨は縁にも降り、その大半は盆地へ、
    // 一部はグリッドの外へ流れる（盆地の水深は 0.2 m ちょうどにはならない。試作 0.22882 m。spec 08 §9.3）
    const size = 30
    const engine = engineOn(walledBasin(size, 0, 5))
    engine.setRainfall(wholeRange(100, 7200))
    let bySteps = 0
    let s: StepStats
    do {
      s = engine.step()
      bySteps += s.outflowRateM3PerS * s.dtS
    } while (s.raining)
    const w = engine.waterDepth()
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const d = w[y * size + x] ?? 0
        min = Math.min(min, d)
        max = Math.max(max, d)
      }
    }
    expect(max - min).toBeLessThanOrEqual(1e-6)
    expect(min).toBeGreaterThanOrEqual(0.2)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(s.totalWater * 1e-12)
    expect(s.outflowWater).toBeLessThanOrEqual(mmhToMps(100) * 7200 * (4 * size - 4))
    expect(s.outflowWater).toBeGreaterThan(0)
    expect(Math.abs(bySteps - s.outflowWater)).toBeLessThanOrEqual(s.outflowWater * 1e-12)
  })
})

describe('斜面の定常流（Manning。spec 08 §9.3、M0 の U5、重いテスト。計画で決めたこと 36）', () => {
  it('幅 20 セル・長さ 100 m・勾配 0.01 に範囲全体の雨 100 mm/h: 流出は I × 面積と 1%、中央 10 列の水深は壁の分を足した等流と 3%、' +
    '95% に達する時刻は運動波の到達時間と 30%、流速は下り向きで等流の流速と 10% 以内', () => {
    const n = MANNING_N
    const S = 0.01
    const W = 20
    const I = mmhToMps(100)
    // 上端（行 0）と両側（列 0・21）は高さ 1 m の壁（有効セル）。下端（行 100 の先）はグリッドの端（仮想セル）
    const t = buildTerrain(W + 2, 101, 1, (x, y) => {
      const z = 1 + S * (100 - y)
      return x === 0 || x === W + 1 || y === 0 ? z + 1 : z
    })
    const engine = engineOn(t)
    engine.setRainfall(wholeRange(100, 6 * 3600))
    // 雨は壁にも降るので、定常の流出は範囲全体の有効セルの面積で比べる
    const expectedQ = I * (W + 2) * 101
    const te = ((100 * n) / (Math.sqrt(S) * I ** (2 / 3))) ** (3 / 5)
    // 下端から 10 m 上の行。上端の壁の外側の縁からの距離 x は行の中心で 91.5 m（上端の壁 1 m を含む）
    const row = 91
    let t95: number | null = null
    let outSum = 0
    let timeSum = 0
    let depthSum = 0
    let s: StepStats
    do {
      s = engine.step()
      if (t95 === null && s.outflowRateM3PerS >= 0.95 * expectedQ) t95 = s.timeS
      if (s.timeS > 2 * 3600) {
        const w = engine.waterDepth()
        let d = 0
        for (let x = 6; x <= 15; x++) d += w[row * (W + 2) + x] ?? 0
        outSum += s.outflowRateM3PerS * s.dtS
        depthSum += (d / 10) * s.dtS
        timeSum += s.dtS
      }
    } while (s.timeS < 3 * 3600)
    expect(Math.abs(outSum / timeSum - expectedQ) / expectedQ).toBeLessThanOrEqual(0.01)
    // 壁に降って斜面へ流れ込む分を q に足す: q = I·x·(W + 2)/W（断面の水深は列によらず一様。M0 の R2）
    const q = (I * (row + 0.5) * (W + 2)) / W
    const hm = ((n * q) / Math.sqrt(S)) ** (3 / 5)
    expect(Math.abs(depthSum / timeSum - hm) / hm).toBeLessThanOrEqual(0.03)
    expect(t95).not.toBeNull()
    expect(Math.abs((t95 ?? 0) - te) / te).toBeLessThanOrEqual(0.3)
    // 流れのベクトル（m/s。spec 08 §3.10）: 中央の列は下り（南）向きで、等流の流速 h^(2/3)·√S / n と 10% 以内
    const w = engine.waterDepth()
    const v = engine.flowVectors()
    for (let x = 6; x <= 15; x++) {
      const i = row * (W + 2) + x
      const u = ((w[i] ?? 0) ** (2 / 3) * Math.sqrt(S)) / n
      const vy = v.y[i] ?? 0
      expect(vy).toBeGreaterThan(0)
      expect(Math.abs(v.x[i] ?? 0)).toBeLessThan(0.1 * vy)
      expect(Math.abs(vy - u) / u).toBeLessThanOrEqual(0.1)
    }
  }, 120_000)
})

describe('自動停止（spec 08 §3.9・§9.3、R08-6、重いテスト。Task 8 のレビューの修正ラウンド 1）', () => {
  // 一度に置いた水は面の流量 0 から動き出すので、初めの step では面の流速が 1 cm/s 未満でも、水は流れ出したところ。
  // 勾配 1e-3・1e-4 では流速がのちに 1 cm/s を超え、閉じた範囲の中で揺れて 1 cm/s の前後を行き来する
  it.each([1e-3, 1e-4])(
    '一度に置いた水（勾配 %f の斜面に深さ 5 cm）は、初めの step では止まらず、止まった後は流速が 1 cm/s に戻らない',
    (slope) => {
      const engine = engineOn(sheetOnSlope(slope))
      engine.setInitialWater(sheetDepth(0.05))
      let s: StepStats | null = null
      let lastFast = -1
      for (let n = 0; n < 100_000; n++) {
        s = engine.step()
        if (faceSpeedMax(engine) >= SETTLE_VELOCITY_M_PER_S) lastFast = s.timeS
        if (s.timeS < 30) {
          expect(s.settled).toBe(false)
          expect(s.stopReason).toBeNull()
        }
        if (s.stopReason !== null) break
      }
      expect(lastFast).toBeGreaterThan(0)
      expect(s?.stopReason).toBe('settled')
      const settledAt = s?.timeS ?? 0
      expect(settledAt - lastFast).toBeGreaterThanOrEqual(SETTLE_HOLD_S)
      // 止まった後も 1 時間回し、流速が 1 cm/s に戻らないこと（止め方が早すぎない）
      while ((s?.timeS ?? 0) < settledAt + 3600) {
        s = engine.step()
        expect(faceSpeedMax(engine)).toBeLessThan(SETTLE_VELOCITY_M_PER_S)
      }
    },
    120_000,
  )
})
