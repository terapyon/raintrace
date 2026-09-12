import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebounce } from './debounce'

afterEach(() => {
  vi.useRealTimers()
})

describe('createDebounce（URL の書き込みの間引き。spec 04 §7）', () => {
  it('300ms の間に何度 schedule しても、最後の呼び出しから 300ms 後に 1 回だけ emit する', () => {
    vi.useFakeTimers()
    let count = 0
    const debounce = createDebounce(() => {
      count++
    }, 300)
    debounce.schedule()
    vi.advanceTimersByTime(100)
    debounce.schedule()
    vi.advanceTimersByTime(100)
    debounce.schedule()
    expect(count).toBe(0)
    vi.advanceTimersByTime(299)
    expect(count).toBe(0)
    vi.advanceTimersByTime(1)
    expect(count).toBe(1)
  })

  it('schedule のたびにタイマーが延びる（最初の schedule から 300ms では emit しない）', () => {
    vi.useFakeTimers()
    let count = 0
    const debounce = createDebounce(() => {
      count++
    }, 300)
    debounce.schedule()
    vi.advanceTimersByTime(200)
    debounce.schedule()
    vi.advanceTimersByTime(200)
    expect(count).toBe(0)
    vi.advanceTimersByTime(100)
    expect(count).toBe(1)
  })

  it('cancel すれば emit しない。待っているタイマーも残さない', () => {
    vi.useFakeTimers()
    let count = 0
    const debounce = createDebounce(() => {
      count++
    }, 300)
    debounce.schedule()
    debounce.cancel()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(1000)
    expect(count).toBe(0)
  })

  it('emit の後にまた schedule すれば、もう一度 300ms 後に emit する', () => {
    vi.useFakeTimers()
    let count = 0
    const debounce = createDebounce(() => {
      count++
    }, 300)
    debounce.schedule()
    vi.advanceTimersByTime(300)
    expect(count).toBe(1)
    debounce.schedule()
    vi.advanceTimersByTime(300)
    expect(count).toBe(2)
  })
})
