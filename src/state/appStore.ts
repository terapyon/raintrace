import { createStore, type StoreApi } from 'zustand/vanilla'
import type { DemId } from '../dem/demSources'
import type { TerrainErrorReason, TerrainPayload } from '../shared/protocol'

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
  flowSpacingM: 5 | 10 | 20
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

export interface AppState {
  selected: { lon: number; lat: number } | null
  load: LoadState
  summary: TerrainSummary | null
  display: DisplaySettings
  cursor: CursorElevation | null
}

export interface AppActions {
  selectPoint(lon: number, lat: number): void
  setProgress(done: number, started: number): void
  setTerrain(summary: TerrainSummary): void
  setFailed(reason: LoadFailureReason): void
  setDisplay(patch: Partial<DisplaySettings>): void
  setCursor(cursor: CursorElevation | null): void
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
    display: { elevation: true, depressions: true, flow: true, flowSpacingM: 10 },
    cursor: null,
    selectPoint: (lon, lat) =>
      set({
        selected: { lon, lat },
        load: { status: 'loading', done: 0, started: 0 },
        summary: null,
        cursor: null,
      }),
    setProgress: (done, started) => set({ load: { status: 'loading', done, started } }),
    setTerrain: (summary) => set({ summary, load: { status: 'ready' } }),
    setFailed: (reason) => set({ load: { status: 'failed', reason }, summary: null }),
    setDisplay: (patch) => set((state) => ({ display: { ...state.display, ...patch } })),
    // マウスの移動のたびに呼ばれる。同じ値なら同じ state を返し、購読者（パネル）に知らせない
    setCursor: (cursor) => set((state) => (sameCursor(state.cursor, cursor) ? state : { cursor })),
  }))
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
