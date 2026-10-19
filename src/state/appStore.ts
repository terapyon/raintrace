import { createStore, type StoreApi } from 'zustand/vanilla'
import type { DemId } from '../dem/demSources'
import { DEFAULT_DEBRIS_PRESET_ID } from '../shared/debrisPresets'
import type {
  CollapseRatio,
  DammedSiteSummary,
  FillCandidate,
  TerrainErrorReason,
  TerrainPayload,
} from '../shared/protocol'
import type { StepStats } from '../simulation/types'
import { CLOSED, type Popover } from './clickState'

/** 読み込みの失敗の理由。superseded（新しい地点に置き換わった）は失敗として置かない */
export type LoadFailureReason = Exclude<TerrainErrorReason, 'superseded'>

export type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; done: number; started: number }
  | { status: 'ready' }
  | { status: 'failed'; reason: LoadFailureReason }

export interface DisplaySettings {
  elevation: boolean
  depressions: boolean
  flow: boolean
}

export type CursorElevation =
  | { kind: 'outside' }
  | { kind: 'no-data' }
  | { kind: 'value'; meters: number }

/** パネルに出す小さな値だけ。大きな配列は SimulationClient が持つ（tech-spec §2 原則2） */
export interface TerrainSummary {
  demLevel: 1 | 2 | 3
  breakdown: Partial<Record<DemId, number>>
  cellSizeM: number
  invalidRatio: number
  elevationRange: { min: number; max: number } | null
  depressionCount: number
  largestDepression: { maxDepthM: number; capacityM3: number; spillElevation: number } | null
}

/** 2D と 3D（spec 05 §3.6、R05-1）。保存しない（計画で決めたこと 13） */
export type ViewMode = '2d' | '3d'
/**
 * 3D の状態（View3dSession が入れる）。loading: 3D のコードを読み込み中。fallback-2d: 3D を選んでいるが、
 * 境界より粗いので 2D で描いている（spec 05 §4.3）。error: 3D のコードを読めなかった
 */
export type View3dStatus = 'off' | 'loading' | '3d' | 'fallback-2d' | 'error'

/** 盛土の履歴（spec 09）。保存しない画面の一時状態。off: 切っている。waiting: オンだが計算する地形がまだ無い。loading: 計算中 */
export type FillHistoryStatus =
  | 'off'
  | 'waiting'
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'no-overlap'
  | 'failed'

/** パネルに出す小さな値だけ。大きな配列は FillHistorySession が持つ */
export interface FillHistorySummary {
  offsetM: number
  candidates: FillCandidate[]
  a54Available: boolean
  landformAvailable: boolean
}

export interface FillHistoryState {
  enabled: boolean
  status: FillHistoryStatus
  summary: FillHistorySummary | null
  selectedId: number | null
}

/** 崩れた後の計算の結果のうち、パネルに出す小さな値（spec 10）。大きな配列は CollapseSession が持つ */
export interface CollapseSummary {
  candidateId: number
  ratio: CollapseRatio
  presetId: string
  collapsedM3: number
  depositedM3: number
  outsideM3: number
  dams: DammedSiteSummary[]
}

export type CompareStats = Pick<
  StepStats,
  'maxDepth' | 'floodedArea' | 'storedWater' | 'outflowWater'
>

/** 崩れる前と後の比較の要約（spec 10 §5.3）。どちらも雨が降り終わった時点 */
export interface CompareSummary {
  before: CompareStats
  after: CompareStats
  /** せき止められた場所のセルの、崩れた後の水深の最大。せき止められた場所が無ければ null */
  damMaxDepthM: number | null
  /** 崩れた後は 1 cm 以上・前は 1 cm 未満の面積（m²） */
  newWaterAreaM2: number
}

/**
 * 比べる計算の状態。progress は今の側（side）の進み具合（0〜1）。
 * remainingS は両側の合計の残りの目安（秒）。崩れる前を計算している間は、崩れた後も同じだけかかると見て足す
 * （CollapseSession）。目安が無ければ null
 */
export interface CompareState {
  status: 'idle' | 'running' | 'done' | 'failed'
  side: 'before' | 'after' | null
  progress: number
  remainingS: number | null
  summary: CompareSummary | null
}

/** 崩れたと仮定した場合（spec 10）。保存しない画面の一時状態 */
export interface CollapseState {
  /** 「崩れたと仮定する」を押した候補。null は閉じている */
  candidateId: number | null
  ratio: CollapseRatio
  presetId: string
  status: 'idle' | 'computing' | 'ready' | 'failed'
  progress: number
  summary: CollapseSummary | null
  /** エンジンと地図が表している地形。切り替えが済んでから変わる */
  view: 'before' | 'after'
  /** 崩れる前後の地形の切り替えの途中。この間は再生と比べる操作を受けない（Task 10 が使う） */
  swapping: boolean
  compare: CompareState
}

export const IDLE_COMPARE: CompareState = {
  status: 'idle',
  side: null,
  progress: 0,
  remainingS: null,
  summary: null,
}

export const CLOSED_COLLAPSE: CollapseState = {
  candidateId: null,
  ratio: 1,
  presetId: DEFAULT_DEBRIS_PRESET_ID,
  status: 'idle',
  progress: 0,
  summary: null,
  view: 'before',
  swapping: false,
  compare: IDLE_COMPARE,
}

export interface AppState {
  selected: { lon: number; lat: number } | null
  load: LoadState
  summary: TerrainSummary | null
  display: DisplaySettings
  cursor: CursorElevation | null
  popover: Popover
  viewMode: ViewMode
  view3dStatus: View3dStatus
  fillHistory: FillHistoryState
  /** 今の地形か、昔の地形か（盛土の履歴。保存しない） */
  terrainEpoch: 'now' | 'past'
  collapse: CollapseState
}

export interface AppActions {
  selectPoint(lon: number, lat: number): void
  setProgress(done: number, started: number): void
  setTerrain(summary: TerrainSummary): void
  setFailed(reason: LoadFailureReason): void
  setDisplay(patch: Partial<DisplaySettings>): void
  setCursor(cursor: CursorElevation | null): void
  setPopover(popover: Popover): void
  setViewMode(mode: ViewMode): void
  setView3dStatus(status: View3dStatus): void
  /** false で status 'off'・summary null・selectedId null・terrainEpoch 'now' に戻す */
  setFillHistoryEnabled(enabled: boolean): void
  setFillHistoryResult(status: FillHistoryStatus, summary: FillHistorySummary | null): void
  selectFillCandidate(id: number | null): void
  setTerrainEpoch(epoch: 'now' | 'past'): void
  /** ratio 1、presetId 既定、status idle、view before、compare idle で開く */
  openCollapse(candidateId: number): void
  closeCollapse(): void
  /** 結果があれば捨てる（idle・view before に戻る） */
  setCollapseRatio(ratio: CollapseRatio): void
  /** 結果があれば捨てる（idle・view before に戻る） */
  setCollapsePreset(presetId: string): void
  // 以下は CollapseSession が使う
  setCollapseComputing(): void
  setCollapseProgress(progress: number): void
  setCollapseResult(status: 'ready' | 'failed', summary: CollapseSummary | null): void
  setCollapseView(view: 'before' | 'after'): void
  setCollapseSwapping(swapping: boolean): void
  setCompare(compare: CompareState): void
}

export type AppStore = StoreApi<AppState & AppActions>

/** kind が同じで、標高なら値も同じ。null どうしも同じとみなす */
function sameCursor(a: CursorElevation | null, b: CursorElevation | null): boolean {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false
  return a.kind !== 'value' || (b.kind === 'value' && a.meters === b.meters)
}

/** UI の状態（tech-spec §8.1）。zustand/vanilla で作り、React からは useStore で読む */
export function createAppStore(): AppStore {
  return createStore<AppState & AppActions>()((set) => ({
    selected: null,
    load: { status: 'idle' },
    summary: null,
    display: { elevation: true, depressions: true, flow: true },
    cursor: null,
    popover: CLOSED,
    viewMode: '2d',
    view3dStatus: 'off',
    fillHistory: { enabled: false, status: 'off', summary: null, selectedId: null },
    terrainEpoch: 'now',
    collapse: CLOSED_COLLAPSE,
    selectPoint: (lon, lat) =>
      set((state) => ({
        fillHistory: {
          enabled: state.fillHistory.enabled,
          status: state.fillHistory.enabled ? 'waiting' : 'off',
          summary: null,
          selectedId: null,
        },
        terrainEpoch: 'now',
        collapse: CLOSED_COLLAPSE,
        selected: { lon, lat },
        load: { status: 'loading', done: 0, started: 0 },
        summary: null,
        cursor: null,
        popover: CLOSED,
      })),
    setProgress: (done, started) => set({ load: { status: 'loading', done, started } }),
    setTerrain: (summary) => set({ summary, load: { status: 'ready' } }),
    setFailed: (reason) => set({ load: { status: 'failed', reason }, summary: null }),
    setDisplay: (patch) => set((state) => ({ display: { ...state.display, ...patch } })),
    // マウスの移動のたびに呼ばれる。同じ値なら同じ state を返し、購読者（パネル）に知らせない
    setCursor: (cursor) => set((state) => (sameCursor(state.cursor, cursor) ? state : { cursor })),
    setPopover: (popover) => set({ popover }),
    // 2D に戻すと昔の地形の表示も終わる（昔は 3D だけの表示。spec 09 §4.3）
    setViewMode: (viewMode) =>
      set(viewMode === '2d' ? { viewMode, terrainEpoch: 'now' } : { viewMode }),
    setView3dStatus: (view3dStatus) => set({ view3dStatus }),
    setFillHistoryEnabled: (enabled) =>
      set((state) =>
        enabled
          ? state.fillHistory.enabled
            ? state
            : { fillHistory: { ...state.fillHistory, enabled, status: 'waiting' } }
          : {
              fillHistory: { enabled, status: 'off', summary: null, selectedId: null },
              terrainEpoch: 'now',
              collapse: CLOSED_COLLAPSE,
            },
      ),
    // 候補の一覧が変わったので、前の候補で開いていた「崩れたと仮定した場合」も閉じる
    setFillHistoryResult: (status, summary) =>
      set((state) => ({
        fillHistory: { ...state.fillHistory, status, summary, selectedId: null },
        collapse: CLOSED_COLLAPSE,
      })),
    // 開いている候補と別の候補を選ぶと、「崩れたと仮定した場合」を閉じる
    selectFillCandidate: (selectedId) =>
      set((state) => {
        const open = state.collapse.candidateId
        return {
          fillHistory: { ...state.fillHistory, selectedId },
          ...(open !== null && open !== selectedId ? { collapse: CLOSED_COLLAPSE } : {}),
        }
      }),
    // 崩れた後を表示中は昔の地形を見せない（spec 10 §5.4）
    setTerrainEpoch: (terrainEpoch) =>
      set((state) =>
        terrainEpoch === 'past' && state.collapse.view === 'after' ? state : { terrainEpoch },
      ),
    openCollapse: (candidateId) =>
      set((state) =>
        // 開いている候補をもう一度押しても、計算の結果や設定を消さない
        state.collapse.candidateId === candidateId
          ? state
          : { collapse: { ...CLOSED_COLLAPSE, candidateId } },
      ),
    closeCollapse: () => set({ collapse: CLOSED_COLLAPSE }),
    setCollapseRatio: (ratio) =>
      set((state) =>
        state.collapse.ratio === ratio ? state : { collapse: reopened(state.collapse, { ratio }) },
      ),
    setCollapsePreset: (presetId) =>
      set((state) =>
        state.collapse.presetId === presetId
          ? state
          : { collapse: reopened(state.collapse, { presetId }) },
      ),
    setCollapseComputing: () =>
      set((state) => ({
        collapse: {
          ...state.collapse,
          status: 'computing',
          progress: 0,
          summary: null,
          compare: IDLE_COMPARE,
        },
      })),
    setCollapseProgress: (progress) =>
      set((state) => ({ collapse: { ...state.collapse, progress } })),
    setCollapseResult: (status, summary) =>
      set((state) => ({
        collapse: { ...state.collapse, status, summary, progress: status === 'ready' ? 1 : 0 },
      })),
    setCollapseView: (view) =>
      set((state) => ({
        collapse: { ...state.collapse, view },
        // 崩れた後へ入るときは今に戻す（3D の昔の標高を、地形の差し替えより先に外す）
        ...(view === 'after' ? { terrainEpoch: 'now' as const } : {}),
      })),
    setCollapseSwapping: (swapping) =>
      set((state) =>
        state.collapse.swapping === swapping
          ? state
          : { collapse: { ...state.collapse, swapping } },
      ),
    setCompare: (compare) => set((state) => ({ collapse: { ...state.collapse, compare } })),
  }))
}

/** 同じ候補で、結果を捨てて開き直す（割合・プリセットの変更） */
function reopened(
  collapse: CollapseState,
  patch: Partial<Pick<CollapseState, 'ratio' | 'presetId'>>,
): CollapseState {
  return {
    ...CLOSED_COLLAPSE,
    candidateId: collapse.candidateId,
    ratio: collapse.ratio,
    presetId: collapse.presetId,
    ...patch,
  }
}

export function summarizeTerrain(terrain: TerrainPayload): TerrainSummary {
  const shown = terrain.depressions.filter((d) => d.significant)
  let largest: (typeof shown)[number] | null = null
  for (const d of shown) {
    if (largest === null || d.capacityM3 > largest.capacityM3) largest = d
  }
  return {
    demLevel: terrain.geo.level,
    breakdown: terrain.geo.breakdown,
    cellSizeM: terrain.geo.cellSizeM,
    invalidRatio: terrain.geo.invalidRatio,
    elevationRange: terrain.elevationRange,
    depressionCount: shown.length,
    largestDepression:
      largest === null
        ? null
        : {
            maxDepthM: largest.maxDepthM,
            capacityM3: largest.capacityM3,
            spillElevation: largest.spillElevation,
          },
  }
}
