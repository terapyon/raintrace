import { existsSync, renameSync, rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

type ChunkModules = Record<string, string[]>

/** 出力のチャンクごとに、入ったモジュール（リポジトリからの相対パス）を集める */
function collectChunkModules(
  bundle: Record<string, { type: string; fileName: string; moduleIds?: readonly string[] }>,
): ChunkModules {
  const result: ChunkModules = {}
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk' || output.moduleIds === undefined) continue
    result[output.fileName] = output.moduleIds
      .filter((id) => !id.startsWith('\0'))
      .map((id) => relative(process.cwd(), id))
  }
  return result
}

// Worker のビルドはメインのビルドの途中で行われ、メインの generateBundle より先に終わる
const workerChunkModules: ChunkModules = {}

/**
 * メインと Worker の各チャンクに入ったモジュールを chunk-modules.json に書き出す（出力の後に build-info/ へ移る）。
 * scripts/check-bundle-size.mjs が、アプリ本体への外部パッケージの混入と、Worker との重複の報告に使う（spec 01 §4.9）
 */
function chunkModulesReport(): Plugin {
  return {
    name: 'raintrace:chunk-modules',
    apply: 'build',
    generateBundle(_options, bundle) {
      this.emitFile({
        type: 'asset',
        fileName: '.vite/chunk-modules.json',
        source: JSON.stringify(
          { main: collectChunkModules(bundle), workers: workerChunkModules },
          null,
          2,
        ),
      })
    },
  }
}

function workerChunkModulesCollector(): Plugin {
  return {
    name: 'raintrace:worker-chunk-modules',
    generateBundle(_options, bundle) {
      Object.assign(workerChunkModules, collectChunkModules(bundle))
    },
  }
}

/** ビルドの情報（Vite のマニフェストと chunk-modules.json）の置き場所。gitignore する */
const BUILD_INFO_DIR = 'build-info'

/**
 * 出力の後に dist/.vite/ を build-info/ へ移す（spec D §4.5、R-D4）。Cloudflare Pages の
 * wrangler pages deploy は dist の全ファイルを上げ、.assetsignore を読まないので、dist には配信するファイルだけを置く。
 * scripts/check-bundle-size.mjs と tests/perf/fps.perf.ts が build-info/ を読む。
 * Vite の Environment API では writeBundle が環境ごとに走りうるので、client の環境だけで動かす
 * （レビュー R1）。それ以外の環境（cloudflare() が作る worker の環境など）には .vite/ が無く、
 * this.error で壊れてしまうため
 */
function moveBuildInfoOutOfDist(): Plugin {
  let root = ''
  let outDir = ''
  return {
    name: 'raintrace:build-info',
    apply: 'build',
    applyToEnvironment: (env) => env.name === 'client',
    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        if (this.environment?.name !== 'client') return
        const from = resolve(outDir, '.vite')
        const to = resolve(root, BUILD_INFO_DIR)
        rmSync(to, { recursive: true, force: true })
        if (!existsSync(from)) {
          this.error(`${from} がありません（build.manifest と chunkModulesReport を確かめる）`)
        }
        renameSync(from, to)
      },
    },
  }
}

export default defineConfig(({ mode }) => ({
  // 計測用のフック（src/ui/perfHook.ts）は vite build --mode perf のときだけ入れる（spec 05 の計画で決めたこと 20）
  define: { __RAINTRACE_PERF__: JSON.stringify(mode === 'perf') },
  plugins: [react(), chunkModulesReport(), moveBuildInfoOutOfDist()],
  // Worker は { type: 'module' } で起動するので ES モジュールとして出力する
  worker: { format: 'es', plugins: () => [workerChunkModulesCollector()] },
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        // 地図系・UI 系・アプリ本体に分ける（spec 01 §4.9）。UI 系は react・react-dom・@mui・@emotion と、
        // それらが引き込む依存。node_modules 全体を捕まえると、05 で動的 import する Three.js なども
        // 初期ロードの ui チャンクに吸い込まれるので、一覧で明示する。漏れは scripts/check-bundle-size.mjs が検出する
        codeSplitting: {
          groups: [
            { name: 'map', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 20 },
            // three は水面のチャンク（src/renderer）から動的 import で読む。1 つのチャンクにまとめ、大きさを測れるようにする（spec 05 §3.8）
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
            {
              name: 'ui',
              test: /node_modules[\\/](react|react-dom|scheduler|@mui[\\/][^\\/]+|@emotion[\\/][^\\/]+|@babel[\\/]runtime|stylis|clsx|prop-types|react-is|react-transition-group|@popperjs[\\/]core|hoist-non-react-statics|dom-helpers|zustand)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
}))
