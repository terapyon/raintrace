// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { strings } from '../strings'
import { DepressionLegend } from './DepressionLegend'
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
})
