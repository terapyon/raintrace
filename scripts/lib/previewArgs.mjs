/** pnpm preview（scripts/preview.mjs）の引数の読み取り（spec D §4.6）。I/O を持たない */

/** vite preview の既定と同じ。E2E（4173）と 06 の計測（4175）は明示する */
export const DEFAULT_PREVIEW_PORT = 4173

/**
 * wrangler pages dev には --strictPort が無い。包みは常に「使用中なら失敗」なので、受けて捨てる
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ port: number }}
 */
export function parsePreviewArgs(argv) {
  let port = DEFAULT_PREVIEW_PORT
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--strictPort') continue
    let value
    if (arg === '--port') {
      i++
      value = argv[i]
    } else if (arg.startsWith('--port=')) {
      value = arg.slice('--port='.length)
    } else {
      throw new Error(
        `pnpm preview が知らない引数です: ${arg}（使えるのは --port <番号> と --strictPort）`,
      )
    }
    const parsed = Number(value)
    if (value === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`--port の値が正しくありません: ${value}`)
    }
    port = parsed
  }
  return { port }
}
