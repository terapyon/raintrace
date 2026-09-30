import { describe, expect, it } from 'vitest'
import { gridFromRows, indexOf } from '../testing/terrainGrids.test-support.ts'
import { analyzeDepressions, isSignificant } from './analyzeDepressions.ts'
import { d8FlowDirection } from './d8FlowDirection.ts'
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
        significant: true,
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
    // colormap の depressions[label - 1] が頼る不変条件: id は併合後も 1 から順の連番
    expect(first.depressions.map((d) => d.id)).toEqual([1])
    const second = analyzeDepressions(grid)
    expect(second).toEqual(first) // 決定的
  })
})

describe('窪地の significant（R02-3。Float32 の丸め）', () => {
  it('縁 3.10m・底 3.00m の窪地は、Float32 の丸めで深さが 0.10 未満になっても significant', () => {
    // 5×5、縁 3.10m、中の 3×3 が底 3.00m。セル 1.2m なので面積は 9 × 1.44 = 12.96m²
    const rows: number[][] = Array.from({ length: 5 }, () => Array(5).fill(3.1))
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) (rows[y] as number[])[x] = 3.0
    }
    const grid = gridFromRows(rows, 1.2)
    const depth = Math.fround(3.1) - Math.fround(3.0)
    expect(depth).toBeLessThan(0.1) // Float32 の丸めで 0.09999990 になる
    const { depressions } = analyzeDepressions(grid)
    expect(depressions).toHaveLength(1)
    expect(depressions[0]?.areaM2).toBeCloseTo(12.96)
    expect(depressions[0]?.significant).toBe(true)
  })

  it('縁 3.08m・底 3.00m の窪地（深さ約 0.08m）は面積が足りていても significant でない', () => {
    // 閾値 0.10m を明確に下回るので、丸めの余裕（1mm）があっても significant にならない
    const rows: number[][] = Array.from({ length: 5 }, () => Array(5).fill(3.08))
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) (rows[y] as number[])[x] = 3.0
    }
    const grid = gridFromRows(rows, 1.2)
    const { depressions } = analyzeDepressions(grid)
    expect(depressions).toHaveLength(1)
    expect(depressions[0]?.areaM2).toBeCloseTo(12.96)
    expect(depressions[0]?.significant).toBe(false)
  })
})

describe('isSignificant（R02-3）', () => {
  // 既定の閾値は最大深さ 0.10m。DEPTH_TOLERANCE_M（1mm）だけ下まで significant にする
  it('最大深さが 閾値 − 1mm ちょうどなら significant、それを下回れば significant でない', () => {
    expect(isSignificant({ maxDepthM: 0.099, areaM2: 100 })).toBe(true)
    expect(isSignificant({ maxDepthM: 0.0989, areaM2: 100 })).toBe(false)
  })

  it('面積が 10m² 未満なら significant でない', () => {
    expect(isSignificant({ maxDepthM: 1, areaM2: 9.99 })).toBe(false)
  })
})

describe('4 近傍の窪地解析（spec 08 §3.7、R08-2）', () => {
  it('斜めにだけ低い所へ抜ける窪地は、4 近傍では窪地になり、spill 標高は 4 近傍の値（8 近傍なら斜めに抜けて窪地にならない）', () => {
    // (2,2) の 1 は、斜め（南東）の (3,3) の 0 を経て、さらに斜めの角 (4,4) の 0（グリッドの端）へ抜ける。
    // 上下左右はすべて 5 なので、水は上下左右の面を通ってしか動けない 4 近傍では 5 まで溜まる
    const grid = gridFromRows([
      [5, 5, 5, 5, 5],
      [5, 5, 5, 5, 5],
      [5, 5, 1, 5, 5],
      [5, 5, 5, 0, 5],
      [5, 5, 5, 5, 0],
    ])
    const { depressions, fill, labels } = analyzeDepressions(grid)
    expect(labels[indexOf(grid, 2, 2)]).not.toBe(0)
    expect(fill[indexOf(grid, 2, 2)]).toBe(5)
    const pit = depressions.find((d) => d.pitIndex === indexOf(grid, 2, 2))
    expect(pit?.spillElevation).toBe(5)
    // (3,3) も上下左右は 5 なので、4 近傍では別の窪地になる（(2,2) とは斜めにしか接しない）
    expect(labels[indexOf(grid, 3, 3)]).not.toBe(0)
    expect(labels[indexOf(grid, 3, 3)]).not.toBe(labels[indexOf(grid, 2, 2)])
  })

  it('無効セルに斜めにだけ接するセルは起点にならない（上下左右で接するセルは起点）', () => {
    const grid = gridFromRows([
      [5, 5, 5, 5, 5, 5],
      [5, 5, 5, 5, 5, 5],
      [5, 5, null, 5, 5, 5],
      [5, 5, 5, 1, 5, 5],
      [5, 5, 5, 5, 5, 5],
      [5, 5, 5, 5, 5, 5],
    ])
    const { depressions } = analyzeDepressions(grid)
    // (3,3) は無効セル (2,2) に斜めにだけ接する。起点にならないので、周りの 5 まで溜まる窪地になる
    expect(depressions).toHaveLength(1)
    expect(depressions[0]).toMatchObject({
      pitIndex: indexOf(grid, 3, 3),
      spillElevation: 5,
      cellCount: 1,
    })
  })

  it('D8 の流向は 8 近傍のまま（斜めの最急の向きを指す。窪地の中から斜めに外を指す矢印を受け入れる。レビュー 1 の m4）', () => {
    const grid = gridFromRows([
      [5, 5, 5, 5, 5],
      [5, 5, 5, 5, 5],
      [5, 5, 1, 5, 5],
      [5, 5, 5, 0, 5],
      [5, 5, 5, 5, 0],
    ])
    // 東から時計回りの 8 近傍（neighbors.ts）の 2 番目 = 南東。D8 の番号は index + 1
    expect(d8FlowDirection(grid)[indexOf(grid, 2, 2)]).toBe(2)
  })
})
