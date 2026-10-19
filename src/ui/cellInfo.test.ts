import { describe, expect, it } from 'vitest'
import { pixelToLonLat } from '../dem/tileMath'
import type { TerrainPayload } from '../shared/protocol'
import { cellInfoAt } from './cellInfo'

const geo = { z: 17, originX: 1000, originY: 2000, size: 2 } as TerrainPayload['geo']
const terrain = {
  geo,
  elevation: Float32Array.of(12.43, 5, 7, 8),
  validMask: Uint8Array.of(1, 0, 1, 1),
}
/** 列 col・行 row のセルの中心の経度・緯度 */
const at = (col: number, row: number) =>
  pixelToLonLat(geo.originX + col + 0.5, geo.originY + row + 0.5, geo.z)

describe('cellInfoAt（base-spec §39）', () => {
  it('標高・水深・水位（標高 + 水深）を返す', () => {
    const p = at(0, 0)
    const info = cellInfoAt(terrain, Float32Array.of(0.37, 0, 0, 0), p.lon, p.lat)
    expect(info).toMatchObject({ kind: 'value', elevationM: Math.fround(12.43) })
    if (info?.kind !== 'value') throw new Error('値がありません')
    expect(info.depthM).toBeCloseTo(0.37, 6)
    expect(info.levelM).toBeCloseTo(12.8, 5)
  })

  it('水深のバッファがまだ無ければ水深 0', () => {
    const p = at(1, 1)
    expect(cellInfoAt(terrain, null, p.lon, p.lat)).toEqual({
      kind: 'value',
      elevationM: 8,
      depthM: 0,
      levelM: 8,
    })
  })

  it('無効セルは no-data、範囲の外は null', () => {
    const invalid = at(1, 0)
    expect(cellInfoAt(terrain, null, invalid.lon, invalid.lat)).toEqual({ kind: 'no-data' })
    const outside = at(5, 5)
    expect(cellInfoAt(terrain, null, outside.lon, outside.lat)).toBeNull()
  })
})

describe('cellInfoAt の盛土の履歴（spec 09 §6.6）', () => {
  it('history があれば昔の標高と差を返し、NaN は null', () => {
    const history = {
      past: Float32Array.of(10, 0, Number.NaN, 0),
      delta: Float32Array.of(Math.fround(2.5), 0, 0, Number.NaN),
    }
    const a = at(0, 0)
    expect(cellInfoAt(terrain, null, a.lon, a.lat, history)).toMatchObject({
      kind: 'value',
      pastM: 10,
      deltaM: 2.5,
    })
    const b = at(0, 1)
    expect(cellInfoAt(terrain, null, b.lon, b.lat, history)).toMatchObject({
      pastM: null,
      deltaM: 0,
    })
    const c = at(1, 1)
    expect(cellInfoAt(terrain, null, c.lon, c.lat, history)).toMatchObject({
      pastM: 0,
      deltaM: null,
    })
  })

  it('history が無ければ pastM・deltaM を持たない', () => {
    const p = at(0, 0)
    expect(cellInfoAt(terrain, null, p.lon, p.lat)).not.toHaveProperty('pastM')
  })
})
