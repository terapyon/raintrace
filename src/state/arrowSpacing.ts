import type { RangeSizeM } from './persistedSettings'

/** 選べる矢印の間隔（5・10・20 m）の基準の範囲（spec 05 §3.3。1 辺の本数を 500 m の既定にそろえる） */
export const ARROW_REFERENCE_SIZE_M = 500

/**
 * 実際の矢印の間隔（m）= 選んだ間隔 × 範囲 ÷ 500。1000 m の既定（10）は 20 m、250 m は 5 m。
 * 水の流れと地形の流向の両方、2D と 3D のどちらにも使う（計画で決めたこと 18）
 */
export function arrowSpacingForRange(baseM: number, sizeM: RangeSizeM): number {
  return (baseM * sizeM) / ARROW_REFERENCE_SIZE_M
}
