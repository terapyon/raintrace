import type { Basemap } from '../basemapStyle'
import type { DemSourceKind } from './demSource'

/** 地形のタイルを作る場所（計画で決めたこと 11。Task 6 の結果で決める） */
export type TileGeneration = 'main'
/** hillshade（計画で決めたこと 12）。auto は淡色・標準で付け、写真では付けない */
export type HillshadeOption = 'auto' | 'on' | 'off'

/** タイル 1 枚の記録（計測用）。cached は組み立て済みのタイルを使い回した（組み立てていない） */
export interface TileTimeSample {
  source: DemSourceKind
  composeMs: number
  cached: boolean
}

export interface View3dOptions {
  tileGeneration: TileGeneration
  hillshade: HillshadeOption
  /** 水面を描くか。false は計測の「地形のみ」の基準（spec 05 §4.4） */
  water: boolean
  /** 計測用（perfHook）。水面の render の CPU の時間（ms） */
  onRenderTime: ((ms: number) => void) | null
  /** 計測用。タイル 1 枚の組み立ての時間（ソースごと） */
  onTileTime: ((sample: TileTimeSample) => void) | null
  /** 計測用。3D の準備（範囲の無効セルの埋め方）の時間（ms） */
  onPrepareTime: ((ms: number) => void) | null
  /** 計測用。水面のメッシュとテクスチャの作成の時間（ms。Task 8） */
  onWaterBuildTime: ((ms: number) => void) | null
}

export const DEFAULT_VIEW3D_OPTIONS: View3dOptions = {
  tileGeneration: 'main',
  hillshade: 'auto',
  water: true,
  onRenderTime: null,
  onTileTime: null,
  onPrepareTime: null,
  onWaterBuildTime: null,
}

export function hillshadeEnabled(option: HillshadeOption, basemap: Basemap): boolean {
  if (option === 'auto') return basemap !== 'photo'
  return option === 'on'
}
