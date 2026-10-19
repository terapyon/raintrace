/**
 * 崩れた後にできた窪地から、積もった土でせき止められた場所を見つける（spec 10 §3.3）。
 * 「積もった土が窪地のそばにあり、かつ、崩れる前より満水の量が目に見えて増えた」窪地を選ぶ
 */
import type { Depression } from '../terrain/types.ts'
import { DAM_MIN_ADDED_M3, DAM_MIN_AREA_M2, DAM_MIN_RATIO } from './constants.ts'

export interface DammedSite {
  /** 崩れた後の解析の窪地の id */
  depressionId: number
  capacityM3: number
  /** 崩れる前の同じセルの満水の量より増えた分（m³） */
  addedCapacityM3: number
  maxDepthM: number
  areaM2: number
  spillElevation: number
  pitIndex: number
  spillIndex: number
}

/** 積もった土があるとみなす厚さ（m） */
const DEPOSIT_PRESENT_M = 0.01

export function findDammedSites(
  before: { fill: Float32Array; elevation: Float32Array },
  after: {
    fill: Float32Array
    elevation: Float32Array
    labels: Int32Array
    depressions: readonly Depression[]
  },
  deposit: Float32Array,
  size: number,
  cellSizeM: number,
): DammedSite[] {
  const n = size * size
  const cellArea = cellSizeM * cellSizeM
  const byId = new Map<number, Depression>()
  for (const d of after.depressions) if (d.significant) byId.set(d.id, d)
  if (byId.size === 0) return []

  // 窪地ごとに、(a) 土が窪地のセルかその 4 近傍にあるか、(b) 崩れる前の同じセルの満水の量
  const nearDeposit = new Set<number>()
  const beforeM3 = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const id = after.labels[i] ?? 0
    if (id <= 0 || !byId.has(id)) continue
    beforeM3.set(
      id,
      (beforeM3.get(id) ?? 0) + Math.max(0, before.fill[i] - before.elevation[i]) * cellArea,
    )
    if (nearDeposit.has(id)) continue
    const r = Math.floor(i / size)
    const c = i % size
    if (
      (deposit[i] ?? 0) > DEPOSIT_PRESENT_M ||
      (r > 0 && (deposit[i - size] ?? 0) > DEPOSIT_PRESENT_M) ||
      (r < size - 1 && (deposit[i + size] ?? 0) > DEPOSIT_PRESENT_M) ||
      (c > 0 && (deposit[i - 1] ?? 0) > DEPOSIT_PRESENT_M) ||
      (c < size - 1 && (deposit[i + 1] ?? 0) > DEPOSIT_PRESENT_M)
    ) {
      nearDeposit.add(id)
    }
  }

  const sites: DammedSite[] = []
  for (const [id, d] of byId) {
    if (!nearDeposit.has(id)) continue
    const addedCapacityM3 = d.capacityM3 - (beforeM3.get(id) ?? 0)
    if (addedCapacityM3 <= Math.max(DAM_MIN_ADDED_M3, DAM_MIN_RATIO * d.capacityM3)) continue
    if (d.areaM2 < DAM_MIN_AREA_M2) continue
    sites.push({
      depressionId: id,
      capacityM3: d.capacityM3,
      addedCapacityM3,
      maxDepthM: d.maxDepthM,
      areaM2: d.areaM2,
      spillElevation: d.spillElevation,
      pitIndex: d.pitIndex,
      spillIndex: d.spillIndex,
    })
  }
  return sites.sort((a, b) => b.capacityM3 - a.capacityM3 || a.depressionId - b.depressionId)
}
