import { type GridRange, rangePixelRect } from '../../../src/dem/gridRange.ts'
import { TILE_SIZE, tilesInPixelRect } from '../../../src/dem/tileMath.ts'
import { GSI_PALE_TILE_URL } from '../../../src/map/gsiStyle'

/**
 * 淡色地図の z17 のタイルを、範囲の画素（= セル）にそろえて 1 枚に合成する（計画 D17、spec 05 §4 の方式 B）。
 * 取れなかったタイルは灰色のまま（スパイクでは再試行しない）
 */
export async function composeBasemap(range: GridRange): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(range.size, range.size)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D コンテキストを得られません')
  context.fillStyle = '#d8d8d8'
  context.fillRect(0, 0, range.size, range.size)
  const tiles = tilesInPixelRect(rangePixelRect(range), range.z)
  await Promise.all(
    tiles.map(async (tile) => {
      const url = GSI_PALE_TILE_URL.replace('{z}', String(tile.z))
        .replace('{x}', String(tile.x))
        .replace('{y}', String(tile.y))
      const response = await fetch(url)
      if (!response.ok) return
      const bitmap = await createImageBitmap(await response.blob())
      context.drawImage(
        bitmap,
        tile.x * TILE_SIZE - range.originX,
        tile.y * TILE_SIZE - range.originY,
      )
      bitmap.close()
    }),
  )
  return canvas
}
