import { cellAt } from '../dem/gridRange'
import { wrapLongitude } from '../dem/tileMath'
import type { TerrainPayload } from '../shared/protocol'

export type CellInfo =
  | { kind: 'no-data' }
  | { kind: 'value'; elevationM: number; depthM: number; levelM: number }

/**
 * 地点のセルの標高・水深・水位（base-spec §39）。範囲の外は null。
 * 水深はメインの手元の最新の frame（無ければ 0）。表示は 0.01m 単位（tech-spec §6.6）
 */
export function cellInfoAt(
  terrain: Pick<TerrainPayload, 'geo' | 'elevation' | 'validMask'>,
  water: Float32Array | null,
  lon: number,
  lat: number,
): CellInfo | null {
  // 世界のコピーの上のクリックも、選んだ地点と同じ [−180, 180) の経度で調べる
  const cell = cellAt(terrain.geo, wrapLongitude(lon), lat)
  if (cell === null) return null
  const index = cell.row * terrain.geo.size + cell.col
  if (terrain.validMask[index] !== 1) return { kind: 'no-data' }
  const elevationM = terrain.elevation[index] ?? 0
  const depthM = water?.[index] ?? 0
  return { kind: 'value', elevationM, depthM, levelM: elevationM + depthM }
}
