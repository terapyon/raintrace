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
        '?probe=steps&mode=3d&z=16&pitch=85&bearing=10&ex=10&water=0&hillshade=off&ms=5000&fallback=0&settle=20000' +
          '&arrows=0&depthEvery=4&pause=1&until=window&cap=120000&at=35.7623,139.8246',
      ),
    ).toEqual({
      probe: 'steps',
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
      pauseBeforeRun: true,
      until: 'window',
      capMs: 120_000,
      at: { lat: 35.7623, lon: 139.8246 },
    })
  })

  it('無い・不正な項目は既定値（3D・z16・pitch 60・倍率 1・水面あり・矢印あり・転送の間引きの指定なし・止めない・平衡まで 300 秒・地点なし）', () => {
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
      pauseBeforeRun: false,
      until: 'settle',
      capMs: 300_000,
      at: null,
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
