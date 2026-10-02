import { describe, expect, it } from 'vitest'
import { makeDepression } from '../simulation/testing/terrainGrids.test-support'
import { MARKER_HIT_PX, markerHitBox, markerInfoRows, markerRefsFromFeatures } from './markerInfo'

const terrain = {
  elevation: Float32Array.of(3, 1.25, 5),
  lowestIndex: 1,
  depressions: [
    makeDepression({ id: 1, spillElevation: 10.5, maxDepthM: 0.2, capacityM3: 12, areaM2: 80 }),
    makeDepression({ id: 2, spillElevation: 11.5, maxDepthM: 0.4, capacityM3: 30, areaM2: 150 }),
  ],
}

describe('markerHitBox（spec 07 §3.1）', () => {
  it('クリックの位置の ±4 px の矩形', () => {
    expect(MARKER_HIT_PX).toBe(4)
    expect(markerHitBox(100, 50)).toEqual([
      [96, 46],
      [104, 54],
    ])
  })
})

describe('markerRefsFromFeatures', () => {
  it('kind と depressionId から印を読み、形の違うものは捨てる', () => {
    expect(
      markerRefsFromFeatures([
        { properties: { kind: 'lowest' } },
        { properties: { kind: 'spill', depressionId: 2 } },
        { properties: { kind: 'spill' } },
        { properties: { kind: 'spill', depressionId: 1.5 } },
        { properties: { kind: 'other' } },
        { properties: null },
        {},
      ]),
    ).toEqual([{ marker: 'lowest' }, { marker: 'spill', depressionId: 2 }])
  })
})

describe('markerInfoRows（計画で決めたこと 3）', () => {
  it('最低点は標高、あふれ出し点は窪地の 4 つの数値（depressions[id − 1]）', () => {
    expect(
      markerInfoRows(terrain, [{ marker: 'lowest' }, { marker: 'spill', depressionId: 2 }]),
    ).toEqual([
      { marker: 'lowest', elevationM: 1.25 },
      {
        marker: 'spill',
        depressionId: 2,
        spillElevationM: 11.5,
        maxDepthM: 0.4,
        capacityM3: 30,
        areaM2: 150,
      },
    ])
  })

  it('窪地の一覧に無い id・最低点の無い地形の印は飛ばす（Review Focus 3）', () => {
    expect(markerInfoRows(terrain, [{ marker: 'spill', depressionId: 9 }])).toEqual([])
    expect(markerInfoRows({ ...terrain, lowestIndex: -1 }, [{ marker: 'lowest' }])).toEqual([])
  })

  it('id がずれていれば（depressions[id − 1].id が違う）飛ばす', () => {
    const shifted = { ...terrain, depressions: [makeDepression({ id: 2 })] }
    expect(markerInfoRows(shifted, [{ marker: 'spill', depressionId: 1 }])).toEqual([])
  })
})
