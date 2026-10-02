import type { DisplayStats } from './simulationStore'

/** テスト用: 画面に出す統計。既定はすべて 0（Step 0・雨なし・止まっていない）。必要な項目だけ上書きする */
export function displayStats(overrides: Partial<DisplayStats> = {}): DisplayStats {
  return {
    step: 0,
    totalWater: 0,
    storedWater: 0,
    outflowWater: 0,
    maxDepth: 0,
    floodedArea: 0,
    settled: false,
    massError: 0,
    timeS: 0,
    dtS: 0,
    raining: false,
    rainDepthMm: 0,
    outflowRateM3PerS: 0,
    stopReason: null,
    ...overrides,
  }
}
