import { describe, expect, it } from 'vitest'
import {
  DEPTH_EPSILON_M,
  FLOW_THRESHOLD_M,
  MASS_TOLERANCE_REL,
  massTolerance,
  SURFACE_ELEVATION_TOLERANCE_M,
} from './constants.ts'

describe('許容誤差（tech-spec §6.6）', () => {
  it('表の値と一致する', () => {
    expect(MASS_TOLERANCE_REL).toBe(1e-9)
    expect(SURFACE_ELEVATION_TOLERANCE_M).toBe(0.01)
    expect(FLOW_THRESHOLD_M).toBe(1e-5)
  })

  it('水深の比較許容値は流れの閾値 θ と同じ値', () => {
    expect(DEPTH_EPSILON_M).toBe(FLOW_THRESHOLD_M)
  })

  it('質量保存の許容誤差は投入総量に比例する', () => {
    expect(massTolerance(0)).toBe(0)
    expect(massTolerance(1000)).toBeCloseTo(1e-6, 15)
  })
})
