/**
 * メインスレッドと Worker の間のメッセージ（tech-spec §5）。判別可能な union 型。
 * shared は simulation・dem の型だけを import する（types-only-from-core）
 */
import type { DemId } from '../dem/demSources.ts'
import type { Corners } from '../dem/gridRange.ts'
import type { TerrainAnalysis } from '../simulation/terrain/analyzeTerrain.ts'
import type { RainfallInput, StepStats } from '../simulation/types.ts'

/** 再生速度（spec 04 §5.2）。'max' は「最速」（step 数の上限を持たず、時間予算だけで回す） */
export type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4 | 'max'

/**
 * 再生の命令（spec 04 §5.1）。setArrows は spec の setArrowSpacing の代わり。
 * 矢印が非表示なら Worker は flowVectors() を呼ばない（表示中は呼ぶたびに使い回しの 2 × N² の
 * バッファへ書く。spec 06 §5.2）。
 *
 * start・reset の runId は、メイン（SimulationSession）だけが振る通し番号（タスクレビューの重要な指摘・
 * 追加の裁定）。Worker 側では作らない（異常終了で作り直した Worker が番号を巻き戻さないため）。
 * Worker は受け取った runId をそのまま覚え、以降の frame・simFailed に載せて返す。PlaybackScheduler の
 * 保留枠は 1 つしかなく、reset が送る step 0 の frame（ZERO_STATS）は、直後に start が来ると
 * 届く前に discardPending() で消えることがあるので、frame の新旧は「step が 0 かどうか」ではなく
 * runId で区別する。
 *
 * setArrows の spacingM は実際の間隔（m）。範囲に比例させた後の値（spec 05 §3.3）
 */
export type SimulationCommand =
  | { type: 'start'; rain: RainfallInput; runId: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step' }
  | { type: 'reset'; runId: number }
  | { type: 'setSpeed'; speed: PlaybackSpeed }
  | { type: 'setArrows'; visible: boolean; spacingM: number }
  | { type: 'returnBuffer'; buffer: ArrayBuffer }

export type MainToWorkerMessage =
  | { type: 'ping'; id: number }
  | { type: 'loadTerrain'; requestId: number; lon: number; lat: number; sizeM: number }
  | SimulationCommand

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

/** 再生の失敗の理由。no-elevation-at-rain-center は 03 の NoElevationAtRainCenterError（name で判別する） */
export type SimFailureReason = 'no-elevation-at-rain-center' | 'internal'

/**
 * 水深と統計（spec 04 §5.1、tech-spec §5.2）。terrainId はその地形を読み込んだ loadTerrain の requestId。
 * water は Float32 × N² の転送バッファで、メインは次の frame を受けたら returnBuffer で返す。
 * arrows は [列, 行, 方位（度。北が 0、時計回り）, 大きさ（m／step）] の並び。null は前の矢印のまま。
 * stats.events は前に送った frame からの越流イベントの累計（見送った frame の分を含む）。
 * runId はこの frame を生んだ直前の start・reset の通し番号（SimulationCommand の説明を参照）。
 * loadTerrain の直後は 0（まだ実行が始まっていない）
 */
export interface FrameMessage {
  type: 'frame'
  terrainId: number
  step: number
  water: ArrayBuffer
  arrows: Float32Array | null
  stats: StepStats
  stepsPerSecond: number
  runId: number
}

/** runId は FrameMessage と同じ（SimulationCommand の説明を参照） */
export interface SimFailedMessage {
  type: 'simFailed'
  terrainId: number
  reason: SimFailureReason
  message: string
  runId: number
}

export type WorkerToMainMessage =
  | { type: 'pong'; id: number }
  | { type: 'terrainProgress'; requestId: number; done: number; started: number }
  | { type: 'terrainLoaded'; requestId: number; terrain: TerrainPayload }
  | { type: 'terrainFailed'; requestId: number; reason: TerrainFailureReason; message: string }
  | FrameMessage
  | SimFailedMessage
