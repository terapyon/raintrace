import { defineConfig, devices } from '@playwright/test'

// fps の測り直し（spec 05 §4.4）と撮影（Task 13）。E2E（4173）とは別に回す。ビルドは pnpm build:perf が先に行う
const port = 4175

export default defineConfig({
  testDir: 'tests/perf',
  testMatch: /\.perf\.ts$/,
  timeout: 90 * 60_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'gpu',
      use: {
        ...devices['Desktop Chrome'],
        // 実 GPU の headless Chrome（04 の 1000 m の検査・S の fps-gpu と同じ起動設定）。地理院には実際に接続する
        // （本番のタイルの経路）。画面の大きさは各テストが新しい context に渡す（S と同じ 960 × 600）
        channel: 'chrome',
        launchOptions: {
          args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl'],
        },
      },
    },
  ],
})
