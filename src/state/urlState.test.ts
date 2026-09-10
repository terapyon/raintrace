import { describe, expect, it } from 'vitest'
import { formatUrlView, parseUrlView } from './urlState'

describe('parseUrlView', () => {
  it('lat・lon・z を読む', () => {
    expect(parseUrlView('?lat=35.6812&lon=139.7671&z=17&size=500')).toEqual({
      point: { lat: 35.6812, lon: 139.7671 },
      zoom: 17,
    })
  })

  it('数値でない値や範囲外の値は無視する', () => {
    expect(parseUrlView('?lat=abc&lon=139&z=99')).toEqual({ point: null, zoom: null })
    expect(parseUrlView('?lat=91&lon=139')).toEqual({ point: null, zoom: null })
    expect(parseUrlView('?lat=&lon=139')).toEqual({ point: null, zoom: null })
    expect(parseUrlView('')).toEqual({ point: null, zoom: null })
  })
})

describe('formatUrlView', () => {
  it('lat・lon は小数 6 桁、z は小数 2 桁、size は 500。ほかのパラメータは残す', () => {
    expect(
      formatUrlView('?foo=1', { point: { lat: 35.68123456, lon: 139.7671234 }, zoom: 16.123 }),
    ).toBe('?foo=1&lat=35.681235&lon=139.767123&z=16.12&size=500')
  })

  it('z の末尾の 0 は落とす', () => {
    expect(formatUrlView('', { point: null, zoom: 10 })).toBe('?z=10')
  })

  it('地点が無ければ lat・lon・size を消す', () => {
    expect(formatUrlView('?lat=1&lon=2&size=500&z=5', { point: null, zoom: 5 })).toBe('?z=5')
    expect(formatUrlView('?lat=1&lon=2', { point: null, zoom: null })).toBe('')
  })
})
