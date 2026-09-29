import type { AssembledGrid } from '../dem/DemGrid'
import type { TerrainGeo, TerrainPayload } from '../shared/protocol'
import type { OutflowCells } from '../simulation/outflowCells'
import type { TerrainAnalysis } from '../simulation/terrain/analyzeTerrain'

/**
 * メインスレッドへ送る地形を作る。標高・validMask は複製（.slice()）して送る（tech-spec §5.4）。
 * 元の grid は Worker がエンジンに渡す（エンジンが複製を持つので、Worker は grid を保持しない。spec 04）。
 * 流出の表（spec 07 §5.1）は Worker が作ったものをそのまま移す（Worker は持ち続けない）
 */
export function packTerrain(
  grid: AssembledGrid,
  analysis: TerrainAnalysis,
  geo: TerrainGeo,
  outflow: OutflowCells,
): { payload: TerrainPayload; transfer: ArrayBuffer[] } {
  const elevation = grid.elevation.slice()
  const validMask = grid.validMask.slice()
  const payload: TerrainPayload = { ...analysis, elevation, validMask, geo, outflow }
  // flowDirection・fill・labels は TerrainAnalysis の型が ArrayBufferLike（SharedArrayBuffer を含む）を
  // 許すが、analyzeTerrain が new Uint8Array 等で作るので実体は必ず ArrayBuffer。流出の表も同じ
  const transfer: ArrayBuffer[] = [
    elevation.buffer,
    validMask.buffer,
    analysis.flowDirection.buffer as ArrayBuffer,
    analysis.fill.buffer as ArrayBuffer,
    analysis.labels.buffer as ArrayBuffer,
    outflow.mask.buffer as ArrayBuffer,
    outflow.nearest.buffer as ArrayBuffer,
    outflow.band.buffer as ArrayBuffer,
  ]
  return { payload, transfer }
}
