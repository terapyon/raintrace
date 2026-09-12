import { describe, expect, it } from 'vitest'
import type { DemTileData } from '../../src/dem/DemGrid.ts'
import { tileKey } from '../../src/dem/demSelection.ts'
import { rangePixelRect } from '../../src/dem/gridRange.ts'
import { tilesInPixelRect } from '../../src/dem/tileMath.ts'
import {
  boundaryStepM,
  buildRealScene,
  buildSyntheticScene,
  FILM_DEPTH_M,
  fillInvalidNearest,
  isBowlCell,
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

  it('bowlFilm の水はすり鉢の中の 1cm の膜だけで、斜面の膜と池が無い', () => {
    const bowl = buildSyntheticScene('bowlFilm')
    let wet = 0
    let bad = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const d = bowl.depth[row * n + col] ?? 0
        if (isBowlCell(range, col, row)) {
          wet++
          if (d !== Math.fround(FILM_DEPTH_M)) bad++
        } else if (d !== 0) {
          bad++
        }
      }
    }
    // 3 つのすり鉢（半径 60m）の面積は 約 3 × π × 60² ≈ 33,900 m²（約 36,000 セル）
    expect(wet).toBeGreaterThan(30_000)
    expect(bad).toBe(0)
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

  it('fillInvalid のときは A の地形のサンプラーだけが無効画素を埋め、グリッドは変えない', () => {
    const filledScene = buildRealScene(shibuyaRange(), tiles, true)
    const i = scene.validMask.findIndex((v) => v === 0)
    const col = i % n
    const row = Math.floor(i / n)
    expect(scene.sample(range.originX + col, range.originY + row)).toBeNull()
    expect(filledScene.sample(range.originX + col, range.originY + row)).not.toBeNull()
    expect(filledScene.validMask[i]).toBe(0)
    expect(filledScene.depth[i]).toBe(0)
  })
})

describe('境界の段差（計画 D17）', () => {
  it('合成の場面: 北の縁は台地（基準 20m から約 20m）、南の縁は 0、東西の縁は両方を含む', () => {
    const scene = buildSyntheticScene('fixed')
    const step = boundaryStepM(scene)
    expect(scene.minElevation).toBeCloseTo(20, 3)
    expect(step.max).toBeCloseTo(0.1 * 0.4 * scene.range.size * scene.range.cellSizeM, 2)
    expect(step.mean).toBeGreaterThan(0)
    expect(step.mean).toBeLessThan(step.max)
  })
})

describe('無効画素の穴埋め（M2 の切り分け用）', () => {
  it('無効画素は最も近い有効画素の標高になり、元の配列は変えない', () => {
    const elevation = new Float32Array(256 * 256).fill(20)
    const validMask = new Uint8Array(256 * 256).fill(1)
    elevation[1000] = 0 // (232, 3) の 1 画素の穴
    validMask[1000] = 0
    elevation[1001] = 25
    const filled = fillInvalidNearest({ elevation, validMask })
    expect(filled.validMask.every((v) => v === 1)).toBe(true)
    expect([20, 25]).toContain(filled.elevation[1000])
    expect(validMask[1000]).toBe(0)
  })

  it('全画素が無効のタイルは、そのまま無効', () => {
    const filled = fillInvalidNearest({
      elevation: new Float32Array(256 * 256),
      validMask: new Uint8Array(256 * 256),
    })
    expect(filled.validMask.every((v) => v === 0)).toBe(true)
  })
})
