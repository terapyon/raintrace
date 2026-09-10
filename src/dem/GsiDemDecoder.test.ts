import { describe, expect, it } from 'vitest'
import { decodeGsiDem } from './GsiDemDecoder.ts'

/** テスト用のエンコーダ: 標高（m）を RGBA にする。null は無効値 */
function encode(values: (number | null)[]): Uint8Array {
  const rgba = new Uint8Array(values.length * 4)
  values.forEach((value, p) => {
    let x = value === null ? 2 ** 23 : Math.round(value * 100)
    if (x < 0) x += 2 ** 24
    rgba.set([(x >> 16) & 255, (x >> 8) & 255, x & 255, 255], p * 4)
  })
  return rgba
}

describe('decodeGsiDem', () => {
  it.each([
    [[0, 0, 0], 0],
    [[0, 0, 1], 0.01],
    [[0, 1, 0], 2.56],
    [[1, 0, 0], 655.36],
    [[255, 255, 255], -0.01],
  ])('RGB %j は %f m', ([r, g, b], meters) => {
    const decoded = decodeGsiDem(new Uint8Array([r ?? 0, g ?? 0, b ?? 0, 255]))
    expect(decoded.validMask[0]).toBe(1)
    // 標高は Float32Array に入る（655.36 は 655.3599853…）。0.05mm 未満で比べる（tech-spec §6.5）
    expect(decoded.elevation[0]).toBeCloseTo(meters, 4)
  })

  it('RGB (128, 0, 0) は無効値。標高は 0 のまま', () => {
    const decoded = decodeGsiDem(new Uint8Array([128, 0, 0, 255]))
    expect(decoded.validMask[0]).toBe(0)
    expect(decoded.elevation[0]).toBe(0)
  })

  it('アルファは見ない', () => {
    expect(decodeGsiDem(new Uint8Array([0, 0, 1, 0])).elevation[0]).toBeCloseTo(0.01, 5)
  })

  it('エンコーダで往復させた値が 1mm 以内で戻る（-500〜4000m、無効値を含む）', () => {
    let seed = 1
    const next = (): number => {
      seed = (seed * 48271) % 2147483647
      return seed / 2147483647
    }
    const values = Array.from({ length: 2000 }, (_, i) =>
      i % 97 === 0 ? null : Math.round((next() * 4500 - 500) * 100) / 100,
    )
    const decoded = decodeGsiDem(encode(values))
    values.forEach((value, i) => {
      expect(decoded.validMask[i]).toBe(value === null ? 0 : 1)
      if (value !== null) {
        expect(Math.abs((decoded.elevation[i] ?? Number.NaN) - value)).toBeLessThan(0.001)
      }
    })
  })
})
