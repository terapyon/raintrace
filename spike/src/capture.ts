import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CandidateHandle, WaterMeasure } from './types'

// bearing をわずかに動かす量（度）と、内側を削る画素数。遠くの画素の移動をちらつきと取り違えないため（計画 D9）
const JITTER_DEG = [0, 0.002, -0.002] as const
const ERODE_PX = 2

/** 画面を読み取り、マゼンタ（水面の判定用の色）の画素を 1 にしたマスクを返す。preserveDrawingBuffer が要る */
function readMask(map: MapLibreMap): { mask: Uint8Array; width: number; height: number } {
  const canvas = map.getCanvas()
  const { width, height } = canvas
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('2D コンテキストを得られません')
  context.drawImage(canvas, 0, 0)
  const { data } = context.getImageData(0, 0, width, height)
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4
    mask[i] = (data[o] ?? 0) > 200 && (data[o + 1] ?? 255) < 80 && (data[o + 2] ?? 0) > 200 ? 1 : 0
  }
  return { mask, width, height }
}

function erode(mask: Uint8Array, width: number, height: number, times: number): Uint8Array {
  let current = mask
  for (let t = 0; t < times; t++) {
    const next = new Uint8Array(current.length)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        next[i] =
          current[i] === 1 &&
          current[i - 1] === 1 &&
          current[i + 1] === 1 &&
          current[i - width] === 1 &&
          current[i + width] === 1
            ? 1
            : 0
      }
    }
    current = next
  }
  return current
}

const count = (mask: Uint8Array): number => mask.reduce((sum, v) => sum + v, 0)

/** 深度テストなしの水面（全体）と、深度テストありで見えた水面を比べる。終わったら元の表示に戻す */
export async function measureWater(
  map: MapLibreMap,
  candidate: CandidateHandle,
): Promise<WaterMeasure> {
  const bearing = map.getBearing()
  candidate.setDebug('mask-nodepth')
  await candidate.whenIdle()
  const footprint = readMask(map)
  candidate.setDebug('mask')
  const visible: Uint8Array[] = []
  for (const delta of JITTER_DEG) {
    map.jumpTo({ bearing: bearing + delta })
    await candidate.whenIdle()
    visible.push(readMask(map).mask)
  }
  map.jumpTo({ bearing })
  candidate.setDebug('off')
  await candidate.whenIdle()

  const footprintPx = count(footprint.mask)
  const first = visible[0] ?? new Uint8Array(0)
  const interior = erode(footprint.mask, footprint.width, footprint.height, ERODE_PX)
  let interiorPx = 0
  let changed = 0
  for (let i = 0; i < interior.length; i++) {
    if (interior[i] !== 1) continue
    interiorPx++
    if (visible.some((mask) => mask[i] !== first[i])) changed++
  }
  return {
    footprintPx,
    visibleRatio: footprintPx === 0 ? 1 : Math.min(1, count(first) / footprintPx),
    interiorPx,
    flickerRatio: interiorPx === 0 ? 0 : changed / interiorPx,
  }
}
