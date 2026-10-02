/**
 * 計測の結果の形（spec 06 §3）。tests/perf/ は型だけを import する（tsconfig.node.json は vite/client の型を
 * 持たないので、TerrainSession などに届く import を tests から張らない。計画で決めたこと 14）
 */

import type { StopReason } from '../simulation/types'
import type { RainfallSettings } from '../state/persistedSettings'
import type { DisplayStats } from '../state/simulationStore'
import type {
  LongTaskSample,
  LongTaskSummary,
  StepTimeSummary,
  TimedStepSnapshot,
} from './perfCollectors'
import type { PerfParams } from './perfParams'
import type { WaterMeasure, WaterVerdict } from './perfWaterStats'

export interface StepsReport {
  params: PerfParams
  /** 測ったときの 3D の状態（data-view3d。2D なら off） */
  view3d: string
  sizeM: number
  rain: RainfallSettings
  terrain: { demLevel: number; cellSizeM: number; invalidRatio: number } | null
  /**
   * 自動停止（settled・cap。spec 08 §3.9）で止まった。until=settle で計測の上限（capMs）に届いた、
   * または until=window で窓が終わったら false
   */
  stopped: boolean
  /** 自動停止の理由（止まらなければ null） */
  stopReason: StopReason | null
  /** 止まった（または打ち切り・窓の終わりの）時点の step 数。打ち切りは統計の 10Hz の遅れぶん少ないことがある */
  steps: number
  elapsedMs: number
  /** 経過時間（シミュレーションの秒） */
  simTimeS: number
  /** 実際の倍率 = simTimeS ÷ 実時間の秒（spec 08 §6.1・§7.3） */
  actualRatio: number
  /** dt（s）の標本（統計を入れるたび。10Hz）の数・中央値・最小。標本が無ければ null */
  dt: { count: number; medianS: number; minS: number } | null
  stepsPerSecond: number
  final: DisplayStats | null
  stepTimes: StepTimeSummary & { series: TimedStepSnapshot[] }
  longTasks: LongTaskSummary & { entries: LongTaskSample[] }
  /** 止めた後 IDLE_WINDOW_MS の間の地図の render の回数（spec 06 §5「止まっている間の再描画」） */
  idleRenders: number
  idleWindowMs: number
}

export interface To3dTiming {
  /** 3D を押してから 3D の状態になるまで（View3d のチャンクの読み込みと地形の設定） */
  statusMs: number
  /** 水面を作り終えるまで（three のチャンクと水面の作成）。水面なしなら null */
  waterBuiltMs: number | null
  tilesLoaded: boolean
  /** タイルが揃って 2 フレーム描くまで（spec 06 §5「3D を押してから最初の 3D のフレーム」） */
  firstFrameMs: number
  /** firstFrameMs を取った時点で 3D の視点が定まっていたか（data-view3d-framed。横断レビュー task-5 軽微 1） */
  framed: boolean
}

export interface LoadReport {
  params: PerfParams
  sizeM: number
  /** 地点を選んでから、Worker の地形が届いてストアが ready になるまで */
  selectToReadyMs: number
  /** 地点を選んでから、2D の地形のレイヤーが出て 2 フレーム描くまで（spec 06 §5「クリックから 2D の地形の表示」） */
  selectTo2dMs: number
  to3d: To3dTiming | null
  prepareMs: number[]
  waterBuildMs: number[]
  longTasks: { load: LongTaskSummary; to3d: LongTaskSummary | null; entries: LongTaskSample[] }
}

/** probe=water の 1 回の読み（そのフレームのカメラ。Task 27 のレビュー I4） */
export interface WaterRead {
  /** footprint・lifted・visible<揺らし>・footprint-end */
  label: string
  mapZoom: number
  mapPitch: number
  bearing: number
  /** 地図の中心の標高（transform.elevation、m、垂直強調の後）。MapLibre はフレームごとに読めた地形から決め直す */
  centerElevationM: number
  cameraAltitudeM: number
}

export interface WaterProbeRow {
  requestedZoom: number
  mapZoom: number
  mapPitch: number
  /** 画面の中心で描かれている地形タイルのズーム（実測。data-drawn-tile-zoom） */
  drawnTileZoom: string
  /** カメラの高さ − カメラの真下の地形の高さ（m、垂直強調の後）。地形が無ければ null */
  cameraClearanceM: number | null
  /** 読みの間の centerElevationM の最大 − 最小（m） */
  cameraDriftM: number
  reads: WaterRead[]
  measure: WaterMeasure
  verdict: WaterVerdict
  reason: string
}

export interface WaterProbeReport {
  params: PerfParams
  /** 判定用の色を覆うので隠した重ね描き（範囲の枠・流れの向き・最低点） */
  hiddenLayers: string[]
  /** 降雨を止めた時点の step */
  stoppedAtStep: number | null
  rows: WaterProbeRow[]
}
