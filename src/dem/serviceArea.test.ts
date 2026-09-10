import { describe, expect, it } from 'vitest'
import { inServiceArea } from './serviceArea.ts'

describe('inServiceArea', () => {
  it.each<[string, number, number]>([
    ['東京', 139.77, 35.68],
    ['与那国島', 122.9981, 24.4677],
    ['南鳥島', 153.98, 24.28],
    ['北海道の北端', 141.94, 45.52],
  ])('%s は対応範囲内', (_name, lon, lat) => {
    expect(inServiceArea(lon, lat)).toBe(true)
  })

  it.each<[number, number]>([
    [139, 60],
    [139, 85],
    [121, 35],
    [155, 35],
    [139, 19],
  ])('経度 %f・緯度 %f は対応範囲外', (lon, lat) => {
    expect(inServiceArea(lon, lat)).toBe(false)
  })
})
