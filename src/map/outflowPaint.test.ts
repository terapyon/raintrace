import { describe, expect, it } from 'vitest'
import { clearOutflow, createOutflowPainted, paintOutflow } from './outflowPaint'

/**
 * 1 行 6 セルの範囲。帯は 0・1・2（0 と 1 は 0 を、2 は 2 を指す）。3〜5 は帯の外
 */
const outflow = {
  band: Int32Array.of(0, 1, 2),
  nearest: Int32Array.of(0, 0, 2, -1, -1, -1),
}
const alpha = (rgba: Uint8ClampedArray): number[] =>
  Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3] ?? 0)

describe('paintOutflow（spec 07 §5.1・§5.2）', () => {
  it('nearest の指すセルの水深が 1 mm 以上なら、帯のセルを #c2185b（不透明）で塗る。閾値の境目', () => {
    const rgba = new Uint8ClampedArray(6 * 4)
    const painted = createOutflowPainted(outflow.band)
    const water = Float32Array.of(0.001, 0, 0.0009, 1, 1, 1)
    expect(paintOutflow(water, outflow, rgba, painted)).toBe(true)
    // 0 と 1 は 0 の水深（1 mm）で塗る。2 は 0.9 mm で塗らない。帯の外（3〜5）は水があっても塗らない
    expect(alpha(rgba)).toEqual([255, 255, 0, 0, 0, 0])
    expect(Array.from(rgba.slice(0, 4))).toEqual([194, 24, 91, 255])
    expect(painted.count).toBe(2)
  })

  it('前回塗ったセルのうち、今回塗らないものは透明にする', () => {
    const rgba = new Uint8ClampedArray(6 * 4)
    const painted = createOutflowPainted(outflow.band)
    paintOutflow(Float32Array.of(1, 0, 0, 0, 0, 0), outflow, rgba, painted)
    expect(paintOutflow(Float32Array.of(0, 0, 1, 0, 0, 0), outflow, rgba, painted)).toBe(true)
    expect(alpha(rgba)).toEqual([0, 0, 255, 0, 0, 0])
  })

  it('塗るセルが前回と同じなら rgba に触れず false（転送しない。計画で決めたこと 7）', () => {
    const rgba = new Uint8ClampedArray(6 * 4)
    const painted = createOutflowPainted(outflow.band)
    paintOutflow(Float32Array.of(1, 0, 0, 0, 0, 0), outflow, rgba, painted)
    rgba[3] = 7 // 触れたかどうかの目印
    expect(paintOutflow(Float32Array.of(0.5, 0, 0, 0, 0, 0), outflow, rgba, painted)).toBe(false)
    expect(rgba[3]).toBe(7)
  })

  it('帯が空なら何も塗らず、false（全部無効の範囲。Review Focus 2）', () => {
    const empty = { band: new Int32Array(0), nearest: new Int32Array(6).fill(-1) }
    const rgba = new Uint8ClampedArray(6 * 4)
    expect(
      paintOutflow(
        Float32Array.of(1, 1, 1, 1, 1, 1),
        empty,
        rgba,
        createOutflowPainted(empty.band),
      ),
    ).toBe(false)
    expect(alpha(rgba)).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe('clearOutflow（setWater(null) の経路。推奨 R4）', () => {
  it('塗っているセルを全部透明にし、消したものがあれば true。2 回目は false', () => {
    const rgba = new Uint8ClampedArray(6 * 4)
    const painted = createOutflowPainted(outflow.band)
    paintOutflow(Float32Array.of(1, 0, 1, 0, 0, 0), outflow, rgba, painted)
    expect(clearOutflow(rgba, painted)).toBe(true)
    expect(alpha(rgba)).toEqual([0, 0, 0, 0, 0, 0])
    expect(painted.count).toBe(0)
    expect(clearOutflow(rgba, painted)).toBe(false)
  })
})
