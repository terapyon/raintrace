import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.ts'],
      // tech-spec §11.5。対象のディレクトリができた spec で足す（src/state は 04）
      thresholds: {
        'src/simulation/**': { lines: 90 },
        'src/dem/**': { lines: 85 },
        'src/state/**': { lines: 80 },
      },
    },
  },
})
