import type { AssembledGrid } from '../dem/DemGrid'
import { pixelToLonLat } from '../dem/tileMath'
import { debrisPreset } from '../shared/debrisPresets'
import type {
  CollapsePayload,
  CollapseRatio,
  CulvertSummary,
  TerrainGeo,
  TerrainPayload,
} from '../shared/protocol'
import { carveCulvert, culvertBlocked, findCulvert } from '../simulation/debris/culvert.ts'
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
  /** 09 の結果の pastElevation（offsetM を足す前）と offsetM */
  pastElevation: Float32Array
  offsetM: number
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

  const terrainOf = (z: Float32Array) => ({
    elevation: z,
    validMask,
    width: size,
    height: size,
    cellSizeM,
  })
  // 解析と流出の縁の入った地形にする（流出の縁は validMask だけから作るので、geo は崩れる前と同じ）
  const packOf = (z: Float32Array) => {
    const grid: AssembledGrid = {
      elevation: z,
      validMask: validMask.slice(),
      width: size,
      height: size,
      cellSizeM,
      invalidRatio: geo.invalidRatio,
    }
    const analysis = analyzeTerrain(grid)
    const outflow = buildOutflowCells(grid.validMask, size)
    return { analysis, payload: packTerrain(grid, analysis, geo, outflow).payload }
  }

  // 今の地形の窪地と、盛土の下の水路（spec 10b §2）。候補は土を取り去るセル
  const current = analyzeDepressions(terrainOf(elevation))
  const past = new Float32Array(input.pastElevation.length)
  for (let i = 0; i < past.length; i++) past[i] = (input.pastElevation[i] ?? 0) + input.offsetM
  const candidate = new Uint8Array(elevation.length)
  for (let i = 0; i < candidate.length; i++) candidate[i] = (result.removed[i] ?? 0) > 0 ? 1 : 0
  const found = findCulvert({
    elevation,
    past,
    validMask,
    candidate,
    labels: current.labels,
    depressions: current.depressions,
    size,
    cellSizeM,
  })
  const blocked = found !== null && culvertBlocked(found, result.deposit)
  // 水路があれば崩れる前に溝を掘る。ふさがっていなければ崩れた後にも掘る
  const carve = (z: Float32Array) => (found === null ? z : carveCulvert(z, found))
  const beforeElevation = carve(elevation)
  const afterElevation = blocked ? result.after : carve(result.after)
  const { analysis, payload: after } = packOf(afterElevation)

  // 崩れる前と、土を取り去っただけの跡（積もらせる前）の満水の量と比べて、せき止められた窪地を選ぶ
  const scarRaw = new Float32Array(elevation.length)
  for (let i = 0; i < scarRaw.length; i++) {
    scarRaw[i] = (elevation[i] ?? 0) - (result.removed[i] ?? 0)
  }
  const scarElevation = carve(scarRaw)
  const before = found === null ? current : analyzeDepressions(terrainOf(beforeElevation))
  const scar = analyzeDepressions(terrainOf(scarElevation))
  const sites = findDammedSites(
    {
      fill: before.fill,
      elevation: beforeElevation,
      scar: { fill: scar.fill, elevation: scarElevation },
    },
    {
      fill: analysis.fill,
      elevation: afterElevation,
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

  const culvert: CulvertSummary | null =
    found === null
      ? null
      : {
          line: Array.from(found.path, (i) => {
            const row = Math.floor(i / size)
            const col = i - row * size
            const p = pixelToLonLat(geo.originX + col + 0.5, geo.originY + row + 0.5, geo.z)
            return [p.lon, p.lat] as [number, number]
          }),
          lengthM: found.lengthM,
          blocked,
        }

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
    before: found === null ? null : packOf(beforeElevation).payload,
    culvert,
  }
}

/** メインへ移す配列（実体は必ず ArrayBuffer。packTerrain の transfer と同じ並び + removed・deposit、あれば before の 7 つ） */
export function collapseTransferables(result: CollapsePayload): ArrayBuffer[] {
  const terrainBuffers = (t: TerrainPayload) => [
    t.elevation.buffer,
    t.validMask.buffer,
    t.flowDirection.buffer,
    t.fill.buffer,
    t.labels.buffer,
    t.outflow.nearest.buffer,
    t.outflow.band.buffer,
  ]
  return [
    ...terrainBuffers(result.after),
    result.removed.buffer,
    result.deposit.buffer,
    ...(result.before === null ? [] : terrainBuffers(result.before)),
  ] as ArrayBuffer[]
}
