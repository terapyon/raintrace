import { describe, expect, it } from 'vitest'
import { beforeLayerId, OVERLAY_LAYER_ORDER, TERRAIN_LAYER_IDS, WATER_LAYER_IDS } from './layerIds'
import { VIEW3D_LAYER_IDS } from './view3d/layerIds'

/** 今あるレイヤーの集合から has を作る */
const having =
  (...ids: string[]) =>
  (id: string): boolean =>
    ids.includes(id)

describe('重ね描きのレイヤーの重なり順（spec 06 §5.2、Task 17）', () => {
  it('並びは地形・水・3D のレイヤー ID をちょうど 1 回ずつ含む', () => {
    const all = [
      ...Object.values(TERRAIN_LAYER_IDS),
      ...Object.values(WATER_LAYER_IDS),
      ...Object.values(VIEW3D_LAYER_IDS),
    ]
    expect([...OVERLAY_LAYER_ORDER].sort()).toEqual([...all].sort())
    expect(new Set(OVERLAY_LAYER_ORDER).size).toBe(OVERLAY_LAYER_ORDER.length)
  })

  it('重ね描きのレイヤーが何も無ければ、どの id も一番上に積む（undefined）', () => {
    for (const id of OVERLAY_LAYER_ORDER) expect(beforeLayerId(id, having())).toBeUndefined()
  })

  it('2D で水深・矢印が先にあるとき、地形のレイヤーはそれぞれ並びどおりの位置に入る', () => {
    const has = having(WATER_LAYER_IDS.water, WATER_LAYER_IDS.arrows)
    expect(beforeLayerId(TERRAIN_LAYER_IDS.elevation, has)).toBe(WATER_LAYER_IDS.water)
    expect(beforeLayerId(TERRAIN_LAYER_IDS.depressions, has)).toBe(WATER_LAYER_IDS.water)
    expect(beforeLayerId(TERRAIN_LAYER_IDS.outline, has)).toBe(WATER_LAYER_IDS.arrows)
    expect(beforeLayerId(TERRAIN_LAYER_IDS.flow, has)).toBe(WATER_LAYER_IDS.arrows)
    expect(beforeLayerId(TERRAIN_LAYER_IDS.markers, has)).toBeUndefined()
  })

  it('3D の hillshade は、地形が無ければ一番上、標高があれば標高の下', () => {
    expect(beforeLayerId(VIEW3D_LAYER_IDS.hillshade, having())).toBeUndefined()
    expect(
      beforeLayerId(
        VIEW3D_LAYER_IDS.hillshade,
        having(TERRAIN_LAYER_IDS.elevation, WATER_LAYER_IDS.water),
      ),
    ).toBe(TERRAIN_LAYER_IDS.elevation)
  })

  it('3D の水面は、枠があれば枠の下、枠が無く矢印だけあれば矢印の下', () => {
    expect(
      beforeLayerId(
        VIEW3D_LAYER_IDS.water,
        having(WATER_LAYER_IDS.water, TERRAIN_LAYER_IDS.outline, WATER_LAYER_IDS.arrows),
      ),
    ).toBe(TERRAIN_LAYER_IDS.outline)
    expect(
      beforeLayerId(VIEW3D_LAYER_IDS.water, having(WATER_LAYER_IDS.water, WATER_LAYER_IDS.arrows)),
    ).toBe(WATER_LAYER_IDS.arrows)
  })

  it('並びに無い id は例外', () => {
    expect(() => beforeLayerId('no-such-layer', having())).toThrow()
  })
})
