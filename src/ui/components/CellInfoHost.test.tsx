// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../state/appStore'
import { createSimulationStore } from '../../state/simulationStore'
import type { TerrainSession } from '../terrainSession'
import { CellInfoHost } from './CellInfoHost'

afterEach(cleanup)

describe('CellInfoHost の盛土の履歴', () => {
  it('開いたままでも、履歴がオン・結果の到着・オフで昔の標高の行が出入りする', () => {
    const store = createAppStore()
    store.getState().setPopover({ kind: 'cell', lon: 139.7, lat: 35.6, x: 10, y: 10 })
    // session.cellInfo と同じく、履歴がオンで結果が届いている間だけ昔の値を足す
    const session = {
      store,
      simulation: { store: createSimulationStore() },
      cellInfo: () => {
        const f = store.getState().fillHistory
        const base = { kind: 'value' as const, elevationM: 10, depthM: 0, levelM: 10 }
        return f.enabled && f.status === 'ready' ? { ...base, pastM: 8, deltaM: 2 } : base
      },
    } as unknown as TerrainSession
    render(<CellInfoHost session={session} />)
    expect(screen.queryByTestId('cell-past-elevation')).toBeNull()
    act(() => store.getState().setFillHistoryEnabled(true))
    act(() =>
      store.getState().setFillHistoryResult('ready', {
        offsetM: 0,
        candidates: [],
        a54Available: true,
        landformAvailable: true,
      }),
    )
    expect(screen.getByTestId('cell-past-elevation').textContent).toBe('8.00 m')
    expect(screen.getByTestId('cell-delta').textContent).toBe('+2.00 m')
    act(() => store.getState().setFillHistoryEnabled(false))
    expect(screen.queryByTestId('cell-past-elevation')).toBeNull()
  })
})
