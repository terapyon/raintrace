/**
 * dist の JS を gzip で集計し、バンドル予算（tech-spec §14.2）を超えたら失敗する。
 * あわせて、アプリ本体のチャンクに外部パッケージが混ざったら失敗し、Worker との重複を報告する
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { evaluateBudget, initialFiles, kb, packagesIn, sharedModules } from './lib/bundleBudget.mjs'

const dist = 'dist'
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'))
const files = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => {
    const file = `assets/${name}`
    return { file, gzipBytes: gzipSync(readFileSync(join(dist, file)), { level: 9 }).length }
  })

const result = evaluateBudget(files, initialFiles(manifest))
const violations = [...result.violations]

console.log('| チャンク | gzip (KB) | 初期ロード |')
console.log('|---|---:|:---:|')
for (const row of result.rows) {
  console.log(`| ${row.file} | ${kb(row.gzipBytes)} | ${row.initial ? '○' : ''} |`)
}
console.log(`\n初期ロード: ${kb(result.initialBytes)} KB / 総量: ${kb(result.totalBytes)} KB`)
console.log(
  '（Worker のチャンクは、起動時に読まれても初期ロードには数えない。spec 01 §4.9 の定義による）',
)

const reportPath = join(dist, '.vite/chunk-modules.json')
if (!existsSync(reportPath)) {
  violations.push(`${reportPath} がありません（vite.config.ts の chunkModulesReport を確かめる）`)
} else {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))

  // vite.config.ts の ui の一覧から漏れた外部パッケージは、アプリ本体のチャンクに落ちる
  const entryFile = manifest['index.html'].file
  const leaked = packagesIn(report.main[entryFile] ?? [])
  if (leaked.length > 0) {
    violations.push(
      `アプリ本体のチャンク（${entryFile}）に外部パッケージが入っています: ${leaked.join(', ')}。vite.config.ts の codeSplitting の一覧を見直してください`,
    )
  }

  const shared = sharedModules(report.main, report.workers)
  if (shared.length === 0) {
    console.log('Worker とメインで共通するモジュール: なし')
  } else {
    console.log('Worker とメインで共通するモジュール（それぞれに複製されて配信される）:')
    for (const { worker, main, modules } of shared) {
      console.log(`  ${worker} と ${main}: ${modules.length} 件`)
      for (const id of modules.slice(0, 5)) console.log(`    ${id}`)
      if (modules.length > 5) console.log(`    ほか ${modules.length - 5} 件`)
    }
  }
}

if (violations.length > 0) {
  for (const message of violations) console.error(message)
  process.exit(1)
}
