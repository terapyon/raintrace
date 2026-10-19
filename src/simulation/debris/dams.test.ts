import { describe, expect, it } from 'vitest'
import { DEBRIS_PRESETS, type DebrisPreset } from '../../shared/debrisPresets.ts'
import { analyzeDepressions } from '../terrain/analyzeDepressions.ts'
import { findDammedSites } from './dams.ts'
import { simulateCollapse } from './simulateCollapse.ts'
import { CELL, SIZE, terrain, VALLEY_COL, valleyWithFill } from './testTerrain.test-support.ts'

const NEAR = (DEBRIS_PRESETS.find((p) => p.id === 'near') as DebrisPreset).params
const N = 20

/** 平らな土地（標高 100）に、四角い窪み（深さ 1m）を掘る */
function flatWithPits(
  pits: { r: number; c: number; w: number; h?: number; depth?: number }[],
): Float32Array {
  const z = new Float32Array(N * N).fill(100)
  for (const p of pits) {
    for (let r = p.r; r < p.r + (p.h ?? p.w); r++) {
      for (let c = p.c; c < p.c + p.w; c++) z[r * N + c] = 100 - (p.depth ?? 1)
    }
  }
  return z
}

/** 平らな土地が、崩れた後に pit の窪地になり、窪地のすぐそばに土が積もった場合に、せき止められた場所が何か所出るか */
function dammedCount(beforeZ: Float32Array, afterZ: Float32Array, depositAt: number): number {
  const b = analyze(beforeZ)
  const a = analyze(afterZ)
  const deposit = new Float32Array(N * N)
  deposit[depositAt] = 1
  return findDammedSites(
    { fill: b.fill, elevation: beforeZ },
    { fill: a.fill, elevation: afterZ, labels: a.labels, depressions: a.depressions },
    deposit,
    N,
    CELL,
  ).length
}

function analyze(elevation: Float32Array, size = N, cell = CELL) {
  return analyzeDepressions({
    elevation,
    validMask: new Uint8Array(size * size).fill(1),
    width: size,
    height: size,
    cellSizeM: cell,
  })
}

describe('findDammedSites', () => {
  it('Task 3 の V 字谷で、上流の窪地が 1 つせき止められた場所になる', () => {
    const { grid, removed } = valleyWithFill(6)
    const result = simulateCollapse(grid, removed, NEAR)
    const before = analyzeDepressions(terrain(grid.elevation, grid.validMask))
    const after = analyzeDepressions(terrain(result.after, grid.validMask))
    const sites = findDammedSites(
      { fill: before.fill, elevation: grid.elevation },
      {
        fill: after.fill,
        elevation: result.after,
        labels: after.labels,
        depressions: after.depressions,
      },
      result.deposit,
      SIZE,
      CELL,
    )
    expect(sites.length).toBeGreaterThanOrEqual(1)
    const top = sites[0]
    expect(top?.addedCapacityM3).toBeGreaterThan(100)
    expect(top?.capacityM3).toBeGreaterThanOrEqual(top?.addedCapacityM3 ?? Infinity)
    // 窪地は谷筋にかかっていて、spill point は窪地の外
    const dep = after.depressions.find((d) => d.id === top?.depressionId)
    expect(dep?.significant).toBe(true)
    expect(after.labels[top?.spillIndex ?? 0]).toBe(0)
    // 土は谷底に積もっているので、窪地のセルは谷筋の列を含む
    let onValley = false
    for (let r = 0; r < SIZE; r++) {
      if (after.labels[r * SIZE + VALLEY_COL] === top?.depressionId) onValley = true
    }
    expect(onValley).toBe(true)
  })

  it('もともとあった窪地に土が少し入っただけ（容量が増えない）なら、せき止めにしない', () => {
    const ground = flatWithPits([{ r: 5, c: 5, w: 6 }])
    const deposit = new Float32Array(N * N)
    deposit[7 * N + 7] = 0.05
    const afterZ = Float32Array.from(ground, (v, i) => v + (deposit[i] ?? 0))
    const b = analyze(ground)
    const a = analyze(afterZ)
    expect(a.depressions.some((d) => d.significant)).toBe(true)
    expect(
      findDammedSites(
        { fill: b.fill, elevation: ground },
        { fill: a.fill, elevation: afterZ, labels: a.labels, depressions: a.depressions },
        deposit,
        N,
        CELL,
      ),
    ).toEqual([])
  })

  it('平らな土地・崩れる量が小さいと、空の配列（Review Focus 5）', () => {
    const flat = new Float32Array(N * N).fill(100)
    const b = analyze(flat)
    const none = new Float32Array(N * N)
    expect(
      findDammedSites(
        { fill: b.fill, elevation: flat },
        { fill: b.fill, elevation: flat, labels: b.labels, depressions: b.depressions },
        none,
        N,
        CELL,
      ),
    ).toEqual([])

    // 谷に、ごく薄くしか崩れない → せき止めは無い
    const { grid, removed } = valleyWithFill(0.05)
    const result = simulateCollapse(grid, removed, NEAR)
    const vb = analyzeDepressions(terrain(grid.elevation, grid.validMask))
    const va = analyzeDepressions(terrain(result.after, grid.validMask))
    expect(
      findDammedSites(
        { fill: vb.fill, elevation: grid.elevation },
        { fill: va.fill, elevation: result.after, labels: va.labels, depressions: va.depressions },
        result.deposit,
        SIZE,
        CELL,
      ),
    ).toEqual([])
  })

  it('土が窪地のそばに無ければ、容量が増えていてもせき止めにしない', () => {
    const before = new Float32Array(N * N).fill(100)
    const b = analyze(before)
    const afterZ = flatWithPits([{ r: 5, c: 5, w: 5 }])
    const a = analyze(afterZ)
    expect(
      findDammedSites(
        { fill: b.fill, elevation: before },
        { fill: a.fill, elevation: afterZ, labels: a.labels, depressions: a.depressions },
        new Float32Array(N * N),
        N,
        CELL,
      ),
    ).toEqual([])
  })

  it('容量の大きい順', () => {
    const before = new Float32Array(N * N).fill(100)
    const b = analyze(before)
    // 小さい窪地（2x2）を先（行番号が小さい側）に、大きい窪地（4x4）を後ろに置く
    const afterZ = flatWithPits([
      { r: 2, c: 2, w: 3 },
      { r: 10, c: 10, w: 5 },
    ])
    const a = analyze(afterZ)
    const deposit = new Float32Array(N * N)
    deposit[2 * N + 5] = 1
    deposit[10 * N + 15] = 1
    const sites = findDammedSites(
      { fill: b.fill, elevation: before },
      { fill: a.fill, elevation: afterZ, labels: a.labels, depressions: a.depressions },
      deposit,
      N,
      CELL,
    )
    expect(sites.map((s) => s.capacityM3)).toEqual([625, 225])
    expect(sites[0]?.addedCapacityM3).toBeCloseTo(625, 3)
    expect(sites[0]?.depressionId).not.toBe(sites[1]?.depressionId)
  })

  describe('R12 の下限（増えた容量 > max(100 m³, 0.1 × 容量) かつ 面積 ≥ 200 m²。セル 25 m²）', () => {
    const flat = new Float32Array(N * N).fill(100)
    const at = 5 * N + 9 // 窪地のすぐ東（幅 4 の窪地は c = 5〜8）

    it('面積がちょうど 200 m²（8 セル）なら出る。175 m²（7 セル）なら出ない', () => {
      // 深さ 1 m: 8 セルは 200 m³ / 200 m²、7 セルは 175 m³ / 175 m²（容量の下限は超えている）
      expect(dammedCount(flat, flatWithPits([{ r: 5, c: 5, w: 4, h: 2 }]), at)).toBe(1)
      const seven = flatWithPits([{ r: 5, c: 5, w: 4, h: 2 }])
      seven[6 * N + 8] = 100
      expect(dammedCount(flat, seven, at)).toBe(0)
    })

    it('増えた容量がちょうど 100 m³ なら出ない。超えれば出る（面積 200 m² で固定）', () => {
      // 8 セル × 25 m² × 深さ 0.5 m = 100 m³
      expect(dammedCount(flat, flatWithPits([{ r: 5, c: 5, w: 4, h: 2, depth: 0.5 }]), at)).toBe(0)
      expect(dammedCount(flat, flatWithPits([{ r: 5, c: 5, w: 4, h: 2, depth: 0.52 }]), at)).toBe(1)
    })

    it('もともと窪地があって増えたのが容量の 10% 以下なら出ない。超えれば出る', () => {
      // 10×10 セル、深さ 1 m（2500 m³）が、深さ 1.1 m（2750 m³・増分 250 = 9.1%）か 1.2 m（3000 m³・増分 500）になる
      const before = flatWithPits([{ r: 3, c: 3, w: 10 }])
      const place = 8 * N + 13
      expect(dammedCount(before, flatWithPits([{ r: 3, c: 3, w: 10, depth: 1.1 }]), place)).toBe(0)
      expect(dammedCount(before, flatWithPits([{ r: 3, c: 3, w: 10, depth: 1.2 }]), place)).toBe(1)
    })
  })
})
