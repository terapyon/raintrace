import { describe, expect, it } from 'vitest'
import type { TerrainGeo } from '../shared/protocol'
import { DEBRIS_BULKING } from '../simulation/debris/constants.ts'
import { findCulvert } from '../simulation/debris/culvert.ts'
import {
  CELL,
  SIZE,
  terraceWithRim,
  terrain,
  valleyWithCrossFill,
  valleyWithFill,
} from '../simulation/debris/testTerrain.test-support.ts'
import { analyzeDepressions } from '../simulation/terrain/analyzeDepressions'
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
      pastElevation: grid.elevation.slice(),
      offsetM: 0,
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
      pastElevation: grid.elevation.slice(),
      offsetM: 0,
      candidateId: 1,
      ratio: 1,
      presetId: 'far',
    })
    expect(payload.outsideM3).toBeGreaterThan(0)
    expect(payload.dams).toEqual([])
  })
})

describe('computeCollapse の水路（spec 10b）', () => {
  function runCross(opts: { scale?: number; shift?: number; offsetM?: number } = {}) {
    const { grid, removed, past } = valleyWithCrossFill()
    const scaled = removed.map((v) => v * (opts.scale ?? 1))
    const payload = computeCollapse({
      terrainId: 3,
      geo,
      elevation: grid.elevation,
      validMask: grid.validMask,
      removed: scaled,
      pastElevation: past.map((v) => v + (opts.shift ?? 0)),
      offsetM: opts.offsetM ?? 0,
      candidateId: 1,
      ratio: 1,
      presetId: 'near',
    })
    return { grid, removed: scaled, past, payload }
  }

  it('valleyWithCrossFill・near・全部: 水路があり blocked、before に pit の窪地は無く、after の pit に窪地があり dams に入る', () => {
    const { grid, payload } = runCross()
    const orig = analyzeDepressions(terrain(grid.elevation, grid.validMask))
    const dep = orig.depressions.filter((d) => d.significant)[0]
    expect(dep).toBeDefined()
    expect(payload.culvert).not.toBeNull()
    expect(payload.culvert?.blocked).toBe(true)
    expect(payload.culvert?.lengthM).toBeGreaterThan(0)
    expect(payload.culvert?.line.length).toBeGreaterThan(1)
    const before = payload.before
    expect(before).not.toBeNull()
    const lab = before?.labels[dep?.pitIndex ?? 0] ?? 0
    expect(before?.depressions.find((d) => d.id === lab)?.significant ?? false).toBe(false)
    expect(before?.geo).toBe(geo)
    const afterLab = payload.after.labels[dep?.pitIndex ?? 0] ?? 0
    expect(payload.after.depressions.find((d) => d.id === afterLab)?.significant).toBe(true)
    expect(payload.dams.some((d) => d.depressionId === afterLab)).toBe(true)
  })

  it('崩れる厚さが小さく端に 0.5 m 届かないと blocked は false で、after にも溝がある', () => {
    const { grid, removed, past, payload } = runCross({ scale: 0.02 })
    const orig = analyzeDepressions(terrain(grid.elevation, grid.validMask))
    const culvert = findCulvert({
      elevation: grid.elevation,
      past,
      validMask: grid.validMask,
      candidate: removed.map((v) => (v > 0 ? 1 : 0)) as unknown as Uint8Array,
      labels: orig.labels,
      depressions: orig.depressions,
      size: SIZE,
      cellSizeM: CELL,
    })
    expect(culvert).not.toBeNull()
    let maxEnd = 0
    for (const i of culvert?.ends ?? []) maxEnd = Math.max(maxEnd, payload.deposit[i] ?? 0)
    expect(maxEnd).toBeLessThan(0.5)
    expect(payload.culvert?.blocked).toBe(false)
    culvert?.path.forEach((i, k) => {
      expect(payload.after.elevation[i] ?? Number.NaN).toBeLessThanOrEqual(
        (culvert.bed[k] ?? 0) + 1e-4,
      )
    })
  })

  it('offsetM を足した昔の地形で判定する（pastElevation を −3 m ずらし offsetM = +3 でも同じ path）', () => {
    const a = runCross().payload
    const b = runCross({ shift: -3, offsetM: 3 }).payload
    expect(a.culvert).toBeTruthy()
    expect(b.culvert?.line).toEqual(a.culvert?.line)
    expect(b.culvert?.lengthM).toBe(a.culvert?.lengthM)
  })

  it('valleyWithFill（斜面の盛土）では before と culvert が null で、水路なしの結果', () => {
    const { payload } = run()
    expect(payload.before).toBeNull()
    expect(payload.culvert).toBeNull()
  })

  it('collapseTransferables: before があればその配列も含み、重複が無い', () => {
    const { payload } = runCross()
    const list = collapseTransferables(payload)
    const without = collapseTransferables({ ...payload, before: null })
    expect(list.length).toBe(without.length + 7)
    expect(new Set(list).size).toBe(list.length)
    expect(list).toContain(payload.before?.elevation.buffer)
  })
})
