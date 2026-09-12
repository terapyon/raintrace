import { DEM_IDS, type DemId } from '../dem/demSources'
import { strings } from './strings'

/** 標高と水深は 0.01m 単位（tech-spec §6.6） */
export const formatMeters = (value: number): string => `${value.toFixed(2)} m`
export const formatCoordinate = (value: number): string => value.toFixed(6)
export const formatCellSize = (value: number): string => `約 ${value.toFixed(2)} m`
export const formatPercent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`
export const formatCubicMeters = (value: number): string => `${value.toFixed(2)} m³`
/** 水量（base-spec §38、spec 04 §6.3）: 小数 1 桁、1 m³ 未満は小数 2 桁。桁は丸めた後の値で決める */
export const formatVolume = (m3: number): string =>
  `${m3.toFixed(Math.abs(Number(m3.toFixed(2))) < 1 ? 2 : 1)} m³`
export const formatArea = (m2: number): string => `${Math.round(m2)} m²`
export const formatStepsPerSecond = (rate: number): string => `${Math.round(rate)} step/秒`
/** base-spec §33。実時間との対応を示す表現は使わない */
export const formatStep = (step: number): string => `Step ${step}`

/** 最も多く使った DEM を主にし（同数なら DEM_IDS の順）、ほかを「一部」として添える */
export function formatDemLabel(breakdown: Partial<Record<DemId, number>>): string {
  const count = (id: DemId): number => breakdown[id] ?? 0
  const order = (id: DemId): number => DEM_IDS.indexOf(id)
  const used = DEM_IDS.filter((id) => count(id) > 0).sort(
    (a, b) => count(b) - count(a) || order(a) - order(b),
  )
  const [main, ...rest] = used
  if (main === undefined) return '—'
  if (rest.length === 0) return strings.dem[main]
  const others = rest.sort((a, b) => order(a) - order(b)).map((id) => strings.dem[id])
  return `${strings.dem[main]}（${strings.dem.partial} ${others.join('、')}）`
}
