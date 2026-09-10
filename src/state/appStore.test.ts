import { describe, expect, it } from 'vitest'
import type { TerrainPayload } from '../shared/protocol'
import { createAppStore, summarizeTerrain } from './appStore'

const depression = (id: number, capacityM3: number) => ({
  id,
  pitIndex: 0,
  spillIndex: 1,
  spillElevation: 10 + id,
  maxDepthM: 0.5,
  areaM2: 100,
  capacityM3,
  cellCount: 100,
})

const terrain = {
  geo: { level: 1, breakdown: { dem1a: 9 }, cellSizeM: 0.98, invalidRatio: 0.1 },
  elevationRange: { min: 1.23, max: 4.56 },
  depressions: [depression(1, 5), depression(2, 50), depression(3, 500)],
  significantIds: [1, 2],
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
    const none = { ...terrain, significantIds: [] } as unknown as TerrainPayload
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

  it('表示の切り替えは一部だけを変える。既定はすべて表示、矢印の間隔 10m', () => {
    const store = createAppStore()
    expect(store.getState().display).toEqual({
      elevation: true,
      depressions: true,
      flow: true,
      flowSpacingM: 10,
    })
    store.getState().setDisplay({ flow: false, flowSpacingM: 20 })
    expect(store.getState().display).toEqual({
      elevation: true,
      depressions: true,
      flow: false,
      flowSpacingM: 20,
    })
  })
})
