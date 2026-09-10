import { describe, expect, it } from 'vitest'
import { WaterGrid } from './WaterGrid.ts'

function windowOf(g: WaterGrid): number[] {
  return [g.x0, g.y0, g.x1, g.y1]
}

describe('WaterGrid（spec 03 §3.5）', () => {
  it('はじめの走査範囲は空。full ではグリッド全体', () => {
    expect(windowOf(new WaterGrid(6, 4, false))).toEqual([0, 0, 0, 0])
    expect(windowOf(new WaterGrid(6, 4, true))).toEqual([0, 0, 6, 4])
  })

  it('include は周囲 1 セルを足してグリッドの中に切り詰め、今の範囲と合わせる', () => {
    const g = new WaterGrid(6, 4, false)
    g.include(0, 0, 1, 1)
    expect(windowOf(g)).toEqual([0, 0, 2, 2])
    g.include(4, 2, 5, 3)
    expect(windowOf(g)).toEqual([0, 0, 6, 4])
  })

  it('full では include しても全体のまま', () => {
    const g = new WaterGrid(6, 4, true)
    g.include(2, 2, 3, 3)
    expect(windowOf(g)).toEqual([0, 0, 6, 4])
  })

  it("beginStep は走査範囲の W を W' に写す", () => {
    const g = new WaterGrid(6, 4, false)
    g.current[1 * 6 + 1] = 0.5
    g.include(1, 1, 2, 2)
    g.beginStep()
    expect(g.next[1 * 6 + 1]).toBe(0.5)
  })

  it('endStep は入れ替えて集計し、走査範囲を濡れたセルの外接矩形と周囲 1 セルに縮める', () => {
    const g = new WaterGrid(6, 4, false)
    g.include(0, 0, 6, 4)
    g.beginStep()
    g.next[2 * 6 + 3] = 0.02
    g.next[2 * 6 + 4] = 0.005
    const s = g.endStep()
    expect(s.depthSum).toBeCloseTo(0.025, 15)
    expect(s.maxDepth).toBe(0.02)
    expect(s.floodedCells).toBe(1)
    expect(g.current[2 * 6 + 3]).toBe(0.02)
    expect(windowOf(g)).toEqual([2, 1, 6, 4])
  })

  it("縮めた後も、走査範囲の外では W と W' がどちらも 0（不変条件）", () => {
    const g = new WaterGrid(6, 4, false)
    g.current[0] = 1
    g.current[23] = 1
    g.include(0, 0, 6, 4)
    g.beginStep()
    g.next[23] = 0
    g.endStep()
    expect(windowOf(g)).toEqual([0, 0, 2, 2])
    expect(g.next.every((d) => d === 0)).toBe(true)
    expect(Array.from(g.current).filter((d) => d !== 0)).toEqual([1])
  })

  it('水がなくなると走査範囲は空になる', () => {
    const g = new WaterGrid(6, 4, false)
    g.current[7] = 1
    g.include(1, 1, 2, 2)
    g.beginStep()
    g.next[7] = 0
    expect(g.endStep()).toEqual({ depthSum: 0, maxDepth: 0, floodedCells: 0 })
    expect(windowOf(g)).toEqual([0, 0, 0, 0])
  })

  it('clear は水を消し、走査範囲を空に戻す', () => {
    const g = new WaterGrid(6, 4, false)
    g.current[7] = 1
    g.include(1, 1, 2, 2)
    g.clear()
    expect(g.current.every((d) => d === 0)).toBe(true)
    expect(windowOf(g)).toEqual([0, 0, 0, 0])
  })
})
