import { describe, expect, it } from 'vitest'
import type { TerrainPayload } from '../shared/protocol'
// state は simulation の型だけを import する（依存規則。makeDepression は値なので使えない）
import type { Depression } from '../simulation/terrain/types'
import { type CursorElevation, createAppStore, summarizeTerrain } from './appStore'

const depression = (id: number, capacityM3: number, significant: boolean): Depression => ({
  id,
  pitIndex: 0,
  spillIndex: 1,
  spillElevation: 10 + id,
  maxDepthM: 0.5,
  areaM2: 100,
  capacityM3,
  cellCount: 100,
  significant,
})

const terrain = {
  geo: { level: 1, breakdown: { dem1a: 9 }, cellSizeM: 0.98, invalidRatio: 0.1 },
  elevationRange: { min: 1.23, max: 4.56 },
  depressions: [depression(1, 5, true), depression(2, 50, true), depression(3, 500, false)],
} as unknown as TerrainPayload

describe('summarizeTerrain', () => {
  it('DEM 情報・標高の範囲と、表示対象の窪地の件数と容量が最大のものをまとめる', () => {
    expect(summarizeTerrain(terrain)).toEqual({
      demLevel: 1,
      breakdown: { dem1a: 9 },
      cellSizeM: 0.98,
      invalidRatio: 0.1,
      elevationRange: { min: 1.23, max: 4.56 },
      depressionCount: 2,
      largestDepression: { maxDepthM: 0.5, capacityM3: 50, spillElevation: 12 },
    })
  })

  it('表示対象の窪地が無ければ、件数 0 で最大のものは null', () => {
    const none = {
      ...terrain,
      depressions: terrain.depressions.map((d) => ({ ...d, significant: false })),
    } as unknown as TerrainPayload
    expect(summarizeTerrain(none)).toMatchObject({ depressionCount: 0, largestDepression: null })
  })
})

describe('createAppStore', () => {
  it('地点を選ぶと読み込み中になり、前の結果とカーソルを消す', () => {
    const store = createAppStore()
    store.getState().setTerrain(summarizeTerrain(terrain))
    store.getState().setCursor({ kind: 'value', meters: 3 })
    store.getState().selectPoint(139.7, 35.6)
    expect(store.getState()).toMatchObject({
      selected: { lon: 139.7, lat: 35.6 },
      load: { status: 'loading', done: 0, started: 0 },
      summary: null,
      cursor: null,
    })
  })

  it('進捗、完了、失敗を記録する', () => {
    const store = createAppStore()
    store.getState().selectPoint(0, 0)
    store.getState().setProgress(2, 9)
    expect(store.getState().load).toEqual({ status: 'loading', done: 2, started: 9 })
    store.getState().setTerrain(summarizeTerrain(terrain))
    expect(store.getState().load).toEqual({ status: 'ready' })
    store.getState().setFailed('network')
    expect(store.getState().load).toEqual({ status: 'failed', reason: 'network' })
    expect(store.getState().summary).toBeNull()
  })

  it('表示の切り替えは一部だけを変える。既定はすべて表示（矢印の間隔は設定のストア）', () => {
    const store = createAppStore()
    expect(store.getState().display).toEqual({ elevation: true, depressions: true, flow: true })
    store.getState().setDisplay({ flow: false })
    expect(store.getState().display).toEqual({ elevation: true, depressions: true, flow: false })
  })

  describe('setCursor は同じ値なら購読者に知らせない', () => {
    const countNotifications = (cursors: (CursorElevation | null)[]): number => {
      const store = createAppStore()
      let count = 0
      store.subscribe(() => {
        count++
      })
      for (const cursor of cursors) store.getState().setCursor(cursor)
      return count
    }

    it('同じ標高を 2 回なら 1 回', () => {
      expect(
        countNotifications([
          { kind: 'value', meters: 1 },
          { kind: 'value', meters: 1 },
        ]),
      ).toBe(1)
    })

    it('標高が違えば 2 回', () => {
      expect(
        countNotifications([
          { kind: 'value', meters: 1 },
          { kind: 'value', meters: 2 },
        ]),
      ).toBe(2)
    })

    it('範囲の外を 2 回なら 1 回', () => {
      expect(countNotifications([{ kind: 'outside' }, { kind: 'outside' }])).toBe(1)
    })

    it('null を 2 回なら 0 回（初期値も null）', () => {
      expect(countNotifications([null, null])).toBe(0)
    })
  })
})
