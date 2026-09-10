/** バンドル予算の判定（tech-spec §14.2）。I/O を持たない */

export const BUDGET = { initialKb: 400, totalKb: 1200 }

/** バイト数を KB（1000 バイト。Vite のビルドの表示に揃える）の文字列にする */
export const kb = (bytes) => (bytes / 1000).toFixed(1)

/**
 * 初期ロードのチャンク（index.html のエントリと、そこから静的に import されるチャンク）を求める。
 * Worker がマニフェストに isEntry で載っても初期ロードに数えないよう、起点は index.html だけにする
 * @param {Record<string, { file: string, isEntry?: boolean, imports?: string[] }>} manifest Vite のマニフェスト
 * @param {string} entryKey
 * @returns {Set<string>} dist からの相対パス
 */
export function initialFiles(manifest, entryKey = 'index.html') {
  const result = new Set()
  const visit = (key) => {
    const chunk = manifest[key]
    if (chunk === undefined || result.has(chunk.file)) return
    result.add(chunk.file)
    for (const imported of chunk.imports ?? []) visit(imported)
  }
  visit(entryKey)
  return result
}

/**
 * @param {{ file: string, gzipBytes: number }[]} files dist/assets の JS
 * @param {Set<string>} initial 初期ロードのファイル
 * @param {{ initialKb: number, totalKb: number }} budget
 */
export function evaluateBudget(files, initial, budget = BUDGET) {
  const rows = files
    .map((f) => ({ ...f, initial: initial.has(f.file) }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
  const initialBytes = rows.filter((r) => r.initial).reduce((sum, r) => sum + r.gzipBytes, 0)
  const totalBytes = rows.reduce((sum, r) => sum + r.gzipBytes, 0)
  const violations = []
  if (initialBytes > budget.initialKb * 1000) {
    violations.push(
      `初期ロード ${kb(initialBytes)} KB が上限 ${budget.initialKb} KB を超えています`,
    )
  }
  if (totalBytes > budget.totalKb * 1000) {
    violations.push(`総量 ${kb(totalBytes)} KB が上限 ${budget.totalKb} KB を超えています`)
  }
  return { rows, initialBytes, totalBytes, violations }
}

/**
 * 複数のチャンクに含まれるモジュールを返す
 * @param {Record<string, string[]>} chunkModules チャンクのファイル名 → モジュール ID の一覧
 */
export function duplicatedModules(chunkModules) {
  const owners = new Map()
  for (const [chunk, ids] of Object.entries(chunkModules)) {
    for (const id of ids) owners.set(id, [...(owners.get(id) ?? []), chunk])
  }
  return [...owners]
    .filter(([, chunks]) => chunks.length > 1)
    .map(([id, chunks]) => ({ id, chunks }))
}
