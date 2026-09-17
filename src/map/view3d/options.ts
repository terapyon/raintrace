import type { WaterDebug } from '../../renderer/waterLayer'
import type { Basemap } from '../basemapStyle'
import type { DemSourceKind } from './demSource'

export type { WaterDebug }

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
   * (c) 境界より粗いときに 2D に落とすか（spec 05 §4.3）。計測（perfHook の fallback=0）で S の視点を
   * 3D のまま測るときだけ false にする。z16 ×10 p85 の実測は描かれるタイル 16 で 2D には落ちないが
   * （「中心のタイルが 14」は pitch つきの見込みで、実測で否定された）、計測の途中で境界を割らないための保険
   */
  boundaryFallback: boolean
  /**
   * 水深のテクスチャを何回の更新に 1 回転送するか。省略は 1（毎回）。計測の depthEvery=N（spec 06 §5.1）。
   * 既定の値に入れないのは、初期ロードのチャンク（index）を変えないため
   */
  depthUploadEvery?: number
  /**
   * 計測用（perfHook）。水面の render の CPU の時間（ms）。これを呼ぶのは水面の Custom Layer。
   * 呼び出し元は Task 8 で入り、Task 9 の実測は条件ごとの中央値で 0.149〜0.416 ms（ランごとの値は 0.137〜0.463 ms）だった
   */
  onRenderTime: ((ms: number) => void) | null
  /** 計測用。タイル 1 枚の組み立ての時間（ソースごと） */
  onTileTime: ((sample: TileTimeSample) => void) | null
  /** 計測用。3D の準備（範囲の無効セルの埋め方）の時間（ms） */
  onPrepareTime: ((ms: number) => void) | null
  /** 計測用。水面のメッシュとテクスチャの作成の時間（ms。Task 8） */
  onWaterBuildTime: ((ms: number) => void) | null
  /**
   * 計測用（probe=water。spec 06 §3）。水面を作ったときに setDebug を、外したときに null を渡す。
   * 省略は受け口なし
   */
  onWaterDebug?: (setDebug: ((debug: WaterDebug) => void) | null) => void
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
