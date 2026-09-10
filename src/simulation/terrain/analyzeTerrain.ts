import { analyzeDepressions } from './analyzeDepressions.ts'
import { d8FlowDirection } from './d8FlowDirection.ts'
import { lowestCell } from './lowestCell.ts'
import type { Depression, TerrainGrid } from './types.ts'

export interface TerrainAnalysis {
  lowestIndex: number
  flowDirection: Uint8Array
  fill: Float32Array
  labels: Int32Array
  depressions: Depression[] // 表示と越流イベントの対象（R02-3）は Depression.significant
  elevationRange: { min: number; max: number } | null // 有効セルの最低・最高
}

/** グリッドの組み立ての直後に Worker で行う地形解析（spec 02 §5） */
export function analyzeTerrain(grid: TerrainGrid): TerrainAnalysis {
  const { fill, labels, depressions } = analyzeDepressions(grid)
  const lowestIndex = lowestCell(grid)
  let range: { min: number; max: number } | null = null
  if (lowestIndex !== -1) {
    let max = grid.elevation[lowestIndex]
    for (let i = 0; i < grid.elevation.length; i++) {
      if (grid.validMask[i] === 1 && grid.elevation[i] > max) max = grid.elevation[i]
    }
    range = { min: grid.elevation[lowestIndex], max }
  }
  return {
    lowestIndex,
    flowDirection: d8FlowDirection(grid),
    fill,
    labels,
    depressions,
    elevationRange: range,
  }
}
