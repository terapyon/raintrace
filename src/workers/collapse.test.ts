import { describe, expect, it } from 'vitest'
import type { TerrainGeo } from '../shared/protocol'
import { DEBRIS_BULKING } from '../simulation/debris/constants.ts'
import {
  CELL,
  SIZE,
  terraceWithRim,
  valleyWithFill,
} from '../simulation/debris/testTerrain.test-support.ts'
import { collapseTransferables, computeCollapse } from './collapse'

const geo: TerrainGeo = {
  level: 1,
  z: 15,
  originX: 28000,
  originY: 12000,
  size: SIZE,
  cellSizeM: CELL,
  corners: {
    nw: { lon: 135, lat: 35 },
    ne: { lon: 135.01, lat: 35 },
    se: { lon: 135.01, lat: 34.99 },
    sw: { lon: 135, lat: 34.99 },
  },
  breakdown: {},
  invalidRatio: 0,
} as unknown as TerrainGeo

function run(presetId = 'near', progress?: (f: number) => void) {
  const { grid, removed } = valleyWithFill(6)
  const payload = computeCollapse(
    {
      terrainId: 3,
      geo,
      elevation: grid.elevation,
      validMask: grid.validMask,
      removed,
      candidateId: 1,
      ratio: 1,
      presetId,
    },
    progress,
  )
  return { grid, removed, payload }
}

describe('computeCollapse', () => {
  it('質量が保存され、after.depressions にせき止めの窪地がある', () => {
    const { payload } = run()
    const { collapsedM3, depositedM3, outsideM3 } = payload
    expect(collapsedM3).toBeGreaterThan(0)
    expect(depositedM3 + outsideM3).toBeGreaterThan(0)
    // 積もった量 + 外へ出た量 = 崩れた量 × 嵩増し係数
    expect((depositedM3 + outsideM3) / collapsedM3).toBeCloseTo(DEBRIS_BULKING, 3)
    expect(payload.dams).toHaveLength(1)
    for (const dam of payload.dams) {
      expect(payload.after.depressions.some((d) => d.id === dam.depressionId)).toBe(true)
      expect(Number.isFinite(dam.spill.lon)).toBe(true)
      expect(dam.addedCapacityM3).toBeGreaterThan(0)
    }
  })

  it('after.elevation = elevation − removed + deposit、after.geo は入力の geo', () => {
    const { grid, payload } = run()
    expect(payload.after.geo).toBe(geo)
    for (let i = 0; i < grid.elevation.length; i++) {
      const expected =
        (grid.elevation[i] ?? 0) - (payload.removed[i] ?? 0) + (payload.deposit[i] ?? 0)
      expect(payload.after.elevation[i] ?? Number.NaN).toBeCloseTo(expected, 3)
    }
    expect(payload.terrainId).toBe(3)
  })

  it('無い presetId は既定のプリセットで計算する', () => {
    const a = run('no-such-preset').payload
    const b = run('near').payload
    expect(a.deposit).toEqual(b.deposit)
  })

  it('進み具合は最大 10 回、単調に増えて 1 で終わる', () => {
    const calls: number[] = []
    run('near', (f) => calls.push(f))
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.length).toBeLessThanOrEqual(10)
    expect(calls[calls.length - 1]).toBe(1)
    expect([...calls].sort((x, y) => x - y)).toEqual(calls)
  })

  it('collapseTransferables は配列の実体を重複なく返す', () => {
    const { payload } = run()
    const list = collapseTransferables(payload)
    expect(new Set(list).size).toBe(list.length)
  })

  it('取り去った跡だけの窪み（縁が残る）は、遠くまで流れる場合でもせき止めにしない', () => {
    const { grid, removed } = terraceWithRim()
    const payload = computeCollapse({
      terrainId: 1,
      geo: { ...geo, size: grid.size, cellSizeM: grid.cellSizeM },
      elevation: grid.elevation,
      validMask: grid.validMask,
      removed,
      candidateId: 1,
      ratio: 1,
      presetId: 'far',
    })
    expect(payload.outsideM3).toBeGreaterThan(0)
    expect(payload.dams).toEqual([])
  })
})
