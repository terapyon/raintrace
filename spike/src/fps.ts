import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CandidateHandle, FpsResult } from './types'
import type { DynamicWater } from './water/dynamicWater'

const LONG_FRAME_MS = 33.4
const PASS_FPS = 57
const PASS_LONG_RATIO = 0.01

export function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info === null ? '不明' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

/**
 * 地図を毎フレーム動かし（中心を小さく回しながら bearing を回す）、水深を毎フレーム要求する。
 * パン・回転の操作の代わり（tech-spec §14.1 の「地図操作時」）
 */
export async function runFpsProbe(
  map: MapLibreMap,
  candidate: CandidateHandle,
  water: DynamicWater | null,
  durationMs: number,
): Promise<FpsResult> {
  const center = map.getCenter()
  const bearing = map.getBearing()
  const renderStart = candidate.renderTimes.length
  const waterStart = water?.roundTripMs.length ?? 0
  const deltas: number[] = []
  await new Promise<void>((resolve) => {
    let start = 0
    let last = 0
    const tick = (now: number): void => {
      deltas.push(now - last)
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
      if (elapsed < durationMs) requestAnimationFrame(tick)
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
  const cpu = candidate.renderTimes.slice(renderStart).sort((a, b) => a - b)
  const meanFps = deltas.length / (total / 1000)
  const longFrameRatio = deltas.filter((d) => d > LONG_FRAME_MS).length / deltas.length
  const gl = map.painter.context.gl
  return {
    renderer: rendererName(gl),
    durationMs: total,
    frames: deltas.length,
    meanFps,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    longFrameRatio,
    renderCpuMeanMs: mean(cpu),
    renderCpuP95Ms: percentile(cpu, 0.95),
    waterFrames: (water?.roundTripMs.length ?? 0) - waterStart,
    roundTripMeanMs: mean(water?.roundTripMs.slice(waterStart) ?? []),
    devicePixelRatio: window.devicePixelRatio,
    canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    pass: meanFps >= PASS_FPS && longFrameRatio <= PASS_LONG_RATIO,
  }
}
