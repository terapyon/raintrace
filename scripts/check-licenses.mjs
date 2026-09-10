/** 本番の依存のライセンスを検査し、GPL 系が含まれていたら失敗する（tech-spec §16.2） */
import { execFileSync } from 'node:child_process'
import { evaluateLicenses } from './lib/licensePolicy.mjs'

// Windows では pnpm が pnpm.cmd なので、シェル経由で解決する
const output = execFileSync('pnpm', ['licenses', 'list', '--json', '--prod'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
const report = JSON.parse(output)
const { forbidden, unknown } = evaluateLicenses(report)

console.log(`ライセンスの種類: ${Object.keys(report).sort().join(', ')}`)
for (const label of unknown) console.warn(`警告: ライセンスを判定できません: ${label}`)
if (forbidden.length > 0) {
  for (const label of forbidden) console.error(`禁止されたライセンス: ${label}`)
  process.exit(1)
}
console.log('禁止されたライセンスはありません')
