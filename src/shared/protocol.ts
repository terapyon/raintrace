/**
 * メインスレッドと Worker の間のメッセージ（tech-spec §5）。判別可能な union 型。
 * shared は simulation・dem の型だけを import する（types-only-from-core）
 */
import type { DemId } from '../dem/demSources.ts'
import type { Corners } from '../dem/gridRange.ts'
import type { TerrainAnalysis } from '../simulation/terrain/analyzeTerrain.ts'

export type MainToWorkerMessage =
  | { type: 'ping'; id: number }
  | { type: 'loadTerrain'; requestId: number; lon: number; lat: number; sizeM: number }

/**
 * no-data: 範囲の全画素が無効値。network: 再試行しても取得に失敗。out-of-range: 対応範囲（日本）の外。
 * internal: それ以外
 */
export type TerrainFailureReason = 'no-data' | 'network' | 'internal' | 'out-of-range'

/**
 * メインスレッドから見た読み込みの失敗の理由。superseded: 新しい地点の読み込みに置き換わった。
 * worker: Worker が異常終了した（または起動し直した）
 */
export type TerrainErrorReason = TerrainFailureReason | 'superseded' | 'worker'

export interface TerrainGeo {
  level: 1 | 2 | 3 // 採用した DEM の段
  z: number
  originX: number
  originY: number
  size: number
  cellSizeM: number
  corners: Corners
  breakdown: Partial<Record<DemId, number>> // 使った DEM ごとのタイル数
  invalidRatio: number
}

/** 読み込んだ地形。配列は Transferable で送る（tech-spec §5.4） */
export interface TerrainPayload extends TerrainAnalysis {
  elevation: Float32Array
  validMask: Uint8Array
  geo: TerrainGeo
}

export type WorkerToMainMessage =
  | { type: 'pong'; id: number }
  | { type: 'terrainProgress'; requestId: number; done: number; started: number }
  | { type: 'terrainLoaded'; requestId: number; terrain: TerrainPayload }
  | { type: 'terrainFailed'; requestId: number; reason: TerrainFailureReason; message: string }
