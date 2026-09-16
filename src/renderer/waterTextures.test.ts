import { describe, expect, it } from 'vitest'
import { lutIndex, packLutRgba, type WaterLut, waterVertexHeightM } from './waterTextures'

describe('テクスチャへの詰め方（spec 05 §3.1）', () => {
  it('LUT は 1 行の RGBA（アルファ 255。不透明度はシェーダの uniform で掛ける）', () => {
    expect(Array.from(packLutRgba(Uint8Array.from([1, 2, 3, 4, 5, 6])))).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
    ])
  })
})

describe('垂直強調の変換（頂点シェーダと同じ式。spec 05 §3.1・§3.2）', () => {
  it('高さ = (標高 + 水深) × 倍率。1 cm 未満の水深は足さない（その頂点は地形と同じ高さ）', () => {
    expect(waterVertexHeightM(10, 0.2, 1, 0.01)).toBeCloseTo(10.2, 9)
    expect(waterVertexHeightM(10, 0.2, 5, 0.01)).toBeCloseTo(51, 9)
    expect(waterVertexHeightM(10, 0.2, 10, 0.01)).toBeCloseTo(102, 9)
    expect(waterVertexHeightM(10, 0.005, 5, 0.01)).toBeCloseTo(50, 9)
  })
})

describe('LUT の帯（フラグメントシェーダと同じ式）', () => {
  const lut: WaterLut = {
    rgb: new Uint8Array(21 * 3),
    bandsPerM: 20,
    maxIndex: 20,
    epsilonM: 1e-6,
    alpha: 0.74,
    minDepthM: 0.01,
  }
  it('帯 = min(最大, floor((水深 + 余裕) × 帯/m))。1 m 以上は最後の帯', () => {
    expect(lutIndex(0.07, lut)).toBe(1)
    expect(lutIndex(0.35, lut)).toBe(7)
    expect(lutIndex(1.5, lut)).toBe(20)
  })
})
