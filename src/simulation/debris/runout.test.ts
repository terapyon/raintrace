import { describe, expect, it } from 'vitest'
import { DEBRIS_SEED } from './constants.ts'
import { createRandom } from './random.ts'
import { type DebrisGrid, type DebrisParams, runout } from './runout.ts'

// src/shared のプリセットは import できない（core-is-pure）ので、同じ向きの値をここに置く
const NEAR: DebrisParams = {
  mu: 0.6,
  massToDragM: 20,
  divergence: 2,
  persistence: 1.5,
  reposeDeg: 30,
}
const FAR: DebrisParams = {
  mu: 0.12,
  massToDragM: 100,
  divergence: 1.3,
  persistence: 2,
  reposeDeg: 8.5,
}

/** 標高を (行, 列) の関数で作る。valid が false を返すセルは無効 */
function makeGrid(
  size: number,
  cellSizeM: number,
  elev: (row: number, col: number) => number,
  valid: (row: number, col: number) => boolean = () => true,
): DebrisGrid {
  const elevation = new Float32Array(size * size)
  const validMask = new Uint8Array(size * size)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      elevation[r * size + c] = elev(r, c)
      validMask[r * size + c] = valid(r, c) ? 1 : 0
    }
  }
  return { elevation, validMask, size, cellSizeM }
}

/** (行, 列) の矩形に厚さ t の崩れる土を置く */
function removedRect(
  size: number,
  r0: number,
  r1: number,
  c0: number,
  c1: number,
  t: number,
): Float32Array {
  const removed = new Float32Array(size * size)
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) removed[r * size + c] = t
  return removed
}

/** 重みつきの重心（行, 列） */
function centroid(values: Float32Array, size: number): { row: number; col: number } {
  let sum = 0
  let row = 0
  let col = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0
    if (v <= 0) continue
    sum += v
    row += Math.floor(i / size) * v
    col += (i % size) * v
  }
  return { row: row / sum, col: col / sum }
}

function expectMassConserved(r: { collapsedM3: number; depositedM3: number; outsideM3: number }) {
  expect(r.collapsedM3).toBeGreaterThan(0)
  expect(Math.abs(r.collapsedM3 - r.depositedM3 - r.outsideM3)).toBeLessThanOrEqual(
    1e-6 * r.collapsedM3,
  )
}

/** 谷のある地形（南東へ下り、中央の列に谷）。北西の隅は無効 */
function valleyGrid(): DebrisGrid {
  return makeGrid(
    60,
    5,
    (r, c) => 200 - r * 0.8 - c * 0.5 + Math.abs(c - 30) * 0.6 + Math.sin(r * 0.7 + c * 0.3) * 0.2,
    (r, c) => !(r < 6 && c < 6),
  )
}

describe('createRandom', () => {
  it('createRandom: 同じ種なら同じ列、[0, 1) に収まる', () => {
    const a = createRandom(DEBRIS_SEED)
    const b = createRandom(DEBRIS_SEED)
    const c = createRandom(DEBRIS_SEED + 1)
    let differs = false
    for (let i = 0; i < 10000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      if (x !== c()) differs = true
    }
    expect(differs).toBe(true)
  })
})

describe('runout', () => {
  it('質量の保存: 崩れた土 = 積もった土 + 範囲外（1e-6 の相対誤差）', () => {
    const grid = valleyGrid()
    const removed = removedRect(60, 4, 12, 20, 40, 2.5)
    // 無効なセルに置いた崩れる土は数えない
    removed[0] = 5
    for (const params of [NEAR, FAR]) {
      const r = runout(grid, removed, params, DEBRIS_SEED)
      expectMassConserved(r)
      expect(r.collapsedM3).toBeCloseTo(9 * 21 * 2.5 * 25, 6)
      let sum = 0
      for (const v of r.deposit) sum += v * 25
      expect(sum).toBeCloseTo(r.depositedM3, 3)
    }
  })

  it('同じ入力・同じ種なら deposit が一致する', () => {
    const grid = valleyGrid()
    const removed = removedRect(60, 4, 12, 20, 40, 2.5)
    for (const params of [NEAR, FAR]) {
      const a = runout(grid, removed, params, DEBRIS_SEED)
      const b = runout(grid, removed, params, DEBRIS_SEED)
      expect(Array.from(b.deposit)).toEqual(Array.from(a.deposit))
      expect(b.outsideM3).toBe(a.outsideM3)
    }
  })

  it('平らな面では崩れたセル（とその周り）にだけ積もる', () => {
    const size = 21
    const grid = makeGrid(size, 5, () => 10)
    const removed = removedRect(size, 9, 11, 9, 11, 1)
    const r = runout(grid, removed, FAR, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBe(0)
    for (let i = 0; i < r.deposit.length; i++) {
      if ((r.deposit[i] ?? 0) <= 0) continue
      const row = Math.floor(i / size)
      const col = i % size
      expect(row).toBeGreaterThanOrEqual(8)
      expect(row).toBeLessThanOrEqual(12)
      expect(col).toBeGreaterThanOrEqual(8)
      expect(col).toBeLessThanOrEqual(12)
    }
  })

  it('東へ一様に下る斜面では、崩れた場所より東（下流）にだけ積もる', () => {
    const size = 30
    // 1 セル（5 m）で 1 m 下る（tan = 0.2）。μ = 0.6 なので最初の 1 歩で止まる
    const grid = makeGrid(size, 5, (_r, c) => 100 - c)
    const removed = removedRect(size, 15, 15, 10, 10, 0.01)
    const r = runout(grid, removed, NEAR, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBe(0)
    let count = 0
    for (let i = 0; i < r.deposit.length; i++) {
      if ((r.deposit[i] ?? 0) <= 0) continue
      count++
      expect(i % size).toBeGreaterThan(10)
    }
    expect(count).toBeGreaterThan(0)
  })

  it('範囲の東端の近くの候補では、一部が範囲の外へ出て outsideM3 > 0（Review Focus 4）', () => {
    const size = 30
    const grid = makeGrid(size, 5, (_r, c) => 100 - 2 * c)
    const removed = removedRect(size, 14, 16, size - 4, size - 3, 1)
    const r = runout(grid, removed, FAR, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBeGreaterThan(0)
    expect(r.outsideM3).toBeLessThanOrEqual(r.collapsedM3 * (1 + 1e-9))
  })

  it('無効なセルへ進んだ粒は範囲外に数える', () => {
    const size = 30
    // 東へ下る斜面の、東側 10 列が無効
    const grid = makeGrid(
      size,
      5,
      (_r, c) => 100 - 2 * c,
      (_r, c) => c < 20,
    )
    const removed = removedRect(size, 14, 16, 15, 16, 1)
    const r = runout(grid, removed, FAR, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBeGreaterThan(0)
    for (let i = 0; i < r.deposit.length; i++) {
      if (grid.validMask[i] === 0) expect(r.deposit[i]).toBe(0)
    }
  })

  it('μ を小さく・M/D を大きくすると、到達距離（崩れた場所から積もった重心までの距離）が長くなる', () => {
    const size = 60
    // 西の 20 列は tan 0.2 の斜面、その先は tan 0.02 のゆるい斜面
    const grid = makeGrid(size, 5, (_r, c) => (c < 20 ? 100 - c : 80 - (c - 20) * 0.1))
    const removed = removedRect(size, 28, 32, 2, 4, 1)
    const source = { row: 30, col: 3 }
    const distance = (params: DebrisParams) => {
      const r = runout(grid, removed, params, DEBRIS_SEED)
      expectMassConserved(r)
      expect(r.outsideM3).toBe(0)
      const g = centroid(r.deposit, size)
      return Math.hypot(g.row - source.row, g.col - source.col)
    }
    const near = distance(NEAR)
    const far = distance(FAR)
    const farther = distance({ ...FAR, mu: 0.05, massToDragM: 150 })
    expect(far).toBeGreaterThan(near)
    expect(farther).toBeGreaterThan(far)
  })
})
