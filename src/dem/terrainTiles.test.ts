import { describe, expect, it, vi } from 'vitest'
import type { DemTileData } from './DemGrid.ts'
import type { FetchDemTile, TileFetchResult } from './demSelection.ts'
import type { DemId } from './demSources.ts'
import {
  ancestorTile,
  composeTerrariumTile,
  type DemTileId,
  generateTerrariumTile,
  loadOutsideTile,
  type OutsideTile,
  OutsideTileCache,
  outsideSources,
  type RangeElevation,
  rangeCoverage,
} from './terrainTiles.ts'
import { decodeTerrarium } from './terrarium.ts'
import type { TileCoord } from './tileMath.ts'
import { demZoom } from './tileZoom.ts'

const SIZE = 256
const tileId = (z: number, x: number, y: number): DemTileId => ({ z: demZoom(z), x, y })

/** RGBA の画素 (px, py) の高さ */
function heightAt(rgba: Uint8ClampedArray, px: number, py: number): number {
  const o = (py * SIZE + px) * 4
  return decodeTerrarium(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0)
}

/** 平面の範囲。セル (col, row) の値は、その中心（連続座標 origin + col + 0.5）の平面の高さ */
function planeRange(z: number, originX: number, originY: number, size: number): RangeElevation {
  const elevation = new Float32Array(size * size)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      elevation[row * size + col] = 20 + 0.2 * (col + 0.5) - 0.1 * (row + 0.5)
    }
  }
  return { z, originX, originY, size, elevation }
}
/** planeRange の、範囲のズームの連続座標 (x, y) での真の高さ */
const planeAt = (range: RangeElevation, x: number, y: number): number =>
  20 + 0.2 * (x - range.originX) - 0.1 * (y - range.originY)

const constantTile = (value: number): DemTileData => ({
  elevation: new Float32Array(SIZE * SIZE).fill(value),
  validMask: new Uint8Array(SIZE * SIZE).fill(1),
})

/** 取得の偽物。key（'dem/z/x/y'）→ タイル。無いものは 404（missing）。呼ばれた key を記録する */
function fakeFetch(tiles: Record<string, DemTileData>): FetchDemTile & { calls: string[] } {
  const calls: string[] = []
  const fetchTile = (async (dem: DemId, tile: TileCoord): Promise<TileFetchResult> => {
    const key = `${dem}/${tile.z}/${tile.x}/${tile.y}`
    calls.push(key)
    const data = tiles[key]
    return data === undefined ? { status: 'missing' } : { status: 'ok', data }
  }) as FetchDemTile & { calls: string[] }
  fetchTile.calls = calls
  return fetchTile
}

describe('範囲の外の出所（計画で決めたこと 6）', () => {
  it('z16（GSI に無い）は z15 の DEM5 を先に、次に z14 の DEM10B を試す', () => {
    expect(outsideSources(demZoom(16))).toEqual([
      { dem: 'dem5a', zoom: 15 },
      { dem: 'dem5b', zoom: 15 },
      { dem: 'dem5c', zoom: 15 },
      { dem: 'dem10b', zoom: 14 },
    ])
  })

  it('z17 は DEM1A から、z14 以下は同じズームの DEM10B', () => {
    expect(outsideSources(demZoom(17))[0]).toEqual({ dem: 'dem1a', zoom: 17 })
    expect(outsideSources(demZoom(14))).toEqual([{ dem: 'dem10b', zoom: 14 }])
    expect(outsideSources(demZoom(10))).toEqual([{ dem: 'dem10b', zoom: 10 }])
  })

  it('親のタイルの座標', () => {
    expect(ancestorTile(tileId(16, 7, 3), 15)).toEqual({ z: 15, x: 3, y: 1 })
    expect(ancestorTile(tileId(17, 1000, 500), 14)).toEqual({ z: 14, x: 125, y: 62 })
    expect(ancestorTile(tileId(15, 10, 20), 15)).toEqual({ z: 15, x: 10, y: 20 })
    expect(() => ancestorTile(tileId(14, 1, 1), 15)).toThrow(RangeError)
  })
})

describe('範囲の中のタイル（角の規約。spec 05 §4.2）', () => {
  // z17 のタイル (1000, 500) の画素 64〜191 を覆う範囲
  const range = planeRange(17, 1000 * SIZE + 64, 500 * SIZE + 64, 128)

  it('画素には角の位置の高さを書く（セルの中心の値ではない）', () => {
    const rgba = composeTerrariumTile(tileId(17, 1000, 500), range, null)
    const x = 1000 * SIZE + 100
    const y = 500 * SIZE + 100
    expect(Math.abs(heightAt(rgba, 100, 100) - planeAt(range, x, y))).toBeLessThan(1 / 256)
    // セルの中心の値（半セル先）なら 0.05 m ずれる
    expect(Math.abs(heightAt(rgba, 100, 100) - planeAt(range, x + 0.5, y + 0.5))).toBeGreaterThan(
      0.04,
    )
  })

  it('粗いズーム（z15）は、範囲のズームの角の点で標本化する（縮小。計画で決めたこと 7）', () => {
    // z15 のタイル (250, 125) の画素 (30, 30) の角は、z17 の連続座標 4 × (250 × 256 + 30)
    const rgba = composeTerrariumTile(tileId(15, 250, 125), range, null)
    const x = 4 * (250 * SIZE + 30)
    const y = 4 * (125 * SIZE + 30)
    expect(Math.abs(heightAt(rgba, 30, 30) - planeAt(range, x, y))).toBeLessThan(1 / 256)
  })

  it('範囲より細かいズームは、範囲のセルから双線形で引き伸ばす（z15 の範囲から z17 のタイル）', () => {
    const coarse = planeRange(15, 250 * SIZE + 10, 125 * SIZE + 10, 20)
    const rgba = composeTerrariumTile(tileId(17, 1000, 500), coarse, null)
    // z17 の画素 (80, 80) の角は、z15 の連続座標 (1000 × 256 + 80) / 4
    const x = (1000 * SIZE + 80) / 4
    const y = (500 * SIZE + 80) / 4
    expect(Math.abs(heightAt(rgba, 80, 80) - planeAt(coarse, x, y))).toBeLessThan(1 / 256)
  })
})

describe('範囲の中と外の境目（計画で決めたこと 8）', () => {
  const range = planeRange(17, 1000 * SIZE + 64, 500 * SIZE + 64, 128)
  const outside: OutsideTile = {
    tile: { z: 17, x: 1000, y: 500 },
    elevation: constantTile(5).elevation,
  }
  const rgba = composeTerrariumTile(tileId(17, 1000, 500), range, outside)

  it('角の周りの 4 セルがすべて範囲の中ならグリッドの値', () => {
    expect(heightAt(rgba, 65, 100)).toBeCloseTo(
      planeAt(range, 1000 * SIZE + 65, 500 * SIZE + 100),
      2,
    )
  })

  it('1 セルでも範囲の外にかかれば外の値（混ぜ合わせない）', () => {
    expect(heightAt(rgba, 64, 100)).toBeCloseTo(5, 2)
    expect(heightAt(rgba, 10, 10)).toBeCloseTo(5, 2)
  })

  it('範囲も外も無い画素は 0 m', () => {
    const empty = composeTerrariumTile(tileId(17, 1, 1), null, null)
    expect(heightAt(empty, 0, 0)).toBeCloseTo(0, 2)
  })
})

describe('外のタイルの標本化は隣のタイルを取らず、タイルの中に丸める（計画で決めたこと 9）', () => {
  it('列・行で値が違う外のタイルを西隣にずらして組み立てると、画素 0 と 255 はどちらもそのタイルの東の端（列 255）に丸めた値になる', () => {
    const westTile: OutsideTile = {
      tile: { z: 17, x: 999, y: 500 }, // 対象タイル (1000, 500) の西隣
      elevation: (() => {
        const e = new Float32Array(SIZE * SIZE)
        for (let row = 0; row < SIZE; row++) {
          for (let col = 0; col < SIZE; col++) {
            e[row * SIZE + col] = 100 + col * 0.5 + row * 0.25
          }
        }
        return e
      })(),
    }
    const rgba = composeTerrariumTile(tileId(17, 1000, 500), null, westTile)
    // 東の端（列 255）の値を行方向にだけ双線形する（列は 0 でも 255 でも西隣の列 255 に丸まる）
    const expected = 100 + 255 * 0.5 + (0.25 * (99 + 100)) / 2
    expect(heightAt(rgba, 0, 100)).toBeCloseTo(expected, 2)
    expect(heightAt(rgba, 255, 100)).toBeCloseTo(expected, 2)
  })
})

describe('外の粗いタイルから細かいタイルを組み立てる（親の x0 とスケール < 1 の経路）', () => {
  it('平面の z15 の外のタイルから、その子の z16 のタイルを組み立てると、角の値は平面と一致する', () => {
    const outsideTileCoord = ancestorTile(tileId(16, 501, 251), 15) // { z: 15, x: 250, y: 125 }
    const outsidePlane = (x: number, y: number): number => 30 + 0.15 * x - 0.05 * y
    const elevation = new Float32Array(SIZE * SIZE)
    for (let row = 0; row < SIZE; row++) {
      for (let col = 0; col < SIZE; col++) {
        elevation[row * SIZE + col] = outsidePlane(
          outsideTileCoord.x * SIZE + col + 0.5,
          outsideTileCoord.y * SIZE + row + 0.5,
        )
      }
    }
    const outside: OutsideTile = { tile: outsideTileCoord, elevation }
    const rgba = composeTerrariumTile(tileId(16, 501, 251), null, outside)
    // z16 の画素 (80, 80) の角は、z15 の連続座標の半分（スケール 2^(15 − 16) = 0.5）
    const x = (501 * SIZE + 80) / 2
    const y = (251 * SIZE + 80) / 2
    expect(Math.abs(heightAt(rgba, 80, 80) - outsidePlane(x, y))).toBeLessThan(1 / 256)
  })
})

describe('rangeCoverage（外のタイルを取らずに済むか）', () => {
  it('すべて・一部・無し', () => {
    // タイル (1000, 500) の画素の角 256000〜256255 は、セル 255999〜256255 があれば すべて中
    const whole = planeRange(17, 1000 * SIZE - 1, 500 * SIZE - 1, 258)
    expect(rangeCoverage(tileId(17, 1000, 500), whole)).toBe('all')
    const part = planeRange(17, 1000 * SIZE + 64, 500 * SIZE + 64, 128)
    expect(rangeCoverage(tileId(17, 1000, 500), part)).toBe('some')
    expect(rangeCoverage(tileId(17, 1002, 500), part)).toBe('none')
    // 粗いズームのタイルは範囲を含むので一部
    expect(rangeCoverage(tileId(15, 250, 125), part)).toBe('some')
  })

  it('上端はちょうどの size で all、1 小さいと some（hi の off-by-one を検出）', () => {
    // タイル (1000, 500) の画素の角 256000〜256255 を覆うのに必要なセルは 255999〜256255 の 257 個
    const exact = planeRange(17, 1000 * SIZE - 1, 500 * SIZE - 1, 257)
    expect(rangeCoverage(tileId(17, 1000, 500), exact)).toBe('all')
    const oneLess = planeRange(17, 1000 * SIZE - 1, 500 * SIZE - 1, 256)
    expect(rangeCoverage(tileId(17, 1000, 500), oneLess)).toBe('some')
  })
})

describe('loadOutsideTile（GSI に無いズーム・404・無効画素）', () => {
  it('z16 は z15 の DEM5A → 5B の順に試し、最初に取れたタイルを返す', async () => {
    const fetchTile = fakeFetch({ 'dem5b/15/250/125': constantTile(9) })
    const result = await loadOutsideTile(tileId(16, 500, 250), fetchTile, new OutsideTileCache())
    expect(fetchTile.calls).toEqual(['dem5a/15/250/125', 'dem5b/15/250/125'])
    expect(result?.tile).toEqual({ z: 15, x: 250, y: 125 })
    expect(result?.elevation[0]).toBe(9)
  })

  it('どれも 404 なら null（海域・国外）', async () => {
    const fetchTile = fakeFetch({})
    expect(
      await loadOutsideTile(tileId(16, 500, 250), fetchTile, new OutsideTileCache()),
    ).toBeNull()
    expect(fetchTile.calls.at(-1)).toBe('dem10b/14/125/62')
  })

  it('取得に失敗した（404 ではない）ら、1 段粗い DEM10B で代える（計画で決めたこと 5）', async () => {
    const calls: string[] = []
    const fetchTile: FetchDemTile = async (dem, tile) => {
      const key = `${dem}/${tile.z}/${tile.x}/${tile.y}`
      calls.push(key)
      if (key === 'dem10b/13/62/31') return { status: 'ok', data: constantTile(4) }
      throw new Error('network')
    }
    const result = await loadOutsideTile(tileId(14, 125, 62), fetchTile, new OutsideTileCache())
    expect(calls).toEqual(['dem10b/14/125/62', 'dem10b/13/62/31'])
    expect(result?.tile).toEqual({ z: 13, x: 62, y: 31 })
  })

  it('1 段粗いタイルも取れなければ投げる（generateTerrariumTile が 0 m で作る）', async () => {
    const failing: FetchDemTile = () => Promise.reject(new Error('network'))
    await expect(
      loadOutsideTile(tileId(14, 125, 62), failing, new OutsideTileCache()),
    ).rejects.toThrow('network')
  })

  it('無効画素は最も近い有効画素の値で埋める（0 m にしない）', async () => {
    const data = constantTile(12)
    data.elevation[1] = 0
    data.validMask[1] = 0
    const result = await loadOutsideTile(
      tileId(14, 125, 62),
      fakeFetch({ 'dem10b/14/125/62': data }),
      new OutsideTileCache(),
    )
    expect(result?.elevation[1]).toBe(12)
  })

  it('同じ出所のタイルは cache から返し、取得は 1 回（z16 の 4 枚は同じ z15 の親を使う）', async () => {
    const fetchTile = fakeFetch({ 'dem5a/15/250/125': constantTile(9) })
    const cache = new OutsideTileCache()
    await loadOutsideTile(tileId(16, 500, 250), fetchTile, cache)
    await loadOutsideTile(tileId(16, 501, 251), fetchTile, cache)
    expect(fetchTile.calls).toEqual(['dem5a/15/250/125'])
  })

  it('cache は容量を超えたら古いものから捨てる', async () => {
    const cache = new OutsideTileCache(2)
    const load = vi.fn(async () => new Float32Array(1))
    await cache.load('a', load)
    await cache.load('b', load)
    await cache.load('c', load)
    expect(cache.size).toBe(2)
    await cache.load('a', load)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('load で使ったキーは新しい側へ移る（LRU の昇格）。a を読み直してから c を足すと、捨てられるのは b', async () => {
    const cache = new OutsideTileCache(2)
    const load = vi.fn(async () => new Float32Array(1))
    await cache.load('a', load)
    await cache.load('b', load)
    await cache.load('a', load) // 再読み込みで a を新しい側へ移す
    await cache.load('c', load) // 容量超え。最も古い b が捨てられる
    expect(cache.size).toBe(2)
    const reloadA = vi.fn(async () => new Float32Array(1))
    await cache.load('a', reloadA)
    expect(reloadA).not.toHaveBeenCalled() // a はまだ cache にある
    const reloadB = vi.fn(async () => new Float32Array(1))
    await cache.load('b', reloadB)
    expect(reloadB).toHaveBeenCalledTimes(1) // b は捨てられていたので取り直す
  })

  it('取得の失敗（例外）は cache に残さない', async () => {
    const cache = new OutsideTileCache()
    await expect(cache.load('x', () => Promise.reject(new Error('network')))).rejects.toThrow()
    expect(cache.size).toBe(0)
  })
})

describe('generateTerrariumTile', () => {
  it('範囲がタイルを覆うなら外のタイルを取らない', async () => {
    const fetchTile = fakeFetch({})
    const whole = planeRange(17, 1000 * SIZE - 1, 500 * SIZE - 1, 258)
    const result = await generateTerrariumTile(
      tileId(17, 1000, 500),
      whole,
      fetchTile,
      new OutsideTileCache(),
    )
    expect(fetchTile.calls).toEqual([])
    expect(result?.outsideFailed).toBe(false)
  })

  it('外のタイルの取得が（1 段粗いタイルも）失敗したら outsideFailed を立て、外は 0 m で作る', async () => {
    const failing: FetchDemTile = () => Promise.reject(new Error('network'))
    const result = await generateTerrariumTile(
      tileId(14, 1, 1),
      null,
      failing,
      new OutsideTileCache(),
    )
    if (result === null) throw new Error('取り消していないのに null')
    expect(result.outsideFailed).toBe(true)
    expect(heightAt(result.rgba, 0, 0)).toBeCloseTo(0, 2)
  })

  it('組み立ての時間を注入した時計で測る', async () => {
    let t = 0
    const result = await generateTerrariumTile(
      tileId(14, 1, 1),
      null,
      fakeFetch({}),
      new OutsideTileCache(),
      () => (t += 5),
    )
    expect(result?.composeMs).toBe(5)
  })

  it('組み立ての前に取り消されていたら、組み立てずに null（計画で決めたこと 23）', async () => {
    const result = await generateTerrariumTile(
      tileId(14, 1, 1),
      null,
      fakeFetch({}),
      new OutsideTileCache(),
      () => 0,
      { aborted: true },
    )
    expect(result).toBeNull()
  })
})
