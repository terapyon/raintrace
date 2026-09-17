import { describe, expect, it } from 'vitest'
import { DEFAULT_PREVIEW_PORT, parsePreviewArgs } from './previewArgs.mjs'

describe('parsePreviewArgs', () => {
  it('引数が無ければ既定のポート 4173', () => {
    expect(DEFAULT_PREVIEW_PORT).toBe(4173)
    expect(parsePreviewArgs([])).toEqual({ port: 4173 })
  })

  it('--port <番号> と --strictPort（E2E と 06 の計測の webServer の形）を読む', () => {
    expect(parsePreviewArgs(['--port', '4175', '--strictPort'])).toEqual({ port: 4175 })
  })

  it('--port=<番号> の形も読む', () => {
    expect(parsePreviewArgs(['--strictPort', '--port=4190'])).toEqual({ port: 4190 })
  })

  it('知らない引数は例外（打ち間違いを黙って通さない）', () => {
    expect(() => parsePreviewArgs(['--host'])).toThrow('--host')
  })

  it('ポートの値が無い・数でない・範囲の外なら例外', () => {
    expect(() => parsePreviewArgs(['--port'])).toThrow('--port')
    expect(() => parsePreviewArgs(['--port', 'abc'])).toThrow('abc')
    expect(() => parsePreviewArgs(['--port', '0'])).toThrow('0')
    expect(() => parsePreviewArgs(['--port=70000'])).toThrow('70000')
  })
})
