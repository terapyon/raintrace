import { relative } from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * メインスレッドの各チャンクに入ったモジュールを dist/.vite/chunk-modules.json に書き出す。
 * scripts/check-bundle-size.mjs が、チャンクの間の重複を報告するのに使う（spec 01 §4.9）
 */
function chunkModulesReport(): Plugin {
  return {
    name: 'raintrace:chunk-modules',
    apply: 'build',
    generateBundle(_options, bundle) {
      const report: Record<string, string[]> = {}
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        report[output.fileName] = output.moduleIds
          .filter((id) => !id.startsWith('\0'))
          .map((id) => relative(process.cwd(), id))
      }
      this.emitFile({
        type: 'asset',
        fileName: '.vite/chunk-modules.json',
        source: JSON.stringify(report, null, 2),
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), cloudflare(), chunkModulesReport()],
  // Worker は { type: 'module' } で起動するので ES モジュールとして出力する
  worker: { format: 'es' },
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        // 地図系・UI 系・アプリ本体に分ける（spec 01 §4.9）。UI 系は react・react-dom・@mui・@emotion と、
        // それらが引き込む依存。node_modules 全体を捕まえると、05 で動的 import する Three.js なども
        // 初期ロードの ui チャンクに吸い込まれるので、一覧で明示する
        codeSplitting: {
          groups: [
            { name: 'map', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 20 },
            {
              name: 'ui',
              test: /node_modules[\\/](react|react-dom|scheduler|@mui[\\/][^\\/]+|@emotion[\\/][^\\/]+|@babel[\\/]runtime|stylis|clsx|prop-types|react-is|react-transition-group|@popperjs[\\/]core|hoist-non-react-statics|dom-helpers)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
