import type { ElevationSampler } from '../types'
import { DEM_Z, decodeTerrarium, encodeTerrarium, sampleZ17Corner } from './terrarium'

/**
 * Terrarium の量子化（1/256m で切り捨て）を、encode→decode の往復で再現する（タスクレビュー
 * fix round 1、直接計算の材料）。MapLibre が RGBA のタイル画像を経由して読む値と同じになる
 */
export function quantizeTerrarium(heightM: number): number {
  const buf = new Uint8ClampedArray(4)
  encodeTerrarium(heightM, buf, 0)
  return decodeTerrarium(buf[0] ?? 0, buf[1] ?? 0, buf[2] ?? 0)
}

/**
 * レンダリングを介さず、MapLibre の地形メッシュの高さを直接計算する（タスクレビュー fix round 1）。
 *
 * MapLibre の getTerrainMesh は 256px の DEM タイルに 128×128 の格子（2px 間隔）で頂点を置き、
 * 各格子の対角（左上→右下）で2枚の三角形に分ける（maplibre-gl-dev.mjs getTerrainMesh、計画の確認）。
 * `terrariumTile`（`z, x, y` のタイル）の画素 (px, py) は z17 の連続座標 `(tileX*256+px)*scale` の
 * 角の高さなので、頂点の間隔はタイル・ズームによらず z17 座標で `2 * scale`
 * （`scale = 2 ** (17 - zoom)`）になる——タイル境界をまたいでも頂点格子は連続している。
 *
 * @param sample z17 の連続座標（角）→ 標高のサンプラー（`sampleZ17Corner` に渡す元のセルサンプラー）
 * @param zoom 描かれている DEM 自体のズーム（0〜17 の整数。17 を超える表示は 17 のタイルを使う）。
 *   MapLibre の地形タイル（`getRenderableTiles` の `canonical.z`）は `deltaZoom`（既定 1）だけ DEM より
 *   細かいズームで管理される（`RasterDEMTileSource` は「実際のズーム − deltaZoom」の DEM タイルを読む）
 *   ので、地形タイルのズームを渡すときは `− deltaZoom`（既定 1）した DEM のズームに直してから渡す
 * @param x z17 の連続座標（角基準。セルの中心なら `col + 0.5` 等）
 * @param y 同上
 */
export function meshHeightAt(sample: ElevationSampler, zoom: number, x: number, y: number): number {
  const z = Math.min(DEM_Z, Math.max(0, Math.round(zoom)))
  const scale = 2 ** (DEM_Z - z)
  const step = 2 * scale
  const kx = Math.floor(x / step)
  const ky = Math.floor(y / step)
  const u = x / step - kx
  const v = y / step - ky
  const corner = (ci: number, cj: number): number =>
    quantizeTerrarium(sampleZ17Corner(sample, ci * step, cj * step))
  const v00 = corner(kx, ky)
  const v10 = corner(kx + 1, ky)
  const v01 = corner(kx, ky + 1)
  const v11 = corner(kx + 1, ky + 1)
  // 対角は左上(v00)→右下(v11)。v <= u が右上の三角形（v00, v10, v11）、v > u が左下（v00, v11, v01）
  return v <= u ? v00 * (1 - u) + v10 * (u - v) + v11 * v : v00 * (1 - v) + v11 * u + v01 * (v - u)
}
