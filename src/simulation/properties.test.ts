import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { massTolerance } from './constants.ts'
import type { ScanMode, TsSimulationEngine } from './TsSimulationEngine.ts'
import { buildTerrain, engineOn, sameBits, type Terrain } from './testing/fixtures.ts'
import type { RainfallInput, StepStats } from './types.ts'

interface Scenario {
  terrain: Terrain
  /** atStep 回目の step の前に降らせる */
  rains: { atStep: number; rain: RainfallInput }[]
  steps: number
}

const MAX_SIDE = 16
const KINDS = ['flat', 'slope', 'pits', 'bumpy'] as const

/** 地形: 平坦・斜面・複数の窪地・ランダムな凹凸に、無効セルを混ぜる（spec 03 §6.2） */
const terrainArb: fc.Arbitrary<Terrain> = fc
  .record({
    width: fc.integer({ min: 3, max: MAX_SIDE }),
    height: fc.integer({ min: 3, max: MAX_SIDE }),
    cellSizeM: fc.constantFrom(0.98, 3.9, 7.8),
    kind: fc.constantFrom(...KINDS),
    a: fc.double({ min: -1, max: 1, noNaN: true }),
    b: fc.double({ min: -1, max: 1, noNaN: true }),
    noise: fc.array(fc.integer({ min: 0, max: 1000 }), {
      minLength: MAX_SIDE * MAX_SIDE,
      maxLength: MAX_SIDE * MAX_SIDE,
    }),
    invalidPercent: fc.constantFrom(0, 0, 10, 30),
  })
  .map(({ width, height, cellSizeM, kind, a, b, noise, invalidPercent }) => {
    const t = buildTerrain(width, height, cellSizeM, (x, y) => {
      const i = y * width + x
      if ((noise[(i * 7919) % noise.length] ?? 0) % 100 < invalidPercent) return Number.NaN
      switch (kind) {
        case 'flat':
          return 10
        case 'slope':
          return 10 + a * x + b * y
        case 'pits':
          return 10 + (Math.abs(a) + 0.2) * Math.sin(x * 1.3) * Math.cos(y * 1.1)
        case 'bumpy':
          return 10 + ((noise[i] ?? 0) / 1000) * (Math.abs(b) * 5 + 0.01)
      }
    })
    // 有効セルが 1 つも無い地形は降雨できないので、左上を有効にする
    if (t.validMask.every((v) => v === 0)) {
      t.validMask[0] = 1
      t.elevation[0] = 10
    }
    return t
  })

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    terrain: terrainArb,
    steps: fc.integer({ min: 1, max: 200 }),
    rains: fc.array(
      fc.record({
        atStep: fc.nat(),
        cell: fc.nat(),
        radiusCells: fc.double({ min: 0.1, max: 8, noNaN: true }),
        amountMm: fc.integer({ min: 1, max: 1000 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })
  .map(({ terrain, steps, rains }) => {
    const valid: number[] = []
    terrain.validMask.forEach((v, i) => {
      if (v !== 0) valid.push(i)
    })
    const { width, cellSizeM } = terrain.meta
    return {
      terrain,
      steps,
      // 降雨中心は有効セルの中心に置く（「降雨中心に標高データがありません」にしない）
      rains: rains.map((r) => {
        const c = valid[r.cell % valid.length] ?? 0
        return {
          atStep: r.atStep % steps,
          rain: {
            x: ((c % width) + 0.5) * cellSizeM,
            y: (Math.floor(c / width) + 0.5) * cellSizeM,
            radiusM: r.radiusCells * cellSizeM,
            amountMm: r.amountMm,
          },
        }
      }),
    }
  })

/**
 * 局所的な最大値原理の検査（spec 03 §6.2）。有効セル i の次の水面標高が、i 自身と 8 近傍の今の
 * 水面標高の最小・最大の間（丸め誤差 1e-9 m を許す）に無ければ、その説明を返す。
 * 近傍の定義はエンジンから借りず、§3.3 から独立に書く（グリッドの外と無効セルは、標高 Z_i・水深 0）
 */
function maxPrincipleViolation(
  t: Terrain,
  before: Float64Array,
  after: Float64Array,
): string | null {
  const { elevation, validMask, meta } = t
  const { width, height } = meta
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (validMask[i] === 0) continue
      const zi = elevation[i] ?? 0
      let lo = zi + (before[i] ?? 0)
      let hi = lo
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          const j = ny * width + nx
          const real = nx >= 0 && nx < width && ny >= 0 && ny < height && validMask[j] !== 0
          const h = real ? (elevation[j] ?? 0) + (before[j] ?? 0) : zi
          if (h < lo) lo = h
          if (h > hi) hi = h
        }
      }
      const next = zi + (after[i] ?? 0)
      if (next < lo - 1e-9 || next > hi + 1e-9) {
        return `セル (${x}, ${y}): 次の水面標高 ${next} が [${lo}, ${hi}] の外`
      }
    }
  }
  return null
}

/** 統計の数値を Float64Array に詰める。sameBits で +0 と −0 まで区別して比べるため */
function packStats(list: StepStats[]): Float64Array {
  const fields = 8
  const out = new Float64Array(list.length * fields)
  list.forEach((s, n) => {
    out.set(
      [
        s.step,
        s.totalWater,
        s.storedWater,
        s.outflowWater,
        s.maxDepth,
        s.floodedArea,
        s.settled ? 1 : 0,
        s.massError,
      ],
      n * fields,
    )
  })
  return out
}

/** シナリオを実行し、各 step の後に onStep を呼ぶ。before は step の前の水深の複製 */
function run(
  s: Scenario,
  scanMode: ScanMode,
  onStep: (engine: TsSimulationEngine, stats: StepStats, before: Float64Array) => void,
): TsSimulationEngine {
  const engine = engineOn(s.terrain, { scanMode })
  for (let n = 0; n < s.steps; n++) {
    for (const r of s.rains) if (r.atStep === n) engine.addRainfall(r.rain)
    const before = engine.waterDepth().slice()
    const stats = engine.step()
    onStep(engine, stats, before)
  }
  return engine
}

describe('性質のテスト（spec 03 §6.2、tech-spec §11.3）', () => {
  it('質量保存: 各 step で |massError| ≤ totalWater × 1e-9', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (_, stats) => {
          expect(Math.abs(stats.massError)).toBeLessThanOrEqual(massTolerance(stats.totalWater))
        })
      }),
    )
  })

  it('非負: すべての step で W ≥ 0', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (engine) => {
          expect(engine.waterDepth().every((d) => d >= 0)).toBe(true)
        })
      }),
    )
  })

  it('局所的な最大値原理: 次の水面標高は、自身と 8 近傍の今の水面標高の範囲に入る', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (engine, _, before) => {
          expect(maxPrincipleViolation(s.terrain, before, engine.waterDepth())).toBeNull()
        })
      }),
    )
  })

  it('決定性: 同じ入力を 2 回実行すると W がビット単位で一致する', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const a = run(s, 'bbox', () => {})
        const b = run(s, 'bbox', () => {})
        expect(sameBits(a.waterDepth(), b.waterDepth())).toBe(true)
      }),
    )
  })

  it("走査範囲: scanMode 'bbox' と 'full' で W と統計がビット単位で一致する", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const statsFull: StepStats[] = []
        const full = run(s, 'full', (_, stats) => statsFull.push(stats))
        const statsBbox: StepStats[] = []
        const bbox = run(s, 'bbox', (_, stats) => statsBbox.push(stats))
        expect(sameBits(bbox.waterDepth(), full.waterDepth())).toBe(true)
        expect(sameBits(packStats(statsBbox), packStats(statsFull))).toBe(true)
        expect(statsBbox).toStrictEqual(statsFull)
      }),
    )
  })
})
