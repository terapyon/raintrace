import { describe, expect, it } from 'vitest'
import { findCandidates } from './findCandidates.ts'
import type { GridFrame } from './resamplePast.ts'

const SIZE = 64
const frame: GridFrame = { z: 17, originX: 0, originY: 0, size: SIZE, cellSizeM: 1 }

function grid() {
  return new Float32Array(SIZE * SIZE)
}

/** 矩形（col0..col0+w-1, row0..row0+h-1）を value で埋める */
function fill(d: Float32Array, col0: number, row0: number, w: number, h: number, value: number) {
  for (let r = row0; r < row0 + h; r++) {
    for (let c = col0; c < col0 + w; c++) d[r * SIZE + c] = value
  }
}

describe('findCandidates', () => {
  it('盛る: 高さ 10 m・20×20 セル（1 m セル）の台 → 面積 400 m² は 500 m² 未満で捨てる', () => {
    const d = grid()
    fill(d, 5, 5, 20, 20, 10)
    const { candidates, labels } = findCandidates(d, frame)
    expect(candidates).toEqual([])
    expect(labels.every((v) => v === 0)).toBe(true)
  })

  it('盛る: 高さ 10 m・30×30 セルの台 → 面積 900、最大 10、体積 9000', () => {
    const d = grid()
    fill(d, 5, 6, 30, 30, 10)
    const { candidates, labels } = findCandidates(d, frame)
    expect(candidates).toEqual([
      expect.objectContaining({
        id: 1,
        cellCount: 900,
        areaM2: 900,
        maxRiseM: 10,
        volumeM3: 9000,
        centroid: { col: 19.5, row: 20.5 },
        bbox: { col0: 5, row0: 6, col1: 34, row1: 35 },
      }),
    ])
    expect(labels[6 * SIZE + 5]).toBe(1)
    expect(labels[0]).toBe(0)
  })

  it('削る: −10 m の穴 → 候補は出ない（切土は一覧に出さない）', () => {
    const d = grid()
    fill(d, 5, 5, 30, 30, -10)
    expect(findCandidates(d, frame).candidates).toEqual([])
  })

  it('+4.99 m は候補にならず、+5 m はなる', () => {
    const a = grid()
    fill(a, 5, 5, 30, 30, 4.99)
    expect(findCandidates(a, frame).candidates).toEqual([])
    const b = grid()
    fill(b, 5, 5, 30, 30, 5)
    expect(findCandidates(b, frame).candidates).toHaveLength(1)
  })

  it('斜めにだけ接する 2 つの台は別のかたまり（4 近傍）', () => {
    const d = grid()
    fill(d, 0, 0, 30, 30, 10)
    fill(d, 30, 30, 30, 30, 10)
    const { candidates } = findCandidates(d, frame)
    expect(candidates).toHaveLength(2)
  })

  it('1 セルだけの +10 m は捨てられる', () => {
    const d = grid()
    d[10 * SIZE + 10] = 10
    expect(findCandidates(d, frame).candidates).toEqual([])
  })

  it('セルが大きければ少ないセル数で面積の下限を超える', () => {
    const d = grid()
    fill(d, 5, 5, 3, 3, 10) // 9 セル × 100 m² = 900 m²
    const { candidates } = findCandidates(d, { ...frame, cellSizeM: 10 })
    expect(candidates).toEqual([expect.objectContaining({ areaM2: 900, volumeM3: 9000 })])
  })

  it('id は面積の大きい順（小さい方を先に見つけても）', () => {
    const d = grid()
    fill(d, 0, 0, 26, 26, 10) // 676、先に見つかる
    fill(d, 30, 30, 30, 30, 10) // 900
    const { candidates, labels } = findCandidates(d, frame)
    expect(candidates.map((c) => [c.id, c.areaM2])).toEqual([
      [1, 900],
      [2, 676],
    ])
    expect(labels[30 * SIZE + 30]).toBe(1)
    expect(labels[0]).toBe(2)
  })

  it('NaN のセルは候補にならず、かたまりを分ける', () => {
    const d = grid()
    fill(d, 0, 0, 30, 60, 10)
    for (let r = 0; r < 60; r++) d[r * SIZE + 15] = Number.NaN // 縦の線で 2 つに分ける
    const { candidates, labels } = findCandidates(d, frame)
    expect(candidates).toHaveLength(2)
    expect(labels[15]).toBe(0)
  })
})
