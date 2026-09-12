import type { Map as MapLibreMap } from 'maplibre-gl'
import { pixelToLonLat } from '../../../src/dem/tileMath.ts'
import type { ArrowPlacement, Scene } from '../types'

const LAYER = 'spike-arrows'
const IMAGE = 'spike-arrow'
const WATER_LAYER = 'spike-water'
const SPACING_M = 20
const BEARING_DEG = 180 // 合成の斜面の下り（南）。すり鉢の上も同じ向きで一定にする

/** GeoJSON の点の集まり（src/map/terrainFeatures.ts と同じく、必要な形だけを型にする） */
interface ArrowCollection {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { bearing: number }
  }[]
}

/** 範囲に 20m おきの固定の点（04 の出力に依らない。計画 D20） */
export function arrowFeatures(scene: Scene): ArrowCollection {
  const { range } = scene
  const step = Math.max(1, Math.round(SPACING_M / range.cellSizeM))
  const features: ArrowCollection['features'] = []
  for (let row = step >> 1; row < range.size; row += step) {
    for (let col = step >> 1; col < range.size; col += step) {
      const ll = pixelToLonLat(range.originX + col + 0.5, range.originY + row + 0.5, range.z)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ll.lon, ll.lat] },
        properties: { bearing: BEARING_DEG },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** 北向きの矢印（白の縁取り）。外部の画像とグリフを読まない（CSP） */
function arrowImage(): ImageData {
  const size = 24
  const context = new OffscreenCanvas(size, size).getContext('2d')
  if (context === null) throw new Error('2D コンテキストを得られません')
  context.beginPath()
  context.moveTo(size / 2, 2)
  context.lineTo(size - 5, size - 4)
  context.lineTo(size / 2, size - 9)
  context.lineTo(5, size - 4)
  context.closePath()
  context.fillStyle = '#263238'
  context.fill()
  context.strokeStyle = '#ffffff'
  context.lineWidth = 2
  context.stroke()
  return context.getImageData(0, 0, size, size)
}

/** 矢印のレイヤーを置き直す。below は水面の Custom Layer の前（先に描く）、above は最後に足す */
export function setArrowLayer(
  map: MapLibreMap,
  scene: Scene,
  placement: ArrowPlacement,
  pitchAlignment: 'map' | 'viewport',
): void {
  if (map.getLayer(LAYER) !== undefined) map.removeLayer(LAYER)
  if (map.getSource(LAYER) !== undefined) map.removeSource(LAYER)
  if (placement === 'none') return
  if (!map.hasImage(IMAGE)) map.addImage(IMAGE, arrowImage())
  map.addSource(LAYER, { type: 'geojson', data: arrowFeatures(scene) })
  map.addLayer(
    {
      id: LAYER,
      type: 'symbol',
      source: LAYER,
      layout: {
        'icon-image': IMAGE,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': pitchAlignment,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': 0.8,
      },
    },
    placement === 'below' ? WATER_LAYER : undefined,
  )
}
