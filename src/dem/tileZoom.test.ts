import { describe, expect, it } from 'vitest'
import {
  DEM_TILE_SIZE,
  demZoom,
  demZoomForDrawnTile,
  drawnTileZoom,
  TERRAIN_MESH_SIZE,
  terrainVertexSpacingM,
} from './tileZoom.ts'

const SHIBUYA_LAT = 35.658

describe('ズームの型（spec 05 §4.3、計画で決めたこと 1）', () => {
  it('描かれる地形タイル z が読む DEM は z − 1。DEM は 17 で頭打ち', () => {
    expect(demZoomForDrawnTile(drawnTileZoom(15))).toBe(14)
    expect(demZoomForDrawnTile(drawnTileZoom(18))).toBe(17)
    expect(demZoomForDrawnTile(drawnTileZoom(19))).toBe(17)
    expect(demZoomForDrawnTile(drawnTileZoom(0))).toBe(0)
  })

  it('整数でない・範囲の外のズームは RangeError', () => {
    expect(() => drawnTileZoom(15.5)).toThrow(RangeError)
    expect(() => drawnTileZoom(-1)).toThrow(RangeError)
    expect(() => demZoom(18)).toThrow(RangeError)
    expect(() => demZoom(Number.NaN)).toThrow(RangeError)
  })

  it('DrawnTileZoom と DemZoom は取り違えると型の誤りになる（S の 3 回の取り違えの再発防止）', () => {
    const dem = demZoom(14)
    // @ts-expect-error DemZoom は DrawnTileZoom の引数に渡せない
    expect(demZoomForDrawnTile(dem)).toBe(13)
    // @ts-expect-error ただの number も渡せない（drawnTileZoom() を通す）
    expect(demZoomForDrawnTile(15)).toBe(14)
  })

  it('頂点間隔は描かれるタイルの幅 ÷ 128（spec 05 §4.3 の表。渋谷の緯度で z15 は 7.76 m、幅 993.7 m）', () => {
    const z15 = terrainVertexSpacingM(drawnTileZoom(15), SHIBUYA_LAT)
    expect(z15).toBeCloseTo(7.76, 2)
    expect(z15 * TERRAIN_MESH_SIZE).toBeCloseTo(993.7, 0)
    expect(terrainVertexSpacingM(drawnTileZoom(14), SHIBUYA_LAT)).toBeCloseTo(15.5, 1)
    expect(terrainVertexSpacingM(drawnTileZoom(16), SHIBUYA_LAT)).toBeCloseTo(3.88, 2)
    expect(terrainVertexSpacingM(drawnTileZoom(17), SHIBUYA_LAT)).toBeCloseTo(1.94, 2)
  })

  it('raster-dem の tileSize は 256（既定の 512 のままにしない。spec 05 §4.2）', () => {
    expect(DEM_TILE_SIZE).toBe(256)
  })
})
