import type { Map as MapLibreMap } from 'maplibre-gl'
import {
  type FrameStats,
  mean,
  percentile,
  summarizeFrames,
  summarizeTileTimes,
  type TileGenStats,
} from './fpsStats'
import type { DemSourceKind } from './view3d/demSource'
import type { TileTimeSample } from './view3d/options'

/** 統計から除く先頭の時間（最初の動き出しの stall を均さない。S と同じ） */
const WARMUP_MS = 1000

/** 計測の間に集める値（View3dOptions の受け口に渡した配列） */
export interface FpsSamples {
  renderTimes: number[]
  tileTimes: TileTimeSample[]
}

export interface FpsResult extends FrameStats {
  renderer: string
  durationMs: number
  warmupMs: number
  /**
   * 水面の render の CPU の時間。これを呼ぶのは水面の Custom Layer（呼び出し元は Task 8 で入った。
   * Task 9 の実測は条件ごとの中央値で 0.149〜0.416 ms、ランごとの値は 0.137〜0.463 ms）。水面が無効などでサンプルが 1 つも無ければ null（0 ms ではなく「未計測」）
   */
  renderCpuMeanMs: number | null
  renderCpuP95Ms: number | null
  /** 0 なら未計測（onRenderTime が一度も呼ばれなかった。例: 水面を描いていない） */
  renderFrames: number
  /** 計測の間のタイルの作成（ソースごと） */
  tileGen: Record<DemSourceKind, TileGenStats>
  /** フレームの間隔（ms）の生の値（閾値を変えて再採点するため。10 秒で約 600 個） */
  deltas: number[]
  /** 計測の終わりの data-drawn-tile-zoom（画面の中心で描かれている地形タイルのズームの実測） */
  drawnTileZoom: string
  devicePixelRatio: number
  canvas: [number, number]
}

export function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info === null ? '不明' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
}

/**
 * 地図を毎フレーム動かし（中心を小さく回しながら bearing を回す）、フレームの間隔を測る（S の runFpsProbe と
 * 同じ動き。tech-spec §14.1 の「地図操作時」の代わり）。durationMs はウォームアップの後に測る時間
 */
export async function runFpsProbe(
  map: MapLibreMap,
  durationMs: number,
  samples: FpsSamples,
): Promise<FpsResult> {
  const center = map.getCenter()
  const bearing = map.getBearing()
  const deltas: number[] = []
  let renderStart = 0
  let tileStart = 0
  await new Promise<void>((resolve) => {
    let start = 0
    let last = 0
    let warmedUp = false
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
      if (!warmedUp && elapsed >= WARMUP_MS) {
        warmedUp = true
        renderStart = samples.renderTimes.length
        tileStart = samples.tileTimes.length
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
  const cpu = samples.renderTimes.slice(renderStart).sort((a, b) => a - b)
  const tiles = samples.tileTimes.slice(tileStart)
  // map.painter は MapLibre の内部で、公開 API ではない。版を 6.6.0 に固定しているから使える（版を上げたら見直す）
  const gl = map.painter.context.gl
  return {
    ...summarizeFrames(deltas),
    renderer: rendererName(gl),
    durationMs: deltas.reduce((a, b) => a + b, 0),
    warmupMs: WARMUP_MS,
    renderCpuMeanMs: cpu.length === 0 ? null : mean(cpu),
    renderCpuP95Ms: cpu.length === 0 ? null : percentile(cpu, 0.95),
    renderFrames: cpu.length,
    tileGen: {
      terrain: summarizeTileTimes(tiles, 'terrain'),
      hillshade: summarizeTileTimes(tiles, 'hillshade'),
    },
    deltas,
    drawnTileZoom: map.getContainer().dataset.drawnTileZoom ?? '',
    devicePixelRatio: window.devicePixelRatio,
    canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
  }
}
