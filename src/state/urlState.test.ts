import { describe, expect, it } from 'vitest'
import { formatUrlView, parseUrlView } from './urlState'

describe('parseUrlView', () => {
  it('lat・lon・z を読む', () => {
    expect(parseUrlView('?lat=35.6812&lon=139.7671&z=17&size=500')).toEqual({
      point: { lat: 35.6812, lon: 139.7671 },
      zoom: 17,
      sizeM: 500,
      amountMm: null,
      radiusM: null,
    })
  })

  it('数値でない値や範囲外の値は無視する', () => {
    expect(parseUrlView('?lat=abc&lon=139&z=99')).toEqual({
      point: null,
      zoom: null,
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
    expect(parseUrlView('?lat=91&lon=139')).toEqual({
      point: null,
      zoom: null,
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
    expect(parseUrlView('?lat=&lon=139')).toEqual({
      point: null,
      zoom: null,
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
    expect(parseUrlView('')).toEqual({
      point: null,
      zoom: null,
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
  })

  it('緯度は Web Mercator の範囲（±85.051129）に絞る。範囲外は地点を読まない', () => {
    expect(parseUrlView('?lat=90&lon=139')).toEqual({
      point: null,
      zoom: null,
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
    expect(parseUrlView('?lat=-86&lon=139')).toEqual({
      point: null,
      zoom: null,
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
  })

  it('日本の対応範囲の外でも、Web Mercator の範囲内の緯度なら地点として読む（Worker が out-of-range を返す）', () => {
    expect(parseUrlView('?lat=60&lon=139')).toEqual({
      point: { lat: 60, lon: 139 },
      zoom: null,
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
    expect(parseUrlView('?lat=85&lon=139')).toEqual({
      point: { lat: 85, lon: 139 },
      zoom: null,
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
  })

  it('size・mm・r を読む（tech-spec §3.3）', () => {
    expect(parseUrlView('?mm=50&r=20.5&size=250')).toMatchObject({
      sizeM: 250,
      amountMm: 50,
      radiusM: 20.5,
    })
  })

  it('size は 250・500・1000 だけ、mm は 1〜1000 の整数、r は 1〜500。ほかは読まない', () => {
    expect(parseUrlView('?mm=0&r=abc&size=300')).toMatchObject({
      sizeM: null,
      amountMm: null,
      radiusM: null,
    })
    expect(parseUrlView('?mm=1.5&r=501')).toMatchObject({ amountMm: null, radiusM: null })
  })
})

describe('formatUrlView', () => {
  const view = { sizeM: 500 as const, amountMm: 100, radiusM: 10 }

  it('lat・lon は小数 6 桁、z は小数 2 桁、size・mm・r を書く。ほかのパラメータは残す', () => {
    expect(
      formatUrlView('?foo=1', {
        ...view,
        point: { lat: 35.68123456, lon: 139.7671234 },
        zoom: 16.123,
      }),
    ).toBe('?foo=1&lat=35.681235&lon=139.767123&z=16.12&size=500&mm=100&r=10')
  })

  it('z の末尾の 0 は落とす', () => {
    expect(formatUrlView('', { ...view, point: null, zoom: 10 })).toBe('?z=10')
  })

  it('z が 0 でも空にせず z=0 と書く', () => {
    expect(formatUrlView('', { ...view, point: null, zoom: 0 })).toBe('?z=0')
    expect(formatUrlView('', { ...view, point: null, zoom: 0.001 })).toBe('?z=0')
  })

  it('地点が無ければ lat・lon・size・mm・r を消す', () => {
    expect(
      formatUrlView('?lat=1&lon=2&size=500&mm=5&r=3&z=5', { ...view, point: null, zoom: 5 }),
    ).toBe('?z=5')
    expect(formatUrlView('?lat=1&lon=2', { ...view, point: null, zoom: null })).toBe('')
  })
})
