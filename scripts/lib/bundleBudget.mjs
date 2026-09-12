/** バンドル予算の判定（tech-spec §14.2）。I/O を持たない */

export const BUDGET = { initialKb: 500, totalKb: 1200 }

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
  // エントリが無いまま空の集合を返すと、予算の検査が初期ロード 0KB で通ってしまう
  if (manifest[entryKey] === undefined) {
    throw new Error(`マニフェストにエントリ ${entryKey} がありません`)
  }
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
 * モジュール ID の一覧から、node_modules のパッケージ名を重複なく取り出す（出てきた順）
 * @param {string[]} moduleIds
 * @returns {string[]}
 */
export function packagesIn(moduleIds) {
  const names = new Set()
  for (const id of moduleIds) {
    const index = id.lastIndexOf('node_modules/')
    if (index === -1) continue
    const parts = id.slice(index + 'node_modules/'.length).split('/')
    names.add(parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0])
  }
  return [...names]
}

/**
 * Worker のチャンクとメインのチャンクで共通するモジュールを、組ごとに返す。
 * 1 回のビルドの中ではモジュールは 1 つのチャンクにしか入らないので、重複は別のビルドである Worker との間で起きる
 * @param {Record<string, string[]>} mainChunks メインのチャンク → モジュール ID
 * @param {Record<string, string[]>} workerChunks Worker のチャンク → モジュール ID
 * @returns {{ worker: string, main: string, modules: string[] }[]}
 */
export function sharedModules(mainChunks, workerChunks) {
  const result = []
  for (const [worker, workerIds] of Object.entries(workerChunks)) {
    const inWorker = new Set(workerIds)
    for (const [main, mainIds] of Object.entries(mainChunks)) {
      const modules = mainIds.filter((id) => inWorker.has(id))
      if (modules.length > 0) result.push({ worker, main, modules })
    }
  }
  return result
}
