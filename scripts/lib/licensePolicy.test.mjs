import { describe, expect, it } from 'vitest'
import { classifyLicense, evaluateLicenses } from './licensePolicy.mjs'

describe('classifyLicense', () => {
  it.each(['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', '0BSD', 'MIT AND Apache-2.0'])(
    '%s は許容',
    (expression) => {
      expect(classifyLicense(expression)).toBe('ok')
    },
  )

  it.each([
    'GPL-3.0',
    'GPL-2.0-or-later',
    'LGPL-2.1',
    'AGPL-3.0-only',
    'GPL-2.0+',
    'MIT AND GPL-3.0',
  ])('%s は禁止', (expression) => {
    expect(classifyLicense(expression)).toBe('forbidden')
  })

  it('OR で選べるなら、許容の側を選べるので許容', () => {
    expect(classifyLicense('(MIT OR GPL-3.0)')).toBe('ok')
    expect(classifyLicense('GPL-2.0 OR LGPL-3.0')).toBe('forbidden')
  })

  it.each(['Unknown', '', 'UNLICENSED', 'SEE LICENSE IN LICENSE.md'])('%s は判定できない', (e) => {
    expect(classifyLicense(e)).toBe('unknown')
  })
})

describe('evaluateLicenses', () => {
  it('pnpm licenses list --json の形から、禁止と判定できないものを集める', () => {
    const report = {
      MIT: [{ name: 'a', versions: ['1.0.0'] }],
      'GPL-3.0': [{ name: 'b', versions: ['2.0.0', '2.1.0'] }],
      Unknown: [{ name: 'c', versions: ['0.1.0'] }],
    }
    expect(evaluateLicenses(report)).toEqual({
      forbidden: ['b@2.0.0, 2.1.0 (GPL-3.0)'],
      unknown: ['c@0.1.0 (Unknown)'],
    })
  })
})
