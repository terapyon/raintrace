import { DEM_IDS, type DemId } from '../dem/demSources'
import { strings } from './strings'

// 桁の丸めだけをここで行い、単位と言葉は strings.ts に置く（tech-spec §9.4）

/** 標高と水深は 0.01m 単位（tech-spec §6.6） */
export const formatMeters = (value: number): string => strings.format.meters(value.toFixed(2))
export const formatCoordinate = (value: number): string => value.toFixed(6)
export const formatCellSize = (value: number): string => strings.format.cellSize(value.toFixed(2))
export const formatPercent = (ratio: number): string =>
  strings.format.percent((ratio * 100).toFixed(1))
export const formatCubicMeters = (value: number): string =>
  strings.format.cubicMeters(value.toFixed(2))
/** 水量（base-spec §38、spec 04 §6.3）: 小数 1 桁、1 m³ 未満は小数 2 桁。桁は丸めた後の値で決める */
export const formatVolume = (m3: number): string =>
  strings.format.cubicMeters(m3.toFixed(Math.abs(Number(m3.toFixed(2))) < 1 ? 2 : 1))
export const formatArea = (m2: number): string => strings.format.area(String(Math.round(m2)))
export const formatStepsPerSecond = (rate: number): string =>
  strings.format.stepsPerSecond(String(Math.round(rate)))
/** base-spec §33。実時間との対応を示す表現は使わない */
export const formatStep = (step: number): string => strings.format.step(step)

/** 最も多く使った DEM を主にし（同数なら DEM_IDS の順）、ほかを「一部」として添える */
export function formatDemLabel(breakdown: Partial<Record<DemId, number>>): string {
  const count = (id: DemId): number => breakdown[id] ?? 0
  const order = (id: DemId): number => DEM_IDS.indexOf(id)
  const used = DEM_IDS.filter((id) => count(id) > 0).sort(
    (a, b) => count(b) - count(a) || order(a) - order(b),
  )
  const [main, ...rest] = used
  if (main === undefined) return strings.format.none
  if (rest.length === 0) return strings.dem[main]
  const others = rest.sort((a, b) => order(a) - order(b)).map((id) => strings.dem[id])
  return strings.dem.withPartial(strings.dem[main], others)
}
