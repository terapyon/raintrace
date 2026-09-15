import { describe, expect, it } from 'vitest'
import { decodeGsiDem } from './GsiDemDecoder.ts'
import {
  type CellSampler,
  decodeTerrarium,
  encodeTerrarium,
  fillInvalidNearest,
  sampleCorner,
} from './terrarium.ts'

describe('Terrarium の符号化', () => {
  it('符号化して戻すと、誤差は 0 以上 1/256 m 未満（切り捨て）。負の標高も書ける', () => {
    const out = new Uint8ClampedArray(4)
    for (const h of [-12.34, -0.95, 0, 0.01, 11.08, 23.08, 40.028, 3776.24]) {
      encodeTerrarium(h, out, 0)
      const error = h - decodeTerrarium(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)
      expect(error).toBeGreaterThanOrEqual(0)
      expect(error).toBeLessThan(1 / 256)
      expect(out[3]).toBe(255)
    }
  })

  it('NaN・無限は 0 m として書く（−32768 m の穴にしない）', () => {
    const out = new Uint8ClampedArray(4)
    for (const h of [Number.NaN, Number.POSITIVE_INFINITY]) {
      encodeTerrarium(h, out, 0)
      expect(decodeTerrarium(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)).toBe(0)
    }
  })
})

/** 連続座標の平面。セル gx の値は、その中心（連続座標 gx + 0.5）の高さ（GSI の画素・02 のグリッドと同じ） */
const plane = (x: number, y: number): number => 10 + 0.2 * x - 0.1 * y
const planeCells: CellSampler = (gx, gy) => plane(gx + 0.5, gy + 0.5)

describe('角の規約（MapLibre の DEMData.sampleBilinear。spec 05 §4.2）', () => {
  it('整数の座標（画素の角）の高さは周りの 4 セルの平均で、セルの値そのものではない', () => {
    const corner = sampleCorner(planeCells, 100, 200)
    const four =
      ((planeCells(99, 199) ?? 0) +
        (planeCells(100, 199) ?? 0) +
        (planeCells(99, 200) ?? 0) +
        (planeCells(100, 200) ?? 0)) /
      4
    expect(corner).toBeCloseTo(four, 9)
    expect(corner).toBeCloseTo(plane(100, 200), 9)
    // セル (100, 200) の値を画素にそのまま書くと、半セル（この平面で 0.05 m）ずれる
    expect(Math.abs((corner ?? 0) - (planeCells(100, 200) ?? 0))).toBeGreaterThan(0.04)
  })

  it('端数の座標は双線形（平面なら真の高さと一致する）', () => {
    expect(sampleCorner(planeCells, 100.25, 200.75)).toBeCloseTo(plane(100.25, 200.75), 9)
  })

  it('4 セルのどれかが無い（null）なら null', () => {
    const holed: CellSampler = (gx, gy) => (gx === 99 ? null : planeCells(gx, gy))
    expect(sampleCorner(holed, 100, 200)).toBeNull()
    expect(sampleCorner(holed, 101, 200)).not.toBeNull()
  })
})

describe('fillInvalidNearest（無効セルを 0 m にしない。spec 05 §4.2、計画で決めたこと 5）', () => {
  it('無効セルを最も近い有効セルの値で埋める。元の配列は変えない', () => {
    const elevation = Float32Array.from([1, 0, 0, 4])
    const valid = Uint8Array.from([1, 0, 0, 1])
    expect(Array.from(fillInvalidNearest(elevation, valid, 4, 1))).toEqual([1, 1, 4, 4])
    expect(Array.from(elevation)).toEqual([1, 0, 0, 4])
  })

  it('2 次元でも 4 近傍の歩数が近い方の値になる', () => {
    // 3 × 3。中央と右下が無効
    const elevation = Float32Array.from([5, 5, 5, 5, 0, 7, 5, 7, 0])
    const valid = Uint8Array.from([1, 1, 1, 1, 0, 1, 1, 1, 0])
    expect(Array.from(fillInvalidNearest(elevation, valid, 3, 3))).toEqual([
      5, 5, 5, 5, 5, 7, 5, 7, 7,
    ])
  })

  it('有効セルが 1 つも無ければ fallbackM（既定 0 m。海域のタイル）', () => {
    const none = new Uint8Array(4)
    expect(Array.from(fillInvalidNearest(new Float32Array(4), none, 2, 2))).toEqual([0, 0, 0, 0])
    expect(Array.from(fillInvalidNearest(new Float32Array(4), none, 2, 2, 3))).toEqual([3, 3, 3, 3])
  })
})

describe('raster-dem の encoding: custom で GSI の PNG を直接読めるか（spec 05 §4.4、計画で決めたこと 10）', () => {
  // MapLibre 6.6.0 の DEMData の unpack の式の写し（custom のときは線形: h = R × redFactor + G × greenFactor +
  // B × blueFactor − baseShift）。GSI の係数（655.36・2.56・0.01、baseShift 0）を入れる
  const linear = (rgba: Uint8Array): number =>
    (rgba[0] ?? 0) * 655.36 + (rgba[1] ?? 0) * 2.56 + (rgba[2] ?? 0) * 0.01
  const gsiPixel = (x: number): Uint8Array =>
    Uint8Array.from([(x >> 16) & 255, (x >> 8) & 255, x & 255, 255])

  it('正の標高は一致する', () => {
    const pixel = gsiPixel(1234)
    expect(decodeGsiDem(pixel).elevation[0]).toBeCloseTo(12.34, 5)
    expect(linear(pixel)).toBeCloseTo(12.34, 5)
  })

  it('負の標高（みなとみらいの −6.70 m）と無効値（2^23）は崩れる。したがって custom は採らない', () => {
    const negative = gsiPixel(2 ** 24 - 670)
    expect(decodeGsiDem(negative).elevation[0]).toBeCloseTo(-6.7, 5)
    expect(linear(negative)).toBeGreaterThan(160_000)
    const na = gsiPixel(2 ** 23)
    expect(decodeGsiDem(na).validMask[0]).toBe(0)
    expect(linear(na)).toBeCloseTo(83886.08, 2)
  })
})
