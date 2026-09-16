import { describe, expect, it } from 'vitest'
import { parseAmountMm, parseRadiusM } from './validation'

describe('入力の検証（spec 04 §9、R04-6）', () => {
  it.each([
    ['1', 1],
    ['1000', 1000],
    [' 100 ', 100],
    ['0', null],
    ['1001', null],
    ['1.5', null],
    ['', null],
    ['abc', null],
    ['1e3', null],
    ['-5', null],
  ])('雨量 %j は %s', (text, expected) => {
    expect(parseAmountMm(text)).toBe(expected)
  })

  it.each([
    ['1', 500, 1],
    ['250', 500, 250],
    ['12.5', 500, 12.5],
    ['0.9', 500, null],
    ['250.5', 500, null],
    ['125', 250, 125],
    ['126', 250, null],
    ['500', 1000, 500],
    ['', 500, null],
    ['1e2', 500, null],
  ] as const)('半径 %j（範囲 %i m）は %s', (text, sizeM, expected) => {
    expect(parseRadiusM(text, sizeM)).toBe(expected)
  })
})
