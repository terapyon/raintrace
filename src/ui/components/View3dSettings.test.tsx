// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../state/appStore'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import { createSettingsStore } from '../../state/settingsStore'
import { strings } from '../strings'
import { View3dSettings } from './View3dSettings'

afterEach(cleanup)

function setup() {
  const app = createAppStore()
  const settings = createSettingsStore(memoryStorage())
  render(<View3dSettings app={app} settings={settings} />)
  return { app, settings, user: userEvent.setup() }
}

describe('View3dSettings（spec 05 §3.2・§3.6）', () => {
  it('3D を押すと表示の方式が 3D になる。垂直強調は 3D のときだけ選べ、設定に書く', async () => {
    const { app, settings, user } = setup()
    const tenX = (): HTMLButtonElement =>
      screen.getByRole('button', { name: strings.view3d.exaggerationValue(10) })
    expect(tenX().disabled).toBe(true)
    await user.click(screen.getByRole('button', { name: strings.view3d.view3d }))
    expect(app.getState().viewMode).toBe('3d')
    await user.click(tenX())
    expect(settings.getState().display.verticalExaggeration).toBe(10)
    await user.click(screen.getByRole('button', { name: strings.view3d.view2d }))
    expect(app.getState().viewMode).toBe('2d')
  })

  it('3D の準備中と失敗を知らせる', () => {
    const { app } = setup()
    act(() => {
      app.getState().setViewMode('3d')
      app.getState().setView3dStatus('loading')
    })
    expect(screen.getByTestId('view3d-loading').textContent).toBe(strings.view3d.loading)
    act(() => app.getState().setView3dStatus('error'))
    expect(screen.getByTestId('view3d-error').textContent).toContain(strings.view3d.error)
  })
})
