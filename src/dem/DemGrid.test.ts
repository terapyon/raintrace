import { describe, expect, it } from 'vitest'
import { assembleGrid, type DemTileData } from './DemGrid.ts'
import type { GridRange } from './gridRange.ts'

/** 画素の値が (タイル, 画素の位置) を表す 256 × 256 のタイル。値は f32 で正確に表せる整数 */
function labeledTile(tx: number, ty: number): DemTileData {
  const elevation = new Float32Array(256 * 256)
  const validMask = new Uint8Array(256 * 256).fill(1)
  for (let p = 0; p < elevation.length; p++) elevation[p] = (ty * 2 + tx) * 100000 + p
  return { elevation, validMask }
}

// タイルの境界（x = 256, y = 256）をまたぐ 4 × 4 の範囲
const range: GridRange = {
  z: 1,
  cellSizeM: 2,
  size: 4,
  originX: 254,
  originY: 254,
  center: { x: 256, y: 256 },
}

describe('assembleGrid', () => {
  it('2 × 2 のタイルを結合し、継ぎ目の画素と番号が正しい', () => {
    const tiles = new Map(
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map(([x, y]) => [`${x}/${y}`, labeledTile(x ?? 0, y ?? 0)]),
    )
    const grid = assembleGrid(range, (tx, ty) => tiles.get(`${tx}/${ty}`))
    expect(grid.width).toBe(4)
    expect(grid.height).toBe(4)
    expect(grid.cellSizeM).toBe(2)
    expect(grid.invalidRatio).toBe(0)
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const gx = 254 + col
        const gy = 254 + row
        const tx = Math.floor(gx / 256)
        const ty = Math.floor(gy / 256)
        const expected = (ty * 2 + tx) * 100000 + (gy - ty * 256) * 256 + (gx - tx * 256)
        expect(grid.elevation[row * 4 + col]).toBe(expected)
      }
    }
  })

  it('無いタイルの範囲は無効セルになり、無効セルの割合に数える', () => {
    const grid = assembleGrid(range, (tx, ty) =>
      tx === 0 && ty === 0 ? labeledTile(0, 0) : undefined,
    )
    expect(grid.validMask[0]).toBe(1) // (254, 254) はタイル (0, 0)
    expect(grid.validMask[3]).toBe(0) // (257, 254) はタイル (1, 0)
    expect(grid.invalidRatio).toBe(12 / 16)
  })

  it('タイルの中の無効画素は無効セルのまま（下位の DEM で埋めない）', () => {
    const tile = labeledTile(0, 0)
    tile.validMask[255 * 256 + 255] = 0 // (255, 255)
    const grid = assembleGrid(range, (tx, ty) =>
      tx === 0 && ty === 0 ? tile : labeledTile(tx, ty),
    )
    expect(grid.validMask[1 * 4 + 1]).toBe(0)
    expect(grid.invalidRatio).toBe(1 / 16)
  })

  it('タイルを引くのは、タイルが変わるときだけ（1 セルごとに引かない）', () => {
    let lookups = 0
    const tile = labeledTile(0, 0)
    assembleGrid(range, () => {
      lookups++
      return tile
    })
    // 4 行 × 各行で 2 タイル = 8 回
    expect(lookups).toBe(8)
  })
})
