// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSimulationStore } from '../../state/simulationStore'
import { strings } from '../strings'
import { SPILL_LIST_MAX_HEIGHT_PX, SpillNotices } from './SpillNotices'

afterEach(cleanup)

describe('SpillNotices（spec 08 §6.2）', () => {
  it('越流の通知は経過時間で出す（Step ではなく）', () => {
    const simulation = createSimulationStore()
    render(<SpillNotices simulation={simulation} />)
    act(() =>
      simulation
        .getState()
        .addSpills([
          { type: 'spill', step: 42, timeS: 3900, depressionId: 3, spillElevation: 12.7 },
        ]),
    )
    const expected = strings.spill.started('12.70 m', '1時間5分')
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
  })

  it('越流が無いうちは一覧を出さない', () => {
    render(<SpillNotices simulation={createSimulationStore()} />)
    expect(screen.queryByTestId('spill-list')).toBeNull()
    expect(screen.queryByText(strings.spill.title)).toBeNull()
  })

  it('一覧は起きた順に並び、高さの上限を超えたら中でスクロールする。キーボードで焦点を受ける', () => {
    const simulation = createSimulationStore()
    render(<SpillNotices simulation={simulation} />)
    act(() =>
      simulation.getState().addSpills([
        { type: 'spill', step: 10, timeS: 60, depressionId: 1, spillElevation: 10 },
        { type: 'spill', step: 20, timeS: 120, depressionId: 2, spillElevation: 11 },
      ]),
    )
    const list = screen.getByTestId('spill-list')
    expect(list.getAttribute('tabindex')).toBe('0')
    expect(list.getAttribute('aria-label')).toBe(strings.spill.listAria)
    const style = getComputedStyle(list)
    expect(style.maxHeight).toBe(`${SPILL_LIST_MAX_HEIGHT_PX}px`)
    expect(style.overflowY).toBe('auto')
    expect([...list.children].map((row) => row.textContent)).toEqual([
      strings.spill.started('10.00 m', '1分0秒'),
      strings.spill.started('11.00 m', '2分0秒'),
    ])
  })
})
