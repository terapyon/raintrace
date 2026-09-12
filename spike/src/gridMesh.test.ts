import { describe, expect, it } from 'vitest'
import { gridIndices, gridVertices } from './gridMesh'

describe('格子のメッシュ', () => {
  it('縁なしの頂点は (列, 行) = (0, 0)〜(n − 1, n − 1) を行優先で並べる', () => {
    expect(Array.from(gridVertices(2, false))).toEqual([0, 0, 1, 0, 0, 1, 1, 1])
  })

  it('縁ありの頂点は −1〜n で、(n + 2)² 個', () => {
    const v = gridVertices(2, true)
    expect(v.length).toBe(4 * 4 * 2)
    expect([v[0], v[1]]).toEqual([-1, -1])
    expect([v[v.length - 2], v[v.length - 1]]).toEqual([2, 2])
  })

  it('3 × 3 の頂点の全体は 4 つの四角形・8 枚の三角形', () => {
    const index = gridIndices(3, 0, 3)
    expect(index.length).toBe(8 * 3)
    expect(Array.from(index.slice(0, 6))).toEqual([0, 3, 1, 1, 3, 4])
    expect(Math.max(...index)).toBe(8)
  })

  it('縁ありの配置で内側だけを選ぶと、縁の頂点を使わない', () => {
    const n = 4
    const m = n + 2
    const index = gridIndices(m, 1, n)
    expect(index.length).toBe((n - 1) * (n - 1) * 6)
    for (const i of index) {
      const col = i % m
      const row = Math.floor(i / m)
      expect(col >= 1 && col <= n && row >= 1 && row <= n).toBe(true)
    }
  })
})
