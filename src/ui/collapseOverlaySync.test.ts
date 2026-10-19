import { describe, expect, it, vi } from 'vitest'
import type { CollapsePayload } from '../shared/protocol'
import { syncCollapseOverlay } from './collapseOverlaySync'

const RESULT = { after: { geo: { size: 1 } } } as unknown as CollapsePayload

function fake() {
  return { show: vi.fn(), clear: vi.fn() }
}
const data = { result: RESULT }

describe('syncCollapseOverlay', () => {
  it('view が after で status が ready のときだけ描く', () => {
    for (const [view, status] of [
      ['before', 'ready'],
      ['after', 'computing'],
      ['after', 'idle'],
    ] as const) {
      const o = fake()
      syncCollapseOverlay(o, { view, status }, data)
      expect(o.clear).toHaveBeenCalled()
      expect(o.show).not.toHaveBeenCalled()
    }
    const o = fake()
    syncCollapseOverlay(o, { view: 'after', status: 'ready' }, data)
    expect(o.show).toHaveBeenCalledWith(RESULT, RESULT.after.geo, 5)
  })

  it('結果が無ければ消す', () => {
    const o = fake()
    syncCollapseOverlay(o, { view: 'after', status: 'ready' }, { result: null })
    expect(o.clear).toHaveBeenCalled()
  })
})
