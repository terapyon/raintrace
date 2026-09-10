import { describe, expect, it } from 'vitest'
import { pixelToLonLat } from '../dem/tileMath'
import type { TerrainPayload } from '../shared/protocol'
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
})

describe('markerFeatures', () => {
  const depression = (id: number, spillIndex: number) => ({
    id,
    pitIndex: 0,
    spillIndex,
    spillElevation: 1,
    maxDepthM: 1,
    areaM2: 100,
    capacityM3: 1,
    cellCount: 1,
  })

  it('最低点と、表示対象の窪地の spill point', () => {
    const collection = markerFeatures({
      geo,
      lowestIndex: 5,
      depressions: [depression(1, 6), depression(2, 7)],
      significantIds: [2],
    })
    expect(collection.features.map((f) => f.properties.kind)).toEqual(['lowest', 'spill'])
    expect(collection.features[1]?.geometry.coordinates).toEqual(cellCenter(geo, 7))
  })

  it('有効セルが無ければ最低点は出さない', () => {
    const collection = markerFeatures({ geo, lowestIndex: -1, depressions: [], significantIds: [] })
    expect(collection.features).toEqual([])
  })
})

describe('outlineFeature', () => {
  it('四隅を閉じた線', () => {
    const line = outlineFeature(geo.corners)
    expect(line.geometry.coordinates).toEqual([...geo.corners, geo.corners[0]])
  })
})
