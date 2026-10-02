import { describe, expect, it } from 'vitest'
import {
  ARROW_MIN_VELOCITY_M_PER_S,
  CFL_ALPHA,
  DEPTH_EPSILON_M,
  DRY_DEPTH_M,
  DT_MAX_S,
  FLOODED_DEPTH_M,
  FROUDE_MAX,
  GRAVITY,
  MANNING_N,
  MASS_TOLERANCE_REL,
  massTolerance,
  SETTLE_CAP_S,
  SETTLE_VELOCITY_M_PER_S,
  SPILL_TOLERANCE_M,
  SURFACE_ELEVATION_TOLERANCE_M,
  THETA,
} from './constants.ts'

describe('許容誤差（tech-spec §6.6）', () => {
  it('表の値と一致する', () => {
    expect(MASS_TOLERANCE_REL).toBe(1e-9)
    expect(SURFACE_ELEVATION_TOLERANCE_M).toBe(0.01)
    expect(DRY_DEPTH_M).toBe(1e-5)
  })

  it('水深の比較許容値は面を通れる水深の閾値と同じ値', () => {
    expect(DEPTH_EPSILON_M).toBe(DRY_DEPTH_M)
  })

  it('質量保存の許容誤差は投入総量に比例する', () => {
    expect(massTolerance(0)).toBe(0)
    expect(massTolerance(1000)).toBeCloseTo(1e-6, 15)
  })
})

describe('エンジンの定数（spec 03 §3.11）', () => {
  it('表の値と一致する', () => {
    expect(FLOODED_DEPTH_M).toBe(0.01)
    expect(SPILL_TOLERANCE_M).toBe(0.01)
  })
})

describe('局所慣性式の定数（spec 08 §3.12）', () => {
  it('表の値と一致する', () => {
    expect(GRAVITY).toBe(9.81)
    expect(MANNING_N).toBe(0.03)
    expect(CFL_ALPHA).toBe(0.5)
    expect(THETA).toBe(0.8)
    expect(DT_MAX_S).toBe(1)
    expect(DRY_DEPTH_M).toBe(1e-5)
    expect(FROUDE_MAX).toBe(1)
    expect(SETTLE_VELOCITY_M_PER_S).toBe(0.01)
    expect(SETTLE_CAP_S).toBe(6 * 3600)
    expect(ARROW_MIN_VELOCITY_M_PER_S).toBe(0.005)
  })

  it('α は θ 重み付けの 2 次元の安定の上限 √(θ/2) より小さい（M0 の U2）', () => {
    expect(CFL_ALPHA).toBeLessThan(Math.sqrt(THETA / 2))
  })
})
