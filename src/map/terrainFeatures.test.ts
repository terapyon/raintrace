import { describe, expect, it } from 'vitest'
import { pixelToLonLat } from '../dem/tileMath'
import type { TerrainPayload } from '../shared/protocol'
import { NEIGHBOR_DX, NEIGHBOR_DY } from '../simulation/terrain/neighbors'
import { makeDepression } from '../simulation/testing/terrainGrids.test-support'
import { cellCenter, flowFeatures, markerFeatures, outlineFeature } from './terrainFeatures'

const geo = {
  level: 1,
  z: 17,
  originX: 1000,
  originY: 2000,
  size: 4,
  cellSizeM: 1,
  corners: [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  breakdown: {},
  invalidRatio: 0,
} as TerrainPayload['geo']

describe('cellCenter', () => {
  it('セルの中心のグローバルピクセルから緯度経度を求める', () => {
    const p = pixelToLonLat(1000 + 1 + 0.5, 2000 + 2 + 0.5, 17)
    expect(cellCenter(geo, 2 * 4 + 1)).toEqual([p.lon, p.lat])
  })
})

describe('flowFeatures', () => {
  it('矢印の間隔で間引き、下り先のあるセルだけを方位つきで返す', () => {
    // 4 × 4 のうち、間隔 2 セルで (1,1)・(3,1)・(1,3)・(3,3) を見る。(3,3) は下り先なし
    const flowDirection = new Uint8Array(16)
    flowDirection[1 * 4 + 1] = 1 // 東 → 90°
    flowDirection[1 * 4 + 3] = 3 // 南 → 180°
    flowDirection[3 * 4 + 1] = 7 // 北 → 0°
    flowDirection[0] = 5 // 間引かれるセル
    const collection = flowFeatures({ flowDirection, geo }, 2)
    expect(collection.features.map((f) => f.properties.bearing)).toEqual([90, 180, 0])
    expect(collection.features[0]?.geometry.coordinates).toEqual(cellCenter(geo, 5))
  })

  it('間隔がセルより小さくても毎セル（間隔 1）', () => {
    const flowDirection = new Uint8Array(16).fill(2)
    expect(flowFeatures({ flowDirection, geo }, 0.3).features).toHaveLength(16)
  })

  it.each(NEIGHBOR_DX.map((dx, k) => [k + 1, dx, NEIGHBOR_DY[k] ?? 0] as const))(
    '方向の番号 %i（dx %i・dy %i）の矢印は、近傍の表から求めた方位を向く',
    (direction, dx, dy) => {
      // y は南が正なので、北を 0° とする方位は atan2(dx, −dy)
      const expected = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
      const one = { ...geo, size: 1 }
      const collection = flowFeatures({ flowDirection: new Uint8Array([direction]), geo: one }, 1)
      expect(collection.features[0]?.properties.bearing).toBeCloseTo(expected, 9)
    },
  )
})

describe('markerFeatures', () => {
  it('最低点と、表示対象の窪地の spill point', () => {
    const collection = markerFeatures({
      geo,
      lowestIndex: 5,
      depressions: [
        makeDepression({ id: 1, spillIndex: 6, significant: false }),
        makeDepression({ id: 2, spillIndex: 7, significant: true }),
      ],
    })
    expect(collection.features.map((f) => f.properties.kind)).toEqual(['lowest', 'spill'])
    expect(collection.features[1]?.geometry.coordinates).toEqual(cellCenter(geo, 7))
  })

  it('有効セルが無ければ最低点は出さない', () => {
    const collection = markerFeatures({ geo, lowestIndex: -1, depressions: [] })
    expect(collection.features).toEqual([])
  })
})

describe('outlineFeature', () => {
  it('四隅を閉じた線', () => {
    const line = outlineFeature(geo.corners)
    expect(line.geometry.coordinates).toEqual([...geo.corners, geo.corners[0]])
  })
})
