import { describe, expect, it } from 'vitest'
import type { TerrainPayload } from '../shared/protocol'
import { cellCenter } from './terrainFeatures'
import { waterArrowFeatures } from './waterFeatures'

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

describe('waterArrowFeatures', () => {
  it('[列, 行, 方位, 大きさ] の並びを、セルの中心の点と方位にする', () => {
    const collection = waterArrowFeatures(Float32Array.of(1, 2, 90, 0.5, 3, 0, 180, 0.1), geo)
    expect(collection.features.map((f) => f.properties.bearing)).toEqual([90, 180])
    expect(collection.features[0]?.geometry.coordinates).toEqual(cellCenter(geo, 2 * 4 + 1))
    expect(collection.features[1]?.geometry.coordinates).toEqual(cellCenter(geo, 3))
  })

  it('空の配列なら点は無い', () => {
    expect(waterArrowFeatures(new Float32Array(0), geo).features).toEqual([])
  })
})
