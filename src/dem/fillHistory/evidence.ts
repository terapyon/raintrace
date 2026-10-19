import { lonLatToPixel } from '../tileMath.ts'
import { EVIDENCE_MIN_FRACTION } from './constants.ts'
import type { CandidateStats } from './findCandidates.ts'
import type { GridFrame } from './resamplePast.ts'

export type LonLatRing = ReadonlyArray<readonly [number, number]>
export type A54Type = 'valley' | 'side' | 'unclassified'

/** 最初の環が外周、残りが穴 */
export interface EvidencePolygon {
  rings: readonly LonLatRing[]
  a54Type?: A54Type
}

export type EvidenceLevel = 'strong' | 'moderate' | 'limited'

export interface CandidateEvidence {
  level: EvidenceLevel
  sources: Array<'a54' | 'landform'>
  a54Type?: A54Type
}

/**
 * ポリゴンを格子に写す。セルの中心がポリゴンの中なら「ポリゴンの番号 + 1」、無ければ 0。
 * 穴の中は外。重なるときは先のポリゴンを残す。
 * 頂点を先に格子の座標（セル単位）へ投影し、行ごとの交点の偶奇で塗る
 * （外接矩形の行だけを見るので、1000×1000 セルでも重くならない）。
 */
export function rasterizePolygons(
  frame: GridFrame,
  polygons: readonly EvidencePolygon[],
): Int32Array {
  const { z, originX, originY, size } = frame
  const out = new Int32Array(size * size)
  const xs: number[] = []

  polygons.forEach((polygon, index) => {
    const rings = polygon.rings.map((ring) =>
      ring.map(([lon, lat]) => {
        const p = lonLatToPixel(lon, lat, z)
        return { x: p.x - originX, y: p.y - originY }
      }),
    )
    let minY = Infinity
    let maxY = -Infinity
    for (const ring of rings) {
      for (const p of ring) {
        if (p.y < minY) minY = p.y
        if (p.y > maxY) maxY = p.y
      }
    }
    // セル中心 row + 0.5 が [minY, maxY] に入る行だけ
    const row0 = Math.max(0, Math.ceil(minY - 0.5))
    const row1 = Math.min(size - 1, Math.floor(maxY - 0.5))

    for (let row = row0; row <= row1; row++) {
      const y = row + 0.5
      xs.length = 0
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[j]
          const b = ring[i]
          if (!a || !b) continue
          // 半開区間で、頂点がちょうど y に乗る場合も 1 回だけ数える
          if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
        }
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = xs[k] as number
        const x1 = xs[k + 1] as number
        // 中心 col + 0.5 が [x0, x1) に入る col
        const c0 = Math.max(0, Math.ceil(x0 - 0.5))
        const c1 = Math.min(size - 1, Math.ceil(x1 - 0.5) - 1)
        for (let col = c0; col <= c1; col++) {
          const i = row * size + col
          if (out[i] === 0) out[i] = index + 1
        }
      }
    }
  })
  return out
}

/**
 * 候補ごとに根拠の段階を決める。
 * A54 の中のセルが候補の EVIDENCE_MIN_FRACTION 以上 → strong（a54Type は最も多く重なった型）。
 * そうでなく人工地形の中のセルがある → moderate。それ以外 → limited。
 * 両方に重なれば strong で sources は両方。null（読めなかった）は重ならないとみなす。
 */
export function classifyEvidence(
  labels: Int32Array,
  candidates: readonly CandidateStats[],
  a54: { mask: Int32Array; polygons: readonly EvidencePolygon[] } | null,
  landform: Int32Array | null,
): Map<number, CandidateEvidence> {
  const ids = new Map<number, number>() // 候補の id → candidates の添字
  candidates.forEach((c, i) => {
    ids.set(c.id, i)
  })
  const a54Cells = new Array<number>(candidates.length).fill(0)
  const landformCells = new Array<number>(candidates.length).fill(0)
  const typeCells = candidates.map(() => new Map<A54Type, number>())

  for (let i = 0; i < labels.length; i++) {
    const idx = ids.get(labels[i] as number)
    if (idx === undefined) continue
    const label = a54?.mask[i] ?? 0
    if (a54 && label > 0) {
      a54Cells[idx] = (a54Cells[idx] ?? 0) + 1
      const type = a54.polygons[label - 1]?.a54Type
      if (type) {
        const m = typeCells[idx] as Map<A54Type, number>
        m.set(type, (m.get(type) ?? 0) + 1)
      }
    }
    if ((landform?.[i] ?? 0) > 0) landformCells[idx] = (landformCells[idx] ?? 0) + 1
  }

  const result = new Map<number, CandidateEvidence>()
  candidates.forEach((c, idx) => {
    const hasA54 = c.cellCount > 0 && (a54Cells[idx] ?? 0) / c.cellCount >= EVIDENCE_MIN_FRACTION
    const hasLandform = (landformCells[idx] ?? 0) > 0
    const sources: Array<'a54' | 'landform'> = []
    if (hasA54) sources.push('a54')
    if (hasLandform) sources.push('landform')
    const level: EvidenceLevel = hasA54 ? 'strong' : hasLandform ? 'moderate' : 'limited'
    const evidence: CandidateEvidence = { level, sources }
    if (hasA54) {
      let best: A54Type | undefined
      let bestN = 0
      for (const [type, n] of typeCells[idx] as Map<A54Type, number>) {
        if (n > bestN) {
          best = type
          bestN = n
        }
      }
      if (best) evidence.a54Type = best
    }
    result.set(c.id, evidence)
  })
  return result
}
