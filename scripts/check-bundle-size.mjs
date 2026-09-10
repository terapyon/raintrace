/** dist の JS を gzip で集計し、バンドル予算（tech-spec §14.2）を超えたら失敗する */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { duplicatedModules, evaluateBudget, initialFiles, kb } from './lib/bundleBudget.mjs'

const dist = 'dist'
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'))
const files = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => {
    const file = `assets/${name}`
    return { file, gzipBytes: gzipSync(readFileSync(join(dist, file)), { level: 9 }).length }
  })

const result = evaluateBudget(files, initialFiles(manifest))

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
if (existsSync(reportPath)) {
  const duplicates = duplicatedModules(JSON.parse(readFileSync(reportPath, 'utf8')))
  if (duplicates.length === 0) {
    console.log('チャンクの間で重複したモジュール: なし')
  } else {
    console.log(`チャンクの間で重複したモジュール: ${duplicates.length} 件`)
    for (const { id, chunks } of duplicates) console.log(`  ${id}: ${chunks.join(', ')}`)
  }
}

if (result.violations.length > 0) {
  for (const message of result.violations) console.error(message)
  process.exit(1)
}
