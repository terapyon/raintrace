import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CandidateHandle, FpsResult, GapHistogram } from './types'
import type { DynamicWater } from './water/dynamicWater'

const PASS_FPS = 57
const PASS_LONG_RATIO = 0.01
// 長いフレームの倍率（中央値の何倍を「長い」とするか）と、統計から除く先頭の時間（fix round 1）。
// 33.4ms 固定（2 フレーム分）は、float の丸めで正確に 2 フレーム分（33.3〜33.5ms）の間隔が
// 閾値の内外で揺れ、同じ条件の実行で pass/fail が入れ替わっていた（task-8-review.md Important 3）。
// 中央値の 2.5 倍（60Hz なら約 41.7ms）にすることで、ちょうど 2 フレーム分の揺れを長いフレームと
// 数えず、実際に 1 フレーム以上余分に落ちたときだけ数える
const LONG_FRAME_MULTIPLIER = 2.5
const WARMUP_MS = 1000

export function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info === null ? '不明' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

/** 中央値を 1 フレーム分として、間隔を 1〜5（5 は 5 フレーム分以上）に丸めて数える（再採点用） */
function buildGapHistogram(deltas: number[], medianMs: number): GapHistogram {
  const histogram: GapHistogram = { g1: 0, g2: 0, g3: 0, g4: 0, g5plus: 0 }
  if (medianMs <= 0) return histogram
  for (const d of deltas) {
    const n = Math.round(d / medianMs)
    if (n <= 1) histogram.g1++
    else if (n === 2) histogram.g2++
    else if (n === 3) histogram.g3++
    else if (n === 4) histogram.g4++
    else histogram.g5plus++
  }
  return histogram
}

/**
 * 地図を毎フレーム動かし（中心を小さく回しながら bearing を回す）、水深を毎フレーム要求する。
 * パン・回転の操作の代わり（tech-spec §14.1 の「地図操作時」）。
 * 先頭 `WARMUP_MS`（既定 1000ms）は統計から除く（最初の動き出しの stall を均さないため。
 * fix round 1、レビュー Minor 2）。`durationMs` はウォームアップの後に測る時間で、
 * 総経過時間は `WARMUP_MS + durationMs` になる（計測の長さそのものは変えていない）
 */
export async function runFpsProbe(
  map: MapLibreMap,
  candidate: CandidateHandle,
  water: DynamicWater | null,
  durationMs: number,
): Promise<FpsResult> {
  const center = map.getCenter()
  const bearing = map.getBearing()
  const deltas: number[] = []
  let renderWarmStart = 0
  let waterWarmStart = 0
  let warmedUp = false
  await new Promise<void>((resolve) => {
    let start = 0
    let last = 0
    const tick = (now: number): void => {
      const delta = now - last
      last = now
      const elapsed = now - start
      map.jumpTo({
        bearing: bearing + elapsed * 0.02,
        center: [
          center.lng + 0.0005 * Math.sin(elapsed / 1000),
          center.lat + 0.0003 * Math.cos(elapsed / 1000),
        ],
      })
      water?.request(elapsed)
      if (!warmedUp && elapsed >= WARMUP_MS) {
        warmedUp = true
        renderWarmStart = candidate.renderTimes.length
        waterWarmStart = water?.roundTripMs.length ?? 0
      }
      if (warmedUp) deltas.push(delta)
      if (elapsed < WARMUP_MS + durationMs) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame((now) => {
      start = now
      last = now
      requestAnimationFrame(tick)
    })
  })
  map.jumpTo({ center, bearing })
  const sorted = [...deltas].sort((a, b) => a - b)
  const total = deltas.reduce((a, b) => a + b, 0)
  const cpu = candidate.renderTimes.slice(renderWarmStart).sort((a, b) => a - b)
  const meanFps = deltas.length / (total / 1000)
  const medianMs = percentile(sorted, 0.5)
  const longFrameThresholdMs = medianMs * LONG_FRAME_MULTIPLIER
  const longFrameRatio = deltas.filter((d) => d > longFrameThresholdMs).length / deltas.length
  const gl = map.painter.context.gl
  return {
    renderer: rendererName(gl),
    durationMs: total,
    warmupMs: WARMUP_MS,
    frames: deltas.length,
    meanFps,
    p50Ms: medianMs,
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    longFrameThresholdMs,
    longFrameRatio,
    gapHistogram: buildGapHistogram(deltas, medianMs),
    renderCpuMeanMs: mean(cpu),
    renderCpuP95Ms: percentile(cpu, 0.95),
    renderFrames: candidate.renderTimes.length - renderWarmStart,
    depthUpdates: (water?.roundTripMs.length ?? 0) - waterWarmStart,
    roundTripMeanMs: mean(water?.roundTripMs.slice(waterWarmStart) ?? []),
    devicePixelRatio: window.devicePixelRatio,
    canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    pass: meanFps >= PASS_FPS && longFrameRatio <= PASS_LONG_RATIO,
  }
}
