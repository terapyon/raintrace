import { describe, expect, it } from 'vitest'
import { CellQueue } from './CellQueue.ts'

const drain = (queue: CellQueue): number[] => {
  const out: number[] = []
  for (let cell = queue.pop(); cell !== -1; cell = queue.pop()) out.push(cell)
  return out
}

describe('CellQueue', () => {
  it('値の小さい順に取り出し、空なら -1', () => {
    const queue = new CellQueue(3)
    queue.push(10, 3)
    queue.push(11, 1)
    queue.push(12, 2)
    expect(queue.length).toBe(3)
    expect(drain(queue)).toEqual([11, 12, 10])
    expect(queue.pop()).toBe(-1)
  })

  it('同じ値なら先に入れたものから取り出す（決定的）', () => {
    const queue = new CellQueue(4)
    queue.push(7, 5)
    queue.push(3, 5)
    queue.push(9, 5)
    queue.push(1, 4)
    expect(drain(queue)).toEqual([1, 7, 3, 9])
  })

  it('多くの要素でも（値, 挿入順）の順序を保つ', () => {
    const n = 1000
    const keys = Array.from({ length: n }, (_, i) => (i * 7919) % 101)
    const queue = new CellQueue(n)
    keys.forEach((key, cell) => {
      queue.push(cell, key)
    })
    const expected = keys
      .map((key, cell) => [key, cell] as const)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .map(([, cell]) => cell)
    expect(drain(queue)).toEqual(expected)
  })

  it('容量を超えて入れると例外', () => {
    const queue = new CellQueue(1)
    queue.push(0, 0)
    expect(() => queue.push(1, 0)).toThrow('容量')
  })
})
