// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { displayStats } from '../../state/displayStats.test-support'
import { createSimulationStore } from '../../state/simulationStore'
import { strings } from '../strings'
import { StatisticsPanel } from './StatisticsPanel'

afterEach(cleanup)

const text = (id: string) => screen.getByTestId(id).textContent

describe('StatisticsPanel（base-spec §38、spec 04 §6.3、spec 08 §6.2）', () => {
  it('統計が無ければ 0 と「—」', () => {
    render(<StatisticsPanel simulation={createSimulationStore()} />)
    expect(text('stat-time')).toBe('0秒')
    expect(text('stat-rain-status')).toBe('—')
    expect(text('stat-rain-depth')).toBe('—')
    expect(text('stat-step')).toBe('Step 0')
    expect(text('stat-total')).toBe('0.00 m³')
    expect(text('stat-outflow-rate')).toBe('0.0 m³/時')
    expect(text('stat-speed')).toBe('実時間の 0 倍（0 step/秒）')
  })

  it('各項目を決めた書式で出す', () => {
    const simulation = createSimulationStore()
    simulation.getState().started({ intensityMmPerH: 100, durationS: 7200 })
    simulation.getState().setStats(
      displayStats({
        step: 1234,
        timeS: 4800,
        raining: true,
        rainDepthMm: (100 * 4800) / 3600,
        totalWater: (Math.PI * 100 * 100) / 1000,
        storedWater: 0.456,
        outflowWater: 13.24,
        outflowRateM3PerS: 12.3 / 3600,
        maxDepth: 0.4321,
        floodedArea: 82.4,
      }),
      59.6,
      27.4,
    )
    render(<StatisticsPanel simulation={simulation} />)
    expect(text('stat-time')).toBe('1時間20分')
    expect(text('stat-rain-status')).toBe('降雨中（残り 40分0秒）')
    expect(text('stat-rain-depth')).toBe('133 mm / 200 mm')
    expect(text('stat-step')).toBe('Step 1234')
    expect(text('stat-total')).toBe('31.4 m³')
    expect(text('stat-stored')).toBe('0.46 m³')
    expect(text('stat-outflow')).toBe('13.2 m³')
    expect(text('stat-outflow-rate')).toBe('12.3 m³/時')
    expect(text('stat-max-depth')).toBe('0.43 m')
    expect(text('stat-flooded-area')).toBe('82 m²')
    expect(text('stat-speed')).toBe('実時間の 27 倍（60 step/秒）')
  })

  it('行の並びは 経過時間・降雨・累積雨量・Step・投入水量・領域内の水量・領域外流出量・流出の速さ・最大水深・湛水面積・実行速度（計画で決めたこと 21）', () => {
    render(<StatisticsPanel simulation={createSimulationStore()} />)
    const ids = screen.getAllByTestId(/^stat-/).map((cell) => cell.getAttribute('data-testid'))
    expect(ids).toEqual([
      'stat-time',
      'stat-rain-status',
      'stat-rain-depth',
      'stat-step',
      'stat-total',
      'stat-stored',
      'stat-outflow',
      'stat-outflow-rate',
      'stat-max-depth',
      'stat-flooded-area',
      'stat-speed',
    ])
  })

  it('ツールチップは「領域外流出量」の行にだけ置き、合計と速さの説明を出す（spec 08 §6.5）', async () => {
    render(<StatisticsPanel simulation={createSimulationStore()} />)
    const helps = screen.getAllByRole('button', { name: strings.stats.outflowHelpLabel })
    expect(helps).toHaveLength(1)
    await userEvent.hover(helps[0] as HTMLElement)
    expect((await screen.findByRole('tooltip')).textContent).toBe(strings.stats.outflowHelp)
  })
})
