import { describe, expect, it } from 'vitest'
import { gridIndices, gridVertices, maskedGridIndices, ringCellValid } from './gridMesh'

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

  it('無効なセルにかかる四角形を除く（B の無効セルの対策）: 全部有効なら gridIndices と同じ', () => {
    const index = maskedGridIndices(3, 0, 3, () => true)
    expect(Array.from(index)).toEqual(Array.from(gridIndices(3, 0, 3)))
  })

  it('無効なセルにかかる四角形を除く: 中央の頂点が無効だと、それにかかる 4 つの四角形すべてが消える', () => {
    // 3 × 3 の頂点（4 つの四角形）のうち、頂点 (1, 1) だけを無効にする → その頂点にかかる 4 つの四角形すべてが消える
    const isValid = (col: number, row: number) => !(col === 1 && row === 1)
    const index = maskedGridIndices(3, 0, 3, isValid)
    expect(index.length).toBe(0)
  })

  it('無効なセルにかかる四角形を除く: 角の頂点が無効なら、その頂点を含む四角形 1 つ（6 個、三角形 2 枚）だけ消える', () => {
    const isValid = (col: number, row: number) => !(col === 0 && row === 0)
    const index = maskedGridIndices(3, 0, 3, isValid)
    // 4 つの四角形のうち (0,0)-(1,1) の 1 つだけが消え、残り 3 つ（18 個の頂点番号）
    expect(index.length).toBe(3 * 6)
    for (const i of index) {
      expect(i).not.toBe(0) // 頂点番号 0 = (col 0, row 0) を含む三角形が無い
    }
  })

  describe('ringCellValid（縁つきの頂点番号 → 無効セルの判定。B・B-raw で共有）', () => {
    it('縁（範囲の外、セル番号が [0, n) の外）は常に有効', () => {
      const isValid = ringCellValid(2, new Uint8Array(4)) // 全セル無効でも縁は有効
      expect(isValid(0, 0)).toBe(true) // セル (-1, -1) = 縁
      expect(isValid(3, 3)).toBe(true) // セル (2, 2) = 縁（n=2 なので範囲の外）
    })

    it('範囲の中（セル番号が [0, n) の中）は validMask を見る', () => {
      const validMask = new Uint8Array(4).fill(1)
      validMask[0] = 0 // セル (0, 0) だけ無効
      const isValid = ringCellValid(2, validMask)
      expect(isValid(1, 1)).toBe(false) // 頂点番号 (1,1) → セル (0,0)
      expect(isValid(2, 1)).toBe(true) // 頂点番号 (2,1) → セル (1,0)
    })
  })
})
