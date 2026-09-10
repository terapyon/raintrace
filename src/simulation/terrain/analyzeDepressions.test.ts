import { describe, expect, it } from 'vitest'
import { analyzeDepressions, significantDepressions } from './analyzeDepressions.ts'
import { gridFromRows, indexOf } from './testGrids.ts'
import type { Depression } from './types.ts'

// 周囲 10 の縁、北の縁の中央だけ 9、内側 3×3 が 8、中央が 7 の単一の窪地
const singlePitRows = (): (number | null)[][] => [
  [10, 10, 9, 10, 10],
  [10, 8, 8, 8, 10],
  [10, 8, 7, 8, 10],
  [10, 8, 8, 8, 10],
  [10, 10, 10, 10, 10],
]

describe('analyzeDepressions', () => {
  it('平面には窪地が無く、満水時の水面は標高と同じ', () => {
    const grid = gridFromRows(Array.from({ length: 5 }, () => [5, 5, 5, 5, 5]))
    const result = analyzeDepressions(grid)
    expect(result.depressions).toEqual([])
    expect([...result.labels]).toEqual(Array(25).fill(0))
    expect([...result.fill]).toEqual([...grid.elevation])
  })

  it('単一の窪地: spill 標高・spill point・最低点・容量が理論値どおり', () => {
    const grid = gridFromRows(singlePitRows(), 2) // セルの一辺 2m、面積 4m²
    const { depressions, fill, labels } = analyzeDepressions(grid)
    expect(depressions).toEqual([
      {
        id: 1,
        pitIndex: indexOf(grid, 2, 2),
        spillIndex: indexOf(grid, 2, 0),
        spillElevation: 9,
        maxDepthM: 2,
        areaM2: 36,
        capacityM3: (8 * 1 + 2) * 4,
        cellCount: 9,
      },
    ])
    expect(fill[indexOf(grid, 2, 2)]).toBe(9)
    expect(fill[indexOf(grid, 0, 0)]).toBe(10)
    expect(labels[indexOf(grid, 1, 1)]).toBe(1)
    expect(labels[indexOf(grid, 2, 0)]).toBe(0)
  })

  it('峠でつながった 2 つの窪地: 奥の窪地の spill 標高は峠の高さ、spill point は峠の上', () => {
    // 西の縁の (0,2) が 4 の出口。西の窪地（底 2）は出口の高さ 4 まで、東の窪地（底 3）は峠（5）まで溜まる
    const grid = gridFromRows([
      [10, 10, 10, 10, 10, 10, 10, 10, 10],
      [10, 2, 2, 2, 5, 3, 3, 3, 10],
      [4, 2, 2, 2, 5, 3, 3, 3, 10],
      [10, 2, 2, 2, 5, 3, 3, 3, 10],
      [10, 10, 10, 10, 10, 10, 10, 10, 10],
    ])
    const { depressions, fill } = analyzeDepressions(grid)
    expect(depressions).toHaveLength(2)
    const [west, east] = depressions as [Depression, Depression]
    expect(west).toMatchObject({
      spillIndex: indexOf(grid, 0, 2),
      spillElevation: 4,
      capacityM3: 18,
    })
    expect(east).toMatchObject({ spillElevation: 5, capacityM3: 18, cellCount: 9 })
    expect(east.spillIndex % grid.width).toBe(4) // 峠の列
    expect(fill[indexOf(grid, 4, 2)]).toBe(5) // 峠そのものは窪地ではない
  })

  it('グリッドの端と無効セルに接するセルは起点になり、そこに窪地はできない', () => {
    const rows = singlePitRows()
    ;(rows[1] as (number | null)[])[2] = null // 中央の窪地の北の縁を無効セルにする
    expect(analyzeDepressions(gridFromRows(rows)).depressions).toEqual([])
    expect(
      analyzeDepressions(
        gridFromRows([
          [5, 1, 5],
          [5, 5, 5],
        ]),
      ).depressions,
    ).toEqual([])
  })

  it('同じ標高の縁が複数あっても 1 つの窪地になり、spill point は先に入れた（番号の小さい）縁', () => {
    const rows = singlePitRows()
    ;(rows[4] as (number | null)[])[2] = 9 // 南の縁の中央も 9 にする
    const grid = gridFromRows(rows)
    const first = analyzeDepressions(grid)
    expect(first.depressions).toHaveLength(1)
    expect(first.depressions[0]).toMatchObject({ spillIndex: indexOf(grid, 2, 0), cellCount: 9 })
    const second = analyzeDepressions(grid)
    expect(second).toEqual(first) // 決定的
  })
})

describe('significantDepressions（R02-3）', () => {
  const base: Depression = {
    id: 1,
    pitIndex: 0,
    spillIndex: 1,
    spillElevation: 1,
    maxDepthM: 0.05,
    areaM2: 10,
    capacityM3: 0.2,
    cellCount: 10,
  }

  it('最大深さ 5cm 以上かつ面積 10m² 以上だけを残す', () => {
    const list = [base, { ...base, id: 2, maxDepthM: 0.049 }, { ...base, id: 3, areaM2: 9.9 }]
    expect(significantDepressions(list).map((d) => d.id)).toEqual([1])
  })
})
