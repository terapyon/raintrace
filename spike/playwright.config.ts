import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// 04 の E2E が 4173 を使うので、スパイクは 4174（Global Constraints）
const port = 4174

export default defineConfig({
  testDir: './e2e',
  outputDir: './out/test-results',
  // 64 通りの視点を 1 つのテストで回すので長くとる
  timeout: 30 * 60_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: 'pnpm spike:build && pnpm spike:preview',
    // 既定ではこの設定のディレクトリで動くので、リポジトリの根にする
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 960, height: 600 },
        deviceScaleFactor: 1,
        // GPU の無い環境でも WebGL を SwiftShader で動かす（本番の playwright.config.ts と同じ）
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
})
