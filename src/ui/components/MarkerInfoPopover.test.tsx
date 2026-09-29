// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Popover } from '../../state/clickState'
import type { MarkerInfoRow } from '../markerInfo'
import { strings } from '../strings'
import { MarkerInfoPopover } from './MarkerInfoPopover'

afterEach(cleanup)

const position = { lon: 139.7, lat: 35.6, x: 100, y: 100 }
const marker: Popover = {
  kind: 'marker',
  markers: [{ marker: 'lowest' }, { marker: 'spill', depressionId: 2 }],
  ...position,
}
const lowest: MarkerInfoRow = { marker: 'lowest', elevationM: 12.345 }
const spill: MarkerInfoRow = {
  marker: 'spill',
  depressionId: 2,
  spillElevationM: 13.5,
  maxDepthM: 0.426,
  capacityM3: 31.44,
  areaM2: 82.4,
}

describe('MarkerInfoPopover（spec 07 §3.4）', () => {
  it('最低点: 見出し・説明・標高を出す', () => {
    render(<MarkerInfoPopover popover={marker} rows={[lowest]} onClose={vi.fn()} />)
    const row = screen.getByTestId('marker-info-lowest')
    expect(within(row).getByText(strings.markerInfo.lowest.title)).toBeTruthy()
    expect(within(row).getByText(strings.markerInfo.lowest.body)).toBeTruthy()
    expect(within(row).getByTestId('marker-elevation').textContent).toBe('12.35 m')
  })

  it('あふれ出し点: 見出し・説明と 4 つの数値を既存の書式で出す', () => {
    render(<MarkerInfoPopover popover={marker} rows={[spill]} onClose={vi.fn()} />)
    const row = screen.getByTestId('marker-info-spill')
    expect(within(row).getByText(strings.markerInfo.spill.title)).toBeTruthy()
    expect(within(row).getByText(strings.markerInfo.spill.body)).toBeTruthy()
    expect(within(row).getByTestId('marker-spill-elevation').textContent).toBe('13.50 m')
    expect(within(row).getByTestId('marker-max-depth').textContent).toBe('0.43 m')
    expect(within(row).getByTestId('marker-capacity').textContent).toBe('31.4 m³')
    expect(within(row).getByTestId('marker-area').textContent).toBe('82 m²')
  })

  it('重なった印は、最低点を先に縦に並べる（R07-4）。「閉じる」で閉じる', async () => {
    const onClose = vi.fn()
    render(<MarkerInfoPopover popover={marker} rows={[lowest, spill]} onClose={onClose} />)
    const rows = screen.getAllByTestId(/^marker-info-(lowest|spill)$/)
    expect(rows.map((r) => r.dataset.testid)).toEqual(['marker-info-lowest', 'marker-info-spill'])
    await userEvent.click(screen.getByRole('button', { name: strings.markerInfo.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('「ここを降雨中心にする」は出さない（spec 07 §3.2）', () => {
    render(<MarkerInfoPopover popover={marker} rows={[lowest]} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: strings.cellInfo.useAsCenter })).toBeNull()
  })

  it('印の説明でないとき・行が無いときは開かない（Review Focus 3）', () => {
    render(
      <MarkerInfoPopover popover={{ kind: 'cell', ...position }} rows={[]} onClose={vi.fn()} />,
    )
    expect(screen.queryByTestId('marker-info')).toBeNull()
    cleanup()
    render(<MarkerInfoPopover popover={marker} rows={[]} onClose={vi.fn()} />)
    expect(screen.queryByTestId('marker-info')).toBeNull()
  })
})
