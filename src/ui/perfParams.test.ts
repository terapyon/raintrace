import { describe, expect, it } from 'vitest'
import { parsePerfParams } from './perfParams'

describe('parsePerfParams（計測用のフックの URL。計画で決めたこと 20）', () => {
  it('probe が無ければ null（通常の URL では何もしない）', () => {
    expect(parsePerfParams('?lat=35.658&lon=139.7016')).toBeNull()
    expect(parsePerfParams('?probe=other')).toBeNull()
  })

  it('すべての項目を読む', () => {
    expect(
      parsePerfParams(
        '?probe=fps&mode=3d&z=16&pitch=85&bearing=10&ex=10&water=0&hillshade=off&ms=5000&fallback=0&settle=20000',
      ),
    ).toEqual({
      probe: 'fps',
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
    })
  })

  it('無い・不正な項目は既定値（3D・z16・pitch 60・倍率 1・水面あり・3D の既定の hillshade・10 秒）', () => {
    expect(parsePerfParams('?probe=view&z=99&pitch=-5&ex=3&hillshade=x&ms=1')).toEqual({
      probe: 'view',
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
    })
  })
})
