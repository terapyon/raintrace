import { describe, expect, it } from 'vitest'
import { fillDeltaRgba } from './fillColormap'
import { FILL_EDGE_COLOR, FILL_EDGE_SELECTED_COLOR, hexToRgb } from './overlayColors'

const px = (rgba: Uint8ClampedArray, i: number): number[] =>
  Array.from(rgba.slice(i * 4, i * 4 + 4))

describe('fillDeltaRgba（spec 09 §4.2）', () => {
  it('+4.9 は透明、+5 は赤、−5 は青、NaN は透明', () => {
    const delta = Float32Array.of(4.9, 5, -5, Number.NaN)
    const rgba = fillDeltaRgba(delta, new Int32Array(4), 2, null)
    expect(px(rgba, 0)[3]).toBe(0)
    const rise = px(rgba, 1)
    const cut = px(rgba, 2)
    expect(rise[3]).toBeGreaterThan(0)
    expect(rise[0]).toBeGreaterThan(rise[2] ?? 0)
    expect(cut[3]).toBeGreaterThan(0)
    expect(cut[2]).toBeGreaterThan(cut[0] ?? 0)
    expect(px(rgba, 3)[3]).toBe(0)
  })

  it('+20 以上は +5 より濃い（頭打ち）', () => {
    const rgba = fillDeltaRgba(Float32Array.of(5, 20, 50, 0), new Int32Array(4), 2, null)
    expect(px(rgba, 1)).toEqual(px(rgba, 2))
    expect(px(rgba, 1)[1]).toBeLessThan(px(rgba, 0)[1] ?? 0)
  })

  it('選んだ候補の縁は黄、他の縁は灰。内側のセルは縁にしない', () => {
    const size = 4
    const labels = new Int32Array(size * size)
    labels.set([1, 1, 2, 2], 0)
    labels.set([1, 1, 2, 2], 4)
    const delta = new Float32Array(size * size).fill(10)
    const rgba = fillDeltaRgba(delta, labels, size, 2)
    const grey = [...hexToRgb(FILL_EDGE_COLOR), 255]
    const yellow = [...hexToRgb(FILL_EDGE_SELECTED_COLOR), 255]
    expect(px(rgba, 1)).toEqual(grey)
    expect(px(rgba, 2)).toEqual(yellow)
    // 上端（地図の外は別 label ではない）の候補 1 の左端 (0,0) は、下も右も同じ label で縁ではない
    expect(px(rgba, 0)).not.toEqual(grey)
    // 3 行目は label 0。候補 1 の (1,0) は下が label 0 なので縁
    expect(px(rgba, 4)).toEqual(grey)
  })
})
