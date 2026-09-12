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
}

export type MountCandidate = (
  map: MapLibreMap,
  scene: Scene,
  params: SpikeParams,
) => Promise<CandidateHandle>

/** ページが Playwright と手動の計測に見せる窓口（window.spike） */
export interface SpikeGlobal {
  map: MapLibreMap
  scene: Scene
  params: SpikeParams
  candidate: CandidateHandle | null
  cspViolations: string[]
  setView(view: View): Promise<void>
}

declare global {
  interface Window {
    spike?: SpikeGlobal
  }
}
