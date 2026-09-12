import { describe, expect, it } from 'vitest'
import { NoElevationAtRainCenterError, planRainfall } from './Rainfall.ts'
import type { TerrainMeta } from './types.ts'

const META_5: TerrainMeta = { width: 5, height: 5, cellSizeM: 1 }

function mask5(invalid: number[] = []): Uint8Array {
  const mask = new Uint8Array(25).fill(1)
  for (const i of invalid) mask[i] = 0
  return mask
}

describe('planRainfall（spec 03 §3.6）', () => {
  it('中心が円内に入る有効セルを選び、その外接矩形を返す', () => {
    // 中心 (2.5, 2.5)・半径 1m: 中央のセルと上下左右の 5 セル（斜めのセルの中心は √2 m 離れている）
    const plan = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 10 }, mask5(), META_5)
    expect(Array.from(plan.cells)).toEqual([7, 11, 12, 13, 17])
    expect([plan.x0, plan.y0, plan.x1, plan.y1]).toEqual([1, 1, 4, 4])
  })

  it('投入総量は π · radiusM² · amountMm / 1000 で、選んだセルに等分する', () => {
    const plan = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 10 }, mask5(), META_5)
    expect(plan.volumeM3).toBeCloseTo((Math.PI * 10) / 1000, 15)
    expect(plan.depthM * 5).toBeCloseTo(plan.volumeM3, 15)
  })

  it('雨量 0 なら投入総量も各セルの水深も 0（何も起きない）', () => {
    const plan = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 0 }, mask5(), META_5)
    expect(plan.volumeM3).toBe(0)
    expect(plan.depthM).toBe(0)
  })

  it('半径がセルより小さく、中心が円内に入るセルが無いときは、降雨中心を含むセル 1 つに入れる', () => {
    // セル 7.8m・半径 1m。降雨中心はセル (3, 2) の中心から 3m ずつずれている
    const meta: TerrainMeta = { width: 11, height: 11, cellSizeM: 7.8 }
    const mask = new Uint8Array(121).fill(1)
    const plan = planRainfall(
      { x: 3 * 7.8 + 0.9, y: 2 * 7.8 + 0.9, radiusM: 1, amountMm: 100 },
      mask,
      meta,
    )
    expect(Array.from(plan.cells)).toEqual([2 * 11 + 3])
    expect(plan.depthM * 7.8 * 7.8).toBeCloseTo(plan.volumeM3, 15)
  })

  it('無効セルには入れない。投入量は円内の有効セルの割合に減り、各セルの水深は円がすべて有効な場合と同じ（R04-8）', () => {
    const rain = { x: 2.5, y: 2.5, radiusM: 1, amountMm: 10 }
    const full = planRainfall(rain, mask5(), META_5)
    const plan = planRainfall(rain, mask5([12]), META_5)
    expect(Array.from(plan.cells)).toEqual([7, 11, 13, 17])
    expect(plan.volumeM3).toBeCloseTo((full.volumeM3 * 4) / 5, 15)
    expect(plan.depthM).toBeCloseTo(full.depthM, 15)
  })

  it('範囲に有効セルが無く、降雨中心のセルが無効ならエラー', () => {
    const rain = { x: 2.5, y: 2.5, radiusM: 0.4, amountMm: 10 }
    expect(() => planRainfall(rain, mask5([12]), META_5)).toThrow(NoElevationAtRainCenterError)
    expect(() => planRainfall(rain, mask5([12]), META_5)).toThrow(
      '降雨中心に標高データがありません',
    )
  })

  it('降雨中心がグリッドの外で、範囲にもセルが無ければエラー', () => {
    const rain = { x: -10, y: 2.5, radiusM: 1, amountMm: 10 }
    expect(() => planRainfall(rain, mask5(), META_5)).toThrow(NoElevationAtRainCenterError)
  })

  it.each([
    { x: Number.NaN, y: 0, radiusM: 1, amountMm: 1 },
    { x: 0, y: 0, radiusM: 0, amountMm: 1 },
    { x: 0, y: 0, radiusM: Number.POSITIVE_INFINITY, amountMm: 1 },
    { x: 0, y: 0, radiusM: 1, amountMm: -1 },
  ])('不正な入力は RangeError: %o', (rain) => {
    expect(() => planRainfall(rain, mask5(), META_5)).toThrow(RangeError)
  })

  it('円がすべて有効なら、投入量は π · radiusM² · amountMm / 1000 と厳密に一致する（R04-8 の前と同じ）', () => {
    const plan = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 10 }, mask5(), META_5)
    expect(plan.volumeM3).toBe((Math.PI * 1 * 10) / 1000)
  })

  it('円がグリッドの西の端で半分に切れると、投入量は半分で、各セルの水深は円内の全セルで割った値（R04-8）', () => {
    // 中心 (0, 2.5)・半径 1.5m。中心が円内のセルは 8 つ（列 −2・−1・0・1）で、グリッドの中は列 0 の 3 つと列 1 の 1 つ
    const rain = { x: 0, y: 2.5, radiusM: 1.5, amountMm: 100 }
    const plan = planRainfall(rain, mask5(), META_5)
    const fullVolume = (Math.PI * 1.5 * 1.5 * 100) / 1000
    expect(Array.from(plan.cells)).toEqual([5, 10, 11, 15])
    expect(plan.volumeM3).toBeCloseTo(fullVolume / 2, 15)
    expect(plan.depthM).toBeCloseTo(fullVolume / 8, 15)
    expect([plan.x0, plan.y0, plan.x1, plan.y1]).toEqual([0, 1, 2, 4])
  })

  it('中心が円内に入るセルがあっても、それがすべて無効ならエラー（R04-8）', () => {
    const rain = { x: 2.5, y: 2.5, radiusM: 1, amountMm: 10 }
    expect(() => planRainfall(rain, mask5([7, 11, 12, 13, 17]), META_5)).toThrow(
      NoElevationAtRainCenterError,
    )
  })

  it('半径がセルより小さいときの 1 セルへの投入は、割合 1（投入量は πr² × 雨量のまま）', () => {
    const meta: TerrainMeta = { width: 11, height: 11, cellSizeM: 7.8 }
    const plan = planRainfall(
      { x: 3 * 7.8 + 0.9, y: 2 * 7.8 + 0.9, radiusM: 1, amountMm: 100 },
      new Uint8Array(121).fill(1),
      meta,
    )
    expect(plan.volumeM3).toBe((Math.PI * 1 * 100) / 1000)
  })
})
