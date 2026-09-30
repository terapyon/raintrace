import { describe, expect, it } from 'vitest'
import {
  CFL_ALPHA,
  DRY_DEPTH_M,
  DT_MAX_S,
  FROUDE_MAX,
  GRAVITY,
  MANNING_N,
  THETA,
} from './constants.ts'
import {
  applyFaceFlows,
  cellVelocities,
  clearFacesOutside,
  createFaces,
  FACE_CLOSED,
  FACE_INNER,
  FACE_VIRTUAL_AFTER,
  FACE_VIRTUAL_BEFORE,
  type Faces,
  faceVelocityMax,
  limitOutflows,
  NEIGHBOR_DX,
  NEIGHBOR_DY,
  type ScanWindow,
  type TerrainArrays,
  timeStep,
  updateFaceFlows,
} from './FlowSolver.ts'

describe('面の表（spec 08 §3.7、レビュー 1 の R1）', () => {
  it('NEIGHBOR_DX・NEIGHBOR_DY は 4 近傍（北・西・東・南）', () => {
    expect(Array.from(NEIGHBOR_DX)).toEqual([0, -1, 1, 0])
    expect(Array.from(NEIGHBOR_DY)).toEqual([-1, 0, 0, 1])
  })
})

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

  it('両側とも仮想セルの面（閉じた面）は、前の流量が残っていても q・h_f を 0 にする', () => {
    // 3 × 2。(1, 0) が無効セルなので、南北の面の北端 x = 1（外|無効）は閉じた面
    const t = flat(3, 2, [1])
    const h = Float64Array.of(0.2, 0, 0.2, 0.2, 0.2, 0.2)
    const f = facesAfter(t, h, 0.1, (faces) => {
      expect(faces.kindY[1]).toBe(FACE_CLOSED)
      faces.qy[1] = 1
    })
    expect(f.qy[1]).toBe(0)
    expect(f.hfy[1]).toBe(0)
    expect(f.qx.every((q) => Number.isFinite(q))).toBe(true)
    expect(f.qy.every((q) => Number.isFinite(q))).toBe(true)
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
        if (hf <= DRY_DEPTH_M) continue
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
        if (hf <= DRY_DEPTH_M) continue
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
