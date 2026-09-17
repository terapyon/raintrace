/** デプロイした URL の応答の判定（spec D §5.2）。E2E の smoke.spec.ts の 3 件と同じ内容を本物の応答で確かめる。I/O を持たない */

/**
 * @typedef {{ status: number, headers: Record<string, string>, body: string }} Fetched
 * headers の名前は小文字（fetch の Headers から Object.fromEntries で作る）
 */

/** 無いパスの例。SPA のフォールバックの確かめに使う */
export const MISSING_PATH = '/no-such-path'

/**
 * index.html が読む /assets/*.js の最初の script のパス
 * @param {string} html
 * @returns {string | undefined}
 */
export function findAssetScript(html) {
  return html.match(/<script\b[^>]*\ssrc="(\/assets\/[^"]+\.js)"/)?.[1]
}

/**
 * @param {{ root: Fetched, asset: Fetched | undefined, buildInfo: Fetched, fallback: Fetched }} responses
 *   root は /、asset は findAssetScript のパス、buildInfo は /.vite/manifest.json、fallback は MISSING_PATH
 * @param {{ noindex: boolean }} expected *.pages.dev なら noindex: true、独自ドメインなら false（R-D6）
 * @returns {string[]} 違反（空なら合格）
 */
export function evaluateDeployment(responses, expected) {
  const { root, asset, buildInfo, fallback } = responses
  const violations = []

  if (root.status !== 200) violations.push(`/ の status が ${root.status}（200 を期待）`)
  if (!(root.headers['content-security-policy'] ?? '').includes("default-src 'self'")) {
    violations.push("/ の content-security-policy に default-src 'self' が無い（_headers）")
  }
  if (root.headers['x-content-type-options'] !== 'nosniff') {
    violations.push('/ の x-content-type-options が nosniff でない（_headers）')
  }
  if ((root.headers['cache-control'] ?? '').includes('immutable')) {
    violations.push('/ の cache-control に immutable がある（index.html は毎回検証させる。RB-1）')
  }

  if (asset === undefined) {
    violations.push('index.html に /assets/*.js の script が見つからない')
  } else {
    const cacheControl = asset.headers['cache-control'] ?? ''
    if (
      asset.status !== 200 ||
      !cacheControl.includes('max-age=31536000') ||
      !cacheControl.includes('immutable')
    ) {
      violations.push(
        `/assets/*.js が長期キャッシュでない（status ${asset.status}、cache-control: ${cacheControl}。RB-1）`,
      )
    }
  }

  if (buildInfo.body.includes('"isEntry"')) {
    violations.push('/.vite/manifest.json がビルドの情報を配信している（R-D4）')
  }

  if (fallback.status !== 200 || fallback.body !== root.body) {
    violations.push(
      `${MISSING_PATH} が index.html を返さない（status ${fallback.status}。SPA のフォールバック。dist/404.html を疑う）`,
    )
  }

  const robots = root.headers['x-robots-tag'] ?? ''
  if (expected.noindex && !robots.includes('noindex')) {
    violations.push('/ の x-robots-tag に noindex が無い（*.pages.dev は索引させない。R-D6）')
  }
  if (!expected.noindex && robots.includes('noindex')) {
    violations.push(
      `/ に noindex が付いている（x-robots-tag: ${robots}。独自ドメインは索引させる。R-D6）`,
    )
  }

  return violations
}
