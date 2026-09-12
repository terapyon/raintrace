import { describe, expect, it } from 'vitest'
import {
  formatArea,
  formatCellSize,
  formatCoordinate,
  formatCubicMeters,
  formatDemLabel,
  formatMeters,
  formatPercent,
  formatStep,
  formatStepsPerSecond,
  formatVolume,
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

  it('水量は小数 1 桁、1 m³ 未満は小数 2 桁（spec 04 §6.3）', () => {
    expect(formatVolume((Math.PI * 100 * 100) / 1000)).toBe('31.4 m³')
    expect(formatVolume(0.456)).toBe('0.46 m³')
    expect(formatVolume(0)).toBe('0.00 m³')
    expect(formatVolume(1)).toBe('1.0 m³')
  })

  it('湛水面積は m²、実行速度は step／秒、Step は「Step N」', () => {
    expect(formatArea(82.4)).toBe('82 m²')
    expect(formatStepsPerSecond(59.6)).toBe('60 step/秒')
    expect(formatStep(1234)).toBe('Step 1234')
  })
})
