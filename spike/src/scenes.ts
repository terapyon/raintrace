import { assembleGrid, type DemTileData } from '../../src/dem/DemGrid.ts'
import { tileKey } from '../../src/dem/demSelection.ts'
import { computeGridRange, type GridRange, rangePixelRect } from '../../src/dem/gridRange.ts'
import { TILE_SIZE, tilesInPixelRect } from '../../src/dem/tileMath.ts'
import { analyzeTerrain } from '../../src/simulation/terrain/analyzeTerrain.ts'
import type { ElevationSampler, Scene } from './types'

/** E2E と同じ渋谷の地点。500m の範囲は DEM1A の z17 の x 116398〜116400・y 51622〜51624 の 9 枚にかかる（中央が 02 のフィクスチャ） */
export const SHIBUYA = { lon: 139.7016, lat: 35.658 } as const
export const RANGE_M = 500
export const DEM_Z = 17

export const POND_DEPTHS_M = [0.05, 0.5, 2] as const
export const FILM_DEPTH_M = 0.01
/** 1cm の判定。Float32 の 0.01 の丸めで膜が捨てられないよう、0.1mm 小さくする（計画 D8） */
export const MIN_DEPTH_M = 0.0099

// 合成の場面の寸法（計画 D4）。位置は範囲の一辺 L に対する割合
const LOW_M = 20
const SLOPE_GRADE = 0.1
const SLOPE_NORTH = 0.55
const SLOPE_SOUTH = 0.95
const BOWL_RADIUS_M = 60
const BOWL_DEPTH_M = 3
const BOWL_CENTERS = [
  [0.2, 0.25],
  [0.5, 0.25],
  [0.8, 0.25],
] as const
const FILM = { x0: 0.1, x1: 0.9, y0: 0.6, y1: 0.9 } as const

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const sideM = (range: GridRange): number => range.size * range.cellSizeM

/** 斜面の北端の高さ。北側の台地はこの高さで、斜面とつながる */
const plateauM = (range: GridRange): number =>
  LOW_M + SLOPE_GRADE * (SLOPE_SOUTH - SLOPE_NORTH) * sideM(range)

/** 合成と実データで共通の範囲（渋谷の 500m 四方、z17） */
export function shibuyaRange(): GridRange {
  return computeGridRange(SHIBUYA.lon, SHIBUYA.lat, RANGE_M, DEM_Z)
}

/** 北の台地に 3 つのすり鉢、南に北へ上る斜面。範囲の外は縁の値を延ばす */
export function syntheticSampler(range: GridRange): ElevationSampler {
  const side = sideM(range)
  const plateau = plateauM(range)
  return (gx, gy) => {
    const x = clamp((gx - range.originX + 0.5) * range.cellSizeM, 0, side)
    const y = clamp((gy - range.originY + 0.5) * range.cellSizeM, 0, side)
    if (y >= SLOPE_SOUTH * side) return LOW_M
    if (y >= SLOPE_NORTH * side) return LOW_M + SLOPE_GRADE * (SLOPE_SOUTH * side - y)
    for (const [cx, cy] of BOWL_CENTERS) {
      const r2 = (x - cx * side) ** 2 + (y - cy * side) ** 2
      if (r2 < BOWL_RADIUS_M ** 2) return plateau - BOWL_DEPTH_M * (1 - r2 / BOWL_RADIUS_M ** 2)
    }
    return plateau
  }
}

/** 斜面の 1cm の膜のセルか（セルの中心で判定） */
export function isFilmCell(range: GridRange, col: number, row: number): boolean {
  const side = sideM(range)
  const x = (col + 0.5) * range.cellSizeM
  const y = (row + 0.5) * range.cellSizeM
  return x >= FILM.x0 * side && x < FILM.x1 * side && y >= FILM.y0 * side && y < FILM.y1 * side
}

function minValid(elevation: Float32Array, validMask: Uint8Array): number {
  let min = Number.POSITIVE_INFINITY
  for (let i = 0; i < elevation.length; i++) {
    if (validMask[i] === 1) min = Math.min(min, elevation[i] ?? min)
  }
  return Number.isFinite(min) ? min : 0
}

export function buildSyntheticScene(water: 'fixed' | 'film'): Scene {
  const range = shibuyaRange()
  const sample = syntheticSampler(range)
  const n = range.size
  const side = sideM(range)
  const plateau = plateauM(range)
  const elevation = new Float32Array(n * n)
  const validMask = new Uint8Array(n * n).fill(1)
  const depth = new Float32Array(n * n)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col
      elevation[i] = sample(range.originX + col, range.originY + row) ?? 0
      if (isFilmCell(range, col, row)) {
        depth[i] = FILM_DEPTH_M
        continue
      }
      if (water === 'film') continue
      const x = (col + 0.5) * range.cellSizeM
      const y = (row + 0.5) * range.cellSizeM
      BOWL_CENTERS.forEach(([cx, cy], k) => {
        if ((x - cx * side) ** 2 + (y - cy * side) ** 2 >= BOWL_RADIUS_M ** 2) return
        const level = plateau - BOWL_DEPTH_M + (POND_DEPTHS_M[k] ?? 0)
        depth[i] = Math.max(0, level - (elevation[i] ?? 0))
      })
    }
  }
  return {
    name: 'synthetic',
    center: SHIBUYA,
    range,
    elevation,
    validMask,
    depth,
    sample,
    minElevation: minValid(elevation, validMask),
  }
}

/** 範囲にかかるタイルを並べたブロックの、z17 の画素の矩形（両端を含む） */
function tileBlock(range: GridRange): { x0: number; y0: number; x1: number; y1: number } {
  const tiles = tilesInPixelRect(rangePixelRect(range), range.z)
  const xs = tiles.map((t) => t.x)
  const ys = tiles.map((t) => t.y)
  return {
    x0: Math.min(...xs) * TILE_SIZE,
    y0: Math.min(...ys) * TILE_SIZE,
    x1: (Math.max(...xs) + 1) * TILE_SIZE - 1,
    y1: (Math.max(...ys) + 1) * TILE_SIZE - 1,
  }
}

/**
 * 実タイルのサンプラー（計画 D5）。ブロックの外は端の値を延ばす（A の地形が範囲の外で 0m に落ちて
 * 段差を作らないように）。無いタイル（404）と無効値は null
 */
export function tileBlockSampler(
  range: GridRange,
  tiles: ReadonlyMap<string, DemTileData>,
): ElevationSampler {
  const block = tileBlock(range)
  return (gx, gy) => {
    const x = clamp(gx, block.x0, block.x1)
    const y = clamp(gy, block.y0, block.y1)
    const tx = Math.floor(x / TILE_SIZE)
    const ty = Math.floor(y / TILE_SIZE)
    const tile = tiles.get(tileKey(tx, ty))
    if (tile === undefined) return null
    const p = (y - ty * TILE_SIZE) * TILE_SIZE + (x - tx * TILE_SIZE)
    return tile.validMask[p] === 1 ? (tile.elevation[p] ?? 0) : null
  }
}

/** 02 の部品で実タイルからグリッドを組み、水深は満水（fill − 標高）と 1cm の大きい方にする（計画 D4） */
export function buildRealScene(range: GridRange, tiles: ReadonlyMap<string, DemTileData>): Scene {
  const grid = assembleGrid(range, (tx, ty) => tiles.get(tileKey(tx, ty)))
  const { fill } = analyzeTerrain(grid)
  const depth = new Float32Array(grid.elevation.length)
  for (let i = 0; i < depth.length; i++) {
    if (grid.validMask[i] !== 1) continue
    depth[i] = Math.max(FILM_DEPTH_M, (fill[i] ?? 0) - (grid.elevation[i] ?? 0))
  }
  return {
    name: 'real',
    center: SHIBUYA,
    range,
    elevation: grid.elevation,
    validMask: grid.validMask,
    depth,
    sample: tileBlockSampler(range, tiles),
    minElevation: minValid(grid.elevation, grid.validMask),
  }
}
