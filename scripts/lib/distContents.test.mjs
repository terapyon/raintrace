import { describe, expect, it } from 'vitest'
import { FORBIDDEN_DIST_ENTRIES, forbiddenDistEntries } from './distContents.mjs'

describe('forbiddenDistEntries', () => {
  it('配信するファイルだけなら空', () => {
    expect(forbiddenDistEntries(['_headers', 'assets', 'index.html'])).toEqual([])
  })

  it('置いてはならないものを 1 つずつ、名前と理由を添えて報告する', () => {
    const names = FORBIDDEN_DIST_ENTRIES.map((entry) => entry.name)
    expect(names).toEqual(['.vite', 'wrangler.json', '.assetsignore', '404.html', '_worker.js'])
    const messages = forbiddenDistEntries(['index.html', ...names])
    expect(messages).toHaveLength(names.length)
    for (const [i, name] of names.entries()) {
      expect(messages[i]).toContain(`dist/${name}`)
    }
  })
})
