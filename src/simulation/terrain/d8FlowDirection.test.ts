import { describe, expect, it } from 'vitest'
import { d8FlowDirection } from './d8FlowDirection.ts'
import { gridFromRows, indexOf } from './testGrids.ts'

// 方向の番号: 1 東、2 南東、3 南、4 南西、5 西、6 北西、7 北、8 北東
describe('d8FlowDirection', () => {
  it('平面では下り先が無い', () => {
    const direction = d8FlowDirection(
      gridFromRows([
        [5, 5, 5],
        [5, 5, 5],
        [5, 5, 5],
      ]),
    )
    expect([...direction]).toEqual(Array(9).fill(0))
  })

  it('東へ上る一様な斜面では、西の端以外がすべて西を向く', () => {
    const rows = Array.from({ length: 4 }, () => [0, 1, 2, 3, 4])
    const grid = gridFromRows(rows)
    const direction = d8FlowDirection(grid)
    for (let y = 0; y < 4; y++) {
      expect(direction[indexOf(grid, 0, y)]).toBe(0) // グリッドの外は近傍に含めない
      for (let x = 1; x < 5; x++) expect(direction[indexOf(grid, x, y)]).toBe(5)
    }
  })

  it('勾配は距離で割る（斜めの近傍の距離は √2）', () => {
    // 中央から東へは 1 下がり（勾配 1）、南東へは 1.5 下がる（勾配 1.5 / √2 ≒ 1.06）
    const grid = gridFromRows([
      [10, 10, 10],
      [10, 10, 9],
      [10, 10, 8.5],
    ])
    expect(d8FlowDirection(grid)[indexOf(grid, 1, 1)]).toBe(2)
  })

  it('同じ勾配なら固定の近傍順で先のもの（東が西より先）', () => {
    const grid = gridFromRows([[4, 5, 4]])
    expect(d8FlowDirection(grid)[1]).toBe(1)
  })

  it('無効セルは下り先にしない', () => {
    const grid = gridFromRows([[null, 5, 4.5]])
    grid.elevation[0] = -100
    expect(d8FlowDirection(grid)[1]).toBe(1)
    expect(d8FlowDirection(grid)[0]).toBe(0)
  })
})
