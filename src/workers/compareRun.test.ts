import { describe, expect, it } from 'vitest'
import type { SwapGrid } from '../shared/protocol'
import { CELL, SIZE, valleyWithFill } from '../simulation/debris/testTerrain.test-support.ts'
import type { RainfallInput } from '../simulation/types'
import { CompareCancelledError, runToRainEnd } from './compareRun'

const rain: RainfallInput = {
  x: 0,
  y: 0,
  radiusM: 0,
  intensityMmPerH: 60,
  durationS: 120,
  wholeRange: true,
}

function grid(): SwapGrid {
  const { grid: g } = valleyWithFill(6)
  return {
    elevation: g.elevation,
    validMask: g.validMask,
    size: SIZE,
    cellSizeM: CELL,
    depressions: [],
  }
}

describe('runToRainEnd', () => {
  it('止まった時点の stats.timeS が雨の継続時間に等しく、raining は false', async () => {
    const side = await runToRainEnd(grid(), rain, new AbortController().signal, () => {})
    expect(side.stats.raining).toBe(false)
    expect(side.stats.timeS).toBeCloseTo(rain.durationS, 6)
    expect(side.depth).toBeInstanceOf(Float32Array)
    expect(side.depth.length).toBe(SIZE * SIZE)
  })

  it('質量の保存（雨 = 溜まった水 + 流出。spec 7.1 の回帰）', async () => {
    const { stats, depth } = await runToRainEnd(
      grid(),
      rain,
      new AbortController().signal,
      () => {},
    )
    const expectedM3 = (rain.intensityMmPerH / 1000 / 3600) * rain.durationS * (SIZE * CELL) ** 2
    expect(stats.totalWater).toBeCloseTo(expectedM3, 3)
    expect(stats.storedWater + stats.outflowWater).toBeCloseTo(stats.totalWater, 3)
    expect(Math.abs(stats.massError)).toBeLessThan(1e-6 * stats.totalWater)
    const depthSum = depth.reduce((a, b) => a + b, 0) * CELL * CELL
    expect(depthSum).toBeCloseTo(stats.storedWater, 1)
  })

  it('signal を取り消すと途中で reject し、進み具合も止まる', async () => {
    const controller = new AbortController()
    let calls = 0
    const run = runToRainEnd(
      grid(),
      { ...rain, durationS: 3600 },
      controller.signal,
      () => {
        calls++
        controller.abort()
      },
      { sliceMs: 0, progressMs: 0 },
    )
    await expect(run).rejects.toBeInstanceOf(CompareCancelledError)
    // 取り消した後は、譲った直後に打ち切るので進み具合は追加で出ない
    expect(calls).toBe(1)
  })

  it('取り消し済みの signal では、エンジンを作らずに reject する', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(runToRainEnd(grid(), rain, controller.signal, () => {})).rejects.toBeInstanceOf(
      CompareCancelledError,
    )
  })

  it('進み具合は 0 から 1 の間で、見込みの残り時間は null か 0 以上', async () => {
    const seen: Array<[number, number | null]> = []
    await runToRainEnd(grid(), rain, new AbortController().signal, (f, r) => seen.push([f, r]), {
      sliceMs: 5,
      progressMs: 0,
    })
    expect(seen.length).toBeGreaterThan(0)
    for (const [f, r] of seen) {
      expect(f).toBeGreaterThan(0)
      expect(f).toBeLessThanOrEqual(1)
      if (r !== null) expect(r).toBeGreaterThanOrEqual(0)
    }
  })
})
