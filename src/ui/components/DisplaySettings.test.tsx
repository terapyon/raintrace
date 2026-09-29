// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../state/appStore'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import { createSettingsStore } from '../../state/settingsStore'
import { strings } from '../strings'
import { DisplaySettings } from './DisplaySettings'

afterEach(cleanup)

describe('DisplaySettings の流出の表示（spec 07 §5.3）', () => {
  it('「流出しているセル」のスイッチは既定でオンで、切ると保存する設定に書く', async () => {
    const settings = createSettingsStore(memoryStorage())
    render(<DisplaySettings app={createAppStore()} settings={settings} />)
    const toggle = screen.getByLabelText(strings.panel.showOutflow) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    await userEvent.click(toggle)
    expect(settings.getState().display.showOutflowCells).toBe(false)
  })

  it('○ の凡例の隣に流出の凡例を出す', () => {
    render(
      <DisplaySettings app={createAppStore()} settings={createSettingsStore(memoryStorage())} />,
    )
    expect(screen.getByRole('img', { name: strings.legend.markersAria })).toBeTruthy()
    expect(screen.getByRole('img', { name: strings.legend.outflowAria })).toBeTruthy()
  })
})
