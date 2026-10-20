import { describe, expect, it, vi } from 'vitest'
import type { CollapsePayload } from '../shared/protocol'
import { syncCollapseOverlay } from './collapseOverlaySync'

const RESULT = { after: { geo: { size: 1 } } } as unknown as CollapsePayload

function fake() {
  return { show: vi.fn(), clear: vi.fn() }
}

describe('syncCollapseOverlay', () => {
  it('status が ready なら、view に関わらず view を渡して描く', () => {
    for (const view of ['before', 'after'] as const) {
      const o = fake()
      syncCollapseOverlay(o, { view, status: 'ready' }, RESULT)
      expect(o.show).toHaveBeenCalledWith(RESULT, RESULT.after.geo, { markerCount: 5, view })
      expect(o.clear).not.toHaveBeenCalled()
    }
  })

  it('status が ready でなければ消す（idle に戻ったときも）', () => {
    for (const status of ['idle', 'computing'] as const) {
      const o = fake()
      syncCollapseOverlay(o, { view: 'after', status }, RESULT)
      expect(o.clear).toHaveBeenCalled()
      expect(o.show).not.toHaveBeenCalled()
    }
  })

  it('結果が無ければ消す', () => {
    const o = fake()
    syncCollapseOverlay(o, { view: 'after', status: 'ready' }, null)
    expect(o.clear).toHaveBeenCalled()
  })
})
