import { describe, expect, it } from 'vitest'
import {
  formatCellSize,
  formatCoordinate,
  formatCubicMeters,
  formatDemLabel,
  formatMeters,
  formatPercent,
} from './format'

describe('表示の書式', () => {
  it('標高と水深は 0.01m 単位', () => {
    expect(formatMeters(11.084)).toBe('11.08 m')
    expect(formatMeters(-0.005)).toBe('-0.01 m')
  })

  it('座標は小数 6 桁、セルは「約」つき、割合は小数 1 桁、容量は m³', () => {
    expect(formatCoordinate(139.70160004)).toBe('139.701600')
    expect(formatCellSize(0.97834)).toBe('約 0.98 m')
    expect(formatPercent(0.1234)).toBe('12.3%')
    expect(formatCubicMeters(18)).toBe('18.00 m³')
  })

  it('DEM は最も多く使った種類を主にし、ほかは「一部」として添える', () => {
    expect(formatDemLabel({ dem1a: 9 })).toBe('DEM1A')
    expect(formatDemLabel({ dem5a: 6, dem5b: 3 })).toBe('DEM5A（一部 DEM5B）')
    expect(formatDemLabel({ dem5b: 2, dem5a: 2, dem5c: 1 })).toBe('DEM5A（一部 DEM5B、DEM5C）')
    expect(formatDemLabel({})).toBe('—')
  })
})
