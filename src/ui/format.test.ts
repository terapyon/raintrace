import { describe, expect, it } from 'vitest'
import { displayStats } from '../state/displayStats.test-support'
import {
  formatArea,
  formatCellSize,
  formatCoordinate,
  formatCubicMeters,
  formatDemLabel,
  formatElapsed,
  formatMeters,
  formatOutflowRate,
  formatPercent,
  formatPlaybackRate,
  formatRainDepth,
  formatRainStatus,
  formatStep,
  formatStepsPerSecond,
  formatVolume,
} from './format'

describe('表示の書式', () => {
  it('標高と水深は 0.01m 単位', () => {
    expect(formatMeters(11.084)).toBe('11.08 m')
    expect(formatMeters(-0.005)).toBe('-0.01 m')
  })

  it('座標は小数 6 桁、セルは「約」つき、割合は小数 1 桁、容量は m³', () => {
    expect(formatCoordinate(139.70160004)).toBe('139.701600')
    expect(formatCellSize(0.97834)).toBe('約 0.98 m')
    expect(formatPercent(0.1234)).toBe('12.3%')
    expect(formatCubicMeters(18)).toBe('18.00 m³')
  })

  it('DEM は最も多く使った種類を主にし、ほかは「一部」として添える', () => {
    expect(formatDemLabel({ dem1a: 9 })).toBe('DEM1A')
    expect(formatDemLabel({ dem5a: 6, dem5b: 3 })).toBe('DEM5A（一部 DEM5B）')
    expect(formatDemLabel({ dem5b: 2, dem5a: 2, dem5c: 1 })).toBe('DEM5A（一部 DEM5B、DEM5C）')
    expect(formatDemLabel({})).toBe('—')
  })

  it('水量は小数 1 桁、1 m³ 未満は小数 2 桁（spec 04 §6.3）', () => {
    expect(formatVolume((Math.PI * 100 * 100) / 1000)).toBe('31.4 m³')
    expect(formatVolume(0.456)).toBe('0.46 m³')
    expect(formatVolume(0)).toBe('0.00 m³')
    expect(formatVolume(1)).toBe('1.0 m³')
  })

  it('水量の桁は丸めた後の値で決める（0.999 は 1 m³ に丸まるので小数 1 桁）', () => {
    expect(formatVolume(0.999)).toBe('1.0 m³')
    expect(formatVolume(0.994)).toBe('0.99 m³')
    expect(formatVolume(-0.999)).toBe('-1.0 m³')
  })

  it('湛水面積は m²、実行速度は step／秒、Step は「Step N」', () => {
    expect(formatArea(82.4)).toBe('82 m²')
    expect(formatStepsPerSecond(59.6)).toBe('60 step/秒')
    expect(formatStep(1234)).toBe('Step 1234')
  })
})

describe('経過時間・降雨・流出の速さ・実行速度の書式（spec 08 §6.2）', () => {
  it('経過時間: 1 時間以上は時・分、1 分以上は分・秒、1 分未満は秒。秒は切り捨て', () => {
    expect(formatElapsed(45.9)).toBe('45秒')
    expect(formatElapsed(0)).toBe('0秒')
    expect(formatElapsed(750)).toBe('12分30秒')
    expect(formatElapsed(60)).toBe('1分0秒')
    expect(formatElapsed(4800)).toBe('1時間20分')
    expect(formatElapsed(8 * 3600 + 59)).toBe('8時間0分')
  })

  it('降雨: 雨の間は残り（経過時間と同じ書式）、終われば「降雨終了」。実行が無ければ「—」', () => {
    const run = { intensityMmPerH: 100, durationS: 3600 }
    expect(formatRainStatus(null, null)).toBe('—')
    expect(formatRainStatus(run, null)).toBe('降雨中（残り 1時間0分）')
    expect(formatRainStatus(run, displayStats({ timeS: 1200, raining: true }))).toBe(
      '降雨中（残り 40分0秒）',
    )
    expect(formatRainStatus(run, displayStats({ timeS: 3600, raining: false }))).toBe('降雨終了')
  })

  it('累積雨量: 「降った量 / 総量」をどちらも mm の整数に切り捨てる（計画で決めたこと 21）', () => {
    expect(formatRainDepth(null, 0)).toBe('—')
    expect(formatRainDepth({ intensityMmPerH: 100, durationS: 7200 }, 60)).toBe('60 mm / 200 mm')
    // 100 mm/h × 10 分 = 16.67 mm。雨の後も「16 mm / 16 mm」で食い違わない
    const tenMinutes = { intensityMmPerH: 100, durationS: 600 }
    expect(formatRainDepth(tenMinutes, (100 * 600) / 3600)).toBe('16 mm / 16 mm')
    expect(formatRainDepth(tenMinutes, 0)).toBe('0 mm / 16 mm')
  })

  it('流出の速さは m³/時（outflowRateM3PerS × 3600。小数 1 桁）', () => {
    expect(formatOutflowRate(12.3 / 3600)).toBe('12.3 m³/時')
    expect(formatOutflowRate(0)).toBe('0.0 m³/時')
  })

  it('実行速度は「実時間の N 倍（M step/秒）」。どちらも四捨五入の整数', () => {
    expect(formatPlaybackRate(27.4, 59.6)).toBe('実時間の 27 倍（60 step/秒）')
    expect(formatPlaybackRate(0, 0)).toBe('実時間の 0 倍（0 step/秒）')
  })
})
