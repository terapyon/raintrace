import {
  ancestorTile,
  type DemTileId,
  type GeneratedTile,
  generateTerrariumTile,
  OutsideTileCache,
  type RangeElevation,
} from '../../dem/terrainTiles'
import type { TileCoord } from '../../dem/tileMath'
import { createMainGsiFetcher } from './gsiDemTile'
import type { DemTileGenerator, GeneratedRgba } from './tileGenerator'

/** 組み立てを待っている要求（取り消しの印つき） */
interface PendingRequest {
  tile: DemTileId
  signal: AbortSignal
}

/**
 * メインスレッドでタイルを作る（addProtocol はメインスレッドで呼ばれる。spec 05 §4.2 の「作る場所とコスト」）。
 * composeMs は組み立ての時間（メインスレッドを止める分）。取得の待ちは含めない
 */
export function createMainTileGenerator(): DemTileGenerator {
  const pending = new Set<PendingRequest>()
  // 取り消されていない要求が、出所のタイル（DEM のタイルの祖先）を待っているか（計画で決めたこと 23）
  const isWanted = (source: TileCoord): boolean => {
    for (const request of pending) {
      if (request.signal.aborted || request.tile.z < source.z) continue
      const at = ancestorTile(request.tile, source.z)
      if (at.x === source.x && at.y === source.y) return true
    }
    return false
  }
  const fetchTile = createMainGsiFetcher(isWanted)
  const cache = new OutsideTileCache()
  let range: RangeElevation | null = null
  const generate = async (tile: DemTileId, signal: AbortSignal): Promise<GeneratedRgba | null> => {
    const used = range
    const request: PendingRequest = { tile, signal }
    pending.add(request)
    let generated: GeneratedTile | null
    try {
      generated = await generateTerrariumTile(
        tile,
        used,
        fetchTile,
        cache,
        () => performance.now(),
        signal,
      )
    } finally {
      pending.delete(request)
    }
    if (generated === null) return null
    // 取得を待つ間に地点を選び直した（setRange）。MapLibre は setTiles の読み直しで前の要求を取り消さず、
    // 古い要求の結果が後から届くと古い範囲のタイルが残るので、今の範囲で組み立て直す（外のタイルは cache にある）
    if (range !== used) return generate(tile, signal)
    if (generated.outsideFailed) {
      console.warn(
        `範囲の外の標高タイルを取得できませんでした（${tile.z}/${tile.x}/${tile.y}）。0 m として描きます`,
      )
    }
    return { rgba: generated.rgba, composeMs: generated.composeMs }
  }
  return {
    setRange(next) {
      range = next
    },
    generate,
    dispose() {},
  }
}
