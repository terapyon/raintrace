import { describe, expect, it } from 'vitest'
import { duplicatedModules, evaluateBudget, initialFiles } from './bundleBudget.mjs'

const manifest = {
  'index.html': { file: 'assets/index-a.js', isEntry: true, imports: ['_ui-b.js', '_map-c.js'] },
  '_ui-b.js': { file: 'assets/ui-b.js' },
  '_map-c.js': { file: 'assets/map-c.js', imports: ['_ui-b.js'] },
  'src/lazy.ts': { file: 'assets/lazy-d.js', isDynamicEntry: true, imports: ['_ui-b.js'] },
  'src/workers/simulation.worker.ts': { file: 'assets/simulation-e.js', isEntry: true },
}

describe('initialFiles', () => {
  it('index.html のエントリと、そこから静的に import されるチャンクを集める（Worker のエントリは数えない）', () => {
    expect([...initialFiles(manifest)].sort()).toEqual([
      'assets/index-a.js',
      'assets/map-c.js',
      'assets/ui-b.js',
    ])
  })
})

describe('evaluateBudget', () => {
  const files = [
    { file: 'assets/index-a.js', gzipBytes: 50_000 },
    { file: 'assets/ui-b.js', gzipBytes: 150_000 },
    { file: 'assets/map-c.js', gzipBytes: 170_000 },
    { file: 'assets/lazy-d.js', gzipBytes: 300_000 },
  ]
  const initial = initialFiles(manifest)

  it('予算内なら違反なし。大きい順に並べる', () => {
    const result = evaluateBudget(files, initial)
    expect(result.initialBytes).toBe(370_000)
    expect(result.totalBytes).toBe(670_000)
    expect(result.violations).toEqual([])
    expect(result.rows.map((r) => r.file)[0]).toBe('assets/lazy-d.js')
    expect(result.rows.find((r) => r.file === 'assets/lazy-d.js')?.initial).toBe(false)
  })

  it('初期ロードと総量のそれぞれの超過を報告する', () => {
    const result = evaluateBudget(files, initial, { initialKb: 300, totalKb: 600 })
    expect(result.violations).toHaveLength(2)
    expect(result.violations[0]).toContain('初期ロード')
    expect(result.violations[1]).toContain('総量')
  })
})

describe('duplicatedModules', () => {
  it('複数のチャンクに含まれるモジュールだけを返す', () => {
    expect(
      duplicatedModules({
        'assets/a.js': ['src/x.ts', 'src/y.ts'],
        'assets/b.js': ['src/y.ts'],
      }),
    ).toEqual([{ id: 'src/y.ts', chunks: ['assets/a.js', 'assets/b.js'] }])
  })
})
