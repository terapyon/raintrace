import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CFL_ALPHA, DT_MAX_S, GRAVITY, massTolerance } from './constants.ts'
import type { ScanMode, TsSimulationEngine } from './TsSimulationEngine.ts'
import { analyzeDepressions } from './terrain/analyzeDepressions.ts'
import { buildTerrain, engineOn, sameBits, type Terrain } from './testing/fixtures.test-support.ts'
import type { RainfallInput, StepStats } from './types.ts'

const MAX_SIDE = 16
const KINDS = ['flat', 'slope', 'pits', 'bumpy', 'cliff'] as const

/**
 * 標高と水面を 1/256 m の格子に載せる（spec 08 §9.2 (b)）。|値| < 2^15 m なら、Float32 の標高・η0 − Z・Z + h が
 * すべて丸めなしで表せ、静水の保存をビット単位で確かめられる
 */
const snap = (v: number): number => Math.round(v * 256) / 256

/**
 * 地形: 平坦・斜面・複数の窪地・ランダムな凹凸・1 セルで 3 m 下がる段差（擁壁・崖）に、無効セルを混ぜる
 * （spec 08 §9.2）。標高は 1/256 m の格子に載せる
 */
const terrainArb: fc.Arbitrary<Terrain> = fc
  .record({
    width: fc.integer({ min: 3, max: MAX_SIDE }),
    height: fc.integer({ min: 3, max: MAX_SIDE }),
    cellSizeM: fc.constantFrom(0.98, 3.9, 7.8),
    kind: fc.constantFrom(...KINDS),
    a: fc.double({ min: -1, max: 1, noNaN: true }),
    b: fc.double({ min: -1, max: 1, noNaN: true }),
    cliffX: fc.integer({ min: 1, max: MAX_SIDE - 1 }),
    noise: fc.array(fc.integer({ min: 0, max: 1000 }), {
      minLength: MAX_SIDE * MAX_SIDE,
      maxLength: MAX_SIDE * MAX_SIDE,
    }),
    invalidPercent: fc.constantFrom(0, 0, 10, 30),
  })
  .map(({ width, height, cellSizeM, kind, a, b, cliffX, noise, invalidPercent }) => {
    const cliff = Math.min(cliffX, width - 1)
    const t = buildTerrain(width, height, cellSizeM, (x, y) => {
      const i = y * width + x
      if ((noise[(i * 7919) % noise.length] ?? 0) % 100 < invalidPercent) return Number.NaN
      switch (kind) {
        case 'flat':
          return 10
        case 'slope':
          return snap(10 + a * x + b * y)
        case 'pits':
          return snap(10 + (Math.abs(a) + 0.2) * Math.sin(x * 1.3) * Math.cos(y * 1.1))
        case 'bumpy':
          return snap(10 + ((noise[i] ?? 0) / 1000) * (Math.abs(b) * 5 + 0.01))
        case 'cliff':
          return snap(x < cliff ? 13 + 0.01 * (cliff - x) : 10 + 0.01 * (width - x))
      }
    })
    // 有効セルが 1 つも無い地形は降雨できないので、左上を有効にする
    if (t.validMask.every((v) => v === 0)) {
      t.validMask[0] = 1
      t.elevation[0] = 10
    }
    return t
  })

interface Scenario {
  terrain: Terrain
  rain: RainfallInput
  steps: number
}

/** 雨: 一度に置くもの（durationS = 0）と、継続時間のあるもの（強さ・時間・範囲全体をランダム） */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    terrain: terrainArb,
    steps: fc.integer({ min: 1, max: 200 }),
    cell: fc.nat(),
    radiusCells: fc.double({ min: 0.1, max: 8, noNaN: true }),
    intensityMmPerH: fc.integer({ min: 1, max: 300 }),
    durationS: fc.constantFrom(0, 3.5, 30, 120, 600),
    wholeRange: fc.boolean(),
  })
  .map(({ terrain, steps, cell, radiusCells, intensityMmPerH, durationS, wholeRange }) => {
    const valid: number[] = []
    terrain.validMask.forEach((v, i) => {
      if (v !== 0) valid.push(i)
    })
    const { width, height, cellSizeM } = terrain.meta
    // 降雨中心は有効セルの中心に置く（「降雨中心に標高データがありません」にしない）。半径の上限は planRainfall の検査
    const c = valid[cell % valid.length] ?? 0
    return {
      terrain,
      steps,
      rain: {
        x: ((c % width) + 0.5) * cellSizeM,
        y: (Math.floor(c / width) + 0.5) * cellSizeM,
        radiusM: Math.min(radiusCells, width + height) * cellSizeM,
        intensityMmPerH,
        durationS,
        wholeRange,
      },
    }
  })

/** シナリオを実行し、各 step の後に onStep を呼ぶ。before は step の前の水深の複製 */
function run(
  s: Scenario,
  scanMode: ScanMode,
  onStep: (engine: TsSimulationEngine, stats: StepStats, before: Float64Array) => void,
): TsSimulationEngine {
  const engine = engineOn(s.terrain, { scanMode })
  engine.setRainfall(s.rain)
  for (let n = 0; n < s.steps; n++) {
    const before = engine.waterDepth().slice()
    const stats = engine.step()
    onStep(engine, stats, before)
  }
  return engine
}

/** 統計の数値を Float64Array に詰める。sameBits で +0 と −0 まで区別して比べるため */
function packStats(list: StepStats[]): Float64Array {
  const fields = 13
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
        s.timeS,
        s.dtS,
        s.raining ? 1 : 0,
        s.rainDepthMm,
        s.outflowRateM3PerS,
      ],
      n * fields,
    )
  })
  return out
}

const allFinite = (a: Float64Array): boolean => a.every((v) => Number.isFinite(v))

describe('性質のテスト（spec 08 §9.2、tech-spec §11.3）', () => {
  it('質量保存: 各 step で |massError| ≤ totalWater × 1e-9', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (_, stats) => {
          expect(Math.abs(stats.massError)).toBeLessThanOrEqual(massTolerance(stats.totalWater))
        })
      }),
    )
  })

  it('非負・有限: すべての step で h ≥ 0、h・qx・qy が有限（NaN・∞ が無い）', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (engine) => {
          const w = engine.waterDepth()
          expect(w.every((d) => d >= 0 && Number.isFinite(d))).toBe(true)
          const { qx, qy } = engine.faceFlows()
          expect(allFinite(qx) && allFinite(qy)).toBe(true)
        })
      }),
    )
  })

  it('時間刻み: dtS ≤ DT_MAX_S、dtS ≤ α·Δx / √(g·h_max)（step の前の最大水深）。雨の終わりをまたぐ step は無い', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const dx = s.terrain.meta.cellSizeM
        const end = s.rain.durationS
        let previous = 0
        run(s, 'bbox', (_, stats, before) => {
          expect(stats.dtS).toBeGreaterThan(0)
          expect(stats.dtS).toBeLessThanOrEqual(DT_MAX_S)
          let hMax = 0
          for (const d of before) if (d > hMax) hMax = d
          if (hMax > 0) {
            expect(stats.dtS).toBeLessThanOrEqual(
              ((CFL_ALPHA * dx) / Math.sqrt(GRAVITY * hMax)) * (1 + 1e-12),
            )
          }
          if (end > 0) expect(previous < end && stats.timeS > end).toBe(false)
          previous = stats.timeS
        })
      }),
    )
  })

  it('決定性: 同じ入力を 2 回実行すると h・qx・qy がビット単位で一致する', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const a = run(s, 'bbox', () => {})
        const b = run(s, 'bbox', () => {})
        expect(sameBits(a.waterDepth(), b.waterDepth())).toBe(true)
        expect(sameBits(a.faceFlows().qx, b.faceFlows().qx)).toBe(true)
        expect(sameBits(a.faceFlows().qy, b.faceFlows().qy)).toBe(true)
      }),
    )
  })

  it("走査範囲: scanMode 'bbox' と 'full' で h・qx・qy と統計がビット単位で一致する", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const statsFull: StepStats[] = []
        const full = run(s, 'full', (_, stats) => statsFull.push(stats))
        const statsBbox: StepStats[] = []
        const bbox = run(s, 'bbox', (_, stats) => statsBbox.push(stats))
        expect(sameBits(bbox.waterDepth(), full.waterDepth())).toBe(true)
        expect(sameBits(bbox.faceFlows().qx, full.faceFlows().qx)).toBe(true)
        expect(sameBits(bbox.faceFlows().qy, full.faceFlows().qy)).toBe(true)
        expect(sameBits(packStats(statsBbox), packStats(statsFull))).toBe(true)
        expect(statsBbox).toStrictEqual(statsFull)
      }),
    )
  })

  it('走査範囲の外: すべての step の後で、範囲の外の h・qx・qy が 0（spec 08 §3.8 の不変条件）', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { width, height } = s.terrain.meta
        run(s, 'bbox', (engine) => {
          const { x0, y0, x1, y1 } = engine.scanWindow()
          const empty = x0 >= x1
          const w = engine.waterDepth()
          const { qx, qy } = engine.faceFlows()
          // expect をセルごとに呼ぶと遅いので、外れた数を数えて最後に 1 回だけ比べる
          let outside = 0
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const inside = !empty && x >= x0 && x < x1 && y >= y0 && y < y1
              if (!inside && w[y * width + x] !== 0) outside++
            }
            for (let x = 0; x <= width; x++) {
              const inside = !empty && y >= y0 && y < y1 && x >= x0 && x <= x1
              if (!inside && qx[y * (width + 1) + x] !== 0) outside++
            }
          }
          for (let y = 0; y <= height; y++) {
            for (let x = 0; x < width; x++) {
              const inside = !empty && y >= y0 && y <= y1 && x >= x0 && x < x1
              if (!inside && qy[y * width + x] !== 0) outside++
            }
          }
          expect(outside).toBe(0)
        })
      }),
    )
  })

  it('静水の保存: h = max(0, min(η0, F₄) − Z) を置き、雨なしで回しても h がビット単位で変わらない（Z・η0 は 1/256 m の格子。レビュー 1 の M2）', () => {
    const staticArb = fc.record({
      terrain: terrainArb,
      level: fc.double({ min: 0, max: 1, noNaN: true }),
      steps: fc.integer({ min: 1, max: 100 }),
      full: fc.boolean(),
    })
    fc.assert(
      fc.property(staticArb, ({ terrain: t, level, steps, full }) => {
        const { fill } = analyzeDepressions({
          elevation: t.elevation,
          validMask: t.validMask,
          ...t.meta,
        })
        let lo = Number.POSITIVE_INFINITY
        let hi = Number.NEGATIVE_INFINITY
        t.validMask.forEach((v, i) => {
          if (v === 0) return
          lo = Math.min(lo, t.elevation[i] ?? 0)
          hi = Math.max(hi, t.elevation[i] ?? 0)
        })
        // 任意の水面標高 η0（格子に載せる）。4 近傍の満水の水面 F₄ で切ると、端・無効セルにつながる所は乾いたまま
        const eta0 = snap(lo + level * (hi - lo + 1))
        const h0 = new Float64Array(t.elevation.length)
        for (let i = 0; i < h0.length; i++) {
          if ((t.validMask[i] ?? 0) === 0) continue
          h0[i] = Math.max(0, Math.min(eta0, fill[i] ?? 0) - (t.elevation[i] ?? 0))
        }
        const engine = engineOn(t, { scanMode: full ? 'full' : 'bbox' })
        engine.setInitialWater(h0)
        for (let n = 0; n < steps; n++) engine.step()
        expect(sameBits(engine.waterDepth(), h0)).toBe(true)
      }),
    )
  })
})
