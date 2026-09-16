// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { TerrainSummary } from '../../state/appStore'
import { DemInfoBadge } from './DemInfoBadge'

afterEach(cleanup)

const summary = (overrides: Partial<TerrainSummary> = {}): TerrainSummary => ({
  demLevel: 1,
  breakdown: { dem1a: 9 },
  cellSizeM: 0.98,
  invalidRatio: 0,
  elevationRange: null,
  depressionCount: 0,
  largestDepression: null,
  ...overrides,
})

describe('DemInfoBadge（jsdom と Testing Library が動くことの確かめ）', () => {
  it('使った DEM の名前を出す', () => {
    render(<DemInfoBadge summary={summary()} />)
    expect(screen.getByTestId('dem-badge').textContent).toBe('DEM1A')
  })

  it('DEM1A でなければ warning の色になる', () => {
    render(<DemInfoBadge summary={summary({ demLevel: 2, breakdown: { dem5a: 4 } })} />)
    expect(screen.getByTestId('dem-badge').className).toContain('MuiChip-colorWarning')
  })
})
