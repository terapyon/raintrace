// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../state/appStore'
import { strings } from '../strings'
import { TerrainEpochToggle } from './TerrainEpochToggle'

afterEach(cleanup)

const summary = { offsetM: 0.1, candidates: [], a54Available: true, landformAvailable: true }

function readyStore() {
  const app = createAppStore()
  app.getState().setFillHistoryEnabled(true)
  app.getState().setFillHistoryResult('ready', summary)
  return app
}

describe('TerrainEpochToggle（3D の昔・今の切り替え）', () => {
  it('3D かつ ready のときだけ出る', () => {
    const app = readyStore()
    render(<TerrainEpochToggle app={app} />)
    // 2D では出ない
    expect(screen.queryByRole('group', { name: strings.epoch.label })).toBeNull()
    act(() => app.getState().setViewMode('3d'))
    expect(screen.getByRole('group', { name: strings.epoch.label })).toBeTruthy()
    // ready でなくなれば消える
    act(() => app.getState().setFillHistoryEnabled(false))
    expect(screen.queryByRole('group', { name: strings.epoch.label })).toBeNull()
  })

  it('昔・今を押すと terrainEpoch が変わる', async () => {
    const app = readyStore()
    app.getState().setViewMode('3d')
    const user = userEvent.setup()
    render(<TerrainEpochToggle app={app} />)
    await user.click(screen.getByRole('button', { name: strings.epoch.past }))
    expect(app.getState().terrainEpoch).toBe('past')
    await user.click(screen.getByRole('button', { name: strings.epoch.now }))
    expect(app.getState().terrainEpoch).toBe('now')
  })
})
