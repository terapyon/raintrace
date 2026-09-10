import { describe, expect, it } from 'vitest'
import { SPILL_TOLERANCE_M } from './constants.ts'
import type { TsSimulationEngine } from './TsSimulationEngine.ts'
import { buildTerrain, cellCenter, engineOn, walledBasin } from './testing/fixtures.ts'
import type { SimulationEvent } from './types.ts'

// 7 × 7 の盆地（床 0m、縁 10m、床は列・行 1〜5 の 25m²）。中央のセルを最低点、spill 標高 0.3m とする手組みの窪地
const BASIN = walledBasin(7, 0, 10)
const PIT = 3 * 7 + 3
const SPILL = 0.3

function setup(): TsSimulationEngine {
  const engine = engineOn(BASIN)
  engine.setDepressions([{ id: 7, pitIndex: PIT, spillElevation: SPILL }])
  return engine
}

/** 床全体（25 セル）に、平衡の水位が level になる量の雨を一様に降らせる。半径 2.9m は床の 25 セルだけを含む */
function rainOnFloor(engine: TsSimulationEngine, level: number): void {
  const amountMm = (level * 25 * 1000) / (Math.PI * 2.9 * 2.9)
  engine.addRainfall({ ...cellCenter(3, 3, 1), radiusM: 2.9, amountMm })
}

/** 床の北西の角のセル 1 つに、平衡の水位が level になる量の雨を降らせる */
function rainOnCorner(engine: TsSimulationEngine, level: number): void {
  const amountMm = (level * 25 * 1000) / (Math.PI * 0.4 * 0.4)
  engine.addRainfall({ ...cellCenter(1, 1, 1), radiusM: 0.4, amountMm })
}

/** steps 回まわして、出たイベントを集める */
function collect(engine: TsSimulationEngine, steps: number): SimulationEvent[] {
  const events: SimulationEvent[] = []
  for (let n = 0; n < steps; n++) events.push(...engine.step().events)
  return events
}

describe('越流イベント（spec 03 §3.7）', () => {
  it('最低点の水面標高が spill 標高 − 1cm に届かなければ通知しない', () => {
    const engine = setup()
    rainOnFloor(engine, 0.28)
    expect(collect(engine, 3000)).toEqual([])
  })

  it('届いた step で 1 回だけ通知し、その後は通知しない', () => {
    const engine = setup()
    rainOnCorner(engine, 0.35)
    const events: SimulationEvent[] = []
    let reachedAt = -1
    for (let n = 0; n < 3000; n++) {
      const s = engine.step()
      events.push(...s.events)
      const h = (BASIN.elevation[PIT] ?? 0) + (engine.waterDepth()[PIT] ?? 0)
      if (reachedAt < 0 && h >= SPILL - SPILL_TOLERANCE_M) reachedAt = s.step
    }
    expect(reachedAt).toBeGreaterThan(1)
    expect(events).toEqual([
      { type: 'spill', step: reachedAt, depressionId: 7, spillElevation: SPILL },
    ])
  })

  it('雨が窪地の端に局所的に溜まって spill 標高を超えても、最低点の水位が届かなければ通知しない', () => {
    const engine = setup()
    // 角のセルの水深ははじめ約 1.25m（spill 標高を大きく超える）。平衡の水位は 0.05m
    rainOnCorner(engine, 0.05)
    expect(collect(engine, 3000)).toEqual([])
  })

  it('reset で通知済みの記録が消え、もう一度通知する', () => {
    const engine = setup()
    rainOnFloor(engine, 0.35)
    expect(collect(engine, 10)).toHaveLength(1)
    engine.reset()
    rainOnFloor(engine, 0.35)
    expect(collect(engine, 10)).toHaveLength(1)
  })

  it('setDepressions で渡し直すと通知済みの記録も新しくなり、loadTerrain で窪地は消える', () => {
    const engine = setup()
    rainOnFloor(engine, 0.35)
    expect(collect(engine, 10)).toHaveLength(1)
    engine.setDepressions([{ id: 8, pitIndex: PIT, spillElevation: SPILL }])
    expect(collect(engine, 1).map((e) => e.depressionId)).toEqual([8])
    engine.loadTerrain(BASIN.elevation, BASIN.validMask, BASIN.meta)
    rainOnFloor(engine, 0.35)
    expect(collect(engine, 10)).toEqual([])
  })

  it('最低点のセル番号が範囲外か整数でなければ RangeError', () => {
    const engine = engineOn(BASIN)
    const bad = [
      { id: 1, pitIndex: 49, spillElevation: 1 },
      { id: 1, pitIndex: -1, spillElevation: 1 },
      { id: 1, pitIndex: 1.5, spillElevation: 1 },
    ]
    for (const d of bad) expect(() => engine.setDepressions([d])).toThrow(RangeError)
  })

  it('最低点が無効セルなら RangeError', () => {
    const t = buildTerrain(7, 7, 1, (x, y) => (x === 3 && y === 3 ? Number.NaN : 0))
    const engine = engineOn(t)
    expect(() => engine.setDepressions([{ id: 1, pitIndex: PIT, spillElevation: 1 }])).toThrow(
      RangeError,
    )
  })

  it('spill 標高が有限でなければ RangeError', () => {
    const engine = engineOn(BASIN)
    for (const spillElevation of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => engine.setDepressions([{ id: 1, pitIndex: PIT, spillElevation }])).toThrow(
        RangeError,
      )
    }
  })

  it('深さ 5mm の窪地は、雨なしでは通知せず、最低点に水が届いた後の step で 1 回だけ通知する', () => {
    const engine = engineOn(BASIN)
    const spillElevation = (BASIN.elevation[PIT] ?? 0) + 0.005
    engine.setDepressions([{ id: 9, pitIndex: PIT, spillElevation }])
    expect(collect(engine, 10)).toEqual([])
    rainOnFloor(engine, 0.35)
    const events = collect(engine, 3000)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'spill', depressionId: 9, spillElevation })
  })
})
