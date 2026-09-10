import type { GridRange } from './gridRange.ts'
import { TILE_SIZE } from './tileMath.ts'

/** src/simulation/types.ts の TerrainMeta と同じ形。dem は simulation の型を import できないので独自に持つ */
export interface GridMeta {
  width: number
  height: number
  cellSizeM: number
}

/** 復号済みの 256 × 256 のタイル */
export interface DemTileData {
  elevation: Float32Array
  validMask: Uint8Array
}

/** タイル座標からタイルを引く。無いタイル（海域・国外）は undefined で、その範囲は全画素無効 */
export type TileLookup = (tx: number, ty: number) => DemTileData | undefined

export interface AssembledGrid {
  elevation: Float32Array
  validMask: Uint8Array
  meta: GridMeta
  invalidRatio: number // 無効セルの割合（0〜1）
}

/**
 * タイルを結合して範囲を切り出す（spec 02 §4.4）。リサンプリングはしない。
 * タイルは行の中でタイルが変わるときだけ引く（1000m 四方の 100 万セルでも引く回数を抑える）
 */
export function assembleGrid(range: GridRange, lookup: TileLookup): AssembledGrid {
  const n = range.size
  const elevation = new Float32Array(n * n)
  const validMask = new Uint8Array(n * n)
  let invalid = 0
  for (let row = 0; row < n; row++) {
    const gy = range.originY + row
    const ty = Math.floor(gy / TILE_SIZE)
    const rowOffset = (gy - ty * TILE_SIZE) * TILE_SIZE
    let currentTx = Number.NaN
    let tile: DemTileData | undefined
    for (let col = 0; col < n; col++) {
      const gx = range.originX + col
      const tx = Math.floor(gx / TILE_SIZE)
      if (tx !== currentTx) {
        currentTx = tx
        tile = lookup(tx, ty)
      }
      const i = row * n + col
      const p = rowOffset + (gx - tx * TILE_SIZE)
      if (tile === undefined || tile.validMask[p] !== 1) {
        invalid++
        continue
      }
      elevation[i] = tile.elevation[p] ?? 0
      validMask[i] = 1
    }
  }
  return {
    elevation,
    validMask,
    meta: { width: n, height: n, cellSizeM: range.cellSizeM },
    invalidRatio: invalid / (n * n),
  }
}
