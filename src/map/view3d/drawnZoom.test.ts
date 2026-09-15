import { describe, expect, it } from 'vitest'
import { lonLatToPixel, TILE_SIZE } from '../../dem/tileMath'
import { drawnTileZoom } from '../../dem/tileZoom'
import {
  boundaryDecision,
  type CanonicalTile,
  CENTRE_TILE_ZOOM_OFFSET,
  drawnTileZoomAt,
  drawnTileZoomForView,
  isBelow3dBoundary,
  type MercatorPoint,
  MIN_3D_DRAWN_TILE_ZOOM,
  MIN_3D_VIEW_ZOOM,
  mapZoomForCentreTileZoom,
  PITCH_3D_DEG,
  predictedCentreTileZoom,
  RETURN_TO_3D_MARGIN_ZOOM,
  zoomFor3dView,
} from './drawnZoom'

const SHIBUYA = { lon: 139.7016, lat: 35.658 }

/** 経緯度 → メルカトル（0〜1。MapLibre の MercatorCoordinate の x・y と同じ） */
function mercator(lon: number, lat: number): MercatorPoint {
  const p = lonLatToPixel(lon, lat, 0)
  return { x: p.x / TILE_SIZE, y: p.y / TILE_SIZE }
}

function tileAt(lon: number, lat: number, z: number): CanonicalTile {
  const p = lonLatToPixel(lon, lat, z)
  return { z, x: Math.floor(p.x / TILE_SIZE), y: Math.floor(p.y / TILE_SIZE) }
}

describe('drawnTileZoomAt（描かれている地形タイルから、点のズームを実測する。spec 05 §5）', () => {
  const t15 = tileAt(SHIBUYA.lon, SHIBUYA.lat, 15)
  // 渋谷の z15 のタイルの西隣の z14 のタイル（重ならない）
  const west14: CanonicalTile = { z: 14, x: Math.floor(t15.x / 2) - 1, y: Math.floor(t15.y / 2) }
  const inWest14: MercatorPoint = { x: (west14.x + 0.5) / 2 ** 14, y: (west14.y + 0.5) / 2 ** 14 }

  it('点を含むタイルのズーム（渋谷は z15、西隣の z14 のタイルの中の点は 14）', () => {
    expect(drawnTileZoomAt([west14, t15], mercator(SHIBUYA.lon, SHIBUYA.lat))).toBe(15)
    expect(drawnTileZoomAt([west14, t15], inWest14)).toBe(14)
  })

  it('どのタイルにも含まれなければ null', () => {
    expect(drawnTileZoomAt([t15], inWest14)).toBeNull()
    expect(drawnTileZoomAt([], mercator(SHIBUYA.lon, SHIBUYA.lat))).toBeNull()
  })

  it('万一タイルが重なっていれば細かい方を返す', () => {
    const parent: CanonicalTile = { z: 14, x: Math.floor(t15.x / 2), y: Math.floor(t15.y / 2) }
    expect(drawnTileZoomAt([parent, t15], mercator(SHIBUYA.lon, SHIBUYA.lat))).toBe(15)
  })

  it('タイルの東・南の端はそのタイルに含めない（半開区間）', () => {
    const tile: CanonicalTile = { z: 15, x: 100, y: 200 }
    const east: CanonicalTile = { z: 15, x: 101, y: 200 }
    const onEdge: MercatorPoint = { x: 101 / 2 ** 15, y: 200.5 / 2 ** 15 }
    expect(drawnTileZoomAt([tile], onEdge)).toBeNull()
    expect(drawnTileZoomAt([tile, east], onEdge)).toBe(15)
  })
})

describe('見込み（画面の中心のタイル。地形が有効な間は pitch で粗くなる）', () => {
  it('視野角の項は log2(1 / cos(fov / 2))、fov = 36.87° で約 0.076', () => {
    expect(CENTRE_TILE_ZOOM_OFFSET).toBeCloseTo(0.076, 3)
  })

  it('pitch 0 は地図のズームと同じ、pitch 60 は 1 段粗い（S の表の 15〜17）', () => {
    for (const z of [15, 16, 17]) {
      expect(drawnTileZoomForView(z, 0)).toBe(z)
      expect(drawnTileZoomForView(z, 60)).toBe(z - 1)
    }
  })

  it('pitch 85 は S の表の 16 → 14、17 → 15 と同じ。15 は 13（見込みは粗い側にだけ外れる。中心を含むタイルの最寄りの辺は中心より近いので、実測は細かい側）', () => {
    expect(drawnTileZoomForView(16, 85)).toBe(14)
    expect(drawnTileZoomForView(17, 85)).toBe(15)
    expect(drawnTileZoomForView(15, 85)).toBe(13)
  })

  it('地図のズーム 18 は S の実測（pitch 60 で 18、85 で 17）以下（見込みは粗い側）', () => {
    expect(drawnTileZoomForView(18, 60)).toBeLessThanOrEqual(18)
    expect(drawnTileZoomForView(18, 85)).toBeLessThanOrEqual(17)
  })

  it('連続の見込みと、その逆（撮影の視点のズーム）', () => {
    expect(predictedCentreTileZoom(16.5, 60)).toBeCloseTo(16.5 + 0.076 - 0.5, 3)
    const z = mapZoomForCentreTileZoom(drawnTileZoom(15), 85)
    expect(drawnTileZoomForView(z, 85)).toBe(15)
    expect(predictedCentreTileZoom(z, 85)).toBeCloseTo(15.5, 9)
  })

  it('負の値は 0 にそろえる', () => {
    expect(drawnTileZoomForView(-0.2, 0)).toBe(0)
  })
})

describe('境界（(c) と §4.4 の共有の定数。計画で決めたこと 2）', () => {
  it('境界は描かれるタイル 15。14 は 2D、15 以上は 3D', () => {
    expect(MIN_3D_DRAWN_TILE_ZOOM).toBe(15)
    expect(isBelow3dBoundary(drawnTileZoom(14))).toBe(true)
    expect(isBelow3dBoundary(drawnTileZoom(15))).toBe(false)
  })

  it('3D の間は実測で判定する（見込みは使わない）', () => {
    expect(boundaryDecision('3d', drawnTileZoom(14), 99)).toBe('to-2d')
    expect(boundaryDecision('3d', drawnTileZoom(15), 0)).toBe('keep')
    // タイルがまだ無い（実測できない）ときは変えない
    expect(boundaryDecision('3d', null, 0)).toBe('keep')
  })

  it('2D に落ちた後は、見込みが境界 + 0.5 以上になったら 3D に戻す（行き来を防ぐ余裕）', () => {
    const threshold = MIN_3D_DRAWN_TILE_ZOOM + RETURN_TO_3D_MARGIN_ZOOM
    expect(boundaryDecision('fallback-2d', null, threshold - 0.01)).toBe('keep')
    expect(boundaryDecision('fallback-2d', null, threshold)).toBe('to-3d')
    // pitch 60 で 2D に落ちるのは地図のズーム約 15.42 より粗いとき、戻るのは約 15.92 から
    expect(boundaryDecision('fallback-2d', null, predictedCentreTileZoom(15.9, 60))).toBe('keep')
    expect(boundaryDecision('fallback-2d', null, predictedCentreTileZoom(15.93, 60))).toBe('to-3d')
  })
})

describe('zoomFor3dView（3D に切り替えたときの視点。計画で決めたこと 4）', () => {
  it('下限は境界 + 1.5（16.5）。S の表で pitch 60 の描かれるタイルは地図より 1 段粗い（16 → 15）ので、境界 + 1 に余裕 0.5', () => {
    expect(MIN_3D_VIEW_ZOOM).toBe(16.5)
    expect(drawnTileZoomForView(MIN_3D_VIEW_ZOOM, 60)).toBeGreaterThanOrEqual(
      MIN_3D_DRAWN_TILE_ZOOM,
    )
  })

  it('下限の見込み（pitch 60 で約 16.08）は、3D に戻す閾値（境界 + 0.5 = 15.5）以上（2D に落ちた後に選び直しても 3D で開く）', () => {
    expect(predictedCentreTileZoom(MIN_3D_VIEW_ZOOM, PITCH_3D_DEG)).toBeGreaterThanOrEqual(
      MIN_3D_DRAWN_TILE_ZOOM + RETURN_TO_3D_MARGIN_ZOOM,
    )
  })

  it('範囲全体を収めるズームから 0.5 引く。ただし下限より粗くしない', () => {
    expect(zoomFor3dView(17.8)).toBeCloseTo(17.3, 9)
    // 1280 × 720 の 500 m（全体は約 16.3）と 1000 m（約 15.3）は、どちらも 16.5 で開く（幅 約 880 m）
    expect(zoomFor3dView(16.31)).toBe(16.5)
    expect(zoomFor3dView(15.31)).toBe(16.5)
    expect(isBelow3dBoundary(drawnTileZoomForView(zoomFor3dView(12), 60))).toBe(false)
  })
})
