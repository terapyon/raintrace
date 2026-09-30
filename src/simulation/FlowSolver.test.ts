import { describe, expect, it } from 'vitest'
import {
  CFL_ALPHA,
  DT_MAX_S,
  FLOW_THRESHOLD_M,
  FROUDE_MAX,
  GRAVITY,
  MANNING_N,
  THETA,
} from './constants.ts'
import {
  applyFaceFlows,
  cellVelocities,
  clearFacesOutside,
  computeFlowVectors,
  createFaces,
  createScratch,
  edgeOutflowCandidates,
  FACE_CLOSED,
  FACE_INNER,
  FACE_VIRTUAL_AFTER,
  FACE_VIRTUAL_BEFORE,
  type Faces,
  FLOW_K,
  faceVelocityMax,
  interiorOutflowCandidates,
  limitOutflows,
  type ScanWindow,
  solveStep,
  type TerrainArrays,
  timeStep,
  updateFaceFlows,
} from './FlowSolver.ts'

/** 標高 0 の平らな地形。invalid のセルは無効セル */
function flat(width: number, height: number, invalid: number[] = []): TerrainArrays {
  const validMask = new Uint8Array(width * height).fill(1)
  for (const i of invalid) validMask[i] = 0
  return { width, height, elevation: new Float32Array(width * height), validMask }
}

/** 決まった種の擬似乱数（mulberry32） */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
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

describe('内側のセルの近傍の添字（03 の軽微 8、spec 06 §5.2）', () => {
  it('内側のすべてのセルで、端の版と g・近傍・合計がビット単位で同じ（無効セルと乾いた近傍を含む）', () => {
    const next = random(42)
    const width = 13
    const height = 9
    const t = flat(width, height)
    const w = new Float64Array(width * height)
    for (let i = 0; i < width * height; i++) {
      t.elevation[i] = next() * 2
      t.validMask[i] = next() < 0.15 ? 0 : 1
      w[i] = next() < 0.3 ? 0 : next() * 0.05
    }
    const edge = createScratch()
    const interior = createScratch()
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const a = edgeOutflowCandidates(t, w, x, y, i, edge)
        const b = interiorOutflowCandidates(t, w, i, interior)
        expect(Object.is(a, b)).toBe(true)
        expect(Array.from(interior.g)).toEqual(Array.from(edge.g))
        expect(Array.from(interior.nb)).toEqual(Array.from(edge.nb))
      }
    }
  })

  it('幅が変わったら添字の差を作り直す', () => {
    const s = createScratch()
    const a = flat(5, 5)
    interiorOutflowCandidates(a, new Float64Array(25), 12, s)
    expect(s.offsetsWidth).toBe(5)
    expect(Array.from(s.offsets)).toEqual([-6, -5, -4, -1, 1, 4, 5, 6])
    const b = flat(7, 3)
    interiorOutflowCandidates(b, new Float64Array(21), 8, s)
    expect(s.offsetsWidth).toBe(7)
    expect(Array.from(s.offsets)).toEqual([-8, -7, -6, -1, 1, 6, 7, 8])
  })
})

/** 走査範囲をグリッド全体にする */
const whole = (t: TerrainArrays): ScanWindow => ({ x0: 0, y0: 0, x1: t.width, y1: t.height })

/** 標高と水深から、面の流量を 1 回だけ更新した面を返す（Δx = 1 m） */
function facesAfter(
  t: TerrainArrays,
  h: Float64Array,
  dt: number,
  setup: (f: Faces) => void = () => {},
): Faces {
  const f = createFaces(t.width, t.height, t.validMask)
  setup(f)
  updateFaceFlows(t, h, whole(t), f, dt, 1, MANNING_N)
  return f
}

describe('createFaces（spec 08 §3.1・§3.6）', () => {
  it('面の数は東西 (W+1)×H・南北 W×(H+1)。グリッドの外・無効セルとの面は仮想、両側とも仮想なら閉じる', () => {
    // 3 × 2。(1, 0) が無効セル
    const t = flat(3, 2, [1])
    const f = createFaces(3, 2, t.validMask)
    expect(f.qx.length).toBe(8)
    expect(f.qy.length).toBe(9)
    // 行 0 の東西の面: 外|(0,0)、(0,0)|無効、無効|(2,0)、(2,0)|外
    expect(Array.from(f.kindX.subarray(0, 4))).toEqual([
      FACE_VIRTUAL_BEFORE,
      FACE_VIRTUAL_AFTER,
      FACE_VIRTUAL_BEFORE,
      FACE_VIRTUAL_AFTER,
    ])
    // 行 1 の東西の面: 全部有効
    expect(Array.from(f.kindX.subarray(4, 8))).toEqual([
      FACE_VIRTUAL_BEFORE,
      FACE_INNER,
      FACE_INNER,
      FACE_VIRTUAL_AFTER,
    ])
    // 南北の面の行 0（北端）。x = 1 は外|無効で閉じる
    expect(Array.from(f.kindY.subarray(0, 3))).toEqual([
      FACE_VIRTUAL_BEFORE,
      FACE_CLOSED,
      FACE_VIRTUAL_BEFORE,
    ])
    // 行 1（行 0 と行 1 の境）。x = 1 は無効|(1,1)
    expect(Array.from(f.kindY.subarray(3, 6))).toEqual([
      FACE_INNER,
      FACE_VIRTUAL_BEFORE,
      FACE_INNER,
    ])
    // 行 2（南端）
    expect(Array.from(f.kindY.subarray(6, 9))).toEqual([
      FACE_VIRTUAL_AFTER,
      FACE_VIRTUAL_AFTER,
      FACE_VIRTUAL_AFTER,
    ])
  })
})

describe('timeStep（spec 08 §3.3）', () => {
  it('水が無ければ DT_MAX_S', () => {
    expect(timeStep(0, 0, 0.98)).toBe(DT_MAX_S)
  })

  it('α·Δx / √(g·h_max)。浅いうちは DT_MAX_S で頭打ち', () => {
    expect(timeStep(0.5, 0, 0.98)).toBe((CFL_ALPHA * 0.98) / Math.sqrt(GRAVITY * 0.5))
    expect(timeStep(1e-3, 0, 0.98)).toBe(DT_MAX_S)
  })

  it('前の step の面の流速が √(g·h_max) より大きければ、それで決める', () => {
    expect(timeStep(0.5, 10, 0.98)).toBe((CFL_ALPHA * 0.98) / 10)
  })
})

describe('updateFaceFlows（spec 08 §3.2・§3.4〜§3.6）', () => {
  it('平らな水面は、底の凹凸によらず内側の面で流れない（静水を保つ。well-balanced）', () => {
    // 4 × 3。標高は 1/4 m の刻み（二進で割り切れる）、水面はどこも 1 m
    const t = flat(4, 3)
    t.elevation.set([0, 0.25, 0.5, 0.125, 0.75, 0, 0.375, 0.5, 0.25, 0.625, 0, 0.125])
    const h = Float64Array.from(t.elevation, (z) => 1 - z)
    const f = facesAfter(t, h, 0.1)
    for (let i = 0; i < f.qx.length; i++) if (f.kindX[i] === FACE_INNER) expect(f.qx[i]).toBe(0)
    for (let i = 0; i < f.qy.length; i++) if (f.kindY[i] === FACE_INNER) expect(f.qy[i]).toBe(0)
  })

  it('面を通れる水深 h_f が DRY_DEPTH_M 以下なら 0（水の無い高いセルへは上らない）', () => {
    // 西は標高 0・水深 0.1、東は標高 0.5・水深 0: h_f = max(0.1, 0.5) − max(0, 0.5) = 0
    const t = flat(2, 1)
    t.elevation[1] = 0.5
    const f = facesAfter(t, Float64Array.of(0.1, 0), 0.1)
    expect(f.qx[1]).toBe(0)
    expect(f.hfx[1]).toBe(0)
  })

  it('水面差のある 2 セルの最初の step は q = −g·h_f·dt·(η_東 − η_西)/Δx（前の流量が 0 なので摩擦は効かない）', () => {
    const t = flat(2, 1)
    const f = facesAfter(t, Float64Array.of(0.3, 0.1), 0.1)
    expect(f.hfx[1]).toBeCloseTo(0.3, 15)
    expect(f.qx[1]).toBeCloseTo(-GRAVITY * 0.1 * 0.3 * (0.1 - 0.3), 15)
  })

  it('前の流量は θ 重み付けで両隣と平均し、Manning の摩擦で弱める（平らな水面）', () => {
    // 3 × 1、水深 0.2 の平らな水面。面 1 に 0.05、面 2 に 0.02 の前の流量（東向き）
    const t = flat(3, 1)
    const f = facesAfter(t, Float64Array.of(0.2, 0.2, 0.2), 0.1, (faces) => {
      faces.qx.set([0, 0.05, 0.02, 0])
    })
    // 面 1 の西隣は面 0（前の値 0）、東隣は面 2（前の値 0.02。この step で更新する前の値）
    const q0 = THETA * 0.05 + ((1 - THETA) / 2) * (0 + 0.02)
    const friction = 1 + (GRAVITY * 0.1 * MANNING_N * MANNING_N * 0.05) / 0.2 ** (7 / 3)
    expect(f.qx[1]).toBeCloseTo(q0 / friction, 14)
  })

  it('フルード数の上限: |q| ≤ FROUDE_MAX·h_f·√(g·h_f)', () => {
    const t = flat(2, 1)
    const f = facesAfter(t, Float64Array.of(2, 0), 1)
    expect(f.qx[1]).toBeCloseTo(FROUDE_MAX * 2 * Math.sqrt(GRAVITY * 2), 12)
  })

  it('仮想セルとの面は外向きにだけ流す（両隣の運動量で内向きになっても 0 にする）', () => {
    // 2 × 1 の平らな水面。面 1 に大きな東向きの前の流量。θ 重み付けで西端の面 0 は東向き（仮想セルから内向き）になる
    const t = flat(2, 1)
    const f = facesAfter(t, Float64Array.of(0.2, 0.2), 0.01, (faces) => {
      faces.qx[1] = 1
    })
    expect(f.qx[0]).toBe(0)
    // 東端の面 2 は外向き（東向き）なので残る
    expect(f.qx[2]).toBeGreaterThan(0)
  })

  it('θ 重み付けの両隣は、この step で更新する前の値を使う（先に更新した面の新しい値を読まない）', () => {
    const next = random(7)
    const t = flat(7, 5)
    for (let i = 0; i < 35; i++) t.elevation[i] = next()
    const h = Float64Array.from({ length: 35 }, () => 0.05 + next() * 0.3)
    const f = createFaces(7, 5, t.validMask)
    for (let i = 0; i < f.qx.length; i++) f.qx[i] = f.kindX[i] === FACE_INNER ? next() - 0.5 : 0
    for (let i = 0; i < f.qy.length; i++) f.qy[i] = f.kindY[i] === FACE_INNER ? next() - 0.5 : 0
    const oldX = f.qx.slice()
    const oldY = f.qy.slice()
    updateFaceFlows(t, h, whole(t), f, 0.05, 1, MANNING_N)
    // 古い値だけから 1 面ずつ計算した値と比べる（内側の面）
    const expected = (qOld: number, left: number, right: number, hf: number, dEta: number) => {
      let q = THETA * qOld + ((1 - THETA) / 2) * (left + right) - GRAVITY * 0.05 * hf * dEta
      if (qOld !== 0) q /= 1 + (GRAVITY * 0.05 * MANNING_N ** 2 * Math.abs(qOld)) / hf ** (7 / 3)
      const cap = FROUDE_MAX * hf * Math.sqrt(GRAVITY * hf)
      return Math.max(-cap, Math.min(cap, q))
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 1; x < 7; x++) {
        const i = y * 8 + x
        const a = y * 7 + x - 1
        const ea = (t.elevation[a] ?? 0) + (h[a] ?? 0)
        const eb = (t.elevation[a + 1] ?? 0) + (h[a + 1] ?? 0)
        const hf = Math.max(ea, eb) - Math.max(t.elevation[a] ?? 0, t.elevation[a + 1] ?? 0)
        if (hf <= FLOW_THRESHOLD_M) continue
        const want = expected(oldX[i] ?? 0, oldX[i - 1] ?? 0, oldX[i + 1] ?? 0, hf, eb - ea)
        expect(Math.abs((f.qx[i] ?? 0) - want)).toBeLessThanOrEqual(1e-14)
      }
    }
    for (let y = 1; y < 5; y++) {
      for (let x = 0; x < 7; x++) {
        const i = y * 7 + x
        const a = i - 7
        const ea = (t.elevation[a] ?? 0) + (h[a] ?? 0)
        const eb = (t.elevation[i] ?? 0) + (h[i] ?? 0)
        const hf = Math.max(ea, eb) - Math.max(t.elevation[a] ?? 0, t.elevation[i] ?? 0)
        if (hf <= FLOW_THRESHOLD_M) continue
        const want = expected(oldY[i] ?? 0, oldY[i - 7] ?? 0, oldY[i + 7] ?? 0, hf, eb - ea)
        expect(Math.abs((f.qy[i] ?? 0) - want)).toBeLessThanOrEqual(1e-14)
      }
    }
  })
})

describe('limitOutflows・applyFaceFlows（spec 08 §3.2・§3.5）', () => {
  it('出る量が水深を超えるセルは出る面を縮め、自分の水をちょうど 0 にする。質量は保存する', () => {
    const t = flat(3, 1)
    const h = Float64Array.of(0, 0.01, 0)
    const f = createFaces(3, 1, t.validMask)
    f.qx.set([0, -1, 1, 0])
    limitOutflows(t, h, whole(t), f, 0.1, 1)
    expect(f.drained[1]).toBe(1)
    expect(0.1 * (-(f.qx[1] ?? 0) + (f.qx[2] ?? 0))).toBeCloseTo(0.01, 15)
    const next = new Float64Array(3)
    const outflow = applyFaceFlows(t, h, next, whole(t), f, 0.1, 1)
    expect(next[1]).toBe(0)
    expect((next[0] ?? 0) + (next[2] ?? 0)).toBeCloseTo(0.01, 15)
    expect(outflow).toBe(0)
  })

  it('足りているセルは縮めない（drained は 0）', () => {
    const t = flat(3, 1)
    const h = Float64Array.of(0, 1, 0)
    const f = createFaces(3, 1, t.validMask)
    f.qx.set([0, -1, 1, 0])
    limitOutflows(t, h, whole(t), f, 0.1, 1)
    expect(f.drained[1]).toBe(0)
    expect(Array.from(f.qx)).toEqual([0, -1, 1, 0])
  })

  it('仮想セルへ出た流量の合計 Σq を返す（× Δx × dt が流出量）', () => {
    const t = flat(1, 1)
    const h = Float64Array.of(0.5)
    const f = createFaces(1, 1, t.validMask)
    f.qx.set([-0.2, 0.3])
    limitOutflows(t, h, whole(t), f, 0.1, 1)
    const next = new Float64Array(1)
    expect(applyFaceFlows(t, h, next, whole(t), f, 0.1, 1)).toBeCloseTo(0.5, 15)
    expect(next[0]).toBeCloseTo(0.5 - 0.1 * 0.5, 15)
  })
})

describe('faceVelocityMax・clearFacesOutside・cellVelocities（spec 08 §3.8〜§3.10）', () => {
  it('faceVelocityMax は走査範囲の面の |q| / h_f の最大（端の仮想セルとの面を含む）', () => {
    const t = flat(2, 1)
    const f = facesAfter(t, Float64Array.of(0.3, 0.1), 0.1)
    let want = 0
    for (let i = 0; i < f.qx.length; i++) {
      if (f.qx[i] !== 0) want = Math.max(want, Math.abs(f.qx[i] ?? 0) / (f.hfx[i] ?? 1))
    }
    for (let i = 0; i < f.qy.length; i++) {
      if (f.qy[i] !== 0) want = Math.max(want, Math.abs(f.qy[i] ?? 0) / (f.hfy[i] ?? 1))
    }
    expect(want).toBeGreaterThan(0)
    expect(faceVelocityMax(whole(t), f)).toBe(want)
    expect(faceVelocityMax({ x0: 0, y0: 0, x1: 0, y1: 0 }, f)).toBe(0)
  })

  it('clearFacesOutside は前の走査範囲の面のうち、新しい走査範囲に入らない面だけを 0 にする', () => {
    const f = createFaces(4, 4, new Uint8Array(16).fill(1))
    f.qx.fill(1)
    f.qy.fill(1)
    clearFacesOutside(f, { x0: 0, y0: 0, x1: 4, y1: 4 }, { x0: 1, y0: 1, x1: 3, y1: 3 })
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x <= 4; x++) {
        const inside = y >= 1 && y < 3 && x >= 1 && x <= 3
        expect(f.qx[y * 5 + x]).toBe(inside ? 1 : 0)
      }
    }
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x < 4; x++) {
        const inside = y >= 1 && y <= 3 && x >= 1 && x < 3
        expect(f.qy[y * 4 + x]).toBe(inside ? 1 : 0)
      }
    }
    // 新しい走査範囲が空なら、前の走査範囲の面はすべて 0
    f.qx.fill(1)
    clearFacesOutside(f, { x0: 0, y0: 0, x1: 4, y1: 4 }, { x0: 0, y0: 0, x1: 0, y1: 0 })
    expect(Array.from(f.qx).every((q) => q === 0)).toBe(true)
  })

  it('cellVelocities はセルの両側の面の流量の平均 ÷ 水深（m/s）。乾いたセルは 0。出力の配列を使い回す', () => {
    const t = flat(2, 2)
    const f = createFaces(2, 2, t.validMask)
    const h = Float64Array.of(0.5, 0, 0, 0)
    // セル (0,0) の西の面 0.1、東の面 0.3、北の面 −0.2、南の面 0
    f.qx[0] = 0.1
    f.qx[1] = 0.3
    f.qy[0] = -0.2
    const out = { x: new Float32Array(4).fill(9), y: new Float32Array(4).fill(9) }
    const v = cellVelocities(t, h, whole(t), f, out)
    expect(v).toBe(out)
    expect(v.x[0]).toBeCloseTo((0.1 + 0.3) / 2 / 0.5, 6)
    expect(v.y[0]).toBeCloseTo((-0.2 + 0) / 2 / 0.5, 6)
    expect(Array.from(v.x.subarray(1))).toEqual([0, 0, 0])
    expect(
      cellVelocities(t, h, whole(t), f, { x: new Float32Array(1), y: new Float32Array(1) }).x
        .length,
    ).toBe(4)
  })
})
