/**
 * pnpm preview: 本番ビルド（dist/）を wrangler pages dev（Cloudflare Pages のローカルの実装、workerd）で配信する。
 * _headers と SPA の判定を配信先と同じ製品の規則で確かめるため（spec D §4.5、R-D3）。
 * Vite の --strictPort は wrangler pages dev に無いので、受けて捨て、ポートが使用中なら起動せずに失敗する（§4.6）。
 * 使い方: pnpm preview [--port <番号>] [--strictPort]
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, statSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePreviewArgs } from './lib/previewArgs.mjs'

// 固定した wrangler（4.127.1）の workerd が対応する最新の日付（wrangler.jsonc から移した）。それより新しい日付では
// 起動しない。Functions を使わないので配信の規則には影響しない。wrangler を上げるときにあわせて進める
const COMPATIBILITY_DATE = '2026-09-04'

// wrangler（node_modules/wrangler/wrangler-dist/cli.js の findRedirectedWranglerConfig・file()）は
// cwd からファイルシステムの root まで親をたどってこのファイルを探し、見つかれば「その設定を使う」。
// @cloudflare/vite-plugin が dev・build のたびに書いていたもので、plugin を外した今はこのリポジトリの
// 中では作られない。このワークツリーは本体のチェックアウトの中（.claude/worktrees/...）にあるので、
// 本体（06 branch、plugin をまだ使う）の残りを拾ってしまうことがある。pages dev は --config を
// 受け付けない（明示的に拒否される）ので、避ける公式な手段が無い（spec D レビュー、fix round 1）
const DEPLOY_CONFIG_RELATIVE_PATH = '.wrangler/deploy/config.json'

/**
 * wrangler と同じ探し方（cwd から親へ、見つかるかファイルシステムの root に着くまで）で
 * .wrangler/deploy/config.json を探す
 * @param {string} startDir
 * @returns {string | undefined} 見つかった絶対パス
 */
function findDeployConfigUpward(startDir) {
  let dir = resolvePath(startDir)
  for (;;) {
    const candidate = join(dir, DEPLOY_CONFIG_RELATIVE_PATH)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

/**
 * このリポジトリ（git の worktree）の中に残っていれば削除する（plugin を外したので、もう作られない）。
 * 外にあれば触らず、止めて知らせる（他のブランチ・他のチェックアウトの正当な設定かもしれないため）。
 * 1 つ消した後も、さらに上に別のもの（本体のチェックアウトなど）が無いか続けて確かめる
 * （wrangler 自身は消した後も cwd から改めて上へ歩くので、リポジトリの中のものだけ消して
 * 「これで綺麗」と思い込むと、外のものを見落とす）
 */
function guardAgainstStaleDeployConfig() {
  const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim()
  const insideRepoPath = join(repoRoot, DEPLOY_CONFIG_RELATIVE_PATH)
  let searchFrom = process.cwd()
  for (;;) {
    const found = findDeployConfigUpward(searchFrom)
    if (found === undefined) return
    if (found === insideRepoPath) {
      unlinkSync(found)
      console.log(
        `古い ${found} を削除しました（@cloudflare/vite-plugin は外したので、もう作られません。spec D）`,
      )
      searchFrom = dirname(repoRoot)
      continue
    }
    throw new Error(
      `wrangler pages dev は ${found} を見つけ、そちらの設定を使おうとします（cwd から上へ探すため）。` +
        'このリポジトリの外のファイルなので、ここでは削除も無視もできません。そちらのチェックアウトで ' +
        'rm -rf .wrangler/deploy を実行してから、もう一度お試しください（pages dev は --config で読み先を ' +
        '指定できません）',
    )
  }
}

/**
 * 使用中のポートでは失敗する（古い preview が残っていると、新しいビルドを配信していると誤解しないように。
 * playwright.config.ts の reuseExistingServer: false と同じ意図）
 * @param {number} port
 */
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`ポート ${port} は使用中です。古い preview が残っていないか確かめてください`)
          : error,
      )
    })
    server.listen(port, () => server.close(() => resolve()))
  })
}

try {
  const { port } = parsePreviewArgs(process.argv.slice(2))
  await assertPortFree(port)
  guardAgainstStaleDeployConfig()
  const wrangler = fileURLToPath(
    new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
  )
  const child = spawn(
    process.execPath,
    [
      wrangler,
      'pages',
      'dev',
      'dist',
      '--port',
      String(port),
      '--compatibility-date',
      COMPATIBILITY_DATE,
      '--show-interactive-dev-session=false',
    ],
    { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
  )
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
  // wrangler が見つからない・起動できないと 'error' イベントになる（'exit' は起きない）。無ければ
  // Node の既定の挙動（スタックトレース付きの未処理例外）になり、一行のメッセージにならない
  child.on('error', (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
  child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
