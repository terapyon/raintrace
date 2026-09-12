import { describe, expect, it } from 'vitest'
import type { ElevationSampler } from '../types'
import { decodeTerrarium, encodeTerrarium, terrariumTile } from './terrarium'

const decodeAt = (rgba: Uint8ClampedArray, px: number, py: number): number => {
  const o = (py * 256 + px) * 4
  return decodeTerrarium(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0)
}

describe('Terrarium（計画 D6）', () => {
  it('符号化して戻すと、誤差は 0 以上 1/256 m 未満（切り捨て）', () => {
    const out = new Uint8ClampedArray(4)
    for (const h of [-12.34, 0, 0.01, 11.08, 23.08, 40.028, 3776.24]) {
      encodeTerrarium(h, out, 0)
      const error = h - decodeTerrarium(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)
      expect(error).toBeGreaterThanOrEqual(0)
      expect(error).toBeLessThan(1 / 256)
      expect(out[3]).toBe(255)
    }
  })

  it('z17 のタイルの画素は、同じ z17 のグローバルピクセルのサンプラーの値', () => {
    const sample: ElevationSampler = (gx, gy) => 10 + (gx % 13) * 0.25 + (gy % 11) * 0.5
    const rgba = terrariumTile(sample, 17, 116399, 51623)
    for (const [px, py] of [
      [0, 0],
      [128, 64],
      [255, 255],
    ] as const) {
      const expected = sample(116399 * 256 + px, 51623 * 256 + py) ?? 0
      expect(expected - decodeAt(rgba, px, py)).toBeLessThan(1 / 256)
    }
  })

  it('z16 のタイルは、画素の中心に当たる z17 の画素を 1 点で取る。無効値は 0m', () => {
    const sample: ElevationSampler = (gx, gy) => (gx === 7 * 512 + 1 ? null : gx * 0.001 + gy)
    const rgba = terrariumTile(sample, 16, 7, 3)
    expect(decodeAt(rgba, 0, 0)).toBeCloseTo(0, 2)
    const expected = (7 * 512 + 3) * 0.001 + (3 * 512 + 1)
    expect(expected - decodeAt(rgba, 1, 0)).toBeLessThan(1 / 256)
  })
})
