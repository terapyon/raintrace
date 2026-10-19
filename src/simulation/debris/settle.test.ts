import { describe, expect, it } from 'vitest'
import { settleDeposit } from './settle.ts'

const SIZE = 21
const CELL = 5

/** (行, 列) の関数で Float32Array を作る */
function field(f: (row: number, col: number) => number): Float32Array {
  const a = new Float32Array(SIZE * SIZE)
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) a[r * SIZE + c] = f(r, c)
  return a
}

/** 4 近傍の組で、限界を超えた分のうち最大のもの（高い側に deposit が残っている組だけ） */
function maxExcess(
  base: Float32Array,
  deposit: Float32Array,
  validMask: Uint8Array,
  reposeDeg: number,
): number {
  const limit = Math.tan((reposeDeg * Math.PI) / 180) * CELL
  let worst = 0
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const i = r * SIZE + c
      if (validMask[i] === 0) continue
      for (const j of [c + 1 < SIZE ? i + 1 : -1, r + 1 < SIZE ? i + SIZE : -1]) {
        if (j < 0 || validMask[j] === 0) continue
        const hi = (base[i] ?? 0) + (deposit[i] ?? 0)
        const hj = (base[j] ?? 0) + (deposit[j] ?? 0)
        const high = hi >= hj ? i : j
        if ((deposit[high] ?? 0) <= 1e-6) continue
        worst = Math.max(worst, Math.abs(hi - hj) - limit)
      }
    }
  }
  return worst
}

function sum(a: Float32Array): number {
  let s = 0
  for (const v of a) s += v
  return s
}

describe('settleDeposit', () => {
  it('settleDeposit: 積んだ土の斜面は限界の角度を超えない（許容 1e-3）', () => {
    for (const reposeDeg of [30, 8.5]) {
      // 東へ下る斜面に、高さ 20 m の柱を 1 本立てる
      const base = field((_r, c) => 100 - 0.5 * c)
      const deposit = field((r, c) => (r === 10 && c === 10 ? 20 : 0))
      const validMask = new Uint8Array(SIZE * SIZE).fill(1)
      expect(maxExcess(base, deposit, validMask, reposeDeg)).toBeGreaterThan(1)
      settleDeposit(base, deposit, validMask, SIZE, CELL, reposeDeg)
      expect(maxExcess(base, deposit, validMask, reposeDeg)).toBeLessThanOrEqual(1e-3)
    }
  })

  it('settleDeposit: deposit の合計は変わらない、地山（base）は削らない', () => {
    const base = field((r, c) => 50 + Math.abs(c - 10) * 2 - r * 0.3)
    const before = base.slice()
    const deposit = field((r, c) => (r >= 8 && r <= 11 && c >= 9 && c <= 12 ? 8 : 0))
    const total = sum(deposit)
    // 西の 3 列は無効。無効なセルへは移さない
    const mask = Uint8Array.from(field((_r, c) => (c < 3 ? 0 : 1)))
    settleDeposit(base, deposit, mask, SIZE, CELL, 30)
    expect(Array.from(base)).toEqual(Array.from(before))
    expect(Math.abs(sum(deposit) - total)).toBeLessThanOrEqual(1e-6 * total)
    for (let i = 0; i < deposit.length; i++) {
      expect(deposit[i]).toBeGreaterThanOrEqual(0)
      if (mask[i] === 0) expect(deposit[i]).toBe(0)
    }
    // 形は変わった（何かが動いた）
    expect(deposit[10 * SIZE + 13]).toBeGreaterThan(0)
  })

  it('settleDeposit: 限界より緩い積もり方なら動かさない', () => {
    const base = field(() => 10)
    const deposit = field((r, c) => (r === 10 && c === 10 ? 1 : 0))
    const validMask = new Uint8Array(SIZE * SIZE).fill(1)
    settleDeposit(base, deposit, validMask, SIZE, CELL, 30)
    expect(deposit[10 * SIZE + 10]).toBe(1)
    expect(sum(deposit)).toBe(1)
  })
})
