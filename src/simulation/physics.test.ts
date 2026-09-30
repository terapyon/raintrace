import { describe, expect, it } from 'vitest'
import { FROUDE_MAX, GRAVITY, massTolerance, SETTLE_CAP_S, SETTLE_HOLD_S } from './constants.ts'
import type { TsSimulationEngine } from './TsSimulationEngine.ts'
import {
  buildTerrain,
  cellCenter,
  cone,
  engineOn,
  runUntilStopped,
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

describe('降雨の総量（spec 08 §4.2・§9.3）', () => {
  // [セルの大きさ（m）, 半径（m）, 時間雨量（mm/h）, 継続時間（s）]。各値を 1 回以上使い、重い組は短い継続時間にする。
  // 600.5 秒は dt（乾いた床では 1 秒）が継続時間を割り切らない組
  // 750 ms を超える 2 組（セル 0.98 m・半径 10 m・1 mm/h・21600 秒と、セル 3.9 m・半径 100 m・1 mm/h・3600 秒）は
  // physics.slow.test.ts へ移した（計画で決めたこと 36。Step 2 の分岐）
  const CASES: [number, number, number, number][] = [
    [0.98, 1, 300, 3600],
    // 重い組（約 4.2 万セル）は 60 秒に縮める（計画のレビュー 1 の M1。各値を 1 回以上使うことは保つ）
    [0.98, 100, 100, 60],
    [3.9, 1, 100, 21_600],
    [3.9, 10, 300, 600.5],
    [7.8, 1, 300, 21_600],
    [7.8, 10, 100, 3600],
    [7.8, 100, 300, 600],
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
    30_000,
  )

  // 「円がグリッドの西の端で切れると」（793 ms）は physics.slow.test.ts へ移した（計画で決めたこと 36）

  it('無効セル（海）のある範囲全体の雨の総量は I·T·有効セル数·A（無効セルには降らない。Review Focus 1）', {
    timeout: 30_000,
  }, () => {
    const t = buildTerrain(30, 30, 2, (x) => (x < 5 ? Number.NaN : 0.01 * x))
    const engine = engineOn(t)
    engine.setRainfall(wholeRange(100, 600))
    const s = runRain(engine)
    let valid = 0
    for (const v of t.validMask) valid += v
    const expected = mmhToMps(100) * 600 * valid * 4
    expect(valid).toBe(25 * 30)
    expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
  })
})

describe('雨の終わり（spec 08 §3.3・§9.3）', () => {
  it('最後の step で raining が false になり、その step の timeS は継続時間にちょうど等しく、rainDepthMm は総量。その後は投入しない', {
    timeout: 30_000,
  }, () => {
    const engine = engineOn(cone(21, 0.1, 5))
    const durationS = 600.5
    engine.setRainfall({
      ...cellCenter(10, 10, 1),
      radiusM: 3,
      intensityMmPerH: 100,
      durationS,
      wholeRange: false,
    })
    let s: StepStats
    do {
      s = engine.step()
      if (s.raining) expect(s.timeS).toBeLessThan(durationS)
    } while (s.raining)
    expect(s.timeS).toBe(durationS)
    expect(s.rainDepthMm).toBe((100 * durationS) / 3600)
    const after = engine.step()
    expect(after.raining).toBe(false)
    expect(after.rainDepthMm).toBe(s.rainDepthMm)
    expect(after.totalWater).toBe(s.totalWater)
  })
})

describe('重力波の速さ（spec 08 §3.2・§9.3）', () => {
  it('平らな水面（深さ 0.5 m）に 1 cm の段差を置くと、段差は √(g·h) の速さで伝わる（到達時刻が 20% 以内）', {
    timeout: 30_000,
  }, () => {
    // 201 × 3・セル 1 m の水路。行 0・2 と両端（列 0・200）は高さ 10 m の壁。列 1〜99 は 0.51 m、列 100〜199 は 0.5 m
    const W = 201
    const t = buildTerrain(W, 3, 1, (x, y) => (y !== 1 || x === 0 || x === W - 1 ? 10 : 0))
    const h = new Float64Array(W * 3)
    for (let x = 1; x < W - 1; x++) h[W + x] = x < 100 ? 0.51 : 0.5
    const engine = engineOn(t)
    engine.setInitialWater(h)
    // 段差から 50.5 m 先（列 150 の中心）に、段差の高さの 1/4（2.5 mm）が届いた時刻
    let arrival: number | null = null
    for (let n = 0; n < 5000 && arrival === null; n++) {
      const s = engine.step()
      if ((engine.waterDepth()[W + 150] ?? 0) > 0.5025) arrival = s.timeS
    }
    const expected = 50.5 / Math.sqrt(GRAVITY * 0.5)
    expect(arrival).not.toBeNull()
    expect(Math.abs((arrival ?? 0) - expected) / expected).toBeLessThanOrEqual(0.2)
  })
})

describe('急な段差（spec 08 §3.5・§9.3、M0 の U5）', () => {
  it('1 セルで 3 m 下がる段差に 300 mm/h × 30 分: NaN・負の水深が出ず、どの面もフルード数の上限を越えない。質量は保存する', () => {
    const t = buildTerrain(60, 20, 1, (x) => (x < 30 ? 3 + 0.01 * (30 - x) : 0.01 * (60 - x)))
    const engine = engineOn(t)
    engine.setRainfall(wholeRange(300, 1800))
    let badDepth = 0
    let worstFroude = 0
    let s: StepStats
    do {
      s = engine.step()
      for (const d of engine.waterDepth()) if (!(Number.isFinite(d) && d >= 0)) badDepth++
      const { qx, qy, hfx, hfy } = engine.faceFlows()
      const check = (q: Float64Array, hf: Float64Array): void => {
        for (let i = 0; i < q.length; i++) {
          const v = q[i] ?? 0
          if (v === 0) continue
          const f = hf[i] ?? 0
          const ratio = Math.abs(v) / (f * Math.sqrt(GRAVITY * f))
          if (!(ratio <= worstFroude)) worstFroude = ratio
        }
      }
      check(qx, hfx)
      check(qy, hfy)
    } while (s.timeS < 3600)
    expect(badDepth).toBe(0)
    expect(worstFroude).toBeLessThanOrEqual(FROUDE_MAX * (1 + 1e-12))
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
  }, 30_000)
})

describe('自動停止（spec 08 §3.9・§9.3、R08-6、Q1 = (a)）', () => {
  // グリッドの端・無効セルに接せず、段差の無い閉じた盆地（雨は壁に降らない円。レビュー 1 の R1 の再レビュー）
  const BASINS: [string, Terrain, number][] = [
    ['平らな床の盆地（20 × 20）', walledBasin(20, 0, 10), 10],
    ['すり鉢（21 × 21、勾配 0.1）', cone(21, 0.1, 5), 10.5],
    ['すり鉢（21 × 21、勾配 0.02）', cone(21, 0.02, 5), 10.5],
  ]

  it.each(BASINS)(
    '%s: 雨の間は settled にならず、雨の後に settled（stopReason = settled）で止まる',
    (_, t, center) => {
      const engine = engineOn(t)
      engine.setRainfall({
        x: center,
        y: center,
        radiusM: 4,
        intensityMmPerH: 100,
        durationS: 600,
        wholeRange: false,
      })
      let s: StepStats | null = null
      for (let n = 0; n < 100_000; n++) {
        s = engine.step()
        if (s.raining) {
          expect(s.settled).toBe(false)
          expect(s.stopReason).toBeNull()
        }
        if (s.stopReason !== null) break
      }
      expect(s?.stopReason).toBe('settled')
      expect(s?.settled).toBe(true)
      expect(s?.timeS ?? 0).toBeGreaterThan(600)
    },
    30_000,
  )

  it('止まらない条件（停止の流速 0）では、雨がやんでから SETTLE_CAP_S で cap になる（計画で決めたこと 13）', () => {
    const engine = engineOn(walledBasin(8, 0, 10), { settleVelocityMPerS: 0 })
    engine.setRainfall({
      ...cellCenter(4, 4, 1),
      radiusM: 2,
      intensityMmPerH: 100,
      durationS: 600,
      wholeRange: false,
    })
    let previous: StepStats | null = null
    let s: StepStats | null = null
    for (let n = 0; n < 200_000; n++) {
      s = engine.step()
      if (s.stopReason !== null) break
      previous = s
    }
    expect(s?.stopReason).toBe('cap')
    expect(s?.settled).toBe(false)
    expect((s?.timeS ?? 0) - 600).toBeGreaterThanOrEqual(SETTLE_CAP_S)
    expect((previous?.timeS ?? 0) - 600).toBeLessThan(SETTLE_CAP_S)
  }, 30_000)

  // 勾配 1e-3・1e-4 の斜面に一度に置いた水が初めの step で止まらないこと（750 ms を超える）は physics.slow.test.ts

  it('平らな床に一度に置いた水は動かず、止まる条件が SETTLE_HOLD_S 続いたところで settled になる', () => {
    const engine = engineOn(sheetOnSlope(0))
    engine.setInitialWater(sheetDepth(0.05))
    const s = runUntilStopped(engine, 100_000)
    expect(s.stopReason).toBe('settled')
    expect(s.timeS).toBeGreaterThanOrEqual(SETTLE_HOLD_S)
    expect(s.timeS - s.dtS).toBeLessThan(SETTLE_HOLD_S)
  }, 30_000)

  it.each([
    ['継続時間 0 の雨', 'rain'],
    ['setInitialWater（雨なし）', 'initial'],
  ])(
    '止まらない条件で水を一度に置く（%s）と、cap は t = 0 から数えて SETTLE_CAP_S で付く',
    (_, how) => {
      const t = walledBasin(8, 0, 10)
      const engine = engineOn(t, { settleVelocityMPerS: 0 })
      if (how === 'rain') {
        engine.setRainfall({
          ...cellCenter(4, 4, 1),
          radiusM: 2,
          intensityMmPerH: 50,
          durationS: 0,
          wholeRange: false,
        })
      } else {
        const h = new Float64Array(64)
        for (let y = 1; y < 7; y++) for (let x = 1; x < 7; x++) h[y * 8 + x] = 0.05
        engine.setInitialWater(h)
      }
      let previous: StepStats | null = null
      let s: StepStats | null = null
      for (let n = 0; n < 200_000; n++) {
        s = engine.step()
        if (s.stopReason !== null) break
        previous = s
      }
      expect(s?.stopReason).toBe('cap')
      expect(s?.settled).toBe(false)
      expect(s?.timeS ?? 0).toBeGreaterThanOrEqual(SETTLE_CAP_S)
      expect(previous?.timeS ?? 0).toBeLessThan(SETTLE_CAP_S)
    },
    30_000,
  )
})
