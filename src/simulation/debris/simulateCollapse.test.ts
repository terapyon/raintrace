import { describe, expect, expectTypeOf, it } from 'vitest'
import { DEBRIS_PRESETS, type DebrisPreset } from '../../shared/debrisPresets.ts'
import { analyzeDepressions } from '../terrain/analyzeDepressions.ts'
import type { DebrisGrid, DebrisParams } from './runout.ts'
import { simulateCollapse } from './simulateCollapse.ts'

// テストは core-is-pure の対象外なので、プリセットの表を src/shared から直接使う
const NEAR = (DEBRIS_PRESETS.find((p) => p.id === 'near') as DebrisPreset).params

const SIZE = 60
const CELL = 5
const VALLEY_COL = 30
/** 谷筋の縦断の勾配（1 セルで下る高さ） */
const VALLEY_DROP = 0.25
/** 東西の斜面の 1 セルあたりの高さ（30°） */
const SIDE_RISE = Math.tan(Math.PI / 6) * CELL

/** 南北に下る V 字の谷（北が上流）。東西の斜面は 30° */
function valley(r: number, c: number): number {
  return 200 - VALLEY_DROP * r + SIDE_RISE * Math.abs(c - VALLEY_COL)
}

/** 盛土: 谷の上流寄りの東の斜面に、厚さ t の土を載せる */
const FILL = { r0: 14, r1: 22, c0: 32, c1: 37 }
function inFill(r: number, c: number): boolean {
  return r >= FILL.r0 && r <= FILL.r1 && c >= FILL.c0 && c <= FILL.c1
}

/** 盛土を載せた谷。removed = 盛土の厚さ（全部崩す） */
function valleyWithFill(thickness: number): { grid: DebrisGrid; removed: Float32Array } {
  const elevation = new Float32Array(SIZE * SIZE)
  const removed = new Float32Array(SIZE * SIZE)
  const validMask = new Uint8Array(SIZE * SIZE).fill(1)
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = inFill(r, c) ? thickness : 0
      elevation[r * SIZE + c] = valley(r, c) + t
      removed[r * SIZE + c] = t
    }
  }
  return { grid: { elevation, validMask, size: SIZE, cellSizeM: CELL }, removed }
}

function terrain(elevation: Float32Array, validMask: Uint8Array) {
  return { elevation, validMask, width: SIZE, height: SIZE, cellSizeM: CELL }
}

function expectMassConserved(r: { collapsedM3: number; depositedM3: number; outsideM3: number }) {
  expect(r.collapsedM3).toBeGreaterThan(0)
  expect(Math.abs(r.collapsedM3 - r.depositedM3 - r.outsideM3)).toBeLessThanOrEqual(
    1e-6 * r.collapsedM3,
  )
}

describe('simulateCollapse', () => {
  it('DebrisPreset の params と simulation の DebrisParams は同じ形（R2）', () => {
    expectTypeOf<DebrisPreset['params']>().toExtend<DebrisParams>()
    expectTypeOf<DebrisParams>().toExtend<DebrisPreset['params']>()
  })

  it('【P1】V 字の谷の片側の斜面の上に盛土を置いて全部崩す → 谷底に積もり、analyzeDepressions で上流側に capacityM3 > 0 の窪地ができる（near のプリセット）', () => {
    const { grid, removed } = valleyWithFill(6)
    // 崩れる前の谷には（盛土の上以外に）窪地が無い。谷筋のセルは窪地に入らない
    const beforeAnalysis = analyzeDepressions(terrain(grid.elevation, grid.validMask))
    for (let r = 0; r < SIZE; r++) expect(beforeAnalysis.labels[r * SIZE + VALLEY_COL]).toBe(0)

    const result = simulateCollapse(grid, removed, NEAR)
    expectMassConserved(result)

    // 谷底に積もる
    let damRow = -1
    let damThickness = 0
    for (let r = 0; r < SIZE; r++) {
      const d = result.deposit[r * SIZE + VALLEY_COL] ?? 0
      if (d > damThickness) {
        damThickness = d
        damRow = r
      }
    }
    expect(damThickness).toBeGreaterThan(VALLEY_DROP)

    // 上流側（ダムより北の谷筋）に、水のたまる窪地ができる
    const after = analyzeDepressions(terrain(result.after, grid.validMask))
    const upstream = new Set<number>()
    for (let r = 0; r < damRow; r++) {
      const id = after.labels[r * SIZE + VALLEY_COL] ?? 0
      if (id > 0) upstream.add(id)
    }
    const capacity = after.depressions
      .filter((d) => upstream.has(d.id))
      .reduce((s, d) => s + d.capacityM3, 0)
    expect(capacity).toBeGreaterThan(0)
  })

  it('すべてのプリセット（DEBRIS_PRESETS のパラメータを写した表）で質量の保存と決まった結果', () => {
    expect(DEBRIS_PRESETS.length).toBeGreaterThan(0)
    for (const preset of DEBRIS_PRESETS) {
      const params: DebrisParams = { ...preset.params }
      const { grid, removed } = valleyWithFill(6)
      const a = simulateCollapse(grid, removed, params)
      const b = simulateCollapse(grid, removed, params)
      expectMassConserved(a)
      let sum = 0
      for (const v of a.deposit) sum += v * CELL * CELL
      expect(Math.abs(sum - a.depositedM3)).toBeLessThanOrEqual(1e-6 * a.collapsedM3)
      expect(Array.from(b.deposit)).toEqual(Array.from(a.deposit))
      expect(Array.from(b.after)).toEqual(Array.from(a.after))
      expect(b.outsideM3).toBe(a.outsideM3)
    }
  })

  it('after = elevation − removed + deposit', () => {
    const { grid, removed } = valleyWithFill(6)
    // 無効なセルと負の値は崩れない（removed は 0 として返す）
    grid.validMask[0] = 0
    removed[0] = 3
    removed[1] = -2
    for (const preset of DEBRIS_PRESETS) {
      const r = simulateCollapse(grid, removed, preset.params)
      expect(r.removed[0]).toBe(0)
      expect(r.removed[1]).toBe(0)
      expect(r.removed[FILL.r0 * SIZE + FILL.c0]).toBeCloseTo(6, 6)
      for (let i = 0; i < SIZE * SIZE; i++) {
        const expected = Math.fround(
          Math.fround((grid.elevation[i] ?? 0) - (r.removed[i] ?? 0)) + (r.deposit[i] ?? 0),
        )
        expect(r.after[i]).toBe(expected)
      }
    }
  })
})
