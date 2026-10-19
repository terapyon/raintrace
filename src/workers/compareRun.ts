import type { CompareSide, SwapGrid } from '../shared/protocol'
import { TsSimulationEngine } from '../simulation/TsSimulationEngine'
import type { RainfallInput } from '../simulation/types'

/** signal が取り消されて計算を打ち切ったときの例外 */
export class CompareCancelledError extends Error {
  constructor() {
    super('比較の計算が取り消されました')
    this.name = 'CompareCancelledError'
  }
}

export interface RunTiming {
  /** 約この時間ごとに setTimeout(0) で譲り、signal を見る（ms） */
  sliceMs: number
  /** 進み具合を知らせる間隔（ms）。実時間で数える */
  progressMs: number
}

export const DEFAULT_RUN_TIMING: RunTiming = { sliceMs: 50, progressMs: 500 }

/**
 * 1 つの地形を、雨が降り終わる時点（stats.raining が false になった最初の step。そこで timeS は雨の終わりちょうど。
 * scripts/bench-engine.ts と同じ判定）まで計算する。再生用とは別のエンジンを作る（spec 10 §5.3）。
 * 譲るたびに signal を見て、取り消されていたら CompareCancelledError で reject する（以後 onProgress も呼ばない）。
 * step ごとの追加の確保はしない（時計の読みと比較だけ）
 */
export async function runToRainEnd(
  grid: SwapGrid,
  rain: RainfallInput,
  signal: AbortSignal,
  onProgress: (fraction: number, remainingS: number | null) => void,
  timing: RunTiming = DEFAULT_RUN_TIMING,
): Promise<CompareSide> {
  if (signal.aborted) throw new CompareCancelledError()
  const engine = new TsSimulationEngine()
  engine.loadTerrain(grid.elevation, grid.validMask, {
    width: grid.size,
    height: grid.size,
    cellSizeM: grid.cellSizeM,
  })
  // setDepressions は loadTerrain の後。越流イベントの対象は表示と同じ significant のもの
  engine.setDepressions(grid.depressions.filter((d) => d.significant))
  engine.setRainfall(rain)

  let sliceStart = performance.now()
  let lastProgressWall = sliceStart
  let lastProgressSimS = 0
  for (;;) {
    const stats = engine.step()
    if (!stats.raining || stats.stopReason !== null) {
      return { depth: Float32Array.from(engine.waterDepth()), stats }
    }
    const now = performance.now()
    if (now - lastProgressWall >= timing.progressMs) {
      const wallS = (now - lastProgressWall) / 1000
      const rate = wallS > 0 ? (stats.timeS - lastProgressSimS) / wallS : 0
      const remainingS = rate > 0 ? Math.max(0, (rain.durationS - stats.timeS) / rate) : null
      lastProgressWall = now
      lastProgressSimS = stats.timeS
      onProgress(Math.min(1, stats.timeS / rain.durationS), remainingS)
    }
    if (now - sliceStart >= timing.sliceMs) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      if (signal.aborted) throw new CompareCancelledError()
      sliceStart = performance.now()
    }
  }
}
