import { describe, expect, it } from 'vitest'
import {
  continuousIndex,
  steppedIndex,
  WATER_ALPHA,
  WATER_BANDS,
  WATER_LAYER_OPACITY,
  WATER_VISIBLE_M,
  waterColorAt,
  waterLegendCss,
  waterLutSpec,
  waterRgba,
} from './waterColormap'

describe('steppedIndex（5cm 刻み、1m で頭打ち。tech-spec §6.6）', () => {
  it.each([
    [0.01, 0],
    [0.0499, 0],
    [Math.fround(0.05), 1],
    [Math.fround(0.35), 7], // Float32 の 0.35 は 0.35 より小さい。余裕 1e-6 m で帯 7 に入れる
    [0.999, 19],
    [1, WATER_BANDS],
    [5, WATER_BANDS],
  ])('水深 %f m は帯 %i', (depth, band) => {
    expect(steppedIndex(depth)).toBe(band)
  })
})

describe('continuousIndex（1cm 刻みの連続表示）', () => {
  it.each([
    [0.01, 1],
    [Math.fround(0.5), 50],
    [1, 100],
    [3, 100],
  ])('水深 %f m は %i', (depth, index) => {
    expect(continuousIndex(depth)).toBe(index)
  })
})

describe('waterColorAt', () => {
  it('1cm 未満と NaN は透明（null）。base-spec §30 の描画閾値', () => {
    expect(waterColorAt('stepped', 0.0099)).toBeNull()
    expect(waterColorAt('stepped', 0)).toBeNull()
    expect(waterColorAt('stepped', Number.NaN)).toBeNull()
    expect(waterColorAt('stepped', 0.01)).not.toBeNull()
  })

  it('段階表示: 同じ帯の中は同じ色、隣の帯は違う色、1m 以上は 1 色', () => {
    expect(waterColorAt('stepped', 0.06)).toEqual(waterColorAt('stepped', 0.09))
    expect(waterColorAt('stepped', 0.04)).not.toEqual(waterColorAt('stepped', 0.06))
    expect(waterColorAt('stepped', 1)).toEqual(waterColorAt('stepped', 7))
    expect(waterColorAt('stepped', 0.99)).not.toEqual(waterColorAt('stepped', 1))
  })

  it('深いほど暗い（明度の順序で読める）', () => {
    const brightness = (d: number) =>
      (waterColorAt('continuous', d) ?? [0, 0, 0]).reduce((a, c) => a + c)
    expect(brightness(0.1)).toBeGreaterThan(brightness(0.5))
    expect(brightness(0.5)).toBeGreaterThan(brightness(0.9))
  })
})

describe('waterRgba', () => {
  it('LUT の色と不透明度を書き、1cm 未満は透明にする。前の内容（乾いたセル）も上書きする', () => {
    const out = new Uint8ClampedArray(3 * 4).fill(255)
    waterRgba(Float32Array.of(0.005, 0.3, 2), 'stepped', out)
    expect(out[3]).toBe(0)
    expect([...out.slice(4, 7)]).toEqual(waterColorAt('stepped', 0.3))
    expect(out[7]).toBeGreaterThan(0)
    expect([...out.slice(8, 11)]).toEqual(waterColorAt('stepped', 2))
  })
})

describe('waterLegendCss', () => {
  it('段階表示は帯ごとの色の境目を持つ線形グラデーション', () => {
    const css = waterLegendCss('stepped')
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true)
    expect(css.split('rgb(').length - 1).toBe(WATER_BANDS + 1)
  })
})

describe('waterLutSpec（3D の水面の LUT。計画で決めたこと 17）', () => {
  it.each(['stepped', 'continuous'] as const)(
    '%s: シェーダの帯の求め方は 2D と同じ帯になり（帯の境目ちょうどの値を除く）、色も 2D と同じ',
    (palette) => {
      const spec = waterLutSpec(palette)
      const index2d = palette === 'stepped' ? steppedIndex : continuousIndex
      expect(spec.rgb.length).toBe((spec.maxIndex + 1) * 3)
      for (let k = 0; k < 300; k++) {
        const d = 0.0123 + k * 0.0071
        const index = Math.min(spec.maxIndex, Math.floor((d + spec.epsilonM) * spec.bandsPerM))
        expect(index).toBe(index2d(d))
        expect(Array.from(spec.rgb.slice(index * 3, index * 3 + 3))).toEqual(
          waterColorAt(palette, d),
        )
      }
    },
  )

  it('不透明度は 2D の見え方（1 画素 210/255 × レイヤー 0.9）。1 cm 未満は描かない', () => {
    const spec = waterLutSpec('stepped')
    expect(spec.alpha).toBeCloseTo((WATER_ALPHA / 255) * WATER_LAYER_OPACITY, 12)
    expect(spec.minDepthM).toBe(WATER_VISIBLE_M)
  })
})
