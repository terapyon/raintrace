import { describe, expect, it } from 'vitest'
import { FLOW_THRESHOLD_M } from './constants.ts'
import {
  computeFlowVectors,
  createScratch,
  FLOW_K,
  solveStep,
  type TerrainArrays,
} from './FlowSolver.ts'

/** 標高 0 の平らな地形。invalid のセルは無効セル */
function flat(width: number, height: number, invalid: number[] = []): TerrainArrays {
  const validMask = new Uint8Array(width * height).fill(1)
  for (const i of invalid) validMask[i] = 0
  return { width, height, elevation: new Float32Array(width * height), validMask }
}

/** 全体を走査範囲にして 1 step 計算する */
function stepOnce(t: TerrainArrays, w: Float64Array) {
  const next = w.slice()
  const win = { x0: 0, y0: 0, x1: t.width, y1: t.height }
  const flow = solveStep(t, w, next, win, createScratch())
  return { next, flow }
}

describe('solveStep（spec 03 §3.2・§3.3）', () => {
  it('k · Σw = c = 0.5', () => {
    expect(FLOW_K * (4 + 4 * Math.SQRT1_2)).toBeCloseTo(0.5, 15)
  })

  it('平らな地形の中央の水は、8 近傍へ水面差と重みに比例して配られ、半分が残る', () => {
    const w = new Float64Array(9)
    w[4] = 1
    const { next, flow } = stepOnce(flat(3, 3), w)
    expect(next[4]).toBeCloseTo(0.5, 15)
    expect(next[1]).toBeCloseTo(FLOW_K, 15)
    expect(next[0]).toBeCloseTo(FLOW_K * Math.SQRT1_2, 15)
    expect(flow).toEqual({ outflowDepth: 0, flowed: true })
  })

  it('角のセルの水は、グリッドの外の仮想セルへも流れ、流出になる', () => {
    const w = new Float64Array(9)
    w[0] = 1
    const { next, flow } = stepOnce(flat(3, 3), w)
    // 仮想セル: 西・北（上下左右）と、北西・北東・南西（斜め）
    expect(flow.outflowDepth).toBeCloseTo(FLOW_K * (2 + 3 * Math.SQRT1_2), 15)
    expect(next[0]).toBeCloseTo(0.5, 15)
    expect(next[1]).toBeCloseTo(FLOW_K, 15)
    expect(next[4]).toBeCloseTo(FLOW_K * Math.SQRT1_2, 15)
  })

  it('無効セルは仮想セルとして扱い、そこへの流れは流出になる。無効セルは水を持たない', () => {
    const w = new Float64Array(25)
    w[11] = 1
    const { next, flow } = stepOnce(flat(5, 5, [12]), w)
    expect(flow.outflowDepth).toBeCloseTo(FLOW_K, 15)
    expect(next[12]).toBe(0)
  })

  it('水面差が θ 以下の近傍には流さない（flowed は false）', () => {
    const w = new Float64Array(9)
    w[0] = FLOW_THRESHOLD_M / 2
    w[4] = FLOW_THRESHOLD_M / 2
    const { next, flow } = stepOnce(flat(3, 3), w)
    expect(flow).toEqual({ outflowDepth: 0, flowed: false })
    expect(Array.from(next)).toEqual(Array.from(w))
  })

  it('持っている水より多くは出さず、水をすべて出したセルはちょうど 0 になる', () => {
    const t = flat(3, 3)
    t.elevation[4] = 1
    const w = new Float64Array(9)
    w[4] = 0.01
    const { next } = stepOnce(t, w)
    expect(next[4]).toBe(0)
    expect(next.every((d) => d >= 0)).toBe(true)
    expect(next.reduce((a, d) => a + d, 0)).toBeCloseTo(0.01, 17)
    // 上下左右（北）は斜め（北西）の √2 倍
    expect((next[1] ?? 0) / (next[0] ?? 0)).toBeCloseTo(Math.SQRT2, 12)
  })

  it('Jacobi 方式: 同じ step で先に更新したセルの値を読まない（左右対称な配置は対称な結果になる）', () => {
    const w = Float64Array.of(1, 0, 1)
    const { next } = stepOnce(flat(3, 1), w)
    expect(next[0]).toBe(next[2])
    expect(next[1]).toBeCloseTo(2 * FLOW_K, 15)
  })
})

describe('computeFlowVectors（spec 03 §3.9）', () => {
  it('平らな地形の中央の水は 8 方向に均等に出るので、ベクトルの和は 0', () => {
    const w = new Float64Array(9)
    w[4] = 1
    const v = computeFlowVectors(flat(3, 3), w, { x0: 0, y0: 0, x1: 3, y1: 3 }, createScratch())
    expect(Math.abs(v.x[4] ?? Number.NaN)).toBeLessThan(1e-7)
    expect(Math.abs(v.y[4] ?? Number.NaN)).toBeLessThan(1e-7)
  })

  it('東へ下る斜面の水は東を向き、濡れていないセルは 0、水は動かさない', () => {
    const t = flat(5, 3)
    for (let i = 0; i < 15; i++) t.elevation[i] = 4 - (i % 5)
    const w = new Float64Array(15)
    w[7] = 0.1
    const before = w.slice()
    const v = computeFlowVectors(t, w, { x0: 0, y0: 0, x1: 5, y1: 3 }, createScratch())
    const vx = v.x[7] ?? Number.NaN
    expect(vx).toBeGreaterThan(0)
    expect(Math.abs(v.y[7] ?? Number.NaN)).toBeLessThan(1e-7 * vx)
    expect(v.x[6]).toBe(0)
    expect(v.y[8]).toBe(0)
    expect(Array.from(w)).toEqual(Array.from(before))
  })

  it('出力の配列を渡すと、それに書いて返す。前の値は 0 に戻す（使い回し。spec 06 §5.2）', () => {
    const t = flat(5, 3)
    for (let i = 0; i < 15; i++) t.elevation[i] = 4 - (i % 5)
    const w = new Float64Array(15)
    w[7] = 0.1
    const out = { x: new Float32Array(15).fill(9), y: new Float32Array(15).fill(9) }
    const v = computeFlowVectors(t, w, { x0: 0, y0: 0, x1: 5, y1: 3 }, createScratch(), out)
    expect(v).toBe(out)
    const fresh = computeFlowVectors(t, w, { x0: 0, y0: 0, x1: 5, y1: 3 }, createScratch())
    expect(Array.from(v.x)).toEqual(Array.from(fresh.x))
    expect(Array.from(v.y)).toEqual(Array.from(fresh.y))
  })

  it('出力の配列の大きさが合わなければ、新しく確保する', () => {
    const w = new Float64Array(9)
    const out = { x: new Float32Array(4), y: new Float32Array(4) }
    const v = computeFlowVectors(
      flat(3, 3),
      w,
      { x0: 0, y0: 0, x1: 3, y1: 3 },
      createScratch(),
      out,
    )
    expect(v).not.toBe(out)
    expect(v.x.length).toBe(9)
  })
})
