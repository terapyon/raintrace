// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { strings } from '../strings'
import { DepressionLegend } from './DepressionLegend'
import { MarkerLegend } from './MarkerLegend'
import { WaterLegend } from './WaterLegend'

afterEach(cleanup)

describe('凡例', () => {
  it('水深の凡例は、読み上げの説明と配色の種類を持つ', () => {
    render(<WaterLegend palette="stepped" />)
    expect(screen.getByRole('img', { name: strings.legend.waterAria })).toBeTruthy()
    expect(screen.getByText(strings.legend.waterStepped, { exact: false })).toBeTruthy()
    expect(screen.getByText(strings.legend.waterMax)).toBeTruthy()
  })

  it('窪地の凡例は、読み上げの説明を持つ', () => {
    render(<DepressionLegend />)
    expect(screen.getByRole('img', { name: strings.legend.depressionAria })).toBeTruthy()
  })

  it('○ の凡例は、最低点とあふれ出し点を地図と同じ色（map/overlayColors.ts）で出す（spec 07 §3.6）', () => {
    render(<MarkerLegend />)
    expect(screen.getByRole('img', { name: strings.legend.markersAria })).toBeTruthy()
    expect(screen.getByText(strings.markerInfo.lowest.title)).toBeTruthy()
    expect(screen.getByText(strings.markerInfo.spill.title)).toBeTruthy()
    expect(screen.getByTestId('marker-legend-lowest').style.backgroundColor).toBe(
      'rgb(21, 101, 192)',
    )
    expect(screen.getByTestId('marker-legend-spill').style.backgroundColor).toBe('rgb(239, 108, 0)')
  })

  it('水深の凡例の下に、1 cm 未満は表示しないことの注記を出す（spec 07 §4.2）', () => {
    render(<WaterLegend palette="stepped" />)
    expect(screen.getByTestId('water-legend-note').textContent).toBe(strings.legend.waterThinNote)
  })
})
