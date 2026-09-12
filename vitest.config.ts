import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // UI のテスト（.test.tsx）は、ファイルの先頭の `// @vitest-environment jsdom` で jsdom を選ぶ（既定は node）
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.test-support.ts'],
      // tech-spec §11.5。対象のディレクトリができた spec で足す（src/state は 04）
      thresholds: {
        'src/simulation/**': { lines: 90 },
        'src/dem/**': { lines: 85 },
        'src/state/**': { lines: 80 },
      },
    },
  },
})
