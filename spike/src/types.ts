import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GridRange } from '../../src/dem/gridRange.ts'
import type { SpikeParams } from './params'

/** z17 のグローバルピクセル（整数）→ 標高（m）。null は無効値（計画 D5） */
export type ElevationSampler = (gx: number, gy: number) => number | null

export type SceneName = 'synthetic' | 'real'
export type WaterMode = 'fixed' | 'film' | 'dynamic'
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
}

declare global {
  interface Window {
    spike?: SpikeGlobal
  }
}
