import { describe, expect, it } from 'vitest'
import { evaluateBudget, initialFiles, packagesIn, sharedModules } from './bundleBudget.mjs'

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

  it('エントリがマニフェストに無ければ例外（予算の検査が初期ロード 0KB で空振りしないように）', () => {
    expect(() => initialFiles(manifest, 'missing.html')).toThrow('missing.html')
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

describe('packagesIn', () => {
  it('node_modules のモジュールからパッケージ名を重複なく取り出す（scoped のものを含む）', () => {
    expect(
      packagesIn([
        'src/main.tsx',
        'node_modules/.pnpm/react@19.2.8/node_modules/react/index.js',
        'node_modules/.pnpm/react@19.2.8/node_modules/react/cjs/react.production.js',
        'node_modules/.pnpm/@mui+material@9.4.0/node_modules/@mui/material/Box/Box.js',
      ]),
    ).toEqual(['react', '@mui/material'])
  })

  it('自作のモジュールだけなら空', () => {
    expect(packagesIn(['src/main.tsx', 'src/ui/App.tsx'])).toEqual([])
  })
})

describe('sharedModules', () => {
  it('Worker のチャンクとメインのチャンクで共通するモジュールを、組ごとに返す', () => {
    expect(
      sharedModules(
        { 'assets/map.js': ['a', 'b', 'c'], 'assets/index.js': ['x'] },
        { 'assets/worker.js': ['b', 'c', 'w'] },
      ),
    ).toEqual([{ worker: 'assets/worker.js', main: 'assets/map.js', modules: ['b', 'c'] }])
  })
})
