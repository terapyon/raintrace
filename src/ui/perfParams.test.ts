import { describe, expect, it } from 'vitest'
import { parseAt, parsePerfParams } from './perfParams'

describe('parsePerfParams（計測用のフックの URL。05 の計画で決めたこと 20、spec 06 §3）', () => {
  it('probe が無ければ null（通常の URL では何もしない）', () => {
    expect(parsePerfParams('?lat=35.658&lon=139.7016')).toBeNull()
    expect(parsePerfParams('?probe=other')).toBeNull()
  })

  it('すべての項目を読む', () => {
    expect(
      parsePerfParams(
        '?probe=water&mode=3d&z=16&pitch=85&bearing=10&ex=10&water=0&hillshade=off&ms=5000&fallback=0&settle=20000' +
          '&arrows=0&arrowsM=5&depthEvery=4&pause=1&until=window&cap=120000&at=35.7623,139.8246' +
          '&zs=15.5,16.25&wet=15000',
      ),
    ).toEqual({
      probe: 'water',
      mode: '3d',
      zoom: 16,
      pitch: 85,
      bearing: 10,
      exaggeration: 10,
      water: false,
      hillshade: 'off',
      durationMs: 5000,
      fallback: false,
      settleMs: 20_000,
      arrows: false,
      depthEvery: 4,
      arrowsM: 5,
      pauseBeforeRun: true,
      until: 'window',
      capMs: 120_000,
      at: { lat: 35.7623, lon: 139.8246 },
      zooms: [15.5, 16.25],
      wetMs: 15_000,
    })
  })

  it('無い・不正な項目は既定値（3D・z16・pitch 60・倍率 1・水面あり・矢印あり・転送の間引きと矢印の間隔の指定なし・止めない・平衡まで 300 秒・地点なし）', () => {
    expect(parsePerfParams('?probe=load&z=99&pitch=-5&ex=3&hillshade=x&ms=1&cap=5&at=x')).toEqual({
      probe: 'load',
      mode: '3d',
      zoom: 16,
      pitch: 60,
      bearing: 0,
      exaggeration: 1,
      water: true,
      hillshade: 'auto',
      durationMs: 10_000,
      fallback: true,
      settleMs: 3000,
      arrows: true,
      depthEvery: null,
      arrowsM: null,
      pauseBeforeRun: false,
      until: 'settle',
      capMs: 300_000,
      at: null,
      zooms: [16],
      wetMs: 20_000,
    })
  })
})

describe('depthEvery（spec 06 §5.1）', () => {
  it('1・2・4・8 以外の値は 1、省けば null（View3d の既定に任せる）', () => {
    expect(parsePerfParams('?probe=fps&depthEvery=3')?.depthEvery).toBe(1)
    expect(parsePerfParams('?probe=fps&depthEvery=2')?.depthEvery).toBe(2)
    expect(parsePerfParams('?probe=fps')?.depthEvery).toBeNull()
  })
})

describe('arrowsM（spec 06 §5.1）', () => {
  it('5・10・20 を読み、それ以外の値と省いたときは null（設定を触らない）', () => {
    expect(parsePerfParams('?probe=fps&arrowsM=5')?.arrowsM).toBe(5)
    expect(parsePerfParams('?probe=fps&arrowsM=10')?.arrowsM).toBe(10)
    expect(parsePerfParams('?probe=fps&arrowsM=20')?.arrowsM).toBe(20)
    expect(parsePerfParams('?probe=fps&arrowsM=15')?.arrowsM).toBeNull()
    expect(parsePerfParams('?probe=fps&arrowsM=')?.arrowsM).toBeNull()
    expect(parsePerfParams('?probe=fps')?.arrowsM).toBeNull()
  })
})

describe('zs（probe=water の視点のズームの並び）', () => {
  it('範囲の外・数でない値は捨て、何も残らなければ z の 1 つ', () => {
    expect(parsePerfParams('?probe=water&z=17&zs=15,x,99,16.5')?.zooms).toEqual([15, 16.5])
    expect(parsePerfParams('?probe=water&z=17&zs=x')?.zooms).toEqual([17])
  })
})

describe('parseAt（probe=load の地点。at=緯度,経度）', () => {
  it('緯度・経度の組を読む', () => {
    expect(parseAt('35.4575,139.632')).toEqual({ lat: 35.4575, lon: 139.632 })
  })

  it('無い・数でない・範囲の外・数が違えば null', () => {
    expect(parseAt(null)).toBeNull()
    expect(parseAt('35.4575')).toBeNull()
    expect(parseAt('35.4575,')).toBeNull()
    expect(parseAt('a,b')).toBeNull()
    expect(parseAt('95,139')).toBeNull()
    expect(parseAt('35,181')).toBeNull()
    expect(parseAt('1,2,3')).toBeNull()
  })
})
