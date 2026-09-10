import type { AssembledGrid } from '../dem/DemGrid'
import type { TerrainGeo, TerrainPayload } from '../shared/protocol'
import type { TerrainAnalysis } from '../simulation/terrain/analyzeTerrain'
import type { Depression, TerrainGrid } from '../simulation/terrain/types'

/** Worker が保持する地形（spec 02 §4.4）。04 でエンジンに渡す（loadTerrain と、significant の窪地を setDepressions） */
export interface RetainedTerrain {
  requestId: number
  grid: TerrainGrid
  depressions: Depression[]
}

/**
 * 読み込んだグリッドと解析の結果を、Worker が保持する分とメインスレッドへ送る分に分ける。
 * 標高・validMask は複製（.slice()）してメインへ送り、元の配列は Worker が保持する（tech-spec §5.4）
 */
export function packTerrain(
  requestId: number,
  grid: AssembledGrid,
  analysis: TerrainAnalysis,
  geo: TerrainGeo,
): { retained: RetainedTerrain; payload: TerrainPayload; transfer: ArrayBuffer[] } {
  const retained: RetainedTerrain = {
    requestId,
    grid: {
      elevation: grid.elevation,
      validMask: grid.validMask,
      width: grid.width,
      height: grid.height,
      cellSizeM: grid.cellSizeM,
    },
    depressions: analysis.depressions,
  }
  const elevation = grid.elevation.slice()
  const validMask = grid.validMask.slice()
  const payload: TerrainPayload = {
    ...analysis,
    elevation,
    validMask,
    geo,
  }
  // flowDirection・fill・labels は TerrainAnalysis の型が ArrayBufferLike（SharedArrayBuffer を含む）を
  // 許すが、analyzeTerrain が new Uint8Array 等で作るので実体は必ず ArrayBuffer
  const transfer: ArrayBuffer[] = [
    elevation.buffer,
    validMask.buffer,
    analysis.flowDirection.buffer as ArrayBuffer,
    analysis.fill.buffer as ArrayBuffer,
    analysis.labels.buffer as ArrayBuffer,
  ]
  return { retained, payload, transfer }
}
