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

  it('緯度は Web Mercator の範囲（±85.051129）に絞る。範囲外は地点を読まない', () => {
    expect(parseUrlView('?lat=90&lon=139')).toEqual({ point: null, zoom: null })
    expect(parseUrlView('?lat=-86&lon=139')).toEqual({ point: null, zoom: null })
  })

  it('日本の対応範囲の外でも、Web Mercator の範囲内の緯度なら地点として読む（Worker が out-of-range を返す）', () => {
    expect(parseUrlView('?lat=60&lon=139')).toEqual({ point: { lat: 60, lon: 139 }, zoom: null })
    expect(parseUrlView('?lat=85&lon=139')).toEqual({ point: { lat: 85, lon: 139 }, zoom: null })
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
