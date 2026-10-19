import { describe, expect, it } from 'vitest'
import type { DemTileData } from '../DemGrid.ts'
import { TILE_SIZE } from '../tileMath.ts'
import { pastTileCoords, resamplePast } from './resamplePast.ts'

// 標高 = 画素のグローバル列番号（x）のタイル
function xTile(tx: number, invalid: number[] = []): DemTileData {
  const elevation = new Float32Array(TILE_SIZE * TILE_SIZE)
  const validMask = new Uint8Array(TILE_SIZE * TILE_SIZE).fill(1)
  for (let r = 0; r < TILE_SIZE; r++) {
    for (let c = 0; c < TILE_SIZE; c++) elevation[r * TILE_SIZE + c] = tx * TILE_SIZE + c
  }
  for (const i of invalid) validMask[i] = 0
  return { elevation, validMask }
}

describe('resamplePast', () => {
  it('z14 の格子ではそのまま画素の値になる', () => {
    const tile = xTile(10)
    const frame = { z: 14, originX: 10 * 256 + 20, originY: 5 * 256 + 20, size: 8, cellSizeM: 10 }
    const past = resamplePast(frame, (tx, ty) => (tx === 10 && ty === 5 ? tile : undefined))
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) expect(past[row * 8 + col]).toBe(frame.originX + col)
    }
  })

  it('z17 では画素の中心を基準に補間する', () => {
    const frame = { z: 17, originX: 8 * 100, originY: 8 * 100, size: 16, cellSizeM: 1 }
    const tile = xTile(0)
    const past = resamplePast(frame, () => tile)
    expect(past[3 * 16 + 3]).toBeCloseTo(99.9375, 6)
  })

  it('4 画素のどれかが無効なら NaN', () => {
    // z15・origin 116 のセル c は z14 で u = 57.75 + c/2。画素 60 を使うのは c = 3..6
    const tile = xTile(0, [60 * TILE_SIZE + 60])
    const frame = { z: 15, originX: 116, originY: 116, size: 8, cellSizeM: 5 }
    const past = resamplePast(frame, () => tile)
    expect(Number.isNaN(past[3 * 8 + 3])).toBe(true)
    expect(Number.isNaN(past[6 * 8 + 6])).toBe(true)
    expect(Number.isNaN(past[0])).toBe(false)
    expect(Number.isNaN(past[7 * 8 + 7])).toBe(false)
    expect(Number.isNaN(past[3 * 8 + 0])).toBe(false)
  })

  it('タイルが無ければ NaN（海・404）', () => {
    const frame = { z: 15, originX: 100, originY: 100, size: 4, cellSizeM: 5 }
    const past = resamplePast(frame, () => undefined)
    expect(past.every(Number.isNaN)).toBe(true)
  })

  it('タイルの境をまたぐ補間は隣のタイルを読む', () => {
    const t0 = xTile(0)
    const t1 = xTile(1)
    // z15 で z14 の x=256 の境（z15 の 512）の手前のセル: 511.5/2 = 255.75 → u = 255.25
    const frame = { z: 15, originX: 508, originY: 200, size: 8, cellSizeM: 5 }
    const past = resamplePast(frame, (tx, ty) =>
      ty === 0 ? (tx === 0 ? t0 : tx === 1 ? t1 : undefined) : undefined,
    )
    // col=3 → 511.5 → u=255.25 → 255 と 256 の間
    expect(past[3]).toBeCloseTo(255.25, 6)
    expect(past[4]).toBeCloseTo(255.75, 6)
  })
})

describe('pastTileCoords', () => {
  it('周りの 1 画素を含めて覆う', () => {
    const frame = { z: 14, originX: 3 * 256, originY: 2 * 256, size: 10, cellSizeM: 10 }
    const xs = new Set(pastTileCoords(frame).map((t) => t.x))
    expect(xs.has(2)).toBe(true)
    expect(xs.has(3)).toBe(true)
    const ys = new Set(pastTileCoords(frame).map((t) => t.y))
    expect(ys.has(1)).toBe(true)
  })
})
