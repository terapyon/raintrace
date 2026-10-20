import { describe, expect, it } from 'vitest'
import { removedThickness } from './removedThickness.ts'

describe('removedThickness', () => {
  it('候補のセルだけ ratio × max(0, delta)、負と NaN は 0', () => {
    const delta = new Float32Array([4, -2, NaN, 8, 6])
    const labels = new Int32Array([1, 1, 1, 2, 0])
    const r = removedThickness(delta, labels, 1, 0.5)
    expect(Array.from(r)).toEqual([2, 0, 0, 0, 0])
  })
})
