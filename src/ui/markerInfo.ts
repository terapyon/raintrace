import type { TerrainPayload } from '../shared/protocol'
import type { MarkerRef } from '../state/clickState'

/** 印の説明の 1 行分の数値（spec 07 §3.4） */
export type MarkerInfoRow =
  | { marker: 'lowest'; elevationM: number }
  | {
      marker: 'spill'
      depressionId: number
      spillElevationM: number
      maxDepthM: number
      capacityM3: number
      areaM2: number
    }

/** 当たりの矩形の半幅（px）。指で押しやすくするため、点ではなく矩形で問い合わせる（spec 07 §3.1） */
export const MARKER_HIT_PX = 4

/** queryRenderedFeatures に渡す矩形（地図の要素の中の座標） */
export function markerHitBox(x: number, y: number): [[number, number], [number, number]] {
  return [
    [x - MARKER_HIT_PX, y - MARKER_HIT_PX],
    [x + MARKER_HIT_PX, y + MARKER_HIT_PX],
  ]
}

/** 描画された ○ の地物のプロパティ（map/terrainFeatures.ts の MarkerProperties）から印を読む。形の違うものは捨てる */
export function markerRefsFromFeatures(features: readonly { properties?: unknown }[]): MarkerRef[] {
  const refs: MarkerRef[] = []
  for (const feature of features) {
    const properties = feature.properties
    if (typeof properties !== 'object' || properties === null) continue
    const { kind, depressionId } = properties as Record<string, unknown>
    if (kind === 'lowest') refs.push({ marker: 'lowest' })
    else if (
      kind === 'spill' &&
      typeof depressionId === 'number' &&
      Number.isInteger(depressionId)
    ) {
      refs.push({ marker: 'spill', depressionId })
    }
  }
  return refs
}

/**
 * 印の数値を地形から引く（計画で決めたこと 3）。窪地は depressions[id − 1]（id は 1 から順。TerrainOverlay の
 * depressionRgba と同じ引き方）で、id が一致しなければ飛ばす。最低点の無い地形（lowestIndex −1）も飛ばす
 */
export function markerInfoRows(
  terrain: Pick<TerrainPayload, 'elevation' | 'lowestIndex' | 'depressions'>,
  markers: readonly MarkerRef[],
): MarkerInfoRow[] {
  const rows: MarkerInfoRow[] = []
  for (const m of markers) {
    if (m.marker === 'lowest') {
      if (terrain.lowestIndex < 0) continue
      rows.push({ marker: 'lowest', elevationM: terrain.elevation[terrain.lowestIndex] ?? 0 })
      continue
    }
    const d = terrain.depressions[m.depressionId - 1]
    if (d === undefined || d.id !== m.depressionId) continue
    rows.push({
      marker: 'spill',
      depressionId: d.id,
      spillElevationM: d.spillElevation,
      maxDepthM: d.maxDepthM,
      capacityM3: d.capacityM3,
      areaM2: d.areaM2,
    })
  }
  return rows
}
