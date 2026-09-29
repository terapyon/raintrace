// biome-ignore-all lint/style/noNonNullAssertion: 使い捨ての試作。型付き配列の添字は範囲内
/**
 * spec 08 の M0 の試作（使い捨て）: 3 地点の実 DEM（固定のフィクスチャ）に雨を降らせ、U2・U6 の数値を出す。
 *
 *   node scripts/proto-08/sites.ts <site> <rain: r10|r100|all> [mmh=100] [durMin=60] [dtMax=2] [theta=0.8] [eqVel=1e-5] [eqCapH=24] [alpha=0.5]
 *
 * - 雨の後、すべての面の流速が 1 cm/s 未満になったら UI の停止（§3.9）。上限は雨がやんでから 6 時間
 * - その後も回し続け、流速 eqVel 未満（§9.1 の平衡のテストの止め方）か、雨がやんでから eqCapH 時間で止める
 * - 5 分（シミュレーションの時間）ごとに dt・最大水深・面の流速の最大・流出の速さ・市松の兆しを出す
 * - 越流の通知の時刻と、窪地の水位が spill − 1 cm を下回らなくなった時刻を比べる（U2 の R4）
 * - UI の停止と平衡の止め方の時点で、池（4 近傍の窪地）の外に残る水と、池の水位を比べる（U6）
 */
import { loadavg } from 'node:os'
import { checkerAmplitude, FlipCounter, fmtTime, SpillTracker, waterSplit } from './common.ts'
import { DEFAULTS, LiEngine } from './li.ts'
import { analyzeDepressions4 } from './pf4.ts'
import { loadSite, SITES, type SiteName } from './site.ts'

const [siteArg, rainArg, mmhArg, durArg, dtMaxArg, thetaArg, eqVelArg, eqCapArg, alphaArg] =
  process.argv.slice(2)
const site = (siteArg ?? 'ayase') as SiteName
if (!(site in SITES)) throw new Error(`site: ${siteArg}`)
const rain = rainArg ?? 'r10'
const mmh = Number(mmhArg ?? 100)
const durS = Number(durArg ?? 60) * 60
const dtMax = Number(dtMaxArg ?? 2)
const theta = Number(thetaArg ?? DEFAULTS.theta)
const alpha = Number(alphaArg ?? DEFAULTS.alpha)
const eqVel = Number(eqVelArg ?? 1e-5)
const eqCapS = Number(eqCapArg ?? 24) * 3600
const SETTLE_V = 0.01
const SETTLE_CAP_S = 6 * 3600

const g = await loadSite(site, 500)
const an = analyzeDepressions4(g.elevation, g.validMask, g.width, g.height, g.cellSizeM)
const significant = an.depressions.filter((d) => d.significant)
const sigIds = new Set(significant.map((d) => d.id))
const e = new LiEngine(g.elevation, g.validMask, g.width, g.height, g.cellSizeM, {
  dtMax,
  theta,
  alpha,
})
if (rain === 'all') e.setRainAll(mmh, durS)
else e.setRainCircle(g.center.x, g.center.y, rain === 'r100' ? 100 : 10, mmh, durS)
const tracker = new SpillTracker(significant)
const area = g.cellSizeM * g.cellSizeM

console.log(
  `# ${SITES[site].label} 500 m（${g.width}×${g.height}、セル ${g.cellSizeM.toFixed(3)} m、段 ${g.demLevel}）・雨 ${rain}・${mmh} mm/h × ${durS / 60} 分・DT_MAX ${dtMax} s・θ ${theta}・α ${alpha}・平衡の流速 ${eqVel}`,
)
console.log(
  `load average ${loadavg()
    .map((v) => v.toFixed(2))
    .join(' ')}、4 近傍の窪地 ${an.depressions.length}（うち有意 ${significant.length}）`,
)
console.log('')
console.log(
  '| t | step | dt（s） | 最大水深（m） | 面の流速の最大（m/s） | 同（h_f ≥ 1 mm・1 cm） | 面の流量の最大（m²/s） | 水深の変化の最大（mm/h） | 流出の速さ（m³/h） | 市松 max（mm） | 符号反転の面 | 走査範囲 |',
)
console.log('|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|')

const started = performance.now()
let nextSample = 0
let uiStop: { t: number; step: number; reason: string } | null = null
let uiSnap: Float64Array | null = null
let eqStop: { t: number; step: number; reason: string } | null = null
let rainEndStep = 0
const spillLog: string[] = []
/** 停止の条件の候補ごとに、雨の後に初めて満たした時刻と step */
/** 有意な池の最低点の水深の、直近 10 分（シミュレーションの時間）の上がりの最大（m）。1 分ごとの記録から求める */
const pitHistory: { t: number; h: Float64Array }[] = []
let pondRise10 = Number.POSITIVE_INFINITY
function recordPits(t: number, h: Float64Array): void {
  const last = pitHistory[pitHistory.length - 1]
  if (last !== undefined && t - last.t < 60) return
  const now = Float64Array.from(significant, (d) => h[d.pitIndex]!)
  pitHistory.push({ t, h: now })
  while (pitHistory.length > 0 && t - pitHistory[0]!.t > 600) pitHistory.shift()
  const old = pitHistory[0]!
  if (t - old.t < 540) return
  let rise = 0
  for (let k = 0; k < now.length; k++) rise = Math.max(rise, now[k]! - old.h[k]!)
  pondRise10 = rise
}
const CANDIDATES: [
  string,
  (s: { uMax: number; uMax1mm: number; uMax1cm: number; qMax: number; dhMax: number }) => boolean,
][] = [
  ['有意な池の水位の上がりが直近 10 分で 1 mm 未満', () => pondRise10 < 1e-3],
  [
    'h_f ≥ 1 cm の面の流速 < 1 cm/s、かつ有意な池の水位の上がりが直近 10 分で 1 mm 未満',
    (s) => s.uMax1cm < 0.01 && pondRise10 < 1e-3,
  ],
  ['h_f ≥ 1 cm の面の流速 < 1 cm/s', (s) => s.uMax1cm < 0.01],
  ['h_f ≥ 1 mm の面の流速 < 1 cm/s', (s) => s.uMax1mm < 0.01],
  ['流速 < 5 cm/s', (s) => s.uMax < 0.05],
  ['流速 < 2 cm/s', (s) => s.uMax < 0.02],
  ['流速 < 1 cm/s（§3.9）', (s) => s.uMax < 0.01],
  ['流量 < 1e-4 m²/s', (s) => s.qMax < 1e-4],
  ['流量 < 1e-5 m²/s', (s) => s.qMax < 1e-5],
  ['流量 < 1e-6 m²/s', (s) => s.qMax < 1e-6],
  ['水深の変化 < 10 mm/h', (s) => s.dhMax < 10 / 3.6e6],
  ['水深の変化 < 5 mm/h', (s) => s.dhMax < 5 / 3.6e6],
  ['水深の変化 < 1 mm/h', (s) => s.dhMax < 1 / 3.6e6],
  ['水深の変化 < 0.1 mm/h', (s) => s.dhMax < 0.1 / 3.6e6],
]
const candHit: ({ t: number; step: number; snap: Float64Array } | null)[] = CANDIDATES.map(
  () => null,
)
const dtFirst: number[] = []
let dtMinAfterRain = Number.POSITIVE_INFINITY
let dtMin = Number.POSITIVE_INFINITY
let cappedTotal = 0
let limitedMaxPerStep = 0
let clampedTotal = 0
let uMaxAll = 0
let flipProbe: FlipCounter | null = null
let flipText = ''

for (;;) {
  const s = e.step()
  if (flipProbe !== null) {
    const r = flipProbe.update(e.qx, e.qy, 1e-6)
    flipText = `${r.flips}/${r.faces}`
    flipProbe = null
  }
  if (s.t <= 6000) dtFirst.push(s.dt)
  if (s.dt < dtMin) dtMin = s.dt
  if (!s.raining && s.dt < dtMinAfterRain) dtMinAfterRain = s.dt
  cappedTotal += s.capped
  clampedTotal += s.clamped
  if (s.limited > limitedMaxPerStep) limitedMaxPerStep = s.limited
  if (s.uMax > uMaxAll) uMaxAll = s.uMax
  if (!Number.isFinite(s.hMax) || !Number.isFinite(s.uMax)) throw new Error(`NaN at step ${s.step}`)
  for (const k of tracker.update(e.z, e.h, s.t, s.step)) {
    const d = significant[k]!
    spillLog.push(
      `${d.id}（spill ${d.spillElevation.toFixed(2)} m・容量 ${d.capacityM3.toFixed(1)} m³）: ${fmtTime(s.t)}（step ${s.step}）${uiStop !== null ? '【UI の停止の後】' : ''}`,
    )
  }
  if (rainEndStep === 0 && !s.raining) rainEndStep = s.step
  if (s.t >= nextSample || (!s.raining && rainEndStep === s.step)) {
    const ck = checkerAmplitude(e.z, e.h, g.width, g.height, 0.05)
    console.log(
      `| ${fmtTime(s.t)} | ${s.step} | ${s.dt.toFixed(3)} | ${s.hMax.toFixed(3)} | ${s.uMax.toExponential(2)} | ${s.uMax1mm.toExponential(1)}・${s.uMax1cm.toExponential(1)} | ${s.qMax.toExponential(2)} | ${(s.dhMax * 3.6e6).toFixed(3)} | ${((s.outflow / s.dt) * 3600).toFixed(2)} | ${(ck.max * 1000).toFixed(3)} | ${flipText} | ${e.x1 - e.x0}×${e.y1 - e.y0} |`,
    )
    {
      const iv = s.t < 7200 ? 300 : 1800
      nextSample = (Math.floor(s.t / iv) + 1) * iv
    }
    flipProbe = new FlipCounter(e.qx, e.qy)
  }
  recordPits(s.t, e.h)
  if (!s.raining) {
    for (let c = 0; c < CANDIDATES.length; c++) {
      if (candHit[c] === null && CANDIDATES[c]![1](s))
        candHit[c] = { t: s.t, step: s.step, snap: e.h.slice() }
    }
    const sinceRain = s.t - e.rainEnd
    if (uiStop === null && (s.uMax < SETTLE_V || sinceRain >= SETTLE_CAP_S)) {
      uiStop = { t: s.t, step: s.step, reason: s.uMax < SETTLE_V ? 'settled' : 'cap' }
      uiSnap = e.h.slice()
      console.log(
        `| **UI の停止（${uiStop.reason}）** ${fmtTime(s.t)} | ${s.step} | ${s.dt.toFixed(3)} | ${s.hMax.toFixed(3)} | ${s.uMax.toExponential(2)} | | | | |`,
      )
    }
    if (s.uMax < eqVel || sinceRain >= eqCapS) {
      eqStop = { t: s.t, step: s.step, reason: s.uMax < eqVel ? `< ${eqVel}` : 'cap' }
      console.log(
        `| **平衡の止め方（${eqStop.reason}）** ${fmtTime(s.t)} | ${s.step} | ${s.dt.toFixed(3)} | ${s.hMax.toFixed(3)} | ${s.uMax.toExponential(2)} | | | | |`,
      )
      break
    }
  }
}
const wallS = (performance.now() - started) / 1000

console.log('')
console.log(`- 雨の終わり: ${fmtTime(e.rainEnd)}（step ${rainEndStep}）`)
console.log(
  `- UI の停止: ${uiStop ? `${fmtTime(uiStop.t)}（雨の後 ${fmtTime(uiStop.t - e.rainEnd)}、step ${uiStop.step}、雨の後の step ${uiStop.step - rainEndStep}、理由 ${uiStop.reason}）` : '—'}`,
)
console.log(
  `- 平衡の止め方: ${eqStop ? `${fmtTime(eqStop.t)}（雨の後 ${fmtTime(eqStop.t - e.rainEnd)}、step ${eqStop.step}、UI の停止からの step ${eqStop.step - (uiStop?.step ?? 0)}、理由 ${eqStop.reason}）` : '—'}`,
)
console.log(
  `- dt: 最小 ${dtMin.toFixed(4)} s、雨の後の最小 ${dtMinAfterRain.toFixed(4)} s。フルード数の上限が効いた面の延べ数 ${cappedTotal}、正値の制限の 1 step の最大セル数 ${limitedMaxPerStep}、丸めで 0 に切ったセルの延べ数 ${clampedTotal}、面の流速の最大 ${uMaxAll.toFixed(3)} m/s`,
)
console.log(
  `- 質量: 投入 ${e.totalIn.toFixed(3)} m³、流出 ${e.outflowTotal.toFixed(3)} m³、誤差 ${(e.totalIn - e.stored() - e.outflowTotal).toExponential(2)} m³。実時間 ${wallS.toFixed(1)} s（${((wallS * 1000) / e.stepCount).toFixed(3)} ms/step）`,
)

if (uiSnap !== null) {
  const a = waterSplit(uiSnap, an.labels, sigIds, area)
  const b = waterSplit(e.h, an.labels, sigIds, area)
  console.log('')
  console.log(
    '| 時点 | 池の外の水（m³） | 池の外の最大水深（mm） | 池の外の濡れたセル（>1e-5 m） | 有意な池の水（m³） | 小さな窪地の水（m³） |',
  )
  console.log('|---|---:|---:|---:|---:|---:|')
  for (const [label, w] of [
    ['UI の停止', a],
    ['平衡の止め方', b],
  ] as const) {
    console.log(
      `| ${label} | ${w.outsideVol.toFixed(3)} | ${(w.outsideMaxH * 1000).toFixed(2)} | ${w.outsideWetCells} | ${w.pondVol.toFixed(3)} | ${w.smallPondVol.toFixed(3)} |`,
    )
  }
  // 池の水位の上がり（最低点の水面標高）
  const rises: string[] = []
  let maxRise = 0
  for (let k = 0; k < significant.length; k++) {
    const d = significant[k]!
    const h0 = uiSnap[d.pitIndex]!
    const h1 = e.h[d.pitIndex]!
    if (h0 === 0 && h1 === 0) continue
    const rise = h1 - h0
    if (rise > maxRise) maxRise = rise
    rises.push(
      `${d.id}: ${(h0 * 1000).toFixed(1)} → ${(h1 * 1000).toFixed(1)} mm（+${(rise * 1000).toFixed(2)}、spill まで ${((d.spillElevation - e.z[d.pitIndex]! - h1) * 1000).toFixed(1)} mm）`,
    )
  }
  console.log('')
  console.log(
    `- 水のある有意な池の最低点の水深（UI の停止 → 平衡の止め方）。上がりの最大 ${(maxRise * 1000).toFixed(2)} mm`,
  )
  for (const r of rises.slice(0, 20)) console.log(`  - ${r}`)
  if (rises.length > 20) console.log(`  - ほか ${rises.length - 20}`)
}
console.log('')
console.log(
  '| 停止の条件の候補 | 雨の後に初めて満たした時刻 | step | 池の外の水（m³） | 池の外の最大水深（mm） | その後に有意な池の最低点の水深が上がった最大（mm） | その時点の後に来た越流の通知 |',
)
console.log('|---|---|---:|---:|---:|---:|---:|')
for (let c = 0; c < CANDIDATES.length; c++) {
  const hit = candHit[c]
  if (hit === null || hit === undefined) {
    console.log(`| ${CANDIDATES[c]![0]} | 満たさず（${fmtTime(e.t)} まで） | | | | | |`)
    continue
  }
  const w = waterSplit(hit.snap, an.labels, sigIds, area)
  let later = 0
  let rise = 0
  for (let k = 0; k < significant.length; k++) {
    if (tracker.notifiedAt[k]! > hit.t) later++
    const p = significant[k]!.pitIndex
    rise = Math.max(rise, e.h[p]! - hit.snap[p]!)
  }
  console.log(
    `| ${CANDIDATES[c]![0]} | ${fmtTime(hit.t)}（雨の後 ${fmtTime(hit.t - e.rainEnd)}） | ${hit.step} | ${w.outsideVol.toFixed(3)} | ${(w.outsideMaxH * 1000).toFixed(2)} | ${(rise * 1000).toFixed(2)} | ${later} |`,
  )
}
console.log('')
console.log(`- 越流の通知（${spillLog.length} 件）`)
for (const s of spillLog) console.log(`  - ${s}`)
for (let k = 0; k < significant.length; k++) {
  if (Number.isNaN(tracker.notifiedAt[k]!)) continue
  const d = significant[k]!
  console.log(
    `  - ${d.id}: 通知 ${fmtTime(tracker.notifiedAt[k]!)}、spill − 1 cm を最後に下回った時刻 ${fmtTime(tracker.lastBelowAt[k]!)}、通知の後に下回った step 数 ${tracker.dipsAfter[k]}、通知の後の最低点の水面 − spill の最小 ${(tracker.minAfter[k]! * 1000).toFixed(1)} mm`,
  )
}
// U2: 各倍率で実時間 1 秒あたりの step 数と、表示が変わる tick の数（最初の 30 分のシミュレーションで）
console.log('')
console.log(
  '| 倍率 | 最初の実時間 10 秒の step 数 | 表示が変わる tick／秒（60 tick 中） | 平均の dt（s） |',
)
console.log('|---|---:|---:|---:|')
for (const mult of [1, 10, 60, 600]) {
  let t = 0
  let idx = 0
  let target = 0
  let steps = 0
  let changed = 0
  const ticks = 600
  for (let tick = 0; tick < ticks && idx < dtFirst.length; tick++) {
    target += mult / 60
    let any = false
    while (t < target && idx < dtFirst.length) {
      t += dtFirst[idx++]!
      steps++
      any = true
    }
    if (any) changed++
  }
  console.log(
    `| ${mult} 倍 | ${steps} | ${(changed / 10).toFixed(1)} | ${(t / Math.max(1, steps)).toFixed(3)} |`,
  )
}
