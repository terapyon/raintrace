import type { TerrainGrid } from './types.ts'

/** テスト用: 行ごとの標高の配列から地形を作る。null は無効セル */
export function gridFromRows(rows: (number | null)[][], cellSizeM = 1): TerrainGrid {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const elevation = new Float32Array(width * height)
  const validMask = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    row.forEach((value, x) => {
      const index = y * width + x
      if (value !== null) {
        elevation[index] = value
        validMask[index] = 1
      }
    })
  })
  return { elevation, validMask, width, height, cellSizeM }
}

export const indexOf = (grid: TerrainGrid, x: number, y: number): number => y * grid.width + x
