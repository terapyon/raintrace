import { describe, expect, it } from 'vitest'
import { gridFromRows, indexOf } from '../testing/terrainGrids.test-support.ts'
import { lowestCell } from './lowestCell.ts'

describe('lowestCell', () => {
  it('標高が最小の有効セルを返す。無効セルは見ない', () => {
    const grid = gridFromRows([
      [5, 4, null],
      [3, 6, 7],
    ])
    grid.elevation[2] = -100 // 無効セルの値は参照しない
    expect(lowestCell(grid)).toBe(indexOf(grid, 0, 1))
  })

  it('同じ標高なら番号が小さいセル', () => {
    expect(lowestCell(gridFromRows([[2, 1, 1]]))).toBe(1)
  })

  it('有効セルが無ければ -1', () => {
    expect(lowestCell(gridFromRows([[null, null]]))).toBe(-1)
  })
})
