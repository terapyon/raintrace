/**
 * 「崩れる前と後を比べる」の所要時間の目安（分）。押す前に知らせるための粗い見積もり（R13）。
 *
 * 比べる計算は、崩れる前と後の 2 回、雨が降り終わるまでを計算する。
 * 所要時間 ≒ RATE ÷ √セルの大きさ × セル数 × 雨の長さ（秒）  （2 回分の合計）
 *   - セル数 = (範囲 ÷ セルの大きさ)²。細かいセルほど 1 歩の時間刻みが短くなるので √ で重くした
 *   - 係数は実測に合わせた（docs/perf/2026-10-19-fill-collapse.md の「比べる」、
 *     docs/perf/2026-09-30-physical-time.md の 1 step の表）。範囲全体・60 mm/h × 360 分の合計で
 *     酒々井 500 m（セル 3.879 m）2.5 分・1000 m 12.5 分、熱海 500 m（セル 0.977 m）約 120 分・1000 m 約 300 分。
 *     見積もりはそれぞれ 3.0・12.2・95・381 分（実測の 0.8〜1.3 倍）
 *   - 雨が範囲の一部（半径の円）だけなら軽い。1 step の時間は 半径 10 m で範囲全体の 約 1/50、
 *     半径 100 m（500 m の範囲）で 約 1/2。円が範囲に占める割合 × 4 に下限 2% を足し、1 を上限とした
 * 端末や、雨で水が増えたときの刻みの変化で大きく変わる。目安として「約 N 分」と出すだけに使う
 */
const RATE_S_PER_CELL_SIM_S = 1.0e-6
const MIN_FACTOR = 0.02
const AREA_FACTOR = 4

export function estimateCompareMinutes(params: {
  sizeM: number
  cellSizeM: number
  wholeRange: boolean
  radiusM: number
  durationMin: number
}): number {
  const { sizeM, cellSizeM, wholeRange, radiusM, durationMin } = params
  if (!(cellSizeM > 0) || !(sizeM > 0)) return 0
  const cells = (sizeM / cellSizeM) ** 2
  const wetFraction = (Math.PI * radiusM * radiusM) / (sizeM * sizeM)
  const rainFactor = wholeRange ? 1 : Math.min(1, MIN_FACTOR + AREA_FACTOR * wetFraction)
  const seconds =
    (RATE_S_PER_CELL_SIM_S / Math.sqrt(cellSizeM)) * cells * durationMin * 60 * rainFactor
  return seconds / 60
}
