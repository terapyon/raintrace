// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../state/appStore'
import { strings } from '../strings'
import { ViewModeToggle } from './ViewModeToggle'

afterEach(cleanup)

describe('ViewModeToggle（地図の上の 2D・3D の切り替え）', () => {
  it('3D・2D を押すと表示の方式が切り替わる。選ばれている方が押された状態になる', async () => {
    const app = createAppStore()
    const user = userEvent.setup()
    render(<ViewModeToggle app={app} />)
    const button = (name: string): HTMLElement => screen.getByRole('button', { name })
    expect(button(strings.view3d.view2d).getAttribute('aria-pressed')).toBe('true')
    await user.click(button(strings.view3d.view3d))
    expect(app.getState().viewMode).toBe('3d')
    expect(button(strings.view3d.view3d).getAttribute('aria-pressed')).toBe('true')
    // 選ばれている方をもう一度押しても外れない
    await user.click(button(strings.view3d.view3d))
    expect(app.getState().viewMode).toBe('3d')
    await user.click(button(strings.view3d.view2d))
    expect(app.getState().viewMode).toBe('2d')
  })

  it('ストアの表示の方式が変われば、ボタンの状態も変わる', () => {
    const app = createAppStore()
    render(<ViewModeToggle app={app} />)
    act(() => app.getState().setViewMode('3d'))
    const view3d = screen.getByRole('button', { name: strings.view3d.view3d })
    expect(view3d.getAttribute('aria-pressed')).toBe('true')
  })
})
