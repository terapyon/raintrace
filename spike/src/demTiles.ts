import type { DemTileData } from '../../src/dem/DemGrid.ts'
import { tileKey } from '../../src/dem/demSelection.ts'
import { demTileUrl } from '../../src/dem/demSources.ts'
import { decodeGsiDem } from '../../src/dem/GsiDemDecoder.ts'
import { type GridRange, rangePixelRect } from '../../src/dem/gridRange.ts'
import { TILE_SIZE, tilesInPixelRect } from '../../src/dem/tileMath.ts'

/**
 * 範囲にかかる DEM1A のタイルを本番と同じ URL で取得し、02 の Worker と同じ手順で復号する
 * （色空間の変換とアルファの乗算をさせない）。404 のタイルは入れない（全画素無効）。
 * 自動の実行では Playwright が spike/fixtures/gsi/ の PNG で応答する（計画 D4）
 */
export async function loadDemTiles(range: GridRange): Promise<Map<string, DemTileData>> {
  const context = new OffscreenCanvas(TILE_SIZE, TILE_SIZE).getContext('2d', {
    willReadFrequently: true,
  })
  if (context === null) throw new Error('OffscreenCanvas の 2D コンテキストを得られません')
  context.globalCompositeOperation = 'copy'
  const tiles = new Map<string, DemTileData>()
  for (const tile of tilesInPixelRect(rangePixelRect(range), range.z)) {
    const response = await fetch(demTileUrl('dem1a', tile))
    if (response.status === 404) continue
    if (!response.ok) throw new Error(`DEM1A ${tile.x}/${tile.y}: HTTP ${response.status}`)
    const bitmap = await createImageBitmap(await response.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    tiles.set(
      tileKey(tile.x, tile.y),
      decodeGsiDem(context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data),
    )
  }
  return tiles
}
