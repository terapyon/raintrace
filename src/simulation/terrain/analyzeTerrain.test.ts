import { describe, expect, it } from 'vitest'
import { gridFromRows } from '../testing/terrainGrids.test-support.ts'
import { analyzeDepressions } from './analyzeDepressions.ts'
import { analyzeTerrain } from './analyzeTerrain.ts'
import { d8FlowDirection } from './d8FlowDirection.ts'
import { lowestCell } from './lowestCell.ts'

describe('analyzeTerrain', () => {
  it('各解析の結果をまとめ、表示対象の窪地と標高の範囲を加える', () => {
    // 4m 四方のセル（16m²）の単一の窪地。最大深さ 2m、面積 144m² なので表示対象
    const grid = gridFromRows(
      [
        [10, 10, 9, 10, 10],
        [10, 8, 8, 8, 10],
        [10, 8, 7, 8, 10],
        [10, 8, 8, 8, null],
        [10, 10, 10, 10, 10],
      ],
      4,
    )
    grid.elevation[3 * 5 + 4] = -50 // 無効セルは標高の範囲に入れない
    const result = analyzeTerrain(grid)
    expect(result.lowestIndex).toBe(lowestCell(grid))
    expect([...result.flowDirection]).toEqual([...d8FlowDirection(grid)])
    expect(result.depressions).toEqual(analyzeDepressions(grid).depressions)
    expect(result.depressions.filter((d) => d.significant).map((d) => d.id)).toEqual([1])
    expect(result.elevationRange).toEqual({ min: 7, max: 10 })
  })

  it('有効セルが無ければ標高の範囲は null', () => {
    expect(analyzeTerrain(gridFromRows([[null, null]])).elevationRange).toBeNull()
  })
})
