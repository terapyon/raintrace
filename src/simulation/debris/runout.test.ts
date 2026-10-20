import { describe, expect, it } from 'vitest'
import { DEBRIS_SEED } from './constants.ts'
import { createRandom } from './random.ts'
import { type DebrisGrid, type DebrisParams, pcmVelocitySq, runout } from './runout.ts'

// src/shared のプリセットは import できない（core-is-pure）ので、同じ向きの値をここに置く
const NEAR: DebrisParams = {
  mu: 0.6,
  massToDragM: 20,
  divergence: 1.3,
  persistence: 1.5,
  reposeDeg: 30,
  slopeThresholdDeg: 40,
  initialVelocityMS: 1,
}
const FAR: DebrisParams = {
  mu: 0.12,
  massToDragM: 100,
  divergence: 2,
  persistence: 2,
  reposeDeg: 8.5,
  slopeThresholdDeg: 20,
  initialVelocityMS: 1,
}
/** 最初の 1 歩で必ず止まる（μ が斜面より大きく、初速 0）。経路の選び方だけを見るテスト用 */
const STOP_AT_FIRST_STEP: DebrisParams = {
  mu: 1.5,
  massToDragM: 20,
  divergence: 3,
  persistence: 1,
  reposeDeg: 30,
  slopeThresholdDeg: 20,
  initialVelocityMS: 0,
}

/** 標高を (行, 列) の関数で作る。valid が false を返すセルは無効 */
function makeGrid(
  size: number,
  cellSizeM: number,
  elev: (row: number, col: number) => number,
  valid: (row: number, col: number) => boolean = () => true,
): DebrisGrid {
  const elevation = new Float32Array(size * size)
  const validMask = new Uint8Array(size * size)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      elevation[r * size + c] = elev(r, c)
      validMask[r * size + c] = valid(r, c) ? 1 : 0
    }
  }
  return { elevation, validMask, size, cellSizeM }
}

/** (行, 列) の矩形に厚さ t の崩れる土を置く */
function removedRect(
  size: number,
  r0: number,
  r1: number,
  c0: number,
  c1: number,
  t: number,
): Float32Array {
  const removed = new Float32Array(size * size)
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) removed[r * size + c] = t
  return removed
}

/** 重みつきの重心（行, 列） */
function centroid(values: Float32Array, size: number): { row: number; col: number } {
  let sum = 0
  let row = 0
  let col = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0
    if (v <= 0) continue
    sum += v
    row += Math.floor(i / size) * v
    col += (i % size) * v
  }
  return { row: row / sum, col: col / sum }
}

function expectMassConserved(r: { collapsedM3: number; depositedM3: number; outsideM3: number }) {
  expect(r.collapsedM3).toBeGreaterThan(0)
  expect(Math.abs(r.collapsedM3 - r.depositedM3 - r.outsideM3)).toBeLessThanOrEqual(
    1e-6 * r.collapsedM3,
  )
}

/** 谷のある地形（南東へ下り、中央の列に谷）。北西の隅は無効 */
function valleyGrid(): DebrisGrid {
  return makeGrid(
    60,
    5,
    (r, c) => 200 - r * 0.8 - c * 0.5 + Math.abs(c - 30) * 0.6 + Math.sin(r * 0.7 + c * 0.3) * 0.2,
    (r, c) => !(r < 6 && c < 6),
  )
}

describe('createRandom', () => {
  it('createRandom: 同じ種なら同じ列、[0, 1) に収まる', () => {
    const a = createRandom(DEBRIS_SEED)
    const b = createRandom(DEBRIS_SEED)
    const c = createRandom(DEBRIS_SEED + 1)
    let differs = false
    for (let i = 0; i < 10000; i++) {
      const x = a()
      expect(x).toBe(b())
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
      if (x !== c()) differs = true
    }
    expect(differs).toBe(true)
  })
})

describe('runout', () => {
  it('質量の保存: 崩れた土 = 積もった土 + 範囲外（1e-6 の相対誤差）', () => {
    const grid = valleyGrid()
    const removed = removedRect(60, 4, 12, 20, 40, 2.5)
    // 無効なセルに置いた崩れる土は数えない
    removed[0] = 5
    for (const params of [NEAR, FAR]) {
      const r = runout(grid, removed, params, DEBRIS_SEED)
      expectMassConserved(r)
      expect(r.collapsedM3).toBeCloseTo(9 * 21 * 2.5 * 25, 6)
      let sum = 0
      for (const v of r.deposit) sum += v * 25
      expect(sum).toBeCloseTo(r.depositedM3, 3)
    }
  })

  it('同じ入力・同じ種なら deposit が一致する', () => {
    const grid = valleyGrid()
    const removed = removedRect(60, 4, 12, 20, 40, 2.5)
    for (const params of [NEAR, FAR]) {
      const a = runout(grid, removed, params, DEBRIS_SEED)
      const b = runout(grid, removed, params, DEBRIS_SEED)
      expect(Array.from(b.deposit)).toEqual(Array.from(a.deposit))
      expect(b.outsideM3).toBe(a.outsideM3)
    }
  })

  it('平らな面では崩れたセル（とその周り）にだけ積もる', () => {
    const size = 21
    const grid = makeGrid(size, 5, () => 10)
    const removed = removedRect(size, 9, 11, 9, 11, 1)
    const r = runout(grid, removed, FAR, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBe(0)
    for (let i = 0; i < r.deposit.length; i++) {
      if ((r.deposit[i] ?? 0) <= 0) continue
      const row = Math.floor(i / size)
      const col = i % size
      expect(row).toBeGreaterThanOrEqual(8)
      expect(row).toBeLessThanOrEqual(12)
      expect(col).toBeGreaterThanOrEqual(8)
      expect(col).toBeLessThanOrEqual(12)
    }
  })

  it('東へ一様に下る斜面では、崩れた場所より東（下流）にだけ積もる', () => {
    const size = 30
    // 1 セル（5 m）で 1 m 下る（tan = 0.2）。μ = 0.6 なので最初の 1 歩で止まる
    const grid = makeGrid(size, 5, (_r, c) => 100 - c)
    const removed = removedRect(size, 15, 15, 10, 10, 0.01)
    const r = runout(grid, removed, NEAR, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBe(0)
    let count = 0
    for (let i = 0; i < r.deposit.length; i++) {
      if ((r.deposit[i] ?? 0) <= 0) continue
      count++
      expect(i % size).toBeGreaterThan(10)
    }
    expect(count).toBeGreaterThan(0)
  })

  it('範囲の東端の近くの候補では、一部が範囲の外へ出て outsideM3 > 0（Review Focus 4）', () => {
    const size = 30
    const grid = makeGrid(size, 5, (_r, c) => 100 - 2 * c)
    const removed = removedRect(size, 14, 16, size - 4, size - 3, 1)
    const r = runout(grid, removed, FAR, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBeGreaterThan(0)
    expect(r.outsideM3).toBeLessThanOrEqual(r.collapsedM3 * (1 + 1e-9))
  })

  it('無効なセルへ進んだ粒は範囲外に数える', () => {
    const size = 30
    // 東へ下る斜面の、東側 10 列が無効
    const grid = makeGrid(
      size,
      5,
      (_r, c) => 100 - 2 * c,
      (_r, c) => c < 20,
    )
    const removed = removedRect(size, 14, 16, 15, 16, 1)
    const r = runout(grid, removed, FAR, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBeGreaterThan(0)
    for (let i = 0; i < r.deposit.length; i++) {
      if (grid.validMask[i] === 0) expect(r.deposit[i]).toBe(0)
    }
  })

  it('μ を小さく・M/D を大きくすると、到達距離（崩れた場所から積もった重心までの距離）が長くなる', () => {
    const size = 60
    // 西の 20 列は tan 0.2 の斜面、その先は tan 0.02 のゆるい斜面
    const grid = makeGrid(size, 5, (_r, c) => (c < 20 ? 100 - c : 80 - (c - 20) * 0.1))
    const removed = removedRect(size, 28, 32, 2, 4, 1)
    const source = { row: 30, col: 3 }
    const distance = (params: DebrisParams) => {
      const r = runout(grid, removed, params, DEBRIS_SEED)
      expectMassConserved(r)
      expect(r.outsideM3).toBe(0)
      const g = centroid(r.deposit, size)
      return Math.hypot(g.row - source.row, g.col - source.col)
    }
    const near = distance(NEAR)
    const far = distance(FAR)
    const farther = distance({ ...FAR, mu: 0.05, massToDragM: 150 })
    expect(far).toBeGreaterThan(near)
    expect(farther).toBeGreaterThan(far)
  })

  it('閾値より急な斜面では、最急の近傍だけへ進む（種によらず同じ経路）', () => {
    const size = 20
    // 1 セル（5 m）で 5 m 下る（東は tan 1、北東・南東は tan 0.71）。閾値 20° より急
    const grid = makeGrid(size, 5, (_r, c) => 100 - 5 * c)
    const removed = removedRect(size, 10, 10, 5, 5, 1e-4)
    for (let seed = 1; seed <= 20; seed++) {
      const r = runout(grid, removed, STOP_AT_FIRST_STEP, seed)
      expectMassConserved(r)
      for (let i = 0; i < r.deposit.length; i++) {
        if (i === 10 * size + 6) expect(r.deposit[i]).toBeGreaterThan(0)
        else expect(r.deposit[i]).toBe(0)
      }
    }
  })

  it('閾値よりゆるい斜面では、divergence を大きくすると横へ広く積もる', () => {
    const size = 40
    // 東へ tan 0.1 で下る（閾値 20° よりゆるい）
    const grid = makeGrid(size, 5, (_r, c) => 100 - 0.5 * c)
    const removed = removedRect(size, 18, 22, 5, 5, 0.01)
    const spread = (divergence: number) => {
      const params = { ...FAR, divergence, persistence: 1, initialVelocityMS: 3 }
      const r = runout(grid, removed, params, DEBRIS_SEED)
      expectMassConserved(r)
      expect(r.outsideM3).toBe(0)
      const g = centroid(r.deposit, size)
      let sum = 0
      let variance = 0
      for (let i = 0; i < r.deposit.length; i++) {
        const v = r.deposit[i] ?? 0
        if (v <= 0) continue
        sum += v
        variance += (Math.floor(i / size) - g.row) ** 2 * v
      }
      return variance / sum
    }
    // a = 1 なら最急の近傍（東）だけなので、崩れた行（18〜22 行）から外れない。分散は 2
    expect(spread(1)).toBeCloseTo(2, 6)
    expect(spread(3)).toBeGreaterThan(spread(1) + 0.5)
  })

  it('pcmVelocitySq: 急な所からゆるい所へ移ると、角度の差の cos で速さを落とす', () => {
    const params = { mu: 0.12, massToDragM: 100 }
    const steep = Math.PI / 4
    const gentle = Math.atan(0.05)
    const withBreak = pcmVelocitySq(100, steep, gentle, 5, params)
    const noBreak = pcmVelocitySq(100, gentle, gentle, 5, params)
    const eb = Math.exp((-2 * 5) / Math.cos(gentle) / 100)
    const alpha = 9.81 * (Math.sin(gentle) - 0.12 * Math.cos(gentle))
    expect(noBreak).toBeCloseTo(alpha * 100 * (1 - eb) + 100 * eb, 9)
    expect(withBreak).toBeCloseTo(
      alpha * 100 * (1 - eb) + 100 * Math.cos(steep - gentle) ** 2 * eb,
      9,
    )
    expect(withBreak).toBeLessThan(noBreak)
    // ゆるい所から急な所（凸）では落とさない。最初の歩（前の角度が無い）も落とさない
    expect(pcmVelocitySq(100, gentle, steep, 5, params)).toBeCloseTo(
      pcmVelocitySq(100, steep, steep, 5, params),
      9,
    )
    expect(pcmVelocitySq(100, Number.NaN, gentle, 5, params)).toBeCloseTo(noBreak, 9)
  })

  it('急な斜面からゆるい斜面へ移る所で速さを落とすので、落とさない場合より手前で止まる', () => {
    const size = 50
    const row = 25
    // 8 列目までは tan 1、その先は tan 0.05
    const grid = makeGrid(size, 5, (_r, c) => (c <= 8 ? 100 - 5 * c : 60 - 0.25 * (c - 8)))
    const removed = removedRect(size, row, row, 1, 1, 1e-4)
    // divergence 1 なら毎歩、最急の近傍（東）だけへ進むので、経路は 25 行目をまっすぐ東
    const params: DebrisParams = { ...FAR, divergence: 1 }
    const r = runout(grid, removed, params, DEBRIS_SEED)
    expectMassConserved(r)
    expect(r.outsideM3).toBe(0)

    const height = (c: number) => (grid.elevation[row * size + c] ?? 0) - (c === 1 ? 1e-4 : 0)
    const stopColumn = (concave: boolean) => {
      let v2 = params.initialVelocityMS ** 2
      let prev = Number.NaN
      for (let c = 1; c < size - 1; c++) {
        const theta = Math.atan((height(c) - height(c + 1)) / 5)
        v2 = pcmVelocitySq(v2, concave ? prev : theta, theta, 5, params)
        prev = theta
        if (v2 <= 0) return c + 1
      }
      return -1
    }
    const expected = stopColumn(true)
    expect(expected).toBeGreaterThan(8)
    expect(expected).toBeLessThan(stopColumn(false))
    for (let i = 0; i < r.deposit.length; i++) {
      if (i === row * size + expected) expect(r.deposit[i]).toBeGreaterThan(0)
      else expect(r.deposit[i]).toBe(0)
    }
  })

  it('後の粒は先の粒が積もった上を通るので、積もった所を避けて進む', () => {
    const size = 20
    const grid = makeGrid(size, 5, (_r, c) => 100 - 5 * c)
    // 崩れた跡から東の隣へは 3 m 下る。1 粒の厚さは 0.5 m
    const removed = removedRect(size, 10, 10, 5, 5, 2)
    const r = runout(grid, removed, STOP_AT_FIRST_STEP, DEBRIS_SEED)
    expectMassConserved(r)
    // 1・2 粒目は東（tan 0.6、0.5）。3 粒目は東（tan 0.4）より北東・南東（tan 0.42）が急。4 粒目は残りの方
    expect(r.deposit[10 * size + 6]).toBeCloseTo(1, 6)
    expect(r.deposit[9 * size + 6]).toBeCloseTo(0.5, 6)
    expect(r.deposit[11 * size + 6]).toBeCloseTo(0.5, 6)
  })
})
