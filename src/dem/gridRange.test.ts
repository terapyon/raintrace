import { describe, expect, it } from 'vitest'
import {
  cellAt,
  computeGridRange,
  gridPositionM,
  MAX_GRID_SIZE,
  rangeCorners,
  rangePixelRect,
} from './gridRange.ts'
import { lonLatToPixel, pixelToLonLat, tilesInPixelRect } from './tileMath.ts'

const points: [number, number][] = [
  [139.7016, 35.658],
  [139.8246, 35.7623],
  [139.632, 35.4575],
  [127.6809, 26.2124],
]

describe('computeGridRange', () => {
  it('DEM1A（z17）・500m・北緯 35° は 512 × 512、セルは約 0.98m', () => {
    const range = computeGridRange(139.7, 35, 500, 17)
    expect(range.size).toBe(512)
    expect(Math.abs(range.cellSizeM - 0.978)).toBeLessThan(0.001)
  })

  it('DEM5（z15）と DEM10B（z14）はセルが粗いので N が小さい', () => {
    expect(computeGridRange(139.7, 35, 500, 15).size).toBe(128)
    expect(computeGridRange(139.7, 35, 500, 14).size).toBe(64)
  })

  it.each(points)(
    '経度 %f・緯度 %f をクリックすると、範囲の中心がその地点から半セル以内に来る',
    (lon, lat) => {
      const range = computeGridRange(lon, lat, 500, 17)
      const position = gridPositionM(range, lon, lat)
      const center = (range.size / 2) * range.cellSizeM
      expect(Math.abs(position.x - center)).toBeLessThanOrEqual(range.cellSizeM / 2)
      expect(Math.abs(position.y - center)).toBeLessThanOrEqual(range.cellSizeM / 2)
      // クリックした地点を含むセルは、N が偶数なら中央の 2 列（行）のどちらか、奇数なら中央の列（行）
      const cell = cellAt(range, lon, lat)
      const candidates = [Math.ceil(range.size / 2) - 1, Math.floor(range.size / 2)]
      expect(candidates).toContain(cell?.col)
      expect(candidates).toContain(cell?.row)
    },
  )

  it('原点は整数のピクセルで、中心のピクセルは pc', () => {
    const range = computeGridRange(139.7016, 35.658, 500, 17)
    const pc = lonLatToPixel(139.7016, 35.658, 17)
    expect(Number.isInteger(range.originX) && Number.isInteger(range.originY)).toBe(true)
    expect(range.center).toEqual(pc)
  })
})

describe('範囲の四隅・外側・タイル', () => {
  const range = computeGridRange(139.7016, 35.658, 500, 17)

  it('四隅は、原点と原点 + N のピクセルから逆算する（北西・北東・南東・南西）', () => {
    const nw = pixelToLonLat(range.originX, range.originY, 17)
    const se = pixelToLonLat(range.originX + range.size, range.originY + range.size, 17)
    expect(rangeCorners(range)).toEqual([
      [nw.lon, nw.lat],
      [se.lon, nw.lat],
      [se.lon, se.lat],
      [nw.lon, se.lat],
    ])
  })

  it('範囲の外は null', () => {
    const [nw] = rangeCorners(range)
    expect(cellAt(range, nw[0] - 0.001, nw[1])).toBeNull()
  })

  it('範囲にかかるタイルは、原点と反対の角のタイルを含む', () => {
    const tiles = tilesInPixelRect(rangePixelRect(range), 17)
    expect([4, 6, 9]).toContain(tiles.length)
    expect(tiles[0]).toEqual({
      z: 17,
      x: Math.floor(range.originX / 256),
      y: Math.floor(range.originY / 256),
    })
    expect(tiles.at(-1)).toEqual({
      z: 17,
      x: Math.floor((range.originX + range.size - 1) / 256),
      y: Math.floor((range.originY + range.size - 1) / 256),
    })
  })
})

describe('グリッドの大きさの上限（最後の砦）', () => {
  it('北緯 85°・90° は N が MAX_GRID_SIZE を超える（90° は有限でない）ので RangeError', () => {
    expect(() => computeGridRange(139, 85, 500, 17)).toThrow(RangeError)
    expect(() => computeGridRange(139, 90, 500, 17)).toThrow(RangeError)
  })

  it('北緯 46°・1000m・DEM1A（z17）は N = 1206 で上限内', () => {
    expect(computeGridRange(139, 46, 1000, 17).size).toBe(1206)
    expect(1206).toBeLessThan(MAX_GRID_SIZE)
  })
})
