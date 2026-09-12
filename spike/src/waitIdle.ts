import type { Map as MapLibreMap } from 'maplibre-gl'

/**
 * 1 枚描かせ、地図が idle（タイルの読み込みと描画が済んだ）になるまで待つ。
 * すでに idle だと idle は来ないので、先に購読してから triggerRepaint で描かせる
 */
export async function waitIdle(map: MapLibreMap): Promise<void> {
  const idle = map.once('idle')
  map.triggerRepaint()
  await idle
}
