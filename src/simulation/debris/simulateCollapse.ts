/**
 * 盛土が崩れた後の地形を作る（spec 10 §3.2）。粒の経路・到達・堆積（runout）のあと、積もった土の形を
 * 整える（settleDeposit）。積もった土が谷をふさぐと、上流に窪地ができる（せき止めを許す。R10-2）
 */
import { DEBRIS_SEED } from './constants.ts'
import { type DebrisGrid, type DebrisParams, type RunoutResult, runout } from './runout.ts'
import { settleDeposit } from './settle.ts'

export interface CollapseResult extends RunoutResult {
  /** 崩れた厚さ（m）。無効なセルと 0 以下の値は 0 */
  removed: Float32Array
  /** 崩れた後の地形 = elevation − removed + deposit */
  after: Float32Array
}

export function simulateCollapse(
  grid: DebrisGrid,
  removed: Float32Array,
  params: DebrisParams,
  seed: number = DEBRIS_SEED,
): CollapseResult {
  const { elevation, validMask, size, cellSizeM } = grid
  const n = size * size
  const cellArea = cellSizeM * cellSizeM

  // runout と同じく、無効なセルと 0 以下の値は崩れない
  const removedClean = new Float32Array(n)
  const base = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = removed[i] ?? 0
    if (validMask[i] !== 0 && t > 0) removedClean[i] = t
    base[i] = elevation[i] - removedClean[i]
  }

  const result = runout(grid, removedClean, params, seed)
  const { deposit } = result
  settleDeposit(base, deposit, validMask, size, cellSizeM, params.reposeDeg)

  const after = new Float32Array(n)
  let depositedM3 = 0
  for (let i = 0; i < n; i++) {
    after[i] = base[i] + deposit[i]
    depositedM3 += deposit[i] * cellArea
  }

  return { ...result, depositedM3, removed: removedClean, after }
}
