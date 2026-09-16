import type { Basemap } from '../basemapStyle'
import type { DemSourceKind } from './demSource'

/** hillshade（計画で決めたこと 12）。auto は淡色・標準で付け、写真では付けない */
export type HillshadeOption = 'auto' | 'on' | 'off'

/** タイル 1 枚の記録（計測用）。cached は組み立て済みのタイルを使い回した（組み立てていない） */
export interface TileTimeSample {
  source: DemSourceKind
  composeMs: number
  cached: boolean
}

export interface View3dOptions {
  hillshade: HillshadeOption
  /** 水面を描くか。false は計測の「地形のみ」の基準（spec 05 §4.4） */
  water: boolean
  /**
   * (c) 境界より粗いときに 2D に落とすか（spec 05 §4.3）。計測（perfHook の fallback=0）で S の視点
   * （z16 ×10 p85 は画面の中心のタイルが 14）を 3D のまま測るときだけ false にする
   */
  boundaryFallback: boolean
  /**
   * 計測用（perfHook）。水面の render の CPU の時間（ms）。これを呼ぶのは水面の Custom Layer。
   * 呼び出し元は Task 8 で入り、Task 9 の実測は 0.149〜0.416 ms だった
   */
  onRenderTime: ((ms: number) => void) | null
  /** 計測用。タイル 1 枚の組み立ての時間（ソースごと） */
  onTileTime: ((sample: TileTimeSample) => void) | null
  /** 計測用。3D の準備（範囲の無効セルの埋め方）の時間（ms） */
  onPrepareTime: ((ms: number) => void) | null
  /** 計測用。水面のメッシュとテクスチャの作成の時間（ms。Task 8） */
  onWaterBuildTime: ((ms: number) => void) | null
}

export const DEFAULT_VIEW3D_OPTIONS: View3dOptions = {
  hillshade: 'auto',
  water: true,
  boundaryFallback: true,
  onRenderTime: null,
  onTileTime: null,
  onPrepareTime: null,
  onWaterBuildTime: null,
}

export function hillshadeEnabled(option: HillshadeOption, basemap: Basemap): boolean {
  if (option === 'auto') return basemap !== 'photo'
  return option === 'on'
}
