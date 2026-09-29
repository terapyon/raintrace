// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Corners } from '../dem/gridRange'
import type { OutflowCells } from '../simulation/outflowCells'
import { uploadCanvasSource, WaterOverlay } from './WaterOverlay'

describe('uploadCanvasSource（止まっている間は再描画させない。spec 06 §5.2）', () => {
  it('play の後に pause を呼ぶ（pause が _playing の間に prepare で 1 回だけ転送する）', () => {
    const calls: string[] = []
    uploadCanvasSource({ play: () => calls.push('play'), pause: () => calls.push('pause') })
    expect(calls).toEqual(['play', 'pause'])
  })

  it('ソースが無い・まだ読み込まれていない（play が無い）ときは何もしない', () => {
    expect(() => uploadCanvasSource(undefined)).not.toThrow()
    const calls: string[] = []
    uploadCanvasSource({ pause: () => calls.push('pause') })
    expect(calls).toEqual([])
  })
})

/**
 * jsdom は canvas 未対応（canvas npm パッケージを入れないと getContext('2d') は null。依存を足さない制約により
 * ここでは足さず、putImageData だけを記録する偽の 2D コンテキストと、jsdom に無い ImageData を用意する。
 * canvas は WaterOverlay.show の中で「水深 → 流出」の順に 1 回ずつ作られるので、contexts[0] が水深、
 * contexts[1] が流出の canvas に対応する
 */
class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }
}

interface FakeContext {
  putImageData: ReturnType<typeof vi.fn>
}

function stubCanvas(): { contexts: FakeContext[] } {
  const contexts: FakeContext[] = []
  vi.stubGlobal('ImageData', FakeImageData)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    const context: FakeContext = { putImageData: vi.fn() }
    contexts.push(context)
    return context as unknown as CanvasRenderingContext2D
  })
  return { contexts }
}

/**
 * requestAnimationFrame を「次の flush() まで実行しない」キューにする（実物の非同期さを保つ。同期に呼ぶと
 * WaterOverlay.requestDraw の `this.frame = requestAnimationFrame(...)` の代入前にコールバックが
 * `this.frame = 0` を先に実行してしまい、代入後の値で上書きされて壊れる）
 */
function stubRaf(): { flush: () => void } {
  let queue: FrameRequestCallback[] = []
  let id = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queue.push(cb)
    return ++id
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  return {
    flush: () => {
      const pending = queue
      queue = []
      for (const cb of pending) cb(0)
    },
  }
}

/** WaterOverlay が使う MapLibre の面だけを持つ偽の地図（レイヤー・ソースを Map で覚える） */
function fakeMap(): MapLibreMap {
  const layers = new Map<string, { layout: Record<string, unknown> }>()
  const sources = new Map<string, unknown>()
  return {
    addSource: (id: string, source: unknown) => sources.set(id, source),
    removeSource: (id: string) => sources.delete(id),
    getSource: (id: string) => sources.get(id),
    addLayer: (layer: { id: string; layout?: Record<string, unknown> }) =>
      layers.set(layer.id, { layout: { ...layer.layout } }),
    removeLayer: (id: string) => layers.delete(id),
    getLayer: (id: string) => layers.get(id),
    setLayoutProperty: (id: string, key: string, value: unknown) => {
      const layer = layers.get(id)
      if (layer !== undefined) layer.layout[key] = value
    },
    // 矢印の画像は既にあることにして、実物の canvas 描画（fillStyle 等）を素通りする
    hasImage: () => true,
  } as unknown as MapLibreMap
}

const CORNERS: Corners = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
]
/** 1 行 2 列。band は 0・1（どちらも自分自身を指す）。2〜3 はグリッド外なので考えない（size は 2） */
const GEO = { size: 2, corners: CORNERS }
const OUTFLOW: OutflowCells = {
  mask: Uint8Array.of(1, 1, 0, 0),
  nearest: Int32Array.of(0, 1, -1, -1),
  band: Int32Array.of(0, 1),
}

const alphaOf = (image: FakeImageData): number[] =>
  Array.from({ length: image.data.length / 4 }, (_, i) => image.data[i * 4 + 3] ?? -1)

describe('WaterOverlay: 流出の帯（spec 07 §5.2。表示を切っている間の Reset で古い帯を残さない。推奨 R4）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it(
    '流出を塗った後に表示を切って Reset（setWater(null)）すると、切っていても canvas を消す。' +
      '表示をまた入れても、latest が無いままなので古い帯の色は出ない',
    () => {
      const { contexts } = stubCanvas()
      const { flush } = stubRaf()
      const overlay = new WaterOverlay(fakeMap(), (run) => run())
      overlay.show(GEO, OUTFLOW)
      overlay.setWater(Float32Array.of(1, 1, 0, 0))
      flush()
      const outflow = contexts[1]
      if (outflow === undefined) throw new Error('流出の canvas の context が無い')
      expect(outflow.putImageData).toHaveBeenCalledTimes(1)
      expect(alphaOf(outflow.putImageData.mock.calls[0]?.[0])).toEqual([255, 255, 0, 0])

      overlay.setOutflowVisible(false)
      overlay.setWater(null) // Reset・start・失敗・異常終了の経路（setWater(null)）
      flush()
      expect(outflow.putImageData).toHaveBeenCalledTimes(2)
      expect(alphaOf(outflow.putImageData.mock.calls[1]?.[0])).toEqual([0, 0, 0, 0])

      overlay.setOutflowVisible(true)
      flush()
      const lastCall = outflow.putImageData.mock.calls.at(-1)
      expect(alphaOf(lastCall?.[0])).toEqual([0, 0, 0, 0])
    },
  )

  it('表示を切ってから水を描き、setWater(null) の後に表示を入れても、色の付いた画素は一度も現れない', () => {
    const { contexts } = stubCanvas()
    const { flush } = stubRaf()
    const overlay = new WaterOverlay(fakeMap(), (run) => run())
    overlay.show(GEO, OUTFLOW)
    overlay.setOutflowVisible(false)
    overlay.setWater(Float32Array.of(1, 1, 0, 0))
    flush()
    overlay.setWater(null)
    flush()
    overlay.setOutflowVisible(true)
    flush()
    const outflow = contexts[1]
    if (outflow === undefined) throw new Error('流出の canvas の context が無い')
    for (const [image] of outflow.putImageData.mock.calls) {
      expect(alphaOf(image).every((a) => a === 0)).toBe(true)
    }
  })
})
