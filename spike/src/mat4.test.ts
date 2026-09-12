import { describe, expect, it } from 'vitest'
import { gridModelMatrix, multiply, projectToScreen } from './mat4'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const at = (m: ArrayLike<number>, i: number): number => m[i] ?? Number.NaN

describe('mat4（列優先）', () => {
  it('単位行列を掛けても変わらない', () => {
    const m = Array.from({ length: 16 }, (_, i) => i + 1)
    expect(Array.from(multiply(identity, m))).toEqual(m)
    expect(Array.from(multiply(m, identity))).toEqual(m)
  })

  it('平行移動の後に拡大すると、拡大してから移動した点になる', () => {
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]
    const scale = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]
    const m = multiply(translate, scale)
    // 点 (1, 1, 1) → 拡大 (2, 3, 4) → 移動 (7, 9, 11)
    expect([at(m, 0) + at(m, 12), at(m, 5) + at(m, 13), at(m, 10) + at(m, 14)]).toEqual([7, 9, 11])
  })

  it('グリッドのモデル行列は、セルの中心をメルカトルへ、高さを倍率で写す', () => {
    const range = { originX: 1000, originY: 2000, z: 17 }
    const world = 256 * 2 ** 17
    const m = gridModelMatrix(range, 0.5)
    const x = at(m, 0) * 0.5 + at(m, 12)
    const y = at(m, 5) * 0.5 + at(m, 13)
    expect(x).toBeCloseTo((1000 + 0.5) / world, 15)
    expect(y).toBeCloseTo((2000 + 0.5) / world, 15)
    expect(m[10]).toBe(0.5)
  })

  it('単位行列で投影すると、クリップ空間の中央が画面の中央になる', () => {
    expect(projectToScreen(identity, [0, 0, 0], 960, 600)).toEqual({ x: 480, y: 300 })
    expect(projectToScreen(identity, [1, 1, 0], 960, 600)).toEqual({ x: 960, y: 0 })
  })
})
