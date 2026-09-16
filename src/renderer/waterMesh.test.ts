import { describe, expect, it } from 'vitest'
import { gridIndices, gridVertices } from './waterMesh'

describe('水面の格子のメッシュ（spec 05 §3.1）', () => {
  it('頂点は（列, 行）の局所座標だけを、行優先（北から、西から）で持つ', () => {
    expect(Array.from(gridVertices(3))).toEqual([
      0, 0, 1, 0, 2, 0, 0, 1, 1, 1, 2, 1, 0, 2, 1, 2, 2, 2,
    ])
  })

  it('四角形ごとに三角形 2 枚（a, d, b）（b, d, e）。頂点番号は行優先の (行 × n + 列)', () => {
    const indices = gridIndices(3)
    expect(indices.length).toBe(2 * (3 - 1) ** 2 * 3)
    expect(Array.from(indices.slice(0, 6))).toEqual([0, 3, 1, 1, 3, 4])
    expect(Math.max(...indices)).toBe(3 * 3 - 1)
  })

  it('範囲 500 m（N = 515）で三角形は約 52 万枚、1000 m（N = 1031）で約 212 万枚', () => {
    expect(gridIndices(515).length / 3).toBe(2 * 514 ** 2)
    expect(gridIndices(1031).length / 3).toBe(2 * 1030 ** 2)
  })
})
