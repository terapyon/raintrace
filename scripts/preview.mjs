/**
 * pnpm preview: 本番ビルド（dist/）を wrangler pages dev（Cloudflare Pages のローカルの実装、workerd）で配信する。
 * _headers と SPA の判定を配信先と同じ製品の規則で確かめるため（spec D §4.5、R-D3）。
 * Vite の --strictPort は wrangler pages dev に無いので、受けて捨て、ポートが使用中なら起動せずに失敗する（§4.6）。
 * 使い方: pnpm preview [--port <番号>] [--strictPort]
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { parsePreviewArgs } from './lib/previewArgs.mjs'

// 固定した wrangler（4.127.1）の workerd が対応する最新の日付（wrangler.jsonc から移した）。それより新しい日付では
// 起動しない。Functions を使わないので配信の規則には影響しない。wrangler を上げるときにあわせて進める
const COMPATIBILITY_DATE = '2026-09-04'

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
  child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
