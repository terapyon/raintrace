/**
 * スパイクのビルド（dist-spike）で、候補ごとに読み込まれる JS の gzip の合計を求める（spec S §3 の「バンドル」）。
 * 候補の分 = 候補のモジュールから静的な import をたどったチャンクのうち、ページの入口（index.html）が読むもの以外
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { initialFiles, kb } from '../../scripts/lib/bundleBudget.mjs'

const dist = 'dist-spike'
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'))
const gzip = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length
const entry = initialFiles(manifest, 'index.html')
const threeFiles = [...new Set(Object.values(manifest).map((chunk) => chunk.file))].filter((file) =>
  /(^|\/)three-[^/]+\.js$/.test(file),
)
const candidates = [
  ["A・A'", 'src/candidates/a.ts'],
  ['B', 'src/candidates/b.ts'],
  ['B-raw', 'src/candidates/braw.ts'],
]

console.log('| 候補 | チャンク | gzip (KB) | three を含む |')
console.log('|---|---|---:|:---:|')
const sizes = {}
for (const [name, key] of candidates) {
  const files = [...initialFiles(manifest, key)].filter((file) => !entry.has(file))
  const bytes = files.reduce((sum, file) => sum + gzip(file), 0)
  sizes[name] = bytes
  const hasThree = files.some((file) => threeFiles.includes(file))
  console.log(`| ${name} | ${files.join('<br>')} | ${kb(bytes)} | ${hasThree ? '○' : ''} |`)
}
const entryBytes = [...entry].reduce((sum, file) => sum + gzip(file), 0)
console.log(`\nページの入口（地図を含み、全候補で共通）: ${kb(entryBytes)} KB`)
console.log(
  `three のチャンク: ${threeFiles.map((file) => `${file} ${kb(gzip(file))} KB`).join('、') || 'なし'}`,
)
console.log(`B − B-raw: ${kb(sizes.B - sizes['B-raw'])} KB`)
