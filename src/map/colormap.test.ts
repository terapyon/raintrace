import { describe, expect, it } from 'vitest'
import { DEPTH_TOLERANCE_M as DEPTH_TOLERANCE_M_TERRAIN } from '../simulation/terrain/analyzeDepressions'
import { makeDepression } from '../simulation/testing/terrainGrids.test-support'
import {
  DEPRESSION_BANDS,
  DEPTH_TOLERANCE_M,
  depressionLegendCss,
  depressionRgba,
  depthBand,
  elevationColor,
  elevationRgba,
  interpolateStops,
} from './colormap'

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
    [0.0485, 0], // 閾値（0.05）から 1mm を超えて離れているので帯は変わらない
    [0.051, 1],
    [0.12, 2],
    [10, 7],
  ])('深さ %f m は帯 %i', (depth, band) => {
    expect(depthBand(depth)).toBe(band)
  })

  it('Float32 の丸めで 0.05 未満になった深さ（3.05 − 3.00）も帯 1 になる', () => {
    expect(depthBand(Math.fround(3.05) - Math.fround(3.0))).toBe(1)
  })
})

describe('DEPTH_TOLERANCE_M', () => {
  it('analyzeDepressions.ts の同名の定数と同じ値', () => {
    expect(DEPTH_TOLERANCE_M).toBe(DEPTH_TOLERANCE_M_TERRAIN)
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
    // 窪地の id は 1 から順（types.ts）。id 1 は表示対象、id 2 は表示対象でない
    const depressions = [
      makeDepression({ id: 1, significant: true }),
      makeDepression({ id: 2, significant: false }),
    ]
    const rgba = depressionRgba(fill, elevation, labels, depressions)
    expect(rgba[3]).toBeGreaterThan(0) // 深さ 0.1m、帯 2
    expect([...rgba.slice(0, 3)]).not.toEqual([...rgba.slice(4, 7)]) // 帯 2 と帯 7 は違う色
    expect(rgba[11]).toBe(0) // 窪地 2 は表示対象でない
  })

  it('窪地の外（ラベル 0）は透明', () => {
    const rgba = depressionRgba(
      new Float32Array([10]),
      new Float32Array([9]),
      new Int32Array([0]),
      [],
    )
    expect(rgba[3]).toBe(0)
  })
})

describe('depressionLegendCss', () => {
  it('窪地の 8 帯の色の境目を持つ線形グラデーション（02 の申し送り L4）', () => {
    const css = depressionLegendCss()
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true)
    expect(css.split('rgb(').length - 1).toBe(8)
  })
})

describe('interpolateStops（標高と水深の配色で共有する線形補間）', () => {
  const stops = [
    [0, 0, 0],
    [100, 200, 50],
    [200, 200, 250],
  ] as const

  it('点の間を線形に補間し、0〜1 の外は端の色に丸める', () => {
    expect(interpolateStops(stops, 0.25)).toEqual([50, 100, 25])
    expect(interpolateStops(stops, 1)).toEqual([200, 200, 250])
    expect(interpolateStops(stops, -1)).toEqual([0, 0, 0])
    expect(interpolateStops(stops, 2)).toEqual([200, 200, 250])
  })
})

describe('RGBA の組み立ては、配列を作らない版でも旧版とビット単位で同じ（spec 06 §5.2）', () => {
  /** 決まった種の擬似乱数（mulberry32） */
  function random(seed: number): () => number {
    let a = seed
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** 置き換える前の elevationRgba（06 の Task 16 の前の colormap.ts の写し） */
  function referenceElevationRgba(
    elevation: Float32Array,
    validMask: Uint8Array,
    min: number,
    max: number,
  ): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(elevation.length * 4)
    const span = max - min
    for (let i = 0; i < elevation.length; i++) {
      if (validMask[i] !== 1) continue
      const [r, g, b] = elevationColor(span > 0 ? ((elevation[i] ?? min) - min) / span : 0)
      rgba.set([r, g, b, 200], i * 4)
    }
    return rgba
  }

  it('elevationRgba: 無効セル・範囲の外・NaN・最低と最高が同じ場合を含めて一致する', () => {
    const next = random(7)
    const n = 4096
    const elevation = new Float32Array(n)
    const validMask = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      elevation[i] = next() * 40 - 5
      validMask[i] = next() < 0.1 ? 0 : 1
    }
    elevation[3] = Number.NaN
    for (const [min, max] of [
      [-2, 30],
      [5, 5],
      [10, 0],
    ] as const) {
      expect(Array.from(elevationRgba(elevation, validMask, min, max))).toEqual(
        Array.from(referenceElevationRgba(elevation, validMask, min, max)),
      )
    }
  })

  /** 置き換える前の depressionRgba（06 の Task 16 の前の colormap.ts の写し） */
  function referenceDepressionRgba(
    fill: Float32Array,
    elevation: Float32Array,
    labels: Int32Array,
    depressions: Parameters<typeof depressionRgba>[3],
  ): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(fill.length * 4)
    for (let i = 0; i < fill.length; i++) {
      const label = labels[i] ?? 0
      if (label === 0 || !depressions[label - 1]?.significant) continue
      const depth = (fill[i] ?? 0) - (elevation[i] ?? 0)
      if (depth <= 0) continue
      const color = DEPRESSION_BANDS[depthBand(depth)] ?? [0, 0, 0]
      rgba.set([color[0], color[1], color[2], 220], i * 4)
    }
    return rgba
  }

  it('depressionRgba: 表示対象・対象外・深さ 0 以下・最も深い帯を含めて一致する', () => {
    const next = random(11)
    const n = 2048
    const fill = new Float32Array(n)
    const elevation = new Float32Array(n)
    const labels = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      elevation[i] = next() * 3
      fill[i] = (elevation[i] ?? 0) + (next() < 0.2 ? -0.01 : next() * 0.6)
      labels[i] = Math.floor(next() * 4)
    }
    const depressions = [
      makeDepression({ id: 1, significant: true }),
      makeDepression({ id: 2, significant: false }),
      makeDepression({ id: 3, significant: true }),
    ]
    expect(Array.from(depressionRgba(fill, elevation, labels, depressions))).toEqual(
      Array.from(referenceDepressionRgba(fill, elevation, labels, depressions)),
    )
  })
})
