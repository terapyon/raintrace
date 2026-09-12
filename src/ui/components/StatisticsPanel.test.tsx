// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSimulationStore } from '../../state/simulationStore'
import { StatisticsPanel } from './StatisticsPanel'

afterEach(cleanup)

const text = (id: string) => screen.getByTestId(id).textContent

describe('StatisticsPanel（base-spec §38、spec 04 §6.3）', () => {
  it('統計が無ければ Step 0 と 0', () => {
    render(<StatisticsPanel simulation={createSimulationStore()} />)
    expect(text('stat-step')).toBe('Step 0')
    expect(text('stat-total')).toBe('0.00 m³')
    expect(text('stat-speed')).toBe('0 step/秒')
  })

  it('各項目を決めた書式で出す', () => {
    const simulation = createSimulationStore()
    simulation.getState().setStats(
      {
        step: 1234,
        totalWater: (Math.PI * 100 * 100) / 1000,
        storedWater: 0.456,
        outflowWater: 13.24,
        maxDepth: 0.4321,
        floodedArea: 82.4,
        settled: false,
        massError: 0,
      },
      59.6,
    )
    render(<StatisticsPanel simulation={simulation} />)
    expect(text('stat-step')).toBe('Step 1234')
    expect(text('stat-total')).toBe('31.4 m³')
    expect(text('stat-stored')).toBe('0.46 m³')
    expect(text('stat-outflow')).toBe('13.2 m³')
    expect(text('stat-max-depth')).toBe('0.43 m')
    expect(text('stat-flooded-area')).toBe('82 m²')
    expect(text('stat-speed')).toBe('60 step/秒')
  })
})
