import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), cloudflare()],
  // Worker は { type: 'module' } で起動するので ES モジュールとして出力する
  worker: { format: 'es' },
  build: { manifest: true },
})
