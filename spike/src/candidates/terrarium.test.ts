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

  it('z17 でも、画素は角の連続座標に合わせて周囲 4 セル（重みは常に 0.5）の平均を取る', () => {
    // レビュー Important 2: サンプラーはセルの中心（連続座標 gx + 0.5）の値を返すので、
    // タイルの角 gx はちょうど 2 セルの中間になり、重みは常に 0.5（4 セルの単純平均）になる
    const sample: ElevationSampler = (gx, gy) => 10 + (gx % 13) * 0.25 + (gy % 11) * 0.5
    const rgba = terrariumTile(sample, 17, 116399, 51623)
    for (const [px, py] of [
      [0, 0],
      [128, 64],
      [255, 255],
    ] as const) {
      const gx = 116399 * 256 + px
      const gy = 51623 * 256 + py
      const expected =
        ((sample(gx - 1, gy - 1) ?? 0) +
          (sample(gx, gy - 1) ?? 0) +
          (sample(gx - 1, gy) ?? 0) +
          (sample(gx, gy) ?? 0)) /
        4
      expect(Math.abs(expected - decodeAt(rgba, px, py))).toBeLessThan(1 / 256)
    }
  })

  it('z16 のタイルも同じ角の合わせ方（+0.5 の補正なし）。無効値は 0m として平均する', () => {
    // 角 gx = (7 × 256 + 1) × 2 = 3586 の周囲 4 セルのうち x = 3583・3584 を無効にする
    const sample: ElevationSampler = (gx, gy) =>
      gx === 3583 || gx === 3584 ? null : gx * 0.001 + gy
    const rgba = terrariumTile(sample, 16, 7, 3)
    // 画素 (0, 0) の角 gx = (7 × 256 + 0) × 2 = 3584 の周囲 4 セルは x = 3583・3584 のみ → 全て無効
    expect(decodeAt(rgba, 0, 0)).toBeCloseTo(0, 2)
    const gx = 7 * 512 + 2 // (7 × 256 + 1) × 2
    const gy = 3 * 512 // (3 × 256 + 0) × 2
    const expected =
      ((sample(gx - 1, gy - 1) ?? 0) +
        (sample(gx, gy - 1) ?? 0) +
        (sample(gx - 1, gy) ?? 0) +
        (sample(gx, gy) ?? 0)) /
      4
    expect(Math.abs(expected - decodeAt(rgba, 1, 0))).toBeLessThan(1 / 256)
  })
})
