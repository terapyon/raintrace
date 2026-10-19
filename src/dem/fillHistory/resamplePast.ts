import type { DemTileData, TileLookup } from '../DemGrid.ts'
import { TILE_SIZE, type TileCoord, tilesInPixelRect } from '../tileMath.ts'
import { PAST_Z } from './constants.ts'

/** 今のシミュレーション格子の位置と大きさ（GridRange / TerrainGeo から構造的に代入できる） */
export interface GridFrame {
  z: number
  originX: number
  originY: number
  size: number
  cellSizeM: number
}

/** 格子の 1 セルが z14 の何画素に当たるか（z17 なら 1/8） */
function pastPerCell(z: number): number {
  return 2 ** (PAST_Z - z)
}

/** 補間に読む z14 の画素の範囲（半開区間）。範囲を写して、周りに 1 画素ずつ足す */
function pastPixelRect(frame: GridFrame) {
  const k = pastPerCell(frame.z)
  const a = frame.originX * k
  const b = (frame.originX + frame.size) * k
  const c = frame.originY * k
  const d = (frame.originY + frame.size) * k
  return {
    x0: Math.floor(a) - 1,
    y0: Math.floor(c) - 1,
    x1: Math.ceil(b) + 1,
    y1: Math.ceil(d) + 1,
  }
}

/** 補間に必要な z14 のタイル（範囲を z14 に写し、周りに 1 画素足した矩形を覆う） */
export function pastTileCoords(frame: GridFrame): TileCoord[] {
  return tilesInPixelRect(pastPixelRect(frame), PAST_Z)
}

/**
 * 昔の標高（z14 のタイル）を今の格子に双線形補間する。長さ size²。
 * 画素 i の中心は i + 0.5 なので、セル中心の z14 の座標 p から 0.5 引いた u で補間する。
 * 補間に使う 4 画素のどれかが無効（タイルが無い・validMask が 0）なら NaN
 */
export function resamplePast(frame: GridFrame, lookup: TileLookup): Float32Array {
  const n = frame.size
  const out = new Float32Array(n * n)
  const k = pastPerCell(frame.z)
  const cache = new Map<number, DemTileData | undefined>()

  // z14 のグローバル画素 (gx, gy) の標高。無効なら NaN
  const sample = (gx: number, gy: number): number => {
    const tx = Math.floor(gx / TILE_SIZE)
    const ty = Math.floor(gy / TILE_SIZE)
    const key = ty * 2 ** 24 + tx
    let tile = cache.get(key)
    if (tile === undefined && !cache.has(key)) {
      tile = lookup(tx, ty)
      cache.set(key, tile)
    }
    if (!tile) return Number.NaN
    const idx = (gy - ty * TILE_SIZE) * TILE_SIZE + (gx - tx * TILE_SIZE)
    return tile.validMask[idx] ? (tile.elevation[idx] as number) : Number.NaN
  }

  for (let row = 0; row < n; row++) {
    const v = (frame.originY + row + 0.5) * k - 0.5
    const j0 = Math.floor(v)
    const fy = v - j0
    for (let col = 0; col < n; col++) {
      const u = (frame.originX + col + 0.5) * k - 0.5
      const i0 = Math.floor(u)
      const fx = u - i0
      const v00 = sample(i0, j0)
      const v10 = sample(i0 + 1, j0)
      const v01 = sample(i0, j0 + 1)
      const v11 = sample(i0 + 1, j0 + 1)
      const top = v00 * (1 - fx) + v10 * fx
      const bottom = v01 * (1 - fx) + v11 * fx
      out[row * n + col] = top * (1 - fy) + bottom * fy
    }
  }
  return out
}
