/**
 * メインスレッドと Worker の間のメッセージ（tech-spec §5）。判別可能な union 型。
 * shared は simulation・dem の型だけを import する（types-only-from-core）
 */
import type { DemId } from '../dem/demSources.ts'
import type { Corners } from '../dem/gridRange.ts'
import type { OutflowCells } from '../simulation/outflowCells.ts'
import type { TerrainAnalysis } from '../simulation/terrain/analyzeTerrain.ts'
import type { Depression } from '../simulation/terrain/types.ts'
import type { RainfallInput, StepStats } from '../simulation/types.ts'

/**
 * 再生速度（spec 08 §6.1、R08-5）。数は実時間の倍率（1 は実時間、60 は実時間 1 秒でシミュレーションの 1 分）。
 * 'max' は「最速」（目標を持たず、時間予算だけで回す）
 */
export type PlaybackSpeed = 1 | 10 | 60 | 600 | 'max'

/** 既定の再生速度（60 倍。spec 08 §6.1）。Worker のスケジューラと、メインの再生のストアの初期値 */
export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 60

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
  | {
      // 盛土の履歴（spec 09）。Worker は格子を持たないので、メインが今の標高とマスクの写しを送る
      type: 'fillHistory'
      requestId: number
      terrainId: number
      geo: TerrainGeo
      elevation: Float32Array
      validMask: Uint8Array
    }
  | {
      // 盛土が崩れた後の地形の計算（spec 10）。fillHistory と同じく、メインが今の標高とマスクの写しを送る
      type: 'collapse'
      requestId: number
      terrainId: number
      geo: TerrainGeo
      elevation: Float32Array
      validMask: Uint8Array
      removed: Float32Array
      /** 09 の結果の pastElevation（offsetM を足す前）と offsetM。水路を探すのに使う（spec 10b） */
      pastElevation: Float32Array
      offsetM: number
      candidateId: number
      ratio: CollapseRatio
      presetId: string
    }
  | ({ type: 'swapTerrain'; requestId: number } & SwapGrid)
  | SimulationCommand

/**
 * 地形の差し替え（spec 10 §5.2）。タイルを読まずに、エンジンの地形だけを入れ替える。
 * 崩れる前と後を切り替えるたびに送る。size は格子の一辺（正方形）
 */
export interface SwapGrid {
  elevation: Float32Array
  validMask: Uint8Array
  size: number
  cellSizeM: number
  depressions: Depression[]
}

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
  /**
   * 流出の縁のマスクと帯（spec 07 §5.1）。地形の解析と同じく Worker が読み込みのときに 1 回だけ作って送る
   * （spec の「メインスレッドで作る」からの逸脱。計画 2026-09-29-07 の冒頭）。メインは読むだけ
   */
  outflow: OutflowCells
}

/** 盛土の候補の根拠の段階。strong: A54 に重なる。moderate: 人工地形（盛土地・埋立地）に重なる。limited: どちらにも重ならない */
export type FillEvidence = 'strong' | 'moderate' | 'limited'

/** A54 の盛土区分。valley: 谷埋め型。side: 腹付け型。unclassified: 区分をしていない */
export type A54Type = 'valley' | 'side' | 'unclassified'

/** 標高差の大きい範囲（盛土の候補。spec 09 §4）。体積は参考値 */
export interface FillCandidate {
  id: number
  areaM2: number
  maxRiseM: number
  volumeM3: number
  centroid: { lon: number; lat: number }
  evidence: FillEvidence
  evidenceSources: Array<'a54' | 'landform'>
  a54Type?: A54Type
}

/**
 * 盛土の履歴の結果。terrainId はその地形を読み込んだ loadTerrain の requestId。
 * 配列は格子（size × size）と同じ並びで、Transferable で送る。NaN は無効
 */
export interface FillHistoryPayload {
  terrainId: number
  pastElevation: Float32Array
  /** 今 − 昔 から範囲全体のずれ（offsetM）を引いた標高差 */
  deltaCorrected: Float32Array
  /** 候補のセルに候補の id、それ以外は 0 */
  candidateLabels: Int32Array
  offsetM: number
  /** 根拠が強い順、次に体積の大きい順 */
  candidates: FillCandidate[]
  /** 範囲にかかる分だけ（地図に描く） */
  a54Polygons: Array<{ rings: Array<Array<[number, number]>>; a54Type: A54Type }>
  /** 盛土地・埋立地に加え、切土地・改変工事中も含む（地図に描く） */
  landformPolygons: Array<{ rings: Array<Array<[number, number]>>; code: string }>
  a54Available: boolean
  landformAvailable: boolean
}

/**
 * unavailable: 段 3（DEM10B）の地形では出せない。no-overlap: 昔の標高と重なる有効なセルが無い。
 * network: 昔の標高の取得に失敗。internal: それ以外
 */
export type FillHistoryFailureReason = 'unavailable' | 'no-overlap' | 'network' | 'internal'

/** 崩れる量（候補の盛土の厚さに対する割合） */
export type CollapseRatio = 1 | 0.5 | 0.25

/** 崩れてせき止められた窪地。spill はあふれ出し点の経緯度 */
export interface DammedSiteSummary {
  depressionId: number
  capacityM3: number
  addedCapacityM3: number
  maxDepthM: number
  areaM2: number
  spillElevation: number
  spill: { lon: number; lat: number }
}

/** 盛土の下に仮定した水路（spec 10b） */
export interface CulvertSummary {
  /** 水路の線（pit から出口へ。セルの中心の [lon, lat]） */
  line: Array<[number, number]>
  lengthM: number
  /** 崩れた土で端がふさがった */
  blocked: boolean
}

/** 盛土が崩れた後の地形と、せき止められた場所（spec 10）。配列は格子と同じ並びで Transferable で送る */
export interface CollapsePayload {
  /** 崩れる前の地形の id */
  terrainId: number
  candidateId: number
  ratio: CollapseRatio
  presetId: string
  /** 崩れた後の地形（解析・流出の縁・geo は崩れる前と同じ geo） */
  after: TerrainPayload
  removed: Float32Array
  deposit: Float32Array
  collapsedM3: number
  depositedM3: number
  outsideM3: number
  dams: DammedSiteSummary[]
  /** 水路を仮定したときの、溝ありの崩れる前の地形（解析・流出の縁つき、geo は入力の geo）。仮定しなければ null */
  before: TerrainPayload | null
  culvert: CulvertSummary | null
}

/** 再生の失敗の理由。no-elevation-at-rain-center は 03 の NoElevationAtRainCenterError（name で判別する） */
export type SimFailureReason = 'no-elevation-at-rain-center' | 'internal'

/**
 * 水深と統計（spec 04 §5.1、tech-spec §5.2）。terrainId はその地形を読み込んだ loadTerrain の requestId。
 * water は Float32 × N² の転送バッファで、メインは次の frame を受けたら returnBuffer で返す。
 * arrows は [列, 行, 方位（度。北が 0、時計回り）, 大きさ（m/s。spec 08 §3.10）] の並び。null は前の矢印のまま。
 * stats.events は前に送った frame からの越流イベントの累計（見送った frame の分を含む）。
 * runId はこの frame を生んだ直前の start・reset の通し番号（SimulationCommand の説明を参照）。
 * loadTerrain の直後は 0（まだ実行が始まっていない）。
 * simSecondsPerSecond は実際の倍率（実時間 1 秒あたりに進んだシミュレーションの秒。spec 08 §6.1）
 */
export interface FrameMessage {
  type: 'frame'
  terrainId: number
  step: number
  water: ArrayBuffer
  arrows: Float32Array | null
  stats: StepStats
  stepsPerSecond: number
  simSecondsPerSecond: number
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
  | { type: 'terrainSwapped'; requestId: number }
  | { type: 'terrainFailed'; requestId: number; reason: TerrainFailureReason; message: string }
  | { type: 'fillHistoryReady'; requestId: number; result: FillHistoryPayload }
  | {
      type: 'fillHistoryFailed'
      requestId: number
      reason: FillHistoryFailureReason
      message: string
    }
  | { type: 'collapseProgress'; requestId: number; fraction: number }
  | { type: 'collapseReady'; requestId: number; result: CollapsePayload }
  | { type: 'collapseFailed'; requestId: number; message: string }
  | FrameMessage
  | SimFailedMessage
