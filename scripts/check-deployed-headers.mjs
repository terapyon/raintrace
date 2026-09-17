/**
 * デプロイした URL の応答を検査する（spec D §5.2）。依存なし（fetch のみ）。CI の deploy の 3 ジョブの最後に回す。
 * 使い方: node scripts/check-deployed-headers.mjs <URL> --noindex | --indexable
 *   --noindex: *.pages.dev（x-robots-tag: noindex を期待）、--indexable: 独自ドメイン（noindex が無いことを期待）
 * 反映の遅れに備え、5 秒おきに 6 回まで試す（レビュー m3: 環境変数で回数・間隔を変えられる。既定は変えない）。
 * 各 fetch には 15 秒のタイムアウトを付ける（最終レビュー m1: CHECK_DEPLOYED_HEADERS_TIMEOUT_MS で変えられる。既定は変えない）。
 * タイムアウトも失敗として数え、通常の再試行に乗る
 * / の応答ヘッダーをすべて出す（Pages の既定のヘッダーの記録）
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { evaluateDeployment, findAssetScript, MISSING_PATH } from './lib/deployedHeaders.mjs'

const DEFAULT_ATTEMPTS = 6
const DEFAULT_INTERVAL_MS = 5000
const DEFAULT_TIMEOUT_MS = 15000
const USAGE = '使い方: node scripts/check-deployed-headers.mjs <URL> --noindex | --indexable'

/**
 * 環境変数から正の整数を読む。無い・不正なら既定値（レビュー m3）
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveIntEnv(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < 1) {
    console.error(`${name} の値が正しくありません: ${raw}（正の整数を指定してください）`)
    process.exit(2)
  }
  return parsed
}

const ATTEMPTS = readPositiveIntEnv('CHECK_DEPLOYED_HEADERS_ATTEMPTS', DEFAULT_ATTEMPTS)
const INTERVAL_MS = readPositiveIntEnv('CHECK_DEPLOYED_HEADERS_INTERVAL_MS', DEFAULT_INTERVAL_MS)
const TIMEOUT_MS = readPositiveIntEnv('CHECK_DEPLOYED_HEADERS_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)

const [base, flag, ...rest] = process.argv.slice(2)
if (base === undefined || (flag !== '--noindex' && flag !== '--indexable') || rest.length > 0) {
  console.error(USAGE)
  process.exit(2)
}
const expected = { noindex: flag === '--noindex' }

/**
 * リダイレクトは追わない(予期しないリダイレクトを 200 でないとして検出する)
 * @param {string} path
 */
async function get(path) {
  const response = await fetch(new URL(path, base), {
    redirect: 'manual',
    headers: { 'cache-control': 'no-cache' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  }
}

let violations = []
let rootHeaders = {}
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    const root = await get('/')
    rootHeaders = root.headers
    const assetPath = findAssetScript(root.body)
    violations = evaluateDeployment(
      {
        root,
        asset: assetPath === undefined ? undefined : await get(assetPath),
        buildInfo: await get('/.vite/manifest.json'),
        fallback: await get(MISSING_PATH),
      },
      expected,
    )
  } catch (error) {
    violations = [`取得に失敗した: ${error instanceof Error ? error.message : error}`]
  }
  if (violations.length === 0) break
  console.log(`試行 ${attempt}/${ATTEMPTS}: 違反 ${violations.length} 件`)
  if (attempt < ATTEMPTS) await sleep(INTERVAL_MS)
}

console.log(`${base} の / の応答ヘッダー:`)
for (const [name, value] of Object.entries(rootHeaders).sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${name}: ${value}`)
}
if (violations.length > 0) {
  for (const message of violations) console.error(message)
  process.exit(1)
}
console.log(`OK: ${base}（${expected.noindex ? 'noindex' : '索引される'}）`)
