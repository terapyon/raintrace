import { describe, expect, it, vi } from 'vitest'
import type { CollapsePayload, CompareSide } from '../shared/protocol'
import { syncCollapseOverlay } from './collapseOverlaySync'

const RESULT = { after: { geo: { size: 1 } } } as unknown as CollapsePayload
const COMPARED = {
  before: { depth: Float32Array.of(0) },
  after: { depth: Float32Array.of(1) },
} as unknown as { before: CompareSide; after: CompareSide }

function fake() {
  return { show: vi.fn(), showCompare: vi.fn(), clear: vi.fn(), clearCompare: vi.fn() }
}
const data = { result: RESULT, compared: COMPARED }

describe('syncCollapseOverlay', () => {
  it('view が after で status が ready のときだけ描く', () => {
    for (const [view, status] of [
      ['before', 'ready'],
      ['after', 'computing'],
      ['after', 'idle'],
    ] as const) {
      const o = fake()
      syncCollapseOverlay(o, { view, status, compare: { status: 'idle' } }, data)
      expect(o.clear).toHaveBeenCalled()
      expect(o.show).not.toHaveBeenCalled()
    }
    const o = fake()
    syncCollapseOverlay(o, { view: 'after', status: 'ready', compare: { status: 'idle' } }, data)
    expect(o.show).toHaveBeenCalledWith(RESULT, RESULT.after.geo)
  })

  it('結果が無ければ消す', () => {
    const o = fake()
    syncCollapseOverlay(
      o,
      { view: 'after', status: 'ready', compare: { status: 'idle' } },
      { result: null, compared: null },
    )
    expect(o.clear).toHaveBeenCalled()
  })

  it('比べ終わったら新しい水を描き、done を外れたら消す', () => {
    const o = fake()
    syncCollapseOverlay(o, { view: 'after', status: 'ready', compare: { status: 'done' } }, data)
    expect(o.showCompare).toHaveBeenCalledTimes(1)
    expect(o.clearCompare).not.toHaveBeenCalled()
    syncCollapseOverlay(o, { view: 'after', status: 'ready', compare: { status: 'running' } }, data)
    expect(o.clearCompare).toHaveBeenCalledTimes(1)
  })
})
