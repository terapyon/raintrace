// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../../state/persistedSettings'
import { createSettingsStore, type SettingsStore } from '../../state/settingsStore'
import { strings } from '../strings'
import { DisclaimerDialog, DisclaimerNotice, useDisclaimer } from './DisclaimerDialog'

afterEach(cleanup)

const NOW = new Date('2026-09-12T01:02:03.000Z')

/** App と同じつなぎ方（useDisclaimer）で、注意文とダイアログを出す */
function Harness({ settings }: { settings: SettingsStore }) {
  const disclaimer = useDisclaimer(settings, () => NOW)
  return (
    <>
      <DisclaimerNotice onShowFull={disclaimer.reopen} />
      <DisclaimerDialog
        open={disclaimer.open}
        acknowledged={disclaimer.acknowledged}
        onAcknowledge={disclaimer.acknowledge}
        onClose={disclaimer.close}
      />
    </>
  )
}

describe('免責表示（tech-spec §9.6）', () => {
  it('未了解なら初回に全文を出し、「了解しました」で日時を保存して閉じる', async () => {
    const settings = createSettingsStore(memoryStorage())
    render(<Harness settings={settings} />)
    const user = userEvent.setup()
    expect(screen.getByRole('dialog')).toBeTruthy()
    for (const line of strings.disclaimer.lines) expect(screen.getByText(line)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: strings.disclaimer.acknowledge }))
    expect(settings.getState().disclaimerAcknowledgedAt).toBe(NOW.toISOString())
    await expect.poll(() => screen.queryByRole('dialog')).toBeNull()
  })

  it('了解の前は Escape で onClose を呼ばない。了解の後に開き直したときは Escape で閉じる', async () => {
    // Harness では未了解のあいだ open が常に true なので、閉じないことは onClose の呼び出しで確かめる
    const onClose = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <DisclaimerDialog open acknowledged={false} onAcknowledge={vi.fn()} onClose={onClose} />,
    )
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    rerender(<DisclaimerDialog open acknowledged onAcknowledge={vi.fn()} onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('了解済みなら開かず、注意文は常に出す。リンクで全文を開き直し、「閉じる」で閉じる', async () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        ...DEFAULT_SETTINGS,
        disclaimerAcknowledgedAt: '2026-09-01T00:00:00.000Z',
      }),
    })
    const settings = createSettingsStore(storage)
    render(<Harness settings={settings} />)
    const user = userEvent.setup()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(strings.disclaimer.notice)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: strings.disclaimer.showFull }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: strings.disclaimer.close }))
    await expect.poll(() => screen.queryByRole('dialog')).toBeNull()
    // 開き直しても、了解の日時は変えない
    expect(settings.getState().disclaimerAcknowledgedAt).toBe('2026-09-01T00:00:00.000Z')
  })
})
