import type { Corners } from '../dem/gridRange'
import { pixelToLonLat } from '../dem/tileMath'
import type { TerrainGeo, TerrainPayload } from '../shared/protocol'

export interface PointFeature<P> {
  type: 'Feature'
  geometry: { type: 'Point'; coordinates: [number, number] }
  properties: P
}

export interface PointCollection<P> {
  type: 'FeatureCollection'
  features: PointFeature<P>[]
}

export interface LineFeature {
  type: 'Feature'
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  properties: Record<string, never>
}

// D8 の番号 1〜8（東から時計回り）の方位（北が 0°、時計回り）
const BEARINGS = [90, 135, 180, 225, 270, 315, 0, 45]

/** セルの中心の [経度, 緯度] */
export function cellCenter(geo: TerrainGeo, index: number): [number, number] {
  const col = index % geo.size
  const row = (index - col) / geo.size
  const p = pixelToLonLat(geo.originX + col + 0.5, geo.originY + row + 0.5, geo.z)
  return [p.lon, p.lat]
}

const point = <P>(coordinates: [number, number], properties: P): PointFeature<P> => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
})

/** 地形の流向の矢印（base-spec §32）。spacingM ごとに間引き、下り先のあるセルだけを返す */
export function flowFeatures(
  terrain: Pick<TerrainPayload, 'flowDirection' | 'geo'>,
  spacingM: number,
): PointCollection<{ bearing: number }> {
  const { geo, flowDirection } = terrain
  const step = Math.max(1, Math.round(spacingM / geo.cellSizeM))
  const offset = Math.floor(step / 2)
  const features: PointFeature<{ bearing: number }>[] = []
  for (let row = offset; row < geo.size; row += step) {
    for (let col = offset; col < geo.size; col += step) {
      const index = row * geo.size + col
      const direction = flowDirection[index] ?? 0
      if (direction === 0) continue
      features.push(point(cellCenter(geo, index), { bearing: BEARINGS[direction - 1] ?? 0 }))
    }
  }
  return { type: 'FeatureCollection', features }
}

/** 最低点と、表示対象の窪地（R02-3）の spill point */
export function markerFeatures(
  terrain: Pick<TerrainPayload, 'lowestIndex' | 'depressions' | 'geo'>,
): PointCollection<{ kind: 'lowest' | 'spill' }> {
  const features: PointFeature<{ kind: 'lowest' | 'spill' }>[] = []
  if (terrain.lowestIndex !== -1) {
    features.push(point(cellCenter(terrain.geo, terrain.lowestIndex), { kind: 'lowest' }))
  }
  for (const d of terrain.depressions) {
    if (d.significant) {
      features.push(point(cellCenter(terrain.geo, d.spillIndex), { kind: 'spill' }))
    }
  }
  return { type: 'FeatureCollection', features }
}

/** 範囲の枠（四隅を閉じた線） */
export function outlineFeature(corners: Corners): LineFeature {
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: [...corners, corners[0]] },
    properties: {},
  }
}
