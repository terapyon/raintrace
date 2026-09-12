import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// スパイク専用の設定（計画 D2）。本番の vite.config.ts・index.html は使わない
const root = fileURLToPath(new URL('.', import.meta.url))
const headersFile = readFileSync(
  fileURLToPath(new URL('../public/_headers', import.meta.url)),
  'utf8',
)
// 本番と同じ CSP を dev と preview の応答に付ける（tech-spec §7.7）。緩めない
const csp = /Content-Security-Policy:\s*(.+)/.exec(headersFile)?.[1]?.trim()
if (csp === undefined) throw new Error('public/_headers に Content-Security-Policy がありません')
const headers = { 'Content-Security-Policy': csp }

export default defineConfig({
  root,
  publicDir: false,
  // HMR の WebSocket は CSP の connect-src に当たりうるので切る（スパイクでは再読み込みで足りる）
  server: { headers, hmr: false },
  preview: { headers },
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('../dist-spike', import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    rolldownOptions: {
      output: {
        // three を 1 つのチャンクにまとめ、候補のチャンクとの差を測れるようにする（Task 9）
        codeSplitting: {
          groups: [
            { name: 'map', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 20 },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
})
