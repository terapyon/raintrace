import { describe, expect, it } from 'vitest'
import { demSourceSpec, demTileTemplate, parseDemTileUrl } from './demSource'

describe('raintrace-dem:// のタイル（spec 05 §4.2）', () => {
  it('ソースと世代つきの URL の型を作り、要求の URL を読む', () => {
    expect(demTileTemplate('terrain', 3)).toBe('raintrace-dem://terrain/3/{z}/{x}/{y}')
    expect(parseDemTileUrl('raintrace-dem://hillshade/3/15/29099/12905')).toEqual({
      source: 'hillshade',
      generation: 3,
      tile: { z: 15, x: 29099, y: 12905 },
    })
  })

  it('形の違う URL、知らないソース、DEM の最大ズーム（17）より細かい要求は null', () => {
    expect(parseDemTileUrl('https://example.com/15/1/2')).toBeNull()
    expect(parseDemTileUrl('raintrace-dem://other/3/15/1/2')).toBeNull()
    expect(parseDemTileUrl('raintrace-dem://terrain/3/18/1/2')).toBeNull()
    expect(parseDemTileUrl('raintrace-dem://terrain/3/15/1')).toBeNull()
  })

  it('地形の raster-dem は tileSize 256・Terrarium・maxzoom 17（既定の 512 にしない）', () => {
    expect(demSourceSpec('terrain', 3)).toEqual({
      type: 'raster-dem',
      tiles: ['raintrace-dem://terrain/3/{z}/{x}/{y}'],
      tileSize: 256,
      maxzoom: 17,
      encoding: 'terrarium',
    })
  })

  it('hillshade の raster-dem は tileSize 512（256 だと地形より 2〜3 段細かいタイルを要求する。計画で決めたこと 12）', () => {
    expect(demSourceSpec('hillshade', 3).tileSize).toBe(512)
  })
})
