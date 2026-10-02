import { describe, expect, it } from 'vitest'
import {
  hexToRgb,
  MARKER_COLORS,
  OUTFLOW_COLOR,
  OUTFLOW_OPACITY,
  OUTFLOW_VISIBLE_M,
} from './overlayColors'

describe('地図の印と流出の色（spec 07 §3.6・§5.2）', () => {
  it('印は最低点が青、あふれ出し点がオレンジ。流出は赤紫（不透明度 0.9）、閾値は 1 mm（R07-1）', () => {
    expect(MARKER_COLORS).toEqual({ lowest: '#1565c0', spill: '#ef6c00' })
    expect(OUTFLOW_COLOR).toBe('#c2185b')
    expect(OUTFLOW_OPACITY).toBe(0.9)
    expect(OUTFLOW_VISIBLE_M).toBe(0.001)
  })

  it('hexToRgb は #rrggbb を 0〜255 の 3 つにする', () => {
    expect(hexToRgb('#c2185b')).toEqual([194, 24, 91])
    expect(hexToRgb(MARKER_COLORS.lowest)).toEqual([21, 101, 192])
    expect(hexToRgb(MARKER_COLORS.spill)).toEqual([239, 108, 0])
  })
})
