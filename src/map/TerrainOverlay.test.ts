// @vitest-environment jsdom
import type { Map as MapLibreMap } from 'maplibre-gl'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TerrainPayload } from '../shared/protocol'
import { TerrainOverlay } from './TerrainOverlay'

afterEach(() => {
  vi.useRealTimers()
})

/** fitBounds だけを見る地図の偽物。レイヤーとソースは無い */
function fakeMap() {
  const container = document.createElement('div')
  return {
    getLayer: () => undefined,
    getSource: () => undefined,
    getContainer: () => container,
    fitBounds: vi.fn(),
  }
}

const terrain = {
  geo: {
    corners: [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  },
} as unknown as TerrainPayload
const display = { elevation: true, depressions: true, flow: true, flowSpacingM: 10 }

describe('TerrainOverlay.showTerrain の fit（ruling R1）', () => {
  it('既定では範囲に合わせて地図を動かし、fit: false では動かさない', () => {
    // 段に分けて足すレイヤーは走らせない（fitBounds だけを見る）
    vi.useFakeTimers()
    const map = fakeMap()
    const overlay = new TerrainOverlay(map as unknown as MapLibreMap, (run) => run())
    overlay.showTerrain(terrain, display)
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    overlay.showTerrain(terrain, display, { fit: false })
    expect(map.fitBounds).toHaveBeenCalledTimes(1)
    vi.clearAllTimers()
  })
})
