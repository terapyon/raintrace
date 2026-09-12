import { describe, expect, it } from 'vitest'
import { createSimulationStore, type DisplayStats } from './simulationStore'

const stats = (step: number): DisplayStats => ({
  step,
  totalWater: 31.4,
  storedWater: 31.4,
  outflowWater: 0,
  maxDepth: 0.1,
  floodedArea: 300,
  settled: false,
  massError: 0,
})

describe('createSimulationStore（UI の一時状態。tech-spec §8.1）', () => {
  it('既定は idle・1x・統計なし', () => {
    expect(createSimulationStore().getState()).toMatchObject({
      status: 'idle',
      speed: 1,
      stats: null,
      stepsPerSecond: 0,
      spills: [],
      error: null,
    })
  })

  it('開始・一時停止・再開・平衡の状態を記録する。開始で前のエラーを消す', () => {
    const store = createSimulationStore()
    store.getState().failed('no-elevation-at-rain-center')
    store.getState().started()
    expect(store.getState()).toMatchObject({ status: 'running', error: null })
    store.getState().paused()
    expect(store.getState().status).toBe('paused')
    store.getState().resumed()
    expect(store.getState().status).toBe('running')
    store.getState().settle(stats(120), 60)
    expect(store.getState()).toMatchObject({ status: 'settled', stats: { step: 120 } })
  })

  it('越流イベントを一覧に足す', () => {
    const store = createSimulationStore()
    store.getState().addSpills([{ type: 'spill', step: 7, depressionId: 2, spillElevation: 12.7 }])
    expect(store.getState().spills).toEqual([{ depressionId: 2, spillElevation: 12.7, step: 7 }])
  })

  it('失敗すると idle に戻り、理由を持つ', () => {
    const store = createSimulationStore()
    store.getState().started()
    store.getState().failed('worker')
    expect(store.getState()).toMatchObject({ status: 'idle', error: 'worker' })
  })

  it('失敗すると統計も消す。前の実行の値を出し続けない（タスク 4 レビューの裁定 1）', () => {
    const store = createSimulationStore()
    store.getState().started()
    store.getState().setStats(stats(5), 58)
    store.getState().failed('no-elevation-at-rain-center')
    expect(store.getState()).toMatchObject({ status: 'idle', stats: null, stepsPerSecond: 0 })
  })

  it('reset で統計・越流・エラーを消す。速度は残す', () => {
    const store = createSimulationStore()
    store.getState().setSpeed(4)
    store.getState().started()
    store.getState().setStats(stats(5), 58)
    store.getState().addSpills([{ type: 'spill', step: 3, depressionId: 1, spillElevation: 1 }])
    store.getState().reset()
    expect(store.getState()).toMatchObject({
      status: 'idle',
      speed: 4,
      stats: null,
      stepsPerSecond: 0,
      spills: [],
      error: null,
    })
  })
})
