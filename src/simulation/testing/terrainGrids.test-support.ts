/**
 * テスト用: 02 の地形解析のテストが使う地形（TerrainGrid）と窪地の組み立て。
 * 03 のエンジンのテストの組み立て（fixtures.test-support.ts）とは使い手が別なので、統合しない（spec 04 の計画 Task 12）
 */
import type { Depression, TerrainGrid } from '../terrain/types.ts'

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

/** テスト用: 窪地。既定値に必要な項目だけ上書きする */
export function makeDepression(overrides: Partial<Depression> = {}): Depression {
  return {
    id: 1,
    pitIndex: 0,
    spillIndex: 1,
    spillElevation: 1,
    maxDepthM: 1,
    areaM2: 100,
    capacityM3: 1,
    cellCount: 1,
    significant: true,
    ...overrides,
  }
}
