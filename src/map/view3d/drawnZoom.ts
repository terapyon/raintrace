/**
 * 描かれる地形タイルのズーム（spec 05 §4.3）。地形が有効な間、MapLibre 6.6.0 はタイルごとに可変のズームで描き、
 * pitch が大きいほど粗くする。S では地図・タイル・DEM のズームの取り違えで 3 回の直しが入ったので、
 * 判定は実測（drawnTileZoomAt）で行い、見込み（predictedCentreTileZoom）は実測できないときだけに使う
 * （計画で決めたこと 3）
 */
import { type DrawnTileZoom, drawnTileZoom } from '../../dem/tileZoom'

/**
 * (c) で 2D に切り替える境界（spec 05 §4.3、R05-4）と、§4.4 の fps の調整で「粗いズームを 2D にする」境界を
 * 兼ねる、ただ 1 つの定数。描かれる地形タイルのズームで定義する。値は 15(R05-4 の承認の有力な値)。
 * Task 13 の手動確認で確かめる。ほかの値（下の余裕と下限）はこれから導く（計画で決めたこと 2）
 */
export const MIN_3D_DRAWN_TILE_ZOOM: DrawnTileZoom = drawnTileZoom(15)
/** 3D に切り替えたときの pitch（spec 05 §3.4） */
export const PITCH_3D_DEG = 60
/** pitch 60 では手前が大きく写るので、範囲全体を収める（pitch 0 の）ズームから引く分 */
export const PITCH_FIT_MARGIN_ZOOM = 0.5
/** 2D に落ちた後、3D に戻す見込みの閾値の余裕（行き来するたびに地形と水面を作り直さない。1000 m の index だけで 25 MB） */
export const RETURN_TO_3D_MARGIN_ZOOM = 0.5
/**
 * 3D に切り替えたときの地図のズームの下限。S の表で pitch 60 の描かれるタイルは地図のズームより 1 段粗い
 * （地図 16 → 15）ので、境界 + 1 に余裕 0.5 を足す。1.5 は pitch 60（PITCH_3D_DEG）に結びついた値で、
 * この下限の見込みが 3D に戻す閾値（境界 + RETURN_TO_3D_MARGIN_ZOOM）以上であることをテストで確かめる
 */
export const MIN_3D_VIEW_ZOOM = MIN_3D_DRAWN_TILE_ZOOM + 1.5
/**
 * MapLibre の calculateTileZoom の視野角の項 log2(1 / cos(fov / 2))（fov = 36.87°）。見込みは次を前提にする:
 * 地図の fov は MapLibre の既定のまま、setSourceTileLodParams を使わない（calculateTileZoom は既定）、
 * DEM の tileSize は 256（地形タイルは 512 で、地図のズームにそのまま足す）。どれかを変えたら見込みを見直す
 */
export const CENTRE_TILE_ZOOM_OFFSET = Math.log2(1 / Math.cos(((36.87 / 2) * Math.PI) / 180))

/** 地形タイルの位置（MapLibre の tileID.canonical と同じ形） */
export interface CanonicalTile {
  z: number
  x: number
  y: number
}

/** メルカトル座標（0〜1。MapLibre の MercatorCoordinate の x・y） */
export interface MercatorPoint {
  x: number
  y: number
}

export type BoundaryState = '3d' | 'fallback-2d'
export type BoundaryDecision = 'keep' | 'to-2d' | 'to-3d'

/**
 * 描かれている地形タイル（terrain.tileManager.getRenderableTiles() の canonical）の中から点を含むものを探し、
 * そのズームを返す（実測）。coveringTiles のタイルは重ならないが、万一重なれば細かい方を返す。
 * どれにも含まれなければ null
 */
export function drawnTileZoomAt(
  tiles: readonly CanonicalTile[],
  point: MercatorPoint,
): DrawnTileZoom | null {
  let best: number | null = null
  for (const tile of tiles) {
    const n = 2 ** tile.z
    const tx = point.x * n
    const ty = point.y * n
    const inside = tx >= tile.x && tx < tile.x + 1 && ty >= tile.y && ty < tile.y + 1
    if (inside && (best === null || tile.z > best)) best = tile.z
  }
  return best === null ? null : drawnTileZoom(best)
}

/**
 * 画面の中心で描かれる地形タイルのズームの見込み（連続の値）: 地図のズーム + 視野角の項 + log2(cos pitch) / 2。
 * MapLibre の calculateTileZoom を画面の中心の点で評価した値で、実測より細かくならない（粗い側にだけ外れる。
 * maxzoom の頭打ちを除く）。中心を含むタイルは、カメラから最寄りの点までの距離 d3 が中心までの距離 D 以下で、
 * タイルの角度 θ_tile も pitch 以下なので、そのタイルの値は見込み以上になる（pitch の項の係数は約 0.9998 で 1 以下、
 * タイルの数の項は既定では 0）。四分木は floor(値) の段まで分けるので、実測は floor(見込み) 以上。
 * S の表の pitch 0・60 と一致し、pitch 85 では 2 段粗い側に外れることもある（控えめ）
 */
export function predictedCentreTileZoom(mapZoom: number, pitchDeg: number): number {
  const cos = Math.max(1e-6, Math.cos((pitchDeg * Math.PI) / 180))
  return mapZoom + CENTRE_TILE_ZOOM_OFFSET + Math.log2(cos) / 2
}

export function drawnTileZoomForView(mapZoom: number, pitchDeg: number): DrawnTileZoom {
  return drawnTileZoom(Math.max(0, Math.floor(predictedCentreTileZoom(mapZoom, pitchDeg))))
}

/** 見込みが z + 0.5（その段の真ん中）になる地図のズーム（撮影で「画面の中心が描かれるタイル z」の視点を置く） */
export function mapZoomForCentreTileZoom(z: DrawnTileZoom, pitchDeg: number): number {
  return z + 0.5 - predictedCentreTileZoom(0, pitchDeg)
}

/** 境界より粗い（2D にする）か */
export function isBelow3dBoundary(z: DrawnTileZoom): boolean {
  return z < MIN_3D_DRAWN_TILE_ZOOM
}

/**
 * (c) の判定（spec 05 §4.3、R05-4。§4.4 の「粗いズームを 2D」も同じ）。3D で描いている間は画面の中心のタイルの
 * 実測で 2D に落とす。2D に落ちた後は地形が無く実測できないので、見込みが境界 + 余裕に届いたら 3D に戻す
 */
export function boundaryDecision(
  state: BoundaryState,
  measured: DrawnTileZoom | null,
  predicted: number,
): BoundaryDecision {
  if (state === '3d') return measured !== null && isBelow3dBoundary(measured) ? 'to-2d' : 'keep'
  return predicted >= MIN_3D_DRAWN_TILE_ZOOM + RETURN_TO_3D_MARGIN_ZOOM ? 'to-3d' : 'keep'
}

/**
 * 3D に切り替えたときの地図のズーム。範囲全体を収めるズームから pitch の分を引き、下限（MIN_3D_VIEW_ZOOM）より
 * 粗くしない。範囲全体が収まらなければ中心寄りに寄る（spec 05 §4.3 の (i) と (ii) の組み合わせ）
 */
export function zoomFor3dView(fitZoom: number): number {
  return Math.max(fitZoom - PITCH_FIT_MARGIN_ZOOM, MIN_3D_VIEW_ZOOM)
}
