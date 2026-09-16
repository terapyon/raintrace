import { vi } from 'vitest'

/**
 * 地理院の標高タイルの復号（OffscreenCanvas・createImageBitmap）と fetch の応答の偽物。gsiDemTile と
 * mainTileGenerator のテストで共有する（横断レビュー m2）
 */

/** 復号に渡す 256 × 256 の画素（すべて 0 → 標高 0 m の有効セル） */
export const TILE_PIXELS = new Uint8ClampedArray(256 * 256 * 4)

export class FakeOffscreenCanvas {
  getContext() {
    return {
      globalCompositeOperation: '',
      drawImage: () => {},
      getImageData: () => ({ data: TILE_PIXELS }),
    }
  }
}

export const okResponse = { status: 200, ok: true, blob: async () => ({}) }
export const notFoundResponse = { status: 404, ok: false, blob: async () => ({}) }

/** 復号を偽物に差し替える。width・height は createImageBitmap が返す大きさ（違えば大きさの検査で失敗する） */
export function stubTileDecoding(width = 256, height = 256): void {
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas)
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height, close: () => {} })),
  )
}
