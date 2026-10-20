/**
 * 盛土の履歴を実際の地理院タイルで確かめる（spec 09 §3.6・§7.3）。Node 24 で直接実行する:
 *
 *   node scripts/fill-history-check.ts <lat> <lon> <sizeM> [--shift-past <m>] [--limit <N>]
 *
 * 取得と計算は scripts/lib/fillHistoryLoad.ts（アプリの Worker と同じ src/dem/fillHistory の関数）。
 * 使った DEM・ずれ・候補（面積・最大・体積・根拠）と、タイルの取得を除いた計算の時間を Markdown で出す。
 * 候補の一覧はアプリ（Worker）と同じ並び（根拠の強い順、同じなら体積の大きい順）で、
 * 「#」は候補の id（面積の大きい順）。--limit <N> で表示する件数を変える（既定 15）。
 * --shift-past は昔の標高を東へ <m> ずらす（位置のずれの記録用）。合否は判定しない
 */
import { pixelToLonLat } from '../src/dem/tileMath.ts'
import { inAppOrder, loadFillHistory } from './lib/fillHistoryLoad.ts'

const args = process.argv.slice(2)
const shiftIdx = args.indexOf('--shift-past')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 15
const shiftM = shiftIdx >= 0 ? Number(args[shiftIdx + 1]) : 0
// 位置引数だけ残す（後ろの添字から消すので、順序によらず添字がずれない）
for (const idx of [limitIdx, shiftIdx].filter((i) => i >= 0).sort((a, b) => b - a))
  args.splice(idx, 2)
const [lat, lon, sizeM] = args.map(Number) as [number, number, number]
if (![lat, lon, sizeM].every(Number.isFinite) || !Number.isFinite(shiftM) || !(limit >= 0)) {
  console.error(
    '使い方: node scripts/fill-history-check.ts <lat> <lon> <sizeM> [--shift-past <m>] [--limit <N>]',
  )
  process.exit(1)
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US')

const result = await loadFillHistory(lat, lon, sizeM, shiftM)
const { selection, current, frame } = result
const { range, tier } = selection

console.log(`## ${lat}, ${lon} / ${sizeM} m${shiftM ? ` / 昔を東へ ${shiftM} m ずらす` : ''}`)
console.log('')
console.log(
  `- 今の DEM: 段 ${tier.level}（z${range.z}）、内訳 ${JSON.stringify(selection.breakdown)}`,
)
console.log(
  `- 格子: ${range.size} x ${range.size} セル（セル ${range.cellSizeM.toFixed(3)} m）、無効 ${(current.invalidRatio * 100).toFixed(1)}%`,
)
if (result.status === 'tier3') {
  console.log('- 段 3（DEM10B）のため、昔と比べられない（機能は unavailable）')
  process.exit(0)
}
if (result.status === 'no-overlap') {
  console.log('- 昔と今の両方に標高があるセルが無い（no-overlap）')
  process.exit(0)
}
const { candidates, evidence, timesMs: t } = result

console.log(`- ずれの補正値（今 − 昔の中央値）: ${result.offsetM.toFixed(2)} m`)
console.log(
  `- A54: ${result.a54Count} ポリゴン、人工地形（盛土地）: ${result.landformCount !== null ? `${result.landformCount} ポリゴン` : '取得できず（全タイル 404）'}`,
)
console.log(
  `- 時間: タイル・データ取得 ${(result.networkMs / 1000).toFixed(2)} s / 計算 合計 ${t.total.toFixed(0)} ms（補間 ${t.resample.toFixed(0)}、ずれの補正 ${t.delta.toFixed(0)}、候補抽出 ${t.find.toFixed(0)}、根拠 ${t.evidence.toFixed(0)}）`,
)
console.log(
  `- 候補 ${candidates.length} 件、面積の合計 ${fmtInt(candidates.reduce((s, c) => s + c.areaM2, 0))} m²`,
)
console.log('')
console.log('| # | 面積 m² | 最大 m | 体積 m³ | 中心 | 根拠 |')
console.log('| --- | ---: | ---: | ---: | --- | --- |')
const levelText = { strong: '強い', moderate: '中くらい', limited: '限られる' } as const
const shown = inAppOrder(candidates, evidence)
for (const c of shown.slice(0, limit)) {
  const e = evidence.get(c.id)
  const p = pixelToLonLat(
    frame.originX + c.centroid.col + 0.5,
    frame.originY + c.centroid.row + 0.5,
    frame.z,
  )
  const src = e?.sources
    .map((s) => (s === 'a54' ? `A54${e.a54Type ? `(${e.a54Type})` : ''}` : '人工地形'))
    .join('+')
  console.log(
    `| ${c.id} | ${fmtInt(c.areaM2)} | +${c.maxRiseM.toFixed(1)} | ${fmtInt(c.volumeM3)} | ${p.lat.toFixed(5)}, ${p.lon.toFixed(5)} | ${levelText[e?.level ?? 'limited']}${src ? ` [${src}]` : ''} |`,
  )
}
if (shown.length > limit) console.log(`| … | 他 ${shown.length - limit} 件 | | | | |`)
