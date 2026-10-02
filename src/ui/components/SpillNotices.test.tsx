// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSimulationStore } from '../../state/simulationStore'
import { strings } from '../strings'
import { SpillNotices } from './SpillNotices'

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
})
