import { describe, expect, it } from 'vitest'
import type { DemTileData } from './DemGrid.ts'
import {
  type FetchDemTile,
  isSeaTile,
  selectDem,
  type TileFetchResult,
  tileKey,
} from './demSelection.ts'
import type { DemId } from './demSources.ts'
import type { TileCoord } from './tileMath.ts'

const LON = 139.7016
const LAT = 35.658

function tileOf(valid: boolean): DemTileData {
  return {
    elevation: new Float32Array(256 * 256).fill(valid ? 10 : 0),
    validMask: new Uint8Array(256 * 256).fill(valid ? 1 : 0),
  }
}

type Outcome = 'ok' | 'missing' | 'sea' | 'error'
type Rule = Outcome | ((tile: TileCoord) => Outcome)

/** DEM ごとの応答の規則で取得関数を作る。'sea' は全画素無効のタイル（dem_png の海域） */
function fakeFetcher(rules: Partial<Record<DemId, Rule>>) {
  const calls: string[] = []
  const fetchTile: FetchDemTile = async (dem, tile) => {
    calls.push(`${dem}/${tile.z}/${tile.x}/${tile.y}`)
    const rule = rules[dem] ?? 'missing'
    const outcome = typeof rule === 'function' ? rule(tile) : rule
    if (outcome === 'error') throw new Error('ネットワークエラー')
    if (outcome === 'missing') return { status: 'missing' }
    return { status: 'ok', data: tileOf(outcome === 'ok') }
  }
  return { fetchTile, calls }
}

const uniqueReferences = (calls: string[]): boolean => {
  const references = calls.filter((c) => c.startsWith('dem10b/14/'))
  return new Set(references).size === references.length
}

describe('selectDem', () => {
  it('段 1 のタイルがすべて 200 なら DEM1A を採用する', async () => {
    const { fetchTile } = fakeFetcher({ dem1a: 'ok' })
    const result = await selectDem(LON, LAT, 500, fetchTile)
    expect(result.tier.level).toBe(1)
    expect(result.range.z).toBe(17)
    expect(result.breakdown).toEqual({ dem1a: result.tiles.size })
    expect(result.seaTileCount).toBe(0)
  })

  it('404 のタイルが海域なら、その範囲を無効として DEM1A のまま採用する', async () => {
    const { fetchTile } = fakeFetcher({
      dem1a: (t) => (t.x % 2 === 0 ? 'ok' : 'missing'),
      dem10b: 'sea',
    })
    const result = await selectDem(LON, LAT, 500, fetchTile)
    expect(result.tier.level).toBe(1)
    expect(result.seaTileCount).toBeGreaterThan(0)
    expect(result.breakdown.dem1a).toBe(result.tiles.size)
  })

  it('404 のタイルが陸域なら段 2 に落ち、DEM5A を採用する', async () => {
    const { fetchTile } = fakeFetcher({
      dem1a: (t) => (t.x % 2 === 0 ? 'ok' : 'missing'),
      dem10b: 'ok',
      dem5a: 'ok',
    })
    const result = await selectDem(LON, LAT, 500, fetchTile)
    expect(result.tier.level).toBe(2)
    expect(result.range.z).toBe(15)
    expect(Object.keys(result.breakdown)).toEqual(['dem5a'])
  })

  it('段 2 は、タイルごとに 5A → 5B → 5C の順で 200 のものを合成する', async () => {
    const { fetchTile } = fakeFetcher({
      dem1a: 'missing',
      dem10b: 'ok',
      dem5a: (t) => (t.x % 2 === 0 ? 'ok' : 'missing'),
      dem5b: 'ok',
    })
    const result = await selectDem(LON, LAT, 500, fetchTile)
    expect(result.tier.level).toBe(2)
    expect((result.breakdown.dem5a ?? 0) + (result.breakdown.dem5b ?? 0)).toBe(result.tiles.size)
    expect(result.breakdown.dem5a).toBeGreaterThan(0)
    expect(result.breakdown.dem5b).toBeGreaterThan(0)
    expect(result.breakdown.dem5c).toBeUndefined()
  })

  it('すべて 404 なら、dem_png の 404 を海域とみなし、タイルの無い段 1 を採用する（無効セル 100% → no-data は Worker が判定）', async () => {
    const { fetchTile } = fakeFetcher({})
    const result = await selectDem(LON, LAT, 500, fetchTile)
    expect(result.tier.level).toBe(1)
    expect(result.tiles.size).toBe(0)
    expect(result.seaTileCount).toBeGreaterThan(0)
  })

  it('段 3 でも 404 のタイルは無効として扱う（一部の dem_png が陸域なので段 3 まで落ちる）', async () => {
    const { fetchTile } = fakeFetcher({
      dem1a: 'missing',
      dem10b: (t) => (t.x % 2 === 0 ? 'ok' : 'missing'),
    })
    const result = await selectDem(LON, LAT, 500, fetchTile)
    expect(result.tier.level).toBe(3)
    expect(result.tiles.size).toBeGreaterThan(0)
    expect(result.seaTileCount).toBeGreaterThan(0)
  })

  it('ネットワークエラーは再試行の後の失敗としてそのまま伝える（取り消しも同じ）', async () => {
    const { fetchTile } = fakeFetcher({ dem1a: 'error' })
    await expect(selectDem(LON, LAT, 500, fetchTile)).rejects.toThrow('ネットワークエラー')
  })

  it('海域判定の dem_png のタイルは、1 回の読み込みの中で使い回す', async () => {
    const { fetchTile, calls } = fakeFetcher({ dem1a: 'missing', dem10b: 'sea' })
    await selectDem(LON, LAT, 500, fetchTile)
    expect(uniqueReferences(calls)).toBe(true)
  })

  it('段 3 まで落ちても、dem_png のタイルは海域判定と合わせて 1 回しか取らない', async () => {
    const { fetchTile, calls } = fakeFetcher({ dem1a: 'missing', dem10b: 'ok' })
    const result = await selectDem(LON, LAT, 500, fetchTile)
    expect(result.tier.level).toBe(3)
    expect(result.breakdown).toEqual({ dem10b: result.tiles.size })
    expect(uniqueReferences(calls)).toBe(true)
  })

  it('404 のタイルの海域判定は、親タイル（z14）が複数あっても並べて取得する（レビュー L4）', async () => {
    // z14 タイルの境目にちょうどかかる地点。段 1（z17）の範囲が 2 つ以上の z14 タイルにまたがる
    const BOUNDARY_LON = 139.7021484375
    const references = new Map<
      string,
      { promise: Promise<TileFetchResult>; resolve: (result: TileFetchResult) => void }
    >()
    const fetchTile: FetchDemTile = (dem, tile) => {
      if (dem !== 'dem10b') return Promise.resolve({ status: 'missing' })
      const key = tileKey(tile.x, tile.y)
      let entry = references.get(key)
      if (entry === undefined) {
        let resolve!: (result: TileFetchResult) => void
        const promise = new Promise<TileFetchResult>((r) => {
          resolve = r
        })
        entry = { promise, resolve }
        references.set(key, entry)
      }
      return entry.promise
    }

    const done = selectDem(BOUNDARY_LON, LAT, 500, fetchTile)
    // dem_png の要求が始まるところまでマイクロタスクを流す（まだどれも解決させない）
    for (let i = 0; i < 10; i++) await Promise.resolve()
    expect(references.size).toBeGreaterThanOrEqual(2)

    for (const entry of references.values()) entry.resolve({ status: 'missing' })
    const result = await done
    expect(result.tier.level).toBe(1)
    expect(result.seaTileCount).toBeGreaterThan(0)
  })

  it('参照タイル（z14）の一方が取得できなくても失敗にせず、海とみなさず段を落とす（推奨 1）', async () => {
    // z14 タイルの境目にちょうどかかる地点（レビュー L4 のテストの組み立てを使う）
    const BOUNDARY_LON = 139.7021484375
    const outcomeOf = new Map<string, 'land' | 'fail'>()
    const fetchTile: FetchDemTile = async (dem, tile) => {
      if (dem === 'dem1a') return { status: 'missing' }
      if (dem === 'dem5a') return { status: 'ok', data: tileOf(true) }
      // dem10b（z14 の参照）: 出会った順に一方は陸、もう一方は取得できないとする
      const key = tileKey(tile.x, tile.y)
      let outcome = outcomeOf.get(key)
      if (outcome === undefined) {
        outcome = outcomeOf.size === 0 ? 'land' : 'fail'
        outcomeOf.set(key, outcome)
      }
      if (outcome === 'fail') throw new Error('ネットワークエラー')
      return { status: 'ok', data: tileOf(true) }
    }

    const result = await selectDem(BOUNDARY_LON, LAT, 500, fetchTile)
    expect(result.tier.level).toBe(2)
    expect(outcomeOf.size).toBeGreaterThanOrEqual(2)
  })
})

describe('isSeaTile', () => {
  // z17 のタイル (8, 8) は、z14 のタイル (1, 1) の中の 32 × 32 画素の窓（x, y とも 0〜31）
  const tile: TileCoord = { z: 17, x: 8, y: 8 }
  const reference = (validPixel: number | null) => async (): Promise<TileFetchResult> => {
    const data = tileOf(false)
    if (validPixel !== null) data.validMask[validPixel] = 1
    return { status: 'ok', data }
  }

  it('窓の画素がすべて無効なら海域', async () => {
    expect(await isSeaTile(tile, reference(null))).toBe(true)
    expect(await isSeaTile(tile, reference(40 * 256 + 40))).toBe(true) // 窓の外の有効画素は見ない
  })

  it('窓の中に 1 画素でも有効な標高があれば陸域', async () => {
    expect(await isSeaTile(tile, reference(31 * 256 + 31))).toBe(false)
  })

  it('dem_png 自体が 404 なら海域（国外を含む）', async () => {
    expect(await isSeaTile(tile, async () => ({ status: 'missing' }))).toBe(true)
  })

  it('z15 のタイルは 128 × 128 画素の窓で判定する', async () => {
    const z15: TileCoord = { z: 15, x: 3, y: 2 } // z14 の (1, 1) の中、x は 128〜255、y は 0〜127
    expect(await isSeaTile(z15, reference(100 * 256 + 200))).toBe(false)
    expect(await isSeaTile(z15, reference(100 * 256 + 100))).toBe(true)
  })
})
