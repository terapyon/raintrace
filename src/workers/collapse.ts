import type { AssembledGrid } from '../dem/DemGrid'
import { pixelToLonLat } from '../dem/tileMath'
import { debrisPreset } from '../shared/debrisPresets'
import type { CollapsePayload, CollapseRatio, TerrainGeo } from '../shared/protocol'
import { findDammedSites } from '../simulation/debris/dams.ts'
import { simulateCollapse } from '../simulation/debris/simulateCollapse.ts'
import { buildOutflowCells } from '../simulation/outflowCells'
import { analyzeDepressions } from '../simulation/terrain/analyzeDepressions'
import { analyzeTerrain } from '../simulation/terrain/analyzeTerrain'
import { packTerrain } from './terrainResult'

export interface CollapseInput {
  terrainId: number
  geo: TerrainGeo
  elevation: Float32Array
  validMask: Uint8Array
  removed: Float32Array
  candidateId: number
  ratio: CollapseRatio
  presetId: string
}

/**
 * 盛土が崩れた後の地形と、せき止められた場所を計算する（spec 10 §3）。
 * 無い presetId は既定のプリセット。進み具合は粒の処理の割合（最大 10 回）
 */
export function computeCollapse(
  input: CollapseInput,
  onProgress?: (fraction: number) => void,
): CollapsePayload {
  const { geo, elevation, validMask } = input
  const { size, cellSizeM } = geo
  const params = debrisPreset(input.presetId).params

  const result = simulateCollapse(
    { elevation, validMask, size, cellSizeM },
    input.removed,
    params,
    undefined,
    onProgress,
  )

  // 崩れた後の地形の解析（流出の縁は validMask だけから作るので、崩れる前と同じ geo の下で作り直すだけ）
  const afterGrid: AssembledGrid = {
    elevation: result.after,
    validMask: validMask.slice(),
    width: size,
    height: size,
    cellSizeM,
    invalidRatio: geo.invalidRatio,
  }
  const analysis = analyzeTerrain(afterGrid)
  const outflow = buildOutflowCells(afterGrid.validMask, size)
  const { payload: after } = packTerrain(afterGrid, analysis, geo, outflow)

  // 崩れる前の満水の量と比べて、せき止められた窪地を選ぶ
  const before = analyzeDepressions({ elevation, validMask, width: size, height: size, cellSizeM })
  const sites = findDammedSites(
    { fill: before.fill, elevation },
    {
      fill: analysis.fill,
      elevation: result.after,
      labels: analysis.labels,
      depressions: analysis.depressions,
    },
    result.deposit,
    size,
    cellSizeM,
  )

  const dams = sites.map((s) => {
    const row = Math.floor(s.spillIndex / size)
    const col = s.spillIndex - row * size
    // 画素の中心の全球画素座標 → 経緯度（09 の重心と同じ変換）
    const spill = pixelToLonLat(geo.originX + col + 0.5, geo.originY + row + 0.5, geo.z)
    return {
      depressionId: s.depressionId,
      capacityM3: s.capacityM3,
      addedCapacityM3: s.addedCapacityM3,
      maxDepthM: s.maxDepthM,
      areaM2: s.areaM2,
      spillElevation: s.spillElevation,
      spill,
    }
  })

  return {
    terrainId: input.terrainId,
    candidateId: input.candidateId,
    ratio: input.ratio,
    presetId: input.presetId,
    after,
    removed: result.removed,
    deposit: result.deposit,
    collapsedM3: result.collapsedM3,
    depositedM3: result.depositedM3,
    outsideM3: result.outsideM3,
    dams,
  }
}

/** メインへ移す配列（実体は必ず ArrayBuffer。packTerrain の transfer と同じ並び + removed・deposit） */
export function collapseTransferables(result: CollapsePayload): ArrayBuffer[] {
  const t = result.after
  return [
    t.elevation.buffer,
    t.validMask.buffer,
    t.flowDirection.buffer,
    t.fill.buffer,
    t.labels.buffer,
    t.outflow.nearest.buffer,
    t.outflow.band.buffer,
    result.removed.buffer,
    result.deposit.buffer,
  ] as ArrayBuffer[]
}
