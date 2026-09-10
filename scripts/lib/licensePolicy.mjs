/**
 * 依存のライセンスの判定（tech-spec §16.2、R01-1 の MIT に合わせる）。I/O を持たない。
 * GPL・AGPL・LGPL の系統を禁止する。SPDX の式は OR と AND だけを扱い、括弧の入れ子は平らにして読む
 */

const isCopyleft = (id) => /^(A|L)?GPL(-|\+|$)/i.test(id)

/**
 * @param {string} expression SPDX の式（例: "MIT"、"(MIT OR GPL-3.0)"、"MIT AND Apache-2.0"）
 * @returns {'ok' | 'forbidden' | 'unknown'}
 */
export function classifyLicense(expression) {
  const trimmed = expression.trim()
  if (trimmed === '' || /^(unknown|unlicensed|see license in)/i.test(trimmed)) return 'unknown'
  // OR はどれか1つを選べる。AND はすべてに従う必要がある
  const alternatives = trimmed.replace(/[()]/g, ' ').split(/\s+OR\s+/i)
  const allowed = alternatives.some((alternative) =>
    alternative
      .split(/\s+AND\s+/i)
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .every((part) => !isCopyleft(part)),
  )
  return allowed ? 'ok' : 'forbidden'
}

/**
 * @param {Record<string, { name: string, versions: string[] }[]>} report `pnpm licenses list --json` の出力
 */
export function evaluateLicenses(report) {
  const forbidden = []
  const unknown = []
  for (const [license, packages] of Object.entries(report)) {
    const verdict = classifyLicense(license)
    if (verdict === 'ok') continue
    const bucket = verdict === 'forbidden' ? forbidden : unknown
    for (const pkg of packages) bucket.push(`${pkg.name}@${pkg.versions.join(', ')} (${license})`)
  }
  return { forbidden, unknown }
}
