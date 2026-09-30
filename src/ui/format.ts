import { DEM_IDS, type DemId } from '../dem/demSources'
import type { DisplayStats, RunRain } from '../state/simulationStore'
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
/** Step N（base-spec §33。spec 08 で経過時間の行を足した） */
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

/** 経過時間（spec 08 §6.2）: 1 時間以上は時・分、1 分以上は分・秒、1 分未満は秒。秒は切り捨て */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours >= 1) return strings.format.hoursMinutes(hours, minutes)
  if (minutes >= 1) return strings.format.minutesSeconds(minutes, total % 60)
  return strings.format.seconds(total)
}

/** 降雨の状態（spec 08 §6.2）。統計がまだ無いときは、雨の始まり（残りは継続時間） */
export function formatRainStatus(run: RunRain | null, stats: DisplayStats | null): string {
  if (run === null) return strings.format.none
  const timeS = stats?.timeS ?? 0
  const raining = stats === null ? run.durationS > 0 : stats.raining
  return raining
    ? strings.stats.raining(formatElapsed(run.durationS - timeS))
    : strings.stats.rainEnded
}

/** 累積雨量「降った量 / 総量」（spec 08 §6.2）。どちらも mm の整数に切り捨てる（計画で決めたこと 21） */
export function formatRainDepth(run: RunRain | null, rainDepthMm: number): string {
  if (run === null) return strings.format.none
  const total = (run.intensityMmPerH * run.durationS) / 3600
  // 1e-9 は、ちょうど整数になるはずの値が丸めで僅かに下回るのを切り捨てないため
  return strings.format.rainDepth(Math.floor(rainDepthMm + 1e-9), Math.floor(total + 1e-9))
}

/** 流出の速さ（spec 08 §6.2）: outflowRateM3PerS × 3600 の m³/時 */
export const formatOutflowRate = (m3PerS: number): string =>
  strings.format.cubicMetersPerHour((m3PerS * 3600).toFixed(1))

/** 実行速度（spec 08 §6.2）: 実際の倍率と step／秒 */
export const formatPlaybackRate = (simSecondsPerSecond: number, stepsPerSecond: number): string =>
  strings.stats.playbackRate(
    String(Math.round(simSecondsPerSecond)),
    formatStepsPerSecond(stepsPerSecond),
  )
