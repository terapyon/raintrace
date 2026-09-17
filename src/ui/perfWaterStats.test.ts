import { describe, expect, it } from 'vitest'
import {
  countMask,
  erode,
  judgeWater,
  MIN_FOOTPRINT_PX,
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

describe('measureWaterMasks（計画で決めたこと 15）', () => {
  it('可視率（spec の定義）・持ち上げ比・ちらつき率', () => {
    const footprint = new Uint8Array(25).fill(1)
    const v0 = new Uint8Array(25).fill(1)
    v0.fill(0, 0, 5) // 上の 1 行が隠れている
    const v1 = v0.slice()
    const v2 = v0.slice()
    v2[12] = 0 // 中央が 1 つの揺らしでだけ消える（ちらつき）
    const lifted = new Uint8Array(25).fill(1)
    lifted.fill(0, 0, 2) // 持ち上げても 2 画素は隠れる（地形が正当に隠す分）
    const m = measureWaterMasks({ width: 5, height: 5, footprint, visible: [v0, v1, v2], lifted })
    expect(m).toEqual({
      footprintPx: 25,
      visiblePx: 20,
      liftedPx: 23,
      visibleRatio: 0.8,
      unoccludedRatio: 20 / 23,
      interiorPx: 1,
      flickerRatio: 1,
    })
  })

  it('footprint・持ち上げが空なら比は null', () => {
    const empty = new Uint8Array(4)
    const m = measureWaterMasks({
      width: 2,
      height: 2,
      footprint: empty,
      visible: [empty],
      lifted: empty,
    })
    expect([m.visibleRatio, m.unoccludedRatio, m.flickerRatio]).toEqual([null, null, null])
  })
})

describe('judgeWater（S と同じ閾値: 持ち上げ比 0.98 以上・ちらつき 1% 以下）', () => {
  const base: WaterMeasure = {
    footprintPx: 10_000,
    visiblePx: 9900,
    liftedPx: 9950,
    visibleRatio: 0.99,
    unoccludedRatio: 0.995,
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
})
