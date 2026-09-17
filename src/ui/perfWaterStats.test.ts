import { describe, expect, it } from 'vitest'
import {
  countMask,
  erode,
  judgeWater,
  MAX_CAMERA_DRIFT_M,
  MIN_FOOTPRINT_PX,
  MIN_INTERIOR_PX,
  MIN_LIFTED_PX,
  magentaMask,
  measureWaterMasks,
  type WaterMeasure,
} from './perfWaterStats'

describe('magentaMask（S の readMask と同じ閾値）', () => {
  it('R > 200・G < 80・B > 200 の画素だけ 1', () => {
    const rgba = Uint8Array.of(
      255,
      0,
      255,
      255,
      201,
      79,
      201,
      255,
      255,
      80,
      255,
      255,
      200,
      0,
      255,
      255,
    )
    expect(Array.from(magentaMask(rgba))).toEqual([1, 1, 0, 0])
  })
})

describe('erode', () => {
  it('5 × 5 の全部 1 を 2 回削ると中央の 1 画素だけ残る', () => {
    const mask = new Uint8Array(25).fill(1)
    const once = erode(mask, 5, 5, 1)
    expect(countMask(once)).toBe(9)
    const twice = erode(mask, 5, 5, 2)
    expect(countMask(twice)).toBe(1)
    expect(twice[12]).toBe(1)
  })
})

describe('measureWaterMasks（計画で決めたこと 15、Task 27 のレビュー I3・I4）', () => {
  it('可視率（spec の定義）・持ち上げ比・ちらつき率', () => {
    const footprint = new Uint8Array(25).fill(1)
    const v0 = new Uint8Array(25).fill(1)
    v0.fill(0, 0, 5) // 上の 1 行が隠れている
    const v1 = v0.slice()
    const v2 = v0.slice()
    v2[12] = 0 // 中央が 1 つの揺らしでだけ消える（ちらつき）
    const lifted = new Uint8Array(25).fill(1)
    lifted.fill(0, 0, 2) // 持ち上げても 2 画素は隠れる（地形が正当に隠す分）
    const m = measureWaterMasks({
      width: 5,
      height: 5,
      footprint,
      footprintEnd: footprint.slice(),
      visible: [v0, v1, v2],
      lifted,
    })
    expect(m).toEqual({
      footprintPx: 25,
      footprintEndPx: 25,
      footprintDriftPx: 0,
      visiblePx: 20,
      liftedPx: 23,
      visibleAndLiftedPx: 20,
      visibleNotFootprintPx: 0,
      visibleNotLiftedPx: 0,
      visibleRatio: 0.8,
      unoccludedRatio: 20 / 23,
      noiseRatio: 0,
      interiorPx: 1,
      flickerRatio: 1,
    })
  })

  it('上限で切らず、食い違い（見えた ∧ ¬footprint・見えた ∧ ¬持ち上げ・footprint のずれ）を画素ごとに数える', () => {
    const footprint = Uint8Array.of(1, 1, 0, 0)
    const footprintEnd = Uint8Array.of(1, 0, 0, 1) // 2 画素が最初と違う
    const visible = Uint8Array.of(1, 1, 1, 0) // 3 つ目は footprint の外
    const lifted = Uint8Array.of(1, 0, 0, 0) // 2・3 つ目は見えたのに持ち上げで見えない（雑音）
    const m = measureWaterMasks({
      width: 2,
      height: 2,
      footprint,
      footprintEnd,
      visible: [visible],
      lifted,
    })
    expect(m.footprintDriftPx).toBe(2)
    expect(m.visibleNotFootprintPx).toBe(1)
    expect(m.visibleAndLiftedPx).toBe(1)
    expect(m.visibleNotLiftedPx).toBe(2)
    expect(m.visibleRatio).toBe(1.5)
    expect(m.unoccludedRatio).toBe(1)
    expect(m.noiseRatio).toBe(2)
  })

  it('footprint・持ち上げが空なら比は null', () => {
    const empty = new Uint8Array(4)
    const m = measureWaterMasks({
      width: 2,
      height: 2,
      footprint: empty,
      footprintEnd: empty,
      visible: [empty],
      lifted: empty,
    })
    expect([m.visibleRatio, m.unoccludedRatio, m.noiseRatio, m.flickerRatio]).toEqual([
      null,
      null,
      null,
      null,
    ])
  })
})

describe('judgeWater（S と同じ閾値: 持ち上げ比 0.98 以上・ちらつき 1% 以下）', () => {
  const base: WaterMeasure = {
    footprintPx: 10_000,
    footprintEndPx: 10_000,
    footprintDriftPx: 0,
    visiblePx: 9900,
    liftedPx: 9950,
    visibleAndLiftedPx: 9900,
    visibleNotFootprintPx: 0,
    visibleNotLiftedPx: 10,
    visibleRatio: 0.99,
    unoccludedRatio: 0.995,
    noiseRatio: 0.001,
    interiorPx: 9000,
    flickerRatio: 0.001,
  }

  it('閾値の内なら pass、外なら fail', () => {
    expect(judgeWater(base, 100).verdict).toBe('pass')
    expect(judgeWater({ ...base, unoccludedRatio: 0.97 }, 100).verdict).toBe('fail')
    expect(judgeWater({ ...base, flickerRatio: 0.02 }, 100).verdict).toBe('fail')
  })

  it('水面がほとんど画面に無い・カメラが地面に近すぎるなら評価不能（不合格と読まない）', () => {
    expect(judgeWater({ ...base, footprintPx: MIN_FOOTPRINT_PX - 1 }, 100).verdict).toBe(
      'not-evaluable',
    )
    expect(judgeWater(base, 0.5).verdict).toBe('not-evaluable')
    expect(judgeWater(base, null).verdict).toBe('pass')
  })

  it('標本が薄いなら判定できず（内側 300 px・持ち上げ 2000 px が境）', () => {
    expect(judgeWater({ ...base, interiorPx: MIN_INTERIOR_PX - 1 }, 100).verdict).toBe(
      'not-evaluable',
    )
    expect(judgeWater({ ...base, interiorPx: MIN_INTERIOR_PX }, 100).verdict).toBe('pass')
    const thin = judgeWater({ ...base, liftedPx: MIN_LIFTED_PX - 1 }, 100)
    expect(thin.verdict).toBe('not-evaluable')
    expect(thin.reason).toContain('標本が薄い')
    expect(judgeWater({ ...base, liftedPx: MIN_LIFTED_PX }, 100).verdict).toBe('pass')
  })

  it('閾値との差が雑音より小さければ判定できず、大きければ判定する', () => {
    const near = { ...base, unoccludedRatio: 0.975 }
    expect(judgeWater({ ...near, noiseRatio: 0.006 }, 100).verdict).toBe('not-evaluable')
    expect(judgeWater({ ...near, noiseRatio: 0.004 }, 100).verdict).toBe('fail')
    expect(judgeWater({ ...base, unoccludedRatio: 0.985, noiseRatio: 0.004 }, 100).verdict).toBe(
      'pass',
    )
  })

  it('読みの間の食い違い（見えた ∧ ¬footprint・footprint のずれ・カメラの標高）が許容を超えたら判定できず', () => {
    // 許容は footprint の 0.5%（10,000 px なら 50 px）
    expect(judgeWater({ ...base, visibleNotFootprintPx: 50 }, 100).verdict).toBe('pass')
    const inconsistent = judgeWater({ ...base, visibleNotFootprintPx: 51 }, 100)
    expect(inconsistent.verdict).toBe('not-evaluable')
    expect(inconsistent.reason).toContain('見えた ∧ ¬footprint')
    expect(judgeWater({ ...base, footprintDriftPx: 50 }, 100).verdict).toBe('pass')
    expect(judgeWater({ ...base, footprintDriftPx: 51 }, 100).verdict).toBe('not-evaluable')
    expect(judgeWater(base, 100, MAX_CAMERA_DRIFT_M).verdict).toBe('pass')
    expect(judgeWater(base, 100, MAX_CAMERA_DRIFT_M + 0.001).verdict).toBe('not-evaluable')
  })
})
