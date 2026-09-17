/** dist/ に置いてはならないものの判定（spec D §4.4・§4.5）。I/O を持たない */

/**
 * wrangler pages deploy は dist の全ファイルを上げる（外すのは _headers・_redirects・_worker.js などだけ）。
 * .assetsignore も読まない。ここに挙げたものが dist の最上位にあれば pnpm size を失敗させる
 */
export const FORBIDDEN_DIST_ENTRIES = [
  {
    name: '.vite',
    reason: 'ビルドの情報は build-info/ に置く（vite.config.ts の moveBuildInfoOutOfDist、R-D4）',
  },
  { name: 'wrangler.json', reason: '@cloudflare/vite-plugin の出力。spec D で plugin を外した' },
  { name: '.assetsignore', reason: 'Workers の仕組みで、Pages は読まない' },
  {
    name: '404.html',
    reason: '最上位にあると Pages が SPA とみなさず、無いパスに index.html を返さなくなる',
  },
  {
    name: '_worker.js',
    reason: 'Pages Functions になり、_headers が効かなくなる（Functions は使わない）',
  },
]

/**
 * @param {string[]} names dist の最上位の名前（readdirSync('dist')）
 * @returns {string[]} 違反のメッセージ（空なら合格）
 */
export function forbiddenDistEntries(names) {
  return FORBIDDEN_DIST_ENTRIES.filter((entry) => names.includes(entry.name)).map(
    (entry) => `dist/${entry.name} があります: ${entry.reason}`,
  )
}
