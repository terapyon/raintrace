import { describe, expect, it } from 'vitest'
import type { DemTileData } from './DemGrid.ts'
import { type FetchDemTile, isSeaTile, selectDem, type TileFetchResult } from './demSelection.ts'
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
