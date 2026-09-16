import type { DemTileId, RangeElevation } from '../../dem/terrainTiles'

/** 組み立てたタイル（Terrarium の RGBA）と、組み立ての時間（ms） */
export interface GeneratedRgba {
  rgba: Uint8ClampedArray<ArrayBuffer>
  composeMs: number
}

/** 地形のタイルを作る口（メインスレッド・Worker。計画で決めたこと 11） */
export interface DemTileGenerator {
  /** 範囲の標高（無効セルは埋めた後）。null は範囲なし（外だけで作る） */
  setRange(range: RangeElevation | null): void
  /** signal が取り消されていたら、組み立てずに null（MapLibre が要らなくしたタイル。計画で決めたこと 23） */
  generate(tile: DemTileId, signal: AbortSignal): Promise<GeneratedRgba | null>
  dispose(): void
}
