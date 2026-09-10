import { describe, expect, it } from 'vitest'
import { depressionRgba, depthBand, elevationColor, elevationRgba } from './colormap'

describe('elevationColor', () => {
  it('両端は決めた色、範囲外は端に丸める', () => {
    expect(elevationColor(0)).toEqual([0, 32, 77])
    expect(elevationColor(1)).toEqual([255, 234, 70])
    expect(elevationColor(-1)).toEqual(elevationColor(0))
    expect(elevationColor(2)).toEqual(elevationColor(1))
  })

  it('途中は隣り合う色の間を補間する', () => {
    const [r] = elevationColor(0.125) // 0 と 0.25 の中間
    expect(r).toBe(Math.round((0 + 65) / 2))
  })
})

describe('depthBand（5cm 刻み）', () => {
  it.each([
    [0.01, 0],
    [0.049, 0],
    [0.051, 1],
    [0.12, 2],
    [10, 7],
  ])('深さ %f m は帯 %i', (depth, band) => {
    expect(depthBand(depth)).toBe(band)
  })
})

describe('elevationRgba', () => {
  it('最低は始点の色、最高は終点の色、無効セルは透明', () => {
    const rgba = elevationRgba(new Float32Array([1, 3, 2]), new Uint8Array([1, 1, 0]), 1, 3)
    expect([...rgba.slice(0, 3)]).toEqual([0, 32, 77])
    expect([...rgba.slice(4, 7)]).toEqual([255, 234, 70])
    expect(rgba[3]).toBeGreaterThan(0)
    expect(rgba[11]).toBe(0)
  })

  it('最低と最高が同じなら始点の色', () => {
    const rgba = elevationRgba(new Float32Array([5]), new Uint8Array([1]), 5, 5)
    expect([...rgba.slice(0, 3)]).toEqual([0, 32, 77])
  })
})

describe('depressionRgba', () => {
  it('表示対象の窪地の中だけを、満水時の深さの帯で塗る', () => {
    const fill = new Float32Array([10, 10, 10])
    const elevation = new Float32Array([9.9, 9.5, 9.0])
    const labels = new Int32Array([1, 1, 2])
    const rgba = depressionRgba(fill, elevation, labels, new Set([1]))
    expect(rgba[3]).toBeGreaterThan(0) // 深さ 0.1m、帯 2
    expect([...rgba.slice(0, 3)]).not.toEqual([...rgba.slice(4, 7)]) // 帯 2 と帯 7 は違う色
    expect(rgba[11]).toBe(0) // 窪地 2 は表示対象でない
  })

  it('窪地の外（ラベル 0）は透明', () => {
    const rgba = depressionRgba(
      new Float32Array([10]),
      new Float32Array([9]),
      new Int32Array([0]),
      new Set([1]),
    )
    expect(rgba[3]).toBe(0)
  })
})
