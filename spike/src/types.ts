import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GridRange } from '../../src/dem/gridRange.ts'
import type { SpikeParams } from './params'

/** z17 のグローバルピクセル（整数）→ 標高（m）。null は無効値（計画 D5） */
export type ElevationSampler = (gx: number, gy: number) => number | null

export type SceneName = 'synthetic' | 'real'
/**
 * bowlFilm: すり鉢の面（曲面）だけに 1cm の膜（中間の判定の反映 M1）。
 * none: 水面のレイヤーを追加しない（A の地形のみの基準。Task 8 fix round 1、レビュー Important 2）
 */
export type WaterMode = 'fixed' | 'film' | 'bowlFilm' | 'dynamic' | 'none'
export type CandidateId = 'a' | 'a2' | 'b' | 'braw'
/** z-fighting の対策（spec S §3）。offset は水面に polygonOffset(−1, −4)、offset2 は (−2, −8) を付ける */
export type ZFix = 'none' | 'offset' | 'offset2'
/** mask: 水面を不透明のマゼンタで描く。mask-nodepth: さらに深度テストを切る（計画 D9） */
export type WaterDebug = 'off' | 'mask' | 'mask-nodepth'

export interface Scene {
  name: SceneName
  center: { lon: number; lat: number }
  range: GridRange
  elevation: Float32Array // N × N、行優先（北から、西から）。無効セルは 0
  validMask: Uint8Array
  depth: Float32Array // 固定の水深（m）
  sample: ElevationSampler
  minElevation: number // 有効セルの最低の標高（B の基準。計画 D17）
}

export interface View {
  exaggeration: number
  pitch: number
  zoom: number
}

/** 判定 (1) の 1 地点の記録（Task 2）。位置は CSS 画素、標高は m */
export interface ProbePoint {
  label: string
  lngLat: [number, number]
  simElevation: number // シミュレーションのグリッドの標高（倍率なし）
  terrainElevation: number | null // queryTerrainElevation（倍率込み）
  projected: { x: number; y: number } // map.project（地形を考慮する）
  viaMatrixZ0: { x: number; y: number } | null // mainMatrix、z = 0
  viaMatrixTerrain: { x: number; y: number } | null // z = queryTerrainElevation
  viaMatrixSim: { x: number; y: number } | null // z = シミュレーションの標高 × 倍率
}

export interface ApiProbeResult {
  optionKeys: string[] // CustomRenderMethodInput の実際のキー
  nearZ: number
  farZ: number
  fovRad: number
  mvpEqualsMain: boolean // modelViewProjectionMatrix と defaultProjectionData.mainMatrix が同じか
  centerElevation: number // map.getCenterElevation()
  exaggeration: number
  points: ProbePoint[]
}

/**
 * A' の高さの取り直しの記録（Task 5）。ms はメインスレッドを止めた時間（tech-spec §14.1 の 50ms と比べる）。
 * 視点が変わったとき（setView）の取り直しだけを記録する（R2）
 */
export interface ResampleInfo {
  ms: number
  zoom: number | null // queryTerrainElevation と同じ値を返す DEM のズーム。見つからなければ null
  fallback: boolean // true なら全セルで queryTerrainElevation を呼んだ
  wetCells: number
  maxDiffM: number // 水のあるセルでの |地形の高さ ÷ 倍率 − シミュレーションの標高| の最大（m）
}

/** A の流れの矢印の置き方（Task 5 Step 7）。above: 水面のレイヤーの後、below: 水面のレイヤーの前 */
export type ArrowPlacement = 'none' | 'above' | 'below'

export interface CandidateHandle {
  /** 地形と水面に同じ倍率を掛ける（合格基準 2） */
  setExaggeration(value: number): void
  /** 水深のテクスチャを差し替える（N × N、m） */
  setDepth(depth: Float32Array): void
  setDebug(mode: WaterDebug): void
  /** タイルの読み込みなど、描画の準備が済んで 1 枚描き終えたら解決する */
  whenIdle(): Promise<void>
  /** Custom Layer の render の CPU 時間（ms）。新しいものを末尾に足す（Task 8 が読む） */
  readonly renderTimes: number[]
  /** A・A' だけ。直近の render の引数から判定 (1) の記録を作る。まだ描いていなければ null */
  apiProbe?(): ApiProbeResult | null
  /** A' だけ。直近の高さの取り直しの記録 */
  lastResample?(): ResampleInfo | null
  /** A' だけ。true の間は whenIdle で高さを取り直さない（視点を動かしている間の見え方を測る。Task 5 Step 8） */
  freezeElevation?(frozen: boolean): void
  /** A・A' だけ。流れの矢印の symbol レイヤーを置き直し、描き終えるまで待つ */
  showArrows?(placement: ArrowPlacement, pitchAlignment: 'map' | 'viewport'): Promise<void>
}

export type MountCandidate = (
  map: MapLibreMap,
  scene: Scene,
  params: SpikeParams,
) => Promise<CandidateHandle>

/** 水面の見え方の数値（計画 D9）。画素は drawingBuffer の画素 */
export interface WaterMeasure {
  footprintPx: number // 深度テストなしで描いた水面の画素数
  visibleRatio: number // 深度テストありで見えた画素数 ÷ footprintPx
  interiorPx: number // footprint を 2 画素削った内側の画素数
  flickerRatio: number // 内側のうち、視点をわずかに動かした 3 枚で見え方が変わった画素の割合
}

/**
 * 中央値を基準にした間隔のヒストグラム（再採点用。Task 8 fix round 1、レビュー Important 3）。
 * `Math.round(d / medianMs)` を 1〜5 に丸めた粒度別の生の回数（5 は 5 フレーム分以上をまとめる）
 */
export interface GapHistogram {
  g1: number
  g2: number
  g3: number
  g4: number
  g5plus: number
}

/**
 * fps の計測(Task 8)。frame の間隔は requestAnimationFrame の時刻の差。
 * 先頭 `warmupMs` は統計から除く（fix round 1、レビュー Minor 2: 最初の動き出しの stall を避ける）
 */
export interface FpsResult {
  renderer: string // WEBGL_debug_renderer_info の UNMASKED_RENDERER（SwiftShader か実 GPU か）
  durationMs: number
  warmupMs: number // 統計から除いた先頭の時間（既定 1000ms。fix round 1）
  frames: number
  meanFps: number
  p50Ms: number // 中央値（frame 間隔）。longFrameThresholdMs の基準にも使う
  p95Ms: number
  maxMs: number
  // 長いフレーム = p50Ms（このランの中央値）× 2.5 を超えた間隔（fix round 1、D15 の裁定）。
  // 33.4ms 固定だと float の丸めで正確に 2 フレーム分（33.3〜33.5ms）の間隔が閾値の内外で揺れ、
  // 同じ条件の実行で pass/fail が入れ替わっていた（task-8-review.md Important 3）
  longFrameThresholdMs: number
  longFrameRatio: number // 上の閾値を超えた間隔の割合
  gapHistogram: GapHistogram // 閾値を後から変えて再採点できるよう、粒度別の生の回数も残す
  // Custom Layer の render の CPU 時間（メインスレッドでのテクスチャアップロードの発行を含むが、
  // GPU 側のアップロードや setDepth 内の 1MB コピー〈Worker の onmessage、計測窓の外〉は含まない）
  renderCpuMeanMs: number
  renderCpuP95Ms: number
  renderFrames: number // 計測中に呼ばれた候補の render() の回数（renderTimes の増分）
  depthUpdates: number // 計測中に届いた水深の数（旧 waterFrames）。renderFrames との比が水深の更新率
  roundTripMeanMs: number // 水深の要求から受け取りまで（Worker の計算と転送 2 回）
  devicePixelRatio: number
  canvas: [number, number] // drawingBuffer の画素数
  pass: boolean // 平均 57fps 以上かつ長いフレーム 1% 以下（計画 D15、fix round 1 で長いフレームの定義を改定）
}

/** ページが Playwright と手動の計測に見せる窓口（window.spike） */
export interface SpikeGlobal {
  map: MapLibreMap
  scene: Scene
  params: SpikeParams
  candidate: CandidateHandle | null
  cspViolations: string[]
  setView(view: View): Promise<void>
  /** 候補の水面の見え方を測る（capture=1 のときだけ使える） */
  measure(): Promise<WaterMeasure>
  /** 範囲の外周の段差（m、倍率 1）。継ぎ目の記録に使う（Task 6） */
  boundaryStep(): { max: number; mean: number }
  /** 地図を動かし、water=dynamic なら水深を毎フレーム更新しながら fps を測る */
  runFps(durationMs: number): Promise<FpsResult>
}

declare global {
  interface Window {
    spike?: SpikeGlobal
  }
}
