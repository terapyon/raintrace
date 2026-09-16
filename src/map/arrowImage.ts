import type { Map as MapLibreMap } from 'maplibre-gl'

const ARROW_SIZE = 24

/**
 * 北向きの矢印の画像を地図に 1 度だけ足す。外部の画像を読まない（CSP）。地形の流向（TerrainOverlay）と
 * 水の流れ（WaterOverlay）が色だけを変えて使う。スタイルの入れ替え（Task 10）で消えた画像も hasImage を見て足し直す
 */
export function ensureArrowImage(
  map: MapLibreMap,
  name: string,
  fill: string,
  stroke?: string,
): void {
  if (map.hasImage(name)) return
  const size = ARROW_SIZE
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) return
  context.fillStyle = fill
  context.beginPath()
  context.moveTo(size / 2, 2)
  context.lineTo(size - 5, size - 4)
  context.lineTo(size / 2, size - 9)
  context.lineTo(5, size - 4)
  context.closePath()
  context.fill()
  if (stroke !== undefined) {
    context.strokeStyle = stroke
    context.lineWidth = 2
    context.stroke()
  }
  const { data } = context.getImageData(0, 0, size, size)
  map.addImage(name, { width: size, height: size, data: new Uint8Array(data.buffer) })
}
