import type { TerrainGrid } from './types.ts'

/** 標高が最小の有効セルの番号。同じなら番号が小さいもの。有効セルが無ければ -1 */
export function lowestCell(grid: TerrainGrid): number {
  const { elevation, validMask } = grid
  let best = -1
  for (let i = 0; i < elevation.length; i++) {
    if (validMask[i] === 0) continue
    if (best === -1 || elevation[i] < elevation[best]) best = i
  }
  return best
}
