import { describe, expect, it } from 'vitest'
import { collapseDepositRgba, newWaterRgba, paintDamOutlines } from './collapseColormap'

describe('collapseDepositRgba（spec 10 §5.4）', () => {
  it('0.009 m は透明、0.01 m は茶、崩れた跡は灰', () => {
    // 2×2: (0,0)=0.009, (0,1)=0.01, (1,0)=跡（偶奇が合う）, (1,1)=跡（偶奇が合わず透明）
    const deposit = Float32Array.of(0.009, 0.01, 0, 0)
    const removed = Float32Array.of(0, 0, 2, 2)
    const rgba = collapseDepositRgba(deposit, removed, 2)
    expect(rgba[3]).toBe(0)
    expect(rgba[7]).toBeGreaterThan(0)
    expect(rgba[4]).toBeGreaterThan(rgba[6] ?? 0) // 茶は R > B
    // (1,0): 行+列 が奇数なので透明、(1,1) は偶数で灰
    expect(rgba[11]).toBe(0)
    expect(rgba[15]).toBeGreaterThan(0)
    expect(rgba[12]).toBe(rgba[13])
  })

  it('厚いほど濃く、5 m で頭打ち', () => {
    const rgba = collapseDepositRgba(Float32Array.of(0.01, 2.5, 5, 50), new Float32Array(4), 2)
    expect(rgba[0] ?? 0).toBeGreaterThan(rgba[4] ?? 0) // 濃いほど R が小さい
    expect(rgba[4] ?? 0).toBeGreaterThan(rgba[8] ?? 0)
    expect(rgba[8]).toBe(rgba[12])
  })
})

describe('paintDamOutlines', () => {
  it('窪地の中は薄い塗り、縁は不透明', () => {
    const size = 3
    const labels = new Int32Array(9).fill(7)
    const rgba = new Uint8ClampedArray(9 * 4)
    paintDamOutlines(rgba, labels, new Set([7]), size)
    // 中央は 4 近傍がすべて窪地なので薄い塗り（縁より透明）
    expect(rgba[4 * 4 + 3]).toBeGreaterThan(0)
    expect(rgba[4 * 4 + 3]).toBeLessThan(255)
    expect(rgba[3]).toBe(255)
    // 窪地でない label は塗らない
    const other = new Uint8ClampedArray(9 * 4)
    paintDamOutlines(other, labels, new Set([1]), size)
    expect(other.every((v) => v === 0)).toBe(true)
  })
})

describe('newWaterRgba', () => {
  it('前 0.009・後 0.01 は色、前 0.01・後 0.02 は透明', () => {
    const two = newWaterRgba(
      Float32Array.of(0.009, 0.01, 0, 0),
      Float32Array.of(0.01, 0.02, 0, 0),
      2,
    )
    expect(two[3]).toBeGreaterThan(0)
    expect(two[7]).toBe(0)
  })
})
