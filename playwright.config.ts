import { defineConfig, devices } from '@playwright/test'

const port = 4173

const chromium = {
  ...devices['Desktop Chrome'],
  // GPU の無い CI でも WebGL を SwiftShader で動かす
  launchOptions: { args: ['--enable-unsafe-swiftshader'] },
}

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${port}` },
  // 本番ビルドを wrangler pages dev（Cloudflare Pages のローカルの実装、workerd）で配信する（spec D）。
  // pnpm preview は scripts/preview.mjs で、--strictPort を受けて捨て、使用中のポートでは失敗する。ビルドは pnpm test:e2e が先に行う
  webServer: {
    command: `pnpm preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // 既存のサーバーは使い回さない。途中で終わった実行が残した古い preview（起動時のビルドの資産表を持つ）を
    // 黙って使うと、新しいビルドの JS が見つからず全件が失敗する。残っていればポートの使用中として明示的に失敗する
    reuseExistingServer: false,
    timeout: 60_000,
  },
  // R01-4: Chromium で全件、WebKit は @webkit タグのテストのみ。
  // 3D のテスト（@3d）は別のプロジェクトで 1 つずつ回す。GPU の無い CI では 3D を SwiftShader（CPU）で描くので、
  // 3D のテストが 2 つ重なると互いに数倍遅くなり、制限時間を超えた（2026-10-02 の main の CI〈PR #15 のマージ〉で、
  // view3d の降雨のテストが流出の帯の 3D のテストと重なって 60 秒を超えた）。2D のテストは今までどおり並行に回す
  projects: [
    {
      name: 'chromium',
      grepInvert: /@3d/,
      use: chromium,
    },
    {
      name: 'chromium-3d',
      grep: /@3d/,
      workers: 1,
      use: chromium,
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, grep: /@webkit/ },
  ],
})
