import { afterEach, describe, expect, it, vi } from 'vitest'
import { createThrottle } from './throttle'

afterEach(() => {
  vi.useRealTimers()
})

describe('createThrottle（統計の 10Hz への間引き。tech-spec §5.1）', () => {
  it('最初の値はすぐ渡し、間隔の中の値は最新の 1 つだけを間隔の終わりに渡す', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const throttle = createThrottle<number>(100, (v) => seen.push(v))
    throttle.push(1)
    vi.advanceTimersByTime(30)
    throttle.push(2)
    vi.advanceTimersByTime(30)
    throttle.push(3)
    expect(seen).toEqual([1])
    vi.advanceTimersByTime(40)
    expect(seen).toEqual([1, 3])
  })

  it('間隔が過ぎてからの値はすぐ渡す', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const throttle = createThrottle<number>(100, (v) => seen.push(v))
    throttle.push(1)
    vi.advanceTimersByTime(150)
    throttle.push(2)
    expect(seen).toEqual([1, 2])
  })

  it('flush で待っている値をすぐ渡し、cancel で捨ててタイマーを残さない', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const throttle = createThrottle<number>(100, (v) => seen.push(v))
    throttle.push(1)
    throttle.push(2)
    throttle.flush()
    expect(seen).toEqual([1, 2])
    throttle.push(3)
    throttle.cancel()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(200)
    expect(seen).toEqual([1, 2])
  })
})
