// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strings } from '../strings'
import { CellInfoPopover } from './CellInfoPopover'

afterEach(cleanup)

const position = { lon: 139.7, lat: 35.6, x: 100, y: 100 }

describe('CellInfoPopover（spec 04 §4）', () => {
  it('標高・水深・水位を 0.01m 単位で出し、「ここを降雨中心にする」で確定する', async () => {
    const onConfirm = vi.fn()
    render(
      <CellInfoPopover
        popover={{ kind: 'cell', ...position }}
        cell={{ kind: 'value', elevationM: 12.434, depthM: 0.366, levelM: 12.8 }}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('cell-elevation').textContent).toBe('12.43 m')
    expect(screen.getByTestId('cell-depth').textContent).toBe('0.37 m')
    expect(screen.getByTestId('cell-level').textContent).toBe('12.80 m')
    await userEvent.click(screen.getByRole('button', { name: strings.cellInfo.useAsCenter }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('無効セルなら「標高データなし」', () => {
    render(
      <CellInfoPopover
        popover={{ kind: 'cell', ...position }}
        cell={{ kind: 'no-data' }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(strings.cellInfo.noData)).toBeTruthy()
  })

  it('範囲の外なら「ここを新しい地点にする」だけ', () => {
    render(
      <CellInfoPopover
        popover={{ kind: 'outside', ...position }}
        cell={null}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: strings.cellInfo.newPoint })).toBeTruthy()
    expect(screen.queryByTestId('cell-elevation')).toBeNull()
  })

  it('閉じているときは何も出さない', () => {
    render(
      <CellInfoPopover
        popover={{ kind: 'closed' }}
        cell={null}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('背景（Backdrop）を持たず、画面のスクロールも止めない（開いている間も地図のクリックを塞がない）', () => {
    render(
      <CellInfoPopover
        popover={{ kind: 'cell', ...position }}
        cell={{ kind: 'no-data' }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(document.querySelector('.MuiBackdrop-root')).toBeNull()
    expect(document.body.style.overflow).not.toBe('hidden')
  })

  it('「閉じる」で閉じる（背景のクリックで閉じる経路が無いので、マウスで閉じる手段）', async () => {
    const onClose = vi.fn()
    render(
      <CellInfoPopover
        popover={{ kind: 'outside', ...position }}
        cell={null}
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: strings.cellInfo.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
