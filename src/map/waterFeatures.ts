import type { TerrainGeo } from '../shared/protocol'
import { cellCenter, type PointCollection, type PointFeature } from './terrainFeatures'

/** frame の矢印（[列, 行, 方位, 大きさ] の並び。spec 04 §5.1）を、セルの中心の点にする */
export function waterArrowFeatures(
  arrows: Float32Array,
  geo: TerrainGeo,
): PointCollection<{ bearing: number }> {
  const features: PointFeature<{ bearing: number }>[] = []
  for (let k = 0; k + 3 < arrows.length; k += 4) {
    const col = arrows[k] ?? 0
    const row = arrows[k + 1] ?? 0
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: cellCenter(geo, row * geo.size + col) },
      properties: { bearing: arrows[k + 2] ?? 0 },
    })
  }
  return { type: 'FeatureCollection', features }
}
