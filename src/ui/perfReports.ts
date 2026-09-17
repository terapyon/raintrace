/**
 * 計測の結果の形（spec 06 §3）。tests/perf/ は型だけを import する（tsconfig.node.json は vite/client の型を
 * 持たないので、TerrainSession などに届く import を tests から張らない。計画で決めたこと 14）
 */
import type { DisplayStats } from '../state/simulationStore'
import type {
  LongTaskSample,
  LongTaskSummary,
  StepTimeSummary,
  TimedStepSnapshot,
} from './perfCollectors'
import type { PerfParams } from './perfParams'

export interface StepsReport {
  params: PerfParams
  /** 測ったときの 3D の状態（data-view3d。2D なら off） */
  view3d: string
  sizeM: number
  rain: { amountMm: number; radiusM: number }
  terrain: { demLevel: number; cellSizeM: number; invalidRatio: number } | null
  /** 平衡に届いたか（until=settle で cap に届いた、または until=window で窓が終わったら false） */
  settled: boolean
  /** 平衡（または打ち切り・窓の終わり）の時点の step 数。打ち切りは統計の 10Hz の遅れぶん少ないことがある */
  steps: number
  elapsedMs: number
  /** steps ÷ 60 を分にした値（1x なら何分か。報告するだけで目標にはしない。R06-6） */
  minutesAt1x: number
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
