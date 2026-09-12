import { describe, expect, it } from 'vitest'
import type { DemTileData } from '../../src/dem/DemGrid.ts'
import { tileKey } from '../../src/dem/demSelection.ts'
import { rangePixelRect } from '../../src/dem/gridRange.ts'
import { tilesInPixelRect } from '../../src/dem/tileMath.ts'
import {
  buildRealScene,
  buildSyntheticScene,
  FILM_DEPTH_M,
  isFilmCell,
  POND_DEPTHS_M,
  RANGE_M,
  shibuyaRange,
} from './scenes'

/** 無効値を少し含み、タイルごとに値の違う規則的な標高のタイル（実タイルの代わり。Node では PNG を復号しない） */
function patternTile(tx: number, ty: number): DemTileData {
  const elevation = new Float32Array(256 * 256)
  const validMask = new Uint8Array(256 * 256)
  for (let p = 0; p < elevation.length; p++) {
    if (p % 97 === 0) continue
    elevation[p] = 10 + (tx % 3) + (ty % 3) * 0.5 + (p % 7) * 0.1 + Math.floor(p / 256) * 0.01
    validMask[p] = 1
  }
  return { elevation, validMask }
}

/** 範囲にかかるタイル（渋谷では x・y とも 3 枚）を、02 の tileKey で引ける形にする */
function patternTiles(): Map<string, DemTileData> {
  const range = shibuyaRange()
  return new Map(
    tilesInPixelRect(rangePixelRect(range), range.z).map((t) => [
      tileKey(t.x, t.y),
      patternTile(t.x, t.y),
    ]),
  )
}

describe('合成の場面（計画 D4）', () => {
  const scene = buildSyntheticScene('fixed')
  const { range } = scene
  const n = range.size

  it('範囲は渋谷の 500m 四方で、一辺は ceil(500 / セルの大きさ)', () => {
    expect(n).toBe(Math.ceil(RANGE_M / range.cellSizeM))
    expect(scene.validMask.every((v) => v === 1)).toBe(true)
  })

  it('グリッドの標高はサンプラーの値と全セルで一致する', () => {
    let mismatches = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const expected = Math.fround(scene.sample(range.originX + col, range.originY + row) ?? 0)
        if (scene.elevation[row * n + col] !== expected) mismatches++
      }
    }
    expect(mismatches).toBe(0)
  })

  it('3 つの池の最大の水深は 5cm・50cm・2m（1mm 以内）', () => {
    // 池は北側の同じ行の帯にあり、西から順に並ぶ。範囲を東西に 3 等分して最大値をとる
    const maxima = [0, 0, 0]
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (isFilmCell(range, col, row)) continue
        const k = Math.min(2, Math.floor((col / n) * 3))
        maxima[k] = Math.max(maxima[k] ?? 0, scene.depth[row * n + col] ?? 0)
      }
    }
    maxima.forEach((depth, k) => {
      expect(depth).toBeCloseTo(POND_DEPTHS_M[k] ?? -1, 3)
    })
  })

  it('膜のセルの水深は 1cm で、斜面は南へ 10% で下る', () => {
    const col = Math.floor(n / 2)
    const row = Math.floor(n * 0.7)
    expect(isFilmCell(range, col, row)).toBe(true)
    expect(scene.depth[row * n + col]).toBe(Math.fround(FILM_DEPTH_M))
    const drop =
      (scene.elevation[row * n + col] ?? 0) - (scene.elevation[(row + 10) * n + col] ?? 0)
    expect(drop).toBeCloseTo(0.1 * 10 * range.cellSizeM, 3)
  })

  it('film の水は膜だけで、池が無い', () => {
    const film = buildSyntheticScene('film')
    let wetOutsideFilm = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!isFilmCell(range, col, row) && (film.depth[row * n + col] ?? 0) > 0) wetOutsideFilm++
      }
    }
    expect(wetOutsideFilm).toBe(0)
  })
})

describe('実データの場面（計画 D4・D5）', () => {
  const tiles = patternTiles()
  const scene = buildRealScene(shibuyaRange(), tiles)
  const { range } = scene
  const n = range.size

  it('範囲にかかるタイルは 9 枚（x 116398〜116400・y 51622〜51624）', () => {
    expect([...tiles.keys()].sort()).toEqual(
      [116398, 116399, 116400]
        .flatMap((x) => [51622, 51623, 51624].map((y) => tileKey(x, y)))
        .sort(),
    )
  })

  it('タイルの外は、並べたタイルの端の値を延ばす（A の地形が範囲の外で段差を作らない）', () => {
    const x0 = 116398 * 256
    const y = range.originY + 10
    expect(scene.sample(x0 - 50, y)).toBe(scene.sample(x0, y))
  })

  it('02 の assembleGrid で組んだグリッドは、A の地形に使うサンプラーと全セルで一致する', () => {
    let mismatches = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const value = scene.sample(range.originX + col, range.originY + row)
        const i = row * n + col
        const valid = scene.validMask[i] === 1
        if (valid !== (value !== null)) mismatches++
        else if (valid && scene.elevation[i] !== Math.fround(value ?? 0)) mismatches++
      }
    }
    expect(mismatches).toBe(0)
  })

  it('有効セルの水深は 1cm 以上、無効セルは 0', () => {
    let bad = 0
    let invalid = 0
    for (let i = 0; i < n * n; i++) {
      if (scene.validMask[i] === 1) {
        if ((scene.depth[i] ?? 0) < Math.fround(FILM_DEPTH_M)) bad++
      } else {
        invalid++
        if (scene.depth[i] !== 0) bad++
      }
    }
    expect(invalid).toBeGreaterThan(0)
    expect(bad).toBe(0)
  })
})
