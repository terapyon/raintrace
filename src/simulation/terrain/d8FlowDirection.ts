import { NEIGHBOR_DISTANCE, NEIGHBOR_DX, NEIGHBOR_DY } from './neighbors.ts'
import type { TerrainGrid } from './types.ts'

/**
 * D8 の流向（spec 02 §5）。勾配 ΔZ / 距離 が最大の近傍を下り先にする。同じ勾配なら固定の近傍順で先のもの。
 * グリッドの外と無効セルは近傍に含めない。0 = 下り先なし、1〜8 = NEIGHBOR_DX の順の index + 1。
 * セルの大きさはすべての近傍に同じ倍率で掛かるので、比較には使わない
 */
export function d8FlowDirection(grid: TerrainGrid): Uint8Array {
  const { elevation, validMask, width, height } = grid
  const direction = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (validMask[i] === 0) continue
      let bestSlope = 0
      let bestDirection = 0
      for (let k = 0; k < 8; k++) {
        const nx = x + NEIGHBOR_DX[k]
        const ny = y + NEIGHBOR_DY[k]
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const j = ny * width + nx
        if (validMask[j] === 0) continue
        const slope = (elevation[i] - elevation[j]) / NEIGHBOR_DISTANCE[k]
        if (slope > bestSlope) {
          bestSlope = slope
          bestDirection = k + 1
        }
      }
      direction[i] = bestDirection
    }
  }
  return direction
}
