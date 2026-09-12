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
 * レンダリングを介さず、MapLibre の地形メッシュの高さを直接計算する
 * （タスクレビュー fix round 1、ズームの意味の訂正は fix round 3）。
 *
 * **頂点間隔の規則（再発防止のため1行にまとめる）**: 頂点間隔 ＝ 描かれている地形タイル（ズーム Z）の
 * 2px ＝ ズーム Z−1 の DEM の1px（raster-dem の tileSize が 256 のとき）。`meshHeightAt` が受け取る
 * `zoom` は Z（描かれている地形タイルのズーム）であって、DEM 自体のズーム（Z−1）ではない。
 *
 * MapLibre の getTerrainMesh は「描かれている地形タイル」自体に 129×129（128 分割、2px 間隔）の
 * 格子で頂点を置き、各格子の対角（左上→右下）で2枚の三角形に分ける
 * （maplibre-gl-dev.mjs getTerrainMesh L10493-10513）。この spike の DEM ソースは
 * `tileSize: 256`（既定の 512 ではない）を明示しているため、地形タイルの実ズームは地図ズームと一致し、
 * そのタイルが読む DEM のズームは `deltaZoom`（既定 1、固定）だけ粗い ⇒ **DEM ズーム = 地形タイルの
 * ズーム − 1**（`getSourceTile` L10148）。地形タイルの頂点間隔（2px）＝ DEM（1段粗い）の1画素にちょうど
 * 一致するため（`dz=1` で 1 地形タイル＝ DEM 128 画素）、`terrariumTile` の画素 (px, py)（z17 の連続座標
 * `(tileX*256+px)*scale` の角の高さ）を直接、地形タイルのズームから求めた間隔でサンプリングすればよい
 * （タイル境界をまたいでも z17 座標の頂点格子は連続している）。
 *
 * **前回の取り違え（fix round 2、re-review で発覚）**: 「渡す `zoom` は DEM 自体のズームで、
 * 地形タイルのズームから deltaZoom を引いてから渡す」という記述は誤りだった。この関数はすでに
 * 「描かれている地形タイル」のズームをそのまま受け取るモデルになっており、そこからさらに 1 引くと
 * deltaZoom を二重に差し引くことになり、格子間隔が2倍・弦の高さが4倍（z18のみ2倍）になってしまう。
 *
 * @param sample z17 の連続座標（角）→ 標高のサンプラー（`sampleZ17Corner` に渡す元のセルサンプラー）
 * @param zoom 実際に描かれている地形タイルのズーム（`getRenderableTiles` の `tileID.canonical.z` を
 *   そのまま渡す。0〜18 の整数。DEM ソースの maxzoom は 17 なので、地形タイル 18 は DEM 17 を
 *   オーバーズームして読む——「17 を超えたら 17 のタイルを使う」のは DEM 側であって地形タイル側では
 *   ない。地形タイル 18 の頂点間隔は DEM 17 の 1 画素の半分（0.97m 相当）で、これは `meshHeightAt(18)`
 *   が正しく表す）
 * @param x z17 の連続座標（角基準。セルの中心なら `col + 0.5` 等）
 * @param y 同上
 */
export function meshHeightAt(sample: ElevationSampler, zoom: number, x: number, y: number): number {
  const z = Math.min(DEM_Z + 1, Math.max(0, Math.round(zoom)))
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
