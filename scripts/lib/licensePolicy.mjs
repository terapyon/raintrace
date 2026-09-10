/**
 * 依存のライセンスの判定（tech-spec §16.2、R01-1 の MIT に合わせる）。I/O を持たない。
 * copyleft（GPL・LGPL・AGPL の系統）は禁止、許容の一覧にあるものは許容、どちらでもないものは判定できない（警告）。
 * SPDX の式は、括弧・AND・OR・WITH を扱う（優先順位は 括弧 > AND > OR）
 */

// 実際に依存に現れる、MIT での配布と両立するライセンス。新しいものが出たら確かめて足す
const PERMISSIVE = new Set(
  [
    '0BSD',
    'Apache-2.0',
    'BlueOak-1.0.0',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'CC-BY-4.0',
    'CC0-1.0',
    'ISC',
    'MIT',
    'MPL-2.0',
    'Python-2.0',
    'Unlicense',
    'Zlib',
  ].map((id) => id.toLowerCase()),
)

// SPDX の形（GPL-3.0）に加えて、古い表記（GPLv2、GNU GPL v3、GNU Lesser …）も捕まえる
const COPYLEFT = /(^|[^a-z])(a|l)?gpl|gnu (general|lesser|library|affero)/i

const RANK = { ok: 0, unknown: 1, forbidden: 2 }
const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b)
const better = (a, b) => (RANK[a] <= RANK[b] ? a : b)

/** @returns {'ok' | 'forbidden' | 'unknown'} */
function classifyId(id) {
  if (COPYLEFT.test(id)) return 'forbidden'
  return PERMISSIVE.has(id.toLowerCase()) ? 'ok' : 'unknown'
}

/** SPDX の式を評価する。式として読めなければ例外を投げる */
function evaluateExpression(tokens) {
  let pos = 0
  const peekKeyword = () => tokens[pos]?.toUpperCase()
  // OR はどれか1つを選べるので、良い方を取る
  const orExpression = () => {
    let verdict = andExpression()
    while (peekKeyword() === 'OR') {
      pos++
      verdict = better(verdict, andExpression())
    }
    return verdict
  }
  // AND はすべてに従うので、悪い方を取る
  const andExpression = () => {
    let verdict = operand()
    while (peekKeyword() === 'AND') {
      pos++
      verdict = worse(verdict, operand())
    }
    return verdict
  }
  const operand = () => {
    const token = tokens[pos++]
    if (token === undefined) throw new Error('式が途中で終わっています')
    if (token === '(') {
      const verdict = orExpression()
      if (tokens[pos++] !== ')') throw new Error('括弧が閉じていません')
      return verdict
    }
    if (token === ')' || /^(and|or|with)$/i.test(token)) throw new Error(`予期しない ${token}`)
    // 「X WITH 例外」は本体の X で判定する
    if (peekKeyword() === 'WITH') {
      pos++
      if (tokens[pos++] === undefined) throw new Error('WITH の後に例外がありません')
    }
    return classifyId(token)
  }
  const verdict = orExpression()
  if (pos !== tokens.length) throw new Error('式の後に余分な語があります')
  return verdict
}

/**
 * @param {string} expression ライセンスの表記（SPDX の式、または "GNU GPL v3" のような自由な表記）
 * @returns {'ok' | 'forbidden' | 'unknown'}
 */
export function classifyLicense(expression) {
  const trimmed = expression.trim()
  if (trimmed === '') return 'unknown'
  try {
    return evaluateExpression(trimmed.match(/\(|\)|[^\s()]+/g) ?? [])
  } catch {
    // SPDX の式として読めない自由な表記は、全体を1つのライセンス名として判定する
    return classifyId(trimmed)
  }
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
