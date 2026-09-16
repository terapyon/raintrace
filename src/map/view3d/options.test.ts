import { describe, expect, it } from 'vitest'
import { DEFAULT_VIEW3D_OPTIONS, hillshadeEnabled } from './options'

describe('3D の選択肢（計画で決めたこと 12）', () => {
  it('hillshade の auto は淡色・標準で付け、写真では付けない。on・off はベースマップによらない', () => {
    expect(hillshadeEnabled('auto', 'pale')).toBe(true)
    expect(hillshadeEnabled('auto', 'std')).toBe(true)
    expect(hillshadeEnabled('auto', 'photo')).toBe(false)
    expect(hillshadeEnabled('on', 'photo')).toBe(true)
    expect(hillshadeEnabled('off', 'pale')).toBe(false)
  })

  it('既定は hillshade は auto・水面あり・計測の受け口なし', () => {
    expect(DEFAULT_VIEW3D_OPTIONS).toEqual({
      hillshade: 'auto',
      water: true,
      boundaryFallback: true,
      onRenderTime: null,
      onTileTime: null,
      onPrepareTime: null,
      onWaterBuildTime: null,
    })
  })
})
