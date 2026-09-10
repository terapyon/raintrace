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

  it.each(['GPLv2', 'GNU GPL v3', 'AGPLv3', 'GNU LGPL', 'LGPL-2.1+'])(
    'SPDX の形でない copyleft の表記 %s も禁止',
    (expression) => {
      expect(classifyLicense(expression)).toBe('forbidden')
    },
  )

  it('OR で選べるなら、許容の側を選べるので許容', () => {
    expect(classifyLicense('(MIT OR GPL-3.0)')).toBe('ok')
    expect(classifyLicense('GPL-2.0 OR LGPL-3.0')).toBe('forbidden')
  })

  it('括弧と AND・OR の優先順位（括弧 > AND > OR）を守る', () => {
    expect(classifyLicense('GPL-3.0 AND (MIT OR Apache-2.0)')).toBe('forbidden')
    expect(classifyLicense('(MIT OR GPL-3.0) AND LGPL-2.1')).toBe('forbidden')
    expect(classifyLicense('MIT AND (GPL-3.0 OR Apache-2.0)')).toBe('ok')
    expect(classifyLicense('MIT OR GPL-3.0 AND Apache-2.0')).toBe('ok')
  })

  it('WITH の例外つきは、本体のライセンスで判定する', () => {
    expect(classifyLicense('GPL-2.0 WITH Classpath-exception-2.0')).toBe('forbidden')
    expect(classifyLicense('Apache-2.0 WITH LLVM-exception')).toBe('ok')
  })

  it.each(['Unknown', '', 'UNLICENSED', 'SEE LICENSE IN LICENSE.md', 'Custom-License-X'])(
    '%s は判定できない（警告にする）',
    (expression) => {
      expect(classifyLicense(expression)).toBe('unknown')
    },
  )

  it('許容の一覧に無いものは、AND なら判定できず、OR なら許容の側を選べる', () => {
    expect(classifyLicense('MIT AND Custom-License-X')).toBe('unknown')
    expect(classifyLicense('MIT OR Custom-License-X')).toBe('ok')
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
