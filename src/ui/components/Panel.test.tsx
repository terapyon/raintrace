// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeWorker } from '../../bridge/fakeWorker.test-support'
import { SimulationClient } from '../../bridge/SimulationClient'
import { createAppStore } from '../../state/appStore'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import { createSettingsStore } from '../../state/settingsStore'
import { createSimulationStore } from '../../state/simulationStore'
import { SimulationSession } from '../simulationSession'
import { strings } from '../strings'
import { TerrainSession } from '../terrainSession'
import { Panel } from './Panel'

afterEach(cleanup)

describe('Panel', () => {
  it('md 未満（jsdom は matchMedia が無いので狭い画面の扱い）では、下部パネルをたたんで開ける（02 の申し送り L8）', async () => {
    const client = new SimulationClient(() => new FakeWorker())
    const settings = createSettingsStore(memoryStorage())
    const simulation = new SimulationSession(client, createSimulationStore(), settings)
    const session = new TerrainSession(client, createAppStore(), simulation, settings)
    render(<Panel session={session} settings={settings} />)
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: strings.panel.collapse })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    await user.click(toggle)
    expect(
      screen.getByRole('button', { name: strings.panel.expand }).getAttribute('aria-expanded'),
    ).toBe('false')
    expect(screen.queryByTestId('stat-step')).toBeNull()
    await user.click(screen.getByRole('button', { name: strings.panel.expand }))
    expect(screen.getByTestId('stat-step')).toBeTruthy()
  })
})
