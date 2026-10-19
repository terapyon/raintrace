/**
 * 盛土が崩れたと仮定した場合を、実際の地理院タイルで確かめる（spec 10 §7.3・§8、spec 10b §7 の P1・P2）。Node 24 で直接実行する:
 *
 *   node scripts/collapse-check.ts <lat> <lon> <sizeM> <candidateRank> <presetId> [ratio]
 *     [--rain <mm/h> <分> --at <時,時,…>] [--png <path>] [--params <JSON>]
 *
 * candidateRank は画面の一覧の何番目か（1 から。scripts/fill-history-check.ts の表と同じ並び）。ratio は 1・0.5・0.25（既定 1）。
 * 盛土の履歴は scripts/lib/fillHistoryLoad.ts、崩れた後の計算と盛土の下の水路は Worker と同じ computeCollapse（src/workers/collapse.ts）。
 * 水路の有無・長さ・ふさがったか・線の始点と終点・候補の下を通るセルの数を出す（セルの数と上流の窪地は、同じ入力で findCulvert を呼び直して数える）。
 * --rain は範囲全体の雨を、崩れる前（水路があれば溝あり）と崩れた後の地形で TsSimulationEngine で順に回し、--at の時刻（時間）ごとに、
 * 上流の窪地（今の地形の解析で水路の depressionId のセル。溝のセルは除く）の最大の水深・1 cm 以上の面積と、窪地の最低点の水面を出す。
 * 中止・分割はしない。
 * --png は陰影の上に崩れた跡（赤）・積もった土（橙〜茶）・せき止めの満水（水色）・水路の線（紺）を描いた画像。
 * --params はプリセットの値の一部を、この実行の中だけ置き換える（値を見直すときの試し。例: '{"mu":0.3}'）。
 * メモリは process.memoryUsage() の値（Node の目安。ブラウザの Worker の値ではない）。合否は判定しない
 */
import { writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { performance } from 'node:perf_hooks'
import { crc32, deflateSync } from 'node:zlib'
import { removedThickness } from '../src/dem/fillHistory/removedThickness.ts'
import { pixelToLonLat } from '../src/dem/tileMath.ts'
import { debrisPreset } from '../src/shared/debrisPresets.ts'
import { FLOODED_DEPTH_M } from '../src/simulation/constants.ts'
import { findCulvert } from '../src/simulation/debris/culvert.ts'
import { TsSimulationEngine } from '../src/simulation/TsSimulationEngine.ts'
import { analyzeDepressions } from '../src/simulation/terrain/analyzeDepressions.ts'
import { inAppOrder, loadFillHistory } from './lib/fillHistoryLoad.ts'

// src/workers・src/shared は拡張子なしの相対 import（Vite 用）。Node で読めるよう、見つからないときだけ '.ts' を足す
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || /\.[cm]?[jt]s$/.test(specifier)) throw error
      return next(`${specifier}.ts`, context)
    }
  },
})
const { computeCollapse } = await import('../src/workers/collapse.ts')
const { rangeCorners } = await import('../src/dem/gridRange.ts')

function takeOption(args: string[], name: string, count: number): string[] | null {
  const i = args.indexOf(name)
  if (i < 0) return null
  return args.splice(i, count + 1).slice(1)
}

const args = process.argv.slice(2)
const rainOpt = takeOption(args, '--rain', 2)
const atOpt = takeOption(args, '--at', 1)
const pngOpt = takeOption(args, '--png', 1)
const paramsOpt = takeOption(args, '--params', 1)
const [lat, lon, sizeM, rank] = args.slice(0, 4).map(Number) as [number, number, number, number]
const presetId = args[4] ?? ''
const ratio = args[5] === undefined ? 1 : Number(args[5])
const rainMmH = rainOpt ? Number(rainOpt[0]) : 0
const rainMin = rainOpt ? Number(rainOpt[1]) : 0
// 水深を見る時刻（時間、昇順）。--rain だけで --at が無いときは雨の終わり
const atHours = (atOpt?.[0]?.split(',') ?? (rainOpt ? [String(rainMin / 60)] : []))
  .map(Number)
  .sort((a, b) => a - b)
if (
  ![lat, lon, sizeM, rank, ratio, rainMmH, rainMin, ...atHours].every((v) => !Number.isNaN(v)) ||
  !(rank >= 1) ||
  ![1, 0.5, 0.25].includes(ratio) ||
  !presetId ||
  (atOpt !== null && rainOpt === null)
) {
  console.error(
    '使い方: node scripts/collapse-check.ts <lat> <lon> <sizeM> <candidateRank> <presetId> [ratio] [--rain <mm/h> <分> --at <時,時,…>] [--png <path>] [--params <JSON>]',
  )
  process.exit(1)
}

const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US')
const mib = (bytes: number): string => `${(bytes / 2 ** 20).toFixed(0)} MiB`
let peakRss = 0
let peakArrayBuffers = 0
function sampleMemory(): void {
  const m = process.memoryUsage()
  peakRss = Math.max(peakRss, m.rss)
  peakArrayBuffers = Math.max(peakArrayBuffers, m.arrayBuffers)
}

const fill = await loadFillHistory(lat, lon, sizeM)
if (fill.status !== 'ok') {
  console.log(`- 盛土の履歴が使えない（${fill.status}）`)
  process.exit(0)
}
const { selection, current, frame } = fill
const { range, tier } = selection
const { size, cellSizeM } = range
const cellArea = cellSizeM * cellSizeM
const ordered = inAppOrder(fill.candidates, fill.evidence)
const cand = ordered[rank - 1]
if (cand === undefined) {
  console.error(`候補は ${ordered.length} 件しかない`)
  process.exit(1)
}
const lonLatOf = (col: number, row: number) =>
  pixelToLonLat(frame.originX + col + 0.5, frame.originY + row + 0.5, frame.z)
const candCenter = lonLatOf(cand.centroid.col, cand.centroid.row)
const preset = debrisPreset(presetId)
// 値を見直すときの試し（spec 3.3）。computeCollapse は id でプリセットを引くので、表の行の値をこの実行の中だけ書き換える
if (paramsOpt?.[0]) Object.assign(preset.params, JSON.parse(paramsOpt[0]))

console.log(
  `## ${lat}, ${lon} / ${sizeM} m / 一覧の ${rank} 番目（#${cand.id}） / ${preset.id}・割合 ${ratio}`,
)
console.log('')
console.log(
  `- 今の DEM: 段 ${tier.level}（z${range.z}）、内訳 ${JSON.stringify(selection.breakdown)}、格子 ${size} x ${size}（セル ${cellSizeM.toFixed(3)} m）`,
)
console.log(
  `- 候補 #${cand.id}: 面積 ${fmtInt(cand.areaM2)} m²、最大 +${cand.maxRiseM.toFixed(1)} m、参考の体積 ${fmtInt(cand.volumeM3)} m³、中心 ${candCenter.lat.toFixed(5)}, ${candCenter.lon.toFixed(5)}`,
)
console.log(`- プリセット ${preset.id}（${preset.label}）: ${JSON.stringify(preset.params)}`)

const geo = {
  level: tier.level,
  z: range.z,
  originX: range.originX,
  originY: range.originY,
  size,
  cellSizeM,
  corners: rangeCorners(range),
  breakdown: selection.breakdown,
  invalidRatio: current.invalidRatio,
}
const removed = removedThickness(fill.delta, fill.labels, cand.id, ratio)
sampleMemory()

const tc = performance.now()
const result = computeCollapse({
  terrainId: 1,
  geo,
  elevation: current.elevation,
  validMask: current.validMask,
  removed,
  pastElevation: fill.pastElevation,
  offsetM: fill.offsetM,
  candidateId: cand.id,
  ratio: ratio as 1 | 0.5 | 0.25,
  presetId,
})
const collapseMs = performance.now() - tc
sampleMemory()

// 積もった土の広がり: 面積・最大の厚さ・候補の重心から最も遠い積もった所・積もった土の重心
const DEPOSIT_M = 0.01
let depositCells = 0
let depositMax = 0
let farthestM = 0
let farthestIdx = -1
let sumW = 0
let sumC = 0
let sumR = 0
let removedCells = 0
let sourceTop = Number.NEGATIVE_INFINITY
let depositLowest = Number.POSITIVE_INFINITY
for (let i = 0; i < size * size; i++) {
  const r = Math.floor(i / size)
  const c = i - r * size
  if ((result.removed[i] ?? 0) > 0) {
    removedCells++
    sourceTop = Math.max(sourceTop, current.elevation[i] ?? 0)
  }
  const d = result.deposit[i] ?? 0
  if (d <= DEPOSIT_M) continue
  depositCells++
  depositMax = Math.max(depositMax, d)
  sumW += d
  sumC += d * c
  sumR += d * r
  depositLowest = Math.min(depositLowest, result.after.elevation[i] ?? 0)
  const dist = Math.hypot(c - cand.centroid.col, r - cand.centroid.row) * cellSizeM
  if (dist > farthestM) {
    farthestM = dist
    farthestIdx = i
  }
}
const massError = Math.abs(result.collapsedM3 - result.depositedM3 - result.outsideM3)
const depCenter = sumW > 0 ? lonLatOf(sumC / sumW, sumR / sumW) : null
const depShiftM =
  sumW > 0
    ? Math.hypot(sumC / sumW - cand.centroid.col, sumR / sumW - cand.centroid.row) * cellSizeM
    : 0
const farthest =
  farthestIdx >= 0 ? lonLatOf(farthestIdx % size, Math.floor(farthestIdx / size)) : null

console.log('')
console.log('### 崩れた土の行き先')
console.log('')
console.log(
  `- 計算の時間（computeCollapse: 粒の計算・形の整え・崩れた後の地形の解析・せき止めの判定）: ${(collapseMs / 1000).toFixed(2)} s`,
)
console.log(
  `- 崩れた土 ${fmtInt(result.collapsedM3)} m³（${fmtInt(removedCells * cellArea)} m²） / 積もった土 ${fmtInt(result.depositedM3)} m³ / 範囲の外へ出た土 ${fmtInt(result.outsideM3)} m³（${((100 * result.outsideM3) / Math.max(1, result.collapsedM3)).toFixed(1)}%） / 保存のずれ ${massError.toExponential(1)} m³`,
)
console.log(
  `- 積もった範囲（${DEPOSIT_M} m 超）${fmtInt(depositCells * cellArea)} m²、最大の厚さ ${depositMax.toFixed(1)} m、積もった土の重心 ${depCenter ? `${depCenter.lat.toFixed(5)}, ${depCenter.lon.toFixed(5)}（候補の重心から ${fmtInt(depShiftM)} m）` : 'なし'}`,
)
console.log(
  `- 候補の重心から最も遠い積もった所 ${fmtInt(farthestM)} m${farthest ? `（${farthest.lat.toFixed(5)}, ${farthest.lon.toFixed(5)}）` : ''}、崩れた所の最高 ${sourceTop.toFixed(1)} m → 積もった面の最低 ${Number.isFinite(depositLowest) ? depositLowest.toFixed(1) : '-'} m`,
)
console.log(`- せき止められた場所 ${result.dams.length} か所`)
if (result.dams.length > 0) {
  console.log('')
  console.log(
    '| 窪地 | 満水の量 m³ | 増えた量 m³ | 最大の深さ m | 面積 m² | あふれ出す高さ m | あふれ出し点 |',
  )
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- |')
  for (const d of [...result.dams].sort((a, b) => b.capacityM3 - a.capacityM3)) {
    console.log(
      `| ${d.depressionId} | ${fmtInt(d.capacityM3)} | ${fmtInt(d.addedCapacityM3)} | ${d.maxDepthM.toFixed(2)} | ${fmtInt(d.areaM2)} | ${d.spillElevation.toFixed(1)} | ${d.spill.lat.toFixed(5)}, ${d.spill.lon.toFixed(5)} |`,
    )
  }
}

// 盛土の下の水路（spec 10b §2）。computeCollapse の結果に加え、同じ入力で findCulvert を呼び直して、
// 候補の下を通るセルの数と上流の窪地（今の地形の解析）を数える
const currentDepressions = analyzeDepressions({
  elevation: current.elevation,
  validMask: current.validMask,
  width: size,
  height: size,
  cellSizeM,
})
const past = new Float32Array(fill.pastElevation.length)
for (let i = 0; i < past.length; i++) past[i] = (fill.pastElevation[i] ?? 0) + fill.offsetM
const candidateMask = new Uint8Array(size * size)
for (let i = 0; i < candidateMask.length; i++)
  candidateMask[i] = (result.removed[i] ?? 0) > 0 ? 1 : 0
const found = findCulvert({
  elevation: current.elevation,
  past,
  validMask: current.validMask,
  candidate: candidateMask,
  labels: currentDepressions.labels,
  depressions: currentDepressions.depressions,
  size,
  cellSizeM,
})
console.log('')
console.log('### 盛土の下の水路')
console.log('')
if (result.culvert === null || found === null) {
  console.log(
    `- 水路を仮定しない${(result.culvert === null) !== (found === null) ? '（computeCollapse と呼び直しの結果が食い違う）' : ''}`,
  )
} else {
  const line = result.culvert.line
  const first = line[0] ?? [0, 0]
  const last = line.at(-1) ?? [0, 0]
  const dep = currentDepressions.depressions.find((d) => d.id === found.depressionId)
  let underCandidate = 0
  for (const i of found.path) if (candidateMask[i] === 1) underCandidate++
  const pitZ = dep ? (current.elevation[dep.pitIndex] ?? 0) : Number.NaN
  console.log(
    `- 水路を仮定する: 長さ ${fmtInt(result.culvert.lengthM)} m（${found.path.length} セル）、候補の下を通るセル ${underCandidate}、${result.culvert.blocked ? '崩れた後はふさがる' : '崩れた後もふさがらない'}`,
  )
  console.log(
    `- 線の始点（上流の窪地の最低点） ${first[1].toFixed(5)}, ${first[0].toFixed(5)}、終点 ${last[1].toFixed(5)}, ${last[0].toFixed(5)}`,
  )
  console.log(
    `- 上流の窪地 ${found.depressionId}: 最低点 ${pitZ.toFixed(2)} m、あふれ出す高さ ${dep ? dep.spillElevation.toFixed(2) : '-'} m、容量 ${dep ? fmtInt(dep.capacityM3) : '-'} m³。溝の底 ${(found.bed[0] ?? 0).toFixed(2)} → ${(found.bed.at(-1) ?? 0).toFixed(2)} m、端のセル ${found.ends.length}`,
  )
}

// 雨の計算（崩れる前 → 後）。上流の窪地の水深を、指定の時刻ごとに見る
if (rainOpt) {
  const rain = {
    x: (size * cellSizeM) / 2,
    y: (size * cellSizeM) / 2,
    radiusM: 0,
    intensityMmPerH: rainMmH,
    durationS: rainMin * 60,
    wholeRange: true,
  }
  const upstreamId = found?.depressionId ?? null
  // 溝のセルは除く（溝は今の地形より最大で数 m 低く掘るので、流れる水でも深く見える）
  const groove = new Set(found?.path ?? [])
  const flooded = FLOODED_DEPTH_M
  const pit = found?.path[0] ?? -1
  type Snapshot = {
    hour: number
    maxDepth: number
    areaM2: number
    /** 上流の窪地の最低点（pit。溝はここを掘り下げない）の水面（標高 + 水深） */
    pitLevel: number
    overallMax: number
  }
  const run = (label: string, elevation: Float32Array, validMask: Uint8Array): Snapshot[] => {
    const engine = new TsSimulationEngine()
    engine.loadTerrain(elevation, validMask, { width: size, height: size, cellSizeM })
    engine.setRainfall(rain)
    const snaps: Snapshot[] = []
    const t0 = performance.now()
    let k = 0
    let steps = 0
    let stop: string | null = null
    while (k < atHours.length) {
      const stats = engine.step()
      steps++
      while (k < atHours.length && stats.timeS >= (atHours[k] ?? 0) * 3600 - 1e-6) {
        const depth = engine.waterDepth()
        let maxDepth = 0
        let cells = 0
        if (upstreamId !== null) {
          for (let i = 0; i < size * size; i++) {
            if (currentDepressions.labels[i] !== upstreamId || groove.has(i)) continue
            const h = depth[i] ?? 0
            if (h > maxDepth) maxDepth = h
            if (h >= flooded) cells++
          }
        }
        snaps.push({
          hour: atHours[k] ?? 0,
          maxDepth,
          areaM2: cells * cellArea,
          pitLevel: pit < 0 ? Number.NaN : (elevation[pit] ?? 0) + (depth[pit] ?? 0),
          overallMax: stats.maxDepth,
        })
        k++
      }
      if (stats.stopReason !== null) {
        stop = stats.stopReason
        break
      }
    }
    sampleMemory()
    console.log(
      `- ${label}: ${((performance.now() - t0) / 1000).toFixed(1)} s（${steps} step${stop ? `、停止 ${stop}` : ''}）`,
    )
    return snaps
  }
  console.log('')
  console.log(`### 雨の計算（${rainMmH} mm/h × ${rainMin} 分、範囲全体）`)
  console.log('')
  const before = result.before ?? current
  const beforeSnaps = run(
    result.before ? '崩れる前（溝あり）' : '崩れる前',
    before.elevation.slice(),
    before.validMask.slice(),
  )
  const afterSnaps = run('崩れた後', result.after.elevation.slice(), result.after.validMask.slice())
  console.log('')
  console.log(
    `上流の窪地${upstreamId === null ? '（水路が無いので数えない）' : ` ${upstreamId}（溝のセルを除く）`}の最大の水深・1 cm 以上の面積・最低点の水面と、範囲全体の最大の水深`,
  )
  console.log('')
  console.log(
    '| 時刻 | 崩れる前 最大 m | 面積 m² | 最低点の水面 m | 崩れた後 最大 m | 面積 m² | 最低点の水面 m | 範囲の最大 前 / 後 m |',
  )
  console.log('| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |')
  for (let k = 0; k < atHours.length; k++) {
    const b = beforeSnaps[k]
    const a = afterSnaps[k]
    const cell = (s: Snapshot | undefined, f: (s: Snapshot) => string) => (s ? f(s) : '-')
    const side = (s: Snapshot | undefined) =>
      `${cell(s, (v) => v.maxDepth.toFixed(2))} | ${cell(s, (v) => fmtInt(v.areaM2))} | ${cell(s, (v) => (Number.isNaN(v.pitLevel) ? '-' : v.pitLevel.toFixed(2)))}`
    console.log(
      `| ${atHours[k]} 時間 | ${side(b)} | ${side(a)} | ${cell(b, (s) => s.overallMax.toFixed(2))} / ${cell(a, (s) => s.overallMax.toFixed(2))} |`,
    )
  }
}

sampleMemory()
console.log('')
console.log(
  `- メモリ（Node、全体の目安）: rss の最大 ${mib(peakRss)}、ArrayBuffer の最大 ${mib(peakArrayBuffers)}`,
)

if (pngOpt?.[0]) writeMap(pngOpt[0])

/** 陰影（北西の光）の上に、崩れた跡・積もった土・せき止めの満水・水路の線を重ねた PNG */
function writeMap(path: string): void {
  const z = result.after.elevation
  const fillAfter = result.after.fill
  const damIds = new Set(result.dams.map((d) => d.depressionId))
  const culvertCells = new Set(found?.path ?? [])
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let r = 0; r < size; r++) {
    raw[r * (size * 3 + 1)] = 0
    for (let c = 0; c < size; c++) {
      const i = r * size + c
      const at = (cc: number, rr: number) =>
        z[Math.min(size - 1, Math.max(0, rr)) * size + Math.min(size - 1, Math.max(0, cc))] ?? 0
      const dzdx = (at(c + 1, r) - at(c - 1, r)) / (2 * cellSizeM)
      const dzdy = (at(c, r + 1) - at(c, r - 1)) / (2 * cellSizeM)
      const shade = Math.max(
        0,
        Math.min(1, 0.6 + (0.5 * (-dzdx + dzdy)) / Math.hypot(1, dzdx, dzdy)),
      )
      let rgb = [shade * 230, shade * 230, shade * 230]
      const dep = result.deposit[i] ?? 0
      if ((result.removed[i] ?? 0) > 0 && dep <= DEPOSIT_M) rgb = [220, 40, 40]
      if (dep > DEPOSIT_M) {
        const t = Math.min(1, dep / 5)
        rgb = [240 - 110 * t, 170 - 110 * t, 40 - 20 * t]
      }
      if (damIds.has(result.after.labels[i] ?? 0) && (fillAfter[i] ?? 0) - (z[i] ?? 0) > 0.01)
        rgb = [90, 190, 240]
      if (culvertCells.has(i)) rgb = [20, 30, 110]
      const o = r * (size * 3 + 1) + 1 + c * 3
      raw[o] = rgb[0] ?? 0
      raw[o + 1] = rgb[1] ?? 0
      raw[o + 2] = rgb[2] ?? 0
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
}
