// biome-ignore-all lint/style/noNonNullAssertion: 使い捨ての試作。型付き配列の添字は範囲内
/**
 * spec 08 の M0 の試作（使い捨て）: 合成の地形で U2（市松・静振・越流の通知の時刻）・U3・U5・U6（§9.1 の止め方）・U7 を確かめる。
 *
 *   node scripts/proto-08/synth.ts [checker|spill|u3|u5|eq|u7|all]
 */
import {
  buildTerrain,
  checkerAmplitude,
  FlipCounter,
  fmtTime,
  SpillTracker,
  type Terrain,
} from './common.ts'
import { G, LiEngine, type LiOptions, type StepInfo } from './li.ts'
import { analyzeDepressions4 } from './pf4.ts'

const which = process.argv[2] ?? 'all'
const on = (name: string) => which === 'all' || which === name

function engine(t: Terrain, o: Partial<LiOptions> = {}): LiEngine {
  return new LiEngine(t.elevation, t.validMask, t.width, t.height, t.cellSizeM, o)
}

function walledBasin(size: number, floor: (x: number, y: number) => number, rim: number): Terrain {
  return buildTerrain(size, size, 1, (x, y) =>
    x === 0 || y === 0 || x === size - 1 || y === size - 1 ? rim : floor(x, y),
  )
}

/** Σ max(0, η − Z) × A = volume となる水面標高（有効セルすべてが対象。二分法） */
function levelForVolume(t: Terrain, volume: number): number {
  const area = t.cellSizeM * t.cellSizeM
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < t.elevation.length; i++) {
    if (t.validMask[i] === 0) continue
    lo = Math.min(lo, t.elevation[i]!)
    hi = Math.max(hi, t.elevation[i]! + volume / area)
  }
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2
    let v = 0
    for (let i = 0; i < t.elevation.length; i++)
      if (t.validMask[i] !== 0) v += Math.max(0, mid - t.elevation[i]!) * area
    if (v < volume) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 決定的な乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------------------------
// U2: 平らな池の市松の振動と、静振が止まるまで
if (on('checker')) {
  console.log(
    '## U2: 平らな池の市松の振動と静振（壁で囲んだ 62 × 62・セル 1 m・水深 0.5 m に高さ 5 cm の山）',
  )
  const cases: [string, Terrain, (x: number, y: number) => number, Partial<LiOptions>][] = []
  // 6 時間で打ち切る（Manning の摩擦は流速の 2 乗に比例し、遅い静振ほど減りにくい）
  const flat = walledBasin(62, () => 0, 2)
  const bumpy = (() => {
    const r = rng(7)
    return walledBasin(62, () => (r() - 0.5) * 0.1, 2)
  })()
  const mound = (x: number, y: number) => 0.05 * Math.exp(-((x - 20) ** 2 + (y - 31) ** 2) / 18)
  const water = (t: Terrain, level: number) => (x: number, y: number) =>
    Math.max(0, level + mound(x, y) - t.elevation[y * t.width + x]!)
  for (const [label, t, level] of [
    ['平らな底・水深 0.5 m', flat, 0.5],
    ['凹凸 ±5 cm の底・水深 0.3 m', bumpy, 0.3],
    ['平らな底・水深 5 mm（浅い）', flat, 0.005],
  ] as const) {
    for (const o of [
      { manningN: 0.03, theta: 1, alpha: 0.7 },
      { manningN: 0.03, theta: 1, alpha: 0.5 },
      { manningN: 0.03, theta: 0.8, alpha: 0.7 },
      { manningN: 0.03, theta: 0.8, alpha: 0.5 },
      { manningN: 0.01, theta: 0.8, alpha: 0.5 },
    ]) {
      cases.push([`${label}・n ${o.manningN}・θ ${o.theta}・α ${o.alpha}`, t, water(t, level), o])
    }
  }
  console.log('')
  console.log(
    '| 条件 | 1 分の市松 max（mm） | 10 分の市松 max（mm） | 符号反転の面の割合の最大 | 面の流速の最大（1 分・10 分・1 時間、m/s） | 流速 < 1 cm/s | 流速 < 1e-5 m/s | step（< 1e-5 まで） |',
  )
  console.log('|---|---:|---:|---:|---|---|---|---:|')
  for (const [label, t, wf, o] of cases) {
    const e = engine(t, { ...o, window: false })
    const h0 = new Float64Array(t.width * t.height)
    for (let y = 1; y < t.height - 1; y++)
      for (let x = 1; x < t.width - 1; x++) h0[y * t.width + x] = wf(x, y)
    e.setDepth(h0)
    let ck1 = Number.NaN
    let ck10 = Number.NaN
    const u: string[] = []
    let worstFlip = 0
    let t1: number | null = null
    let t2: number | null = null
    let steps = 0
    const flip = new FlipCounter(e.qx, e.qy)
    const marks = [60, 600, 3600]
    let mi = 0
    while (e.t < 6 * 3600) {
      const s = e.step()
      const f = flip.update(e.qx, e.qy, 1e-7)
      if (f.faces > 100) worstFlip = Math.max(worstFlip, f.flips / f.faces)
      if (mi < marks.length && s.t >= marks[mi]!) {
        const ck = checkerAmplitude(e.z, e.h, t.width, t.height, 0.001)
        if (mi === 0) ck1 = ck.max
        if (mi === 1) ck10 = ck.max
        u.push(s.uMax.toExponential(1))
        mi++
      }
      if (t1 === null && s.uMax < 0.01) t1 = s.t
      if (s.uMax < 1e-5) {
        t2 = s.t
        steps = s.step
        break
      }
      steps = s.step
    }
    console.log(
      `| ${label} | ${(ck1 * 1000).toFixed(4)} | ${(ck10 * 1000).toFixed(4)} | ${(worstFlip * 100).toFixed(1)}% | ${u.join('・')} | ${t1 === null ? '—' : fmtTime(t1)} | ${t2 === null ? `届かず（${fmtTime(e.t)}）` : fmtTime(t2)} | ${steps} |`,
    )
  }
  console.log('')
}

// ---------------------------------------------------------------------------------------------
// U2（R4）: 外から波で流れ込む窪地の越流の通知の時刻と、満水の時刻
if (on('spill')) {
  console.log('## U2（R4）: 斜面から流れ込む窪地の越流の通知（セル 1 m）')
  console.log('')
  console.log(
    '地形: 幅 30・長さ 160 セル。西の 100 セルは東へ勾配 s で下る斜面（両側と西端は高さ 3 m の壁）、東に深さ 0.5 m の窪地（列 100〜139）、窪地の東の縁（列 140〜159）は窪地の底 +0.3 m で東へ下り、グリッドの東端から流れ出る',
  )
  console.log('')
  console.log(
    '| 条件 | 窪地の容量（m³） | 投入（m³） | 通知の時刻 | spill − 1 cm を最後に下回った時刻 | 通知の後に下回った step | 最低点の水面 − spill の最大（mm） | 最後の水面 − spill（mm） |',
  )
  console.log('|---|---:|---:|---|---|---:|---:|---:|')
  for (const slope of [0.01, 0.05]) {
    const base = 100 * slope
    const t = buildTerrain(160, 30, 1, (x, y) => {
      if (y === 0 || y === 29) return 3 + base
      if (x === 0) return 3 + base
      if (x < 100) return base - slope * x
      if (x < 140) return -0.5 + 0.002 * Math.abs(x - 120)
      return -0.2 - 0.01 * (x - 140)
    })
    const an = analyzeDepressions4(t.elevation, t.validMask, t.width, t.height, 1)
    const dep = an.depressions
      .filter((d) => d.significant)
      .sort((a, b) => b.capacityM3 - a.capacityM3)[0]!
    const slopeCells: number[] = []
    for (let y = 1; y < 29; y++) for (let x = 1; x < 100; x++) slopeCells.push(y * 160 + x)
    const slopeArea = slopeCells.length
    const runs: [string, (e: LiEngine) => void][] = [
      // 雨: 斜面だけに降らせる。容量の 1.2 倍になる強さ × 1 時間
      [
        `勾配 ${slope}・斜面に雨 1 時間（容量の 1.2 倍）`,
        (e) =>
          e.setRainCells(
            Int32Array.from(slopeCells),
            ((1.2 * dep.capacityM3) / slopeArea) * 1000,
            3600,
          ),
      ],
      // 一度に置く水（波）: 斜面の上半分に、容量の 0.9 倍・1.2 倍
      ...[0.9, 1.2].map(
        (f) =>
          [
            `勾配 ${slope}・斜面の上半分に一度に置く（容量の ${f} 倍）`,
            (e: LiEngine) => {
              const h = new Float64Array(160 * 30)
              const cells = slopeCells.filter((i) => i % 160 < 50)
              for (const i of cells) h[i] = (f * dep.capacityM3) / cells.length
              e.setDepth(h)
            },
          ] as [string, (e: LiEngine) => void],
      ),
    ]
    for (const [label, setup] of runs) {
      const e = engine(t)
      setup(e)
      const tr = new SpillTracker([dep])
      let maxOver = Number.NEGATIVE_INFINITY
      while (e.t < 4 * 3600) {
        const s = e.step()
        tr.update(e.z, e.h, s.t, s.step)
        const over = e.z[dep.pitIndex]! + e.h[dep.pitIndex]! - dep.spillElevation
        if (over > maxOver) maxOver = over
        if (!s.raining && s.uMax < 1e-4) break
      }
      const last = e.z[dep.pitIndex]! + e.h[dep.pitIndex]! - dep.spillElevation
      console.log(
        `| ${label} | ${dep.capacityM3.toFixed(1)} | ${e.totalIn.toFixed(1)} | ${fmtTime(tr.notifiedAt[0]!)} | ${fmtTime(tr.lastBelowAt[0]!)} | ${tr.dipsAfter[0]} | ${(maxOver * 1000).toFixed(1)} | ${(last * 1000).toFixed(1)} |`,
      )
    }
  }
  console.log('')
}

// ---------------------------------------------------------------------------------------------
// U3: 薄い膜の広がる斜面と、段差を落ちる水（DRY_DEPTH_M 1e-5 と 1e-4）
if (on('u3')) {
  console.log('## U3: 薄い膜（DRY_DEPTH_M）')
  console.log('')
  console.log(
    '| 地形 | DRY_DEPTH_M | NaN・∞ | 負の水深 | dt の最小（s） | 面の流速の最大（m/s） | 雨の後に流速 < 1 cm/s | 雨の後 1 時間の流速の最大（m/s） | 1 時間後に残る水（m³） | 質量誤差（m³） |',
  )
  console.log('|---|---:|---|---|---:|---:|---|---:|---:|---:|')
  const terrains: [string, Terrain][] = [
    ['勾配 1% の斜面（100 × 20）', buildTerrain(100, 20, 1, (x) => 1 - 0.01 * x)],
    ['勾配 10% の斜面（100 × 20）', buildTerrain(100, 20, 1, (x) => 10 - 0.1 * x)],
    [
      '3 m の段差（40 × 20、列 20 で 3 m 下がる）',
      buildTerrain(40, 20, 1, (x) => (x < 20 ? 3 : 0) - 0.001 * x),
    ],
  ]
  for (const [label, t] of terrains) {
    for (const dry of [1e-5, 1e-4]) {
      const e = engine(t, { dryDepth: dry })
      e.setRainAll(100, 600)
      let nan = false
      let neg = false
      let dtMin = Number.POSITIVE_INFINITY
      let uMax = 0
      let tStop: number | null = null
      let uAfter = 0
      while (e.t < 600 + 3600) {
        const s = e.step()
        if (!Number.isFinite(s.hMax) || !Number.isFinite(s.uMax)) nan = true
        for (let i = 0; i < e.h.length; i += 97) if (e.h[i]! < 0) neg = true
        dtMin = Math.min(dtMin, s.dt)
        uMax = Math.max(uMax, s.uMax)
        if (!s.raining) {
          if (tStop === null && s.uMax < 0.01) tStop = s.t - 600
          if (s.t > 600 + 3000) uAfter = Math.max(uAfter, s.uMax)
        }
      }
      console.log(
        `| ${label} | ${dry} | ${nan ? 'あり' : '無し'} | ${neg ? 'あり' : '無し'} | ${dtMin.toFixed(3)} | ${uMax.toFixed(3)} | ${tStop === null ? '満たさず' : fmtTime(tStop)} | ${uAfter.toExponential(2)} | ${e.stored().toFixed(4)} | ${(e.totalIn - e.stored() - e.outflowTotal).toExponential(1)} |`,
      )
    }
  }
  console.log('')
}

// ---------------------------------------------------------------------------------------------
// U5: Manning の斜面のテスト（§9.3）とフルード数の上限
if (on('u5')) {
  console.log(
    '## U5: Manning の斜面（幅 20 セル・長さ 100 m・勾配 0.01・セル 1 m・100 mm/h）とフルード数の上限',
  )
  console.log('')
  const n = 0.03
  const I = 100 / 1000 / 3600
  const S = 0.01
  // 上端（行 0）と両側（列 0・21）は高さ 1 m の壁（有効セル）。下端（行 101 の先）はグリッドの端（仮想セル）
  const t = buildTerrain(22, 101, 1, (x, y) => {
    const z = 1 + S * (100 - y)
    return x === 0 || x === 21 || y === 0 ? z + 1 : z
  })
  const slopeCells: number[] = []
  for (let y = 1; y < 101; y++) for (let x = 1; x < 21; x++) slopeCells.push(y * 22 + x)
  const te = ((100 * n) / (Math.sqrt(S) * I ** (2 / 3))) ** (3 / 5)
  console.log(`運動波の到達時間 t_e = (L·n / (√S·I^(2/3)))^(3/5) = ${te.toFixed(0)} s（L = 100 m）`)
  console.log('')
  console.log(
    '| 雨の範囲 | 定常の流出（2〜3 時間の平均、m³/s） | 1 step の流出の速さの最小〜最大（2〜3 時間） | 期待値 I × 面積（m³/s） | 差 | 下端から 10 m 上の水深（mm、中央の列） | Manning の等流（mm） | 差 | 流出が 95%・99% に達した時刻 | フルード数の上限が効いた面の延べ数 | 斜面の内側の最大のフルード数 |',
  )
  console.log('|---|---:|---|---:|---:|---:|---:|---:|---|---:|---:|')
  for (const whole of [true, false]) {
    const e = engine(t, { manningN: n })
    if (whole) e.setRainAll(100, 6 * 3600)
    else e.setRainCells(Int32Array.from(slopeCells), 100, 6 * 3600)
    const area = whole ? 22 * 101 : slopeCells.length
    const expect = I * area
    let t95: number | null = null
    let t99: number | null = null
    let capped = 0
    let frMax = 0
    let rate = 0
    let accOut = 0
    let accT = 0
    let rMin = Number.POSITIVE_INFINITY
    let rMax = 0
    while (e.t < 3 * 3600) {
      const s = e.step()
      capped += s.capped
      rate = s.outflow / s.dt
      if (e.t > 2 * 3600) {
        accOut += s.outflow
        accT += s.dt
        rMin = Math.min(rMin, rate)
        rMax = Math.max(rMax, rate)
      }
      if (t95 === null && rate >= 0.95 * expect) t95 = s.t
      if (t99 === null && rate >= 0.99 * expect) t99 = s.t
      if (e.stepCount % 50 === 0) {
        // この step の面の h_f（エンジンが流量の計算に使った値）で、斜面の内側（壁に接しない列）の南北の面のフルード数
        for (let y = 2; y <= 101; y++) {
          for (let x = 2; x < 20; x++) {
            const f = y * 22 + x
            const hf = e.hfy[f]!
            const q = Math.abs(e.qy[f]!)
            if (q > 0 && hf > 1e-4) frMax = Math.max(frMax, q / hf / Math.sqrt(G * hf))
          }
        }
      }
    }
    // 下端から 10 m 上 = 行 91（行 100 が下端のセル）。上端からの距離 x = 90.5 m
    const h10 = e.h[91 * 22 + 10]!
    const avg = accOut / accT
    const q = I * 90.5
    const hm = ((n * q) / Math.sqrt(S)) ** (3 / 5)
    console.log(
      `| ${whole ? '範囲全体（壁を含む）' : '斜面のセルだけ'} | ${avg.toExponential(4)} | ${rMin.toExponential(2)}〜${rMax.toExponential(2)} | ${expect.toExponential(4)} | ${(((avg - expect) / expect) * 100).toFixed(3)}% | ${(h10 * 1000).toFixed(3)} | ${(hm * 1000).toFixed(3)} | ${(((h10 - hm) / hm) * 100).toFixed(1)}% | ${t95 === null ? '—' : t95.toFixed(0)} s・${t99 === null ? '—' : t99.toFixed(0)} s | ${capped} | ${frMax.toFixed(3)} |`,
    )
  }
  // 3 m の段差（300 mm/h × 30 分）
  const st = buildTerrain(60, 20, 1, (x) => (x < 30 ? 3 + 0.01 * (30 - x) : 0.01 * (60 - x)))
  const e = engine(st)
  e.setRainAll(300, 1800)
  let capped = 0
  let steps = 0
  let nan = false
  let neg = false
  let limited = 0
  while (e.t < 3600) {
    const s = e.step()
    capped += s.capped
    limited += s.limited
    steps++
    if (!Number.isFinite(s.hMax)) nan = true
    for (let i = 0; i < e.h.length; i++) if (e.h[i]! < 0) neg = true
  }
  console.log('')
  console.log(
    `- 3 m の段差（60 × 20、300 mm/h × 30 分、1 時間まで）: ${steps} step、フルード数の上限が効いた面の延べ数 ${capped}（1 step あたり ${(capped / steps).toFixed(1)}）、正値の制限が効いたセルの延べ数 ${limited}、NaN ${nan ? 'あり' : '無し'}、負の水深 ${neg ? 'あり' : '無し'}、質量誤差 ${(e.totalIn - e.stored() - e.outflowTotal).toExponential(1)} m³`,
  )
  console.log('')
}

// ---------------------------------------------------------------------------------------------
// U6（§9.1）: 平衡のテストの止め方（流速 1e-5 m/s）と許容
if (on('eq')) {
  console.log('## U6（§9.1）: 平衡のテストの止め方の候補（上限 2,000,000 step）')
  console.log('')
  const terrains: [string, Terrain, (e: LiEngine) => void][] = [
    [
      '平面（walledBasin 12、床 0・縁 10。(3,3) に半径 2 m・1000 mm）',
      walledBasin(12, () => 0, 10),
      (e) => e.setRainCircle(3.5, 3.5, 2, 1000, 0),
    ],
    [
      '単純窪地（cone 21、勾配 0.1。(16,10) に半径 1.5 m・200 mm）',
      buildTerrain(21, 21, 1, (x, y) =>
        x === 0 || y === 0 || x === 20 || y === 20 ? 5 : 0.1 * Math.hypot(x - 10, y - 10),
      ),
      (e) => e.setRainCircle(16.5, 10.5, 1.5, 200, 0),
    ],
    [
      '平衡水位（cone 21、20 m³ を中心に）',
      buildTerrain(21, 21, 1, (x, y) =>
        x === 0 || y === 0 || x === 20 || y === 20 ? 5 : 0.1 * Math.hypot(x - 10, y - 10),
      ),
      (e) => e.setRainCircle(10.5, 10.5, 3, (20 * 1000) / (Math.PI * 9), 0),
    ],
    [
      'fillMatch 凹凸（24 × 24）',
      buildTerrain(
        24,
        24,
        1,
        (x, y) => 10 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 0.02 * x,
      ),
      (e) => e.setRainAll(2000, 0),
    ],
    [
      'fillMatch 凹凸と無効セル（24 × 20、セル 3.9 m）',
      (() => {
        const t = buildTerrain(24, 20, 3.9, (x, y) =>
          x >= 9 && x <= 11 && y >= 8 && y <= 10
            ? Number.NaN
            : 10 + 0.8 * Math.sin(x * 0.9) * Math.sin(y * 0.8),
        )
        return t
      })(),
      (e) => e.setRainAll(2000, 0),
    ],
    [
      'fillMatch 入れ子の窪地（20 × 20）',
      buildTerrain(20, 20, 1, (x, y) => {
        if (x === 0 || y === 0 || x === 19 || y === 19) return x === 19 && y === 10 ? 1.5 : 3
        const bowl = 0.1 * Math.hypot(x - 9.5, y - 9.5)
        const pitA = Math.hypot(x - 6, y - 6) < 2 ? -0.5 : 0
        const pitB = Math.hypot(x - 13, y - 12) < 2.5 ? -0.3 : 0
        return bowl + pitA + pitB
      }),
      (e) => e.setRainAll(2000, 0),
    ],
  ]
  const STOPS: [string, (s: StepInfo) => boolean][] = [
    ['すべての面の流速 < 1 cm/s（UI の停止）', (s) => s.uMax < 0.01],
    ['すべての面の流速 < 1e-5 m/s（§9.1 の案）', (s) => s.uMax < 1e-5],
    ['h_f ≥ 0.1 mm の面の流速 < 1e-3 m/s', (s) => s.uMax01mm < 1e-3],
    ['h_f ≥ 0.1 mm の面の流速 < 1e-4 m/s', (s) => s.uMax01mm < 1e-4],
    ['水深の変化 < 0.1 mm/h', (s) => s.dhMax < 0.1 / 3.6e6],
  ]
  console.log(
    '| 地形 | n | 止め方 | step・時刻 | 池のセルの max(H − F)・min（mm） | 池の外の有効セルの最大水深（m） | 水深 > 0.1 mm のセルの水面の差 max − min（mm） | 理論の水位との差（mm） |',
  )
  console.log('|---|---:|---|---|---|---:|---:|---:|')
  for (const [label, t, setup] of terrains) {
    const an = analyzeDepressions4(t.elevation, t.validMask, t.width, t.height, t.cellSizeM)
    for (const n of [0.1, 0.03]) {
      const e = engine(t, { manningN: n })
      setup(e)
      const level = levelForVolume(t, e.totalIn)
      const done = STOPS.map(() => false)
      let s: StepInfo | null = null
      for (let k = 0; k < 2_000_000 && done.some((d) => !d); k++) {
        s = e.step()
        for (let c = 0; c < STOPS.length; c++) {
          if (done[c] || !STOPS[c]![1](s)) continue
          done[c] = true
          let pondHi = Number.NEGATIVE_INFINITY
          let pondLo = Number.POSITIVE_INFINITY
          let outside = 0
          let mn = Number.POSITIVE_INFINITY
          let mx = Number.NEGATIVE_INFINITY
          for (let i = 0; i < e.h.length; i++) {
            if (t.validMask[i] === 0) continue
            const hh = e.h[i]!
            if (an.labels[i] !== 0) {
              const d = e.z[i]! + hh - an.fill[i]!
              pondHi = Math.max(pondHi, d)
              pondLo = Math.min(pondLo, d)
            } else outside = Math.max(outside, hh)
            if (hh > 1e-4) {
              mn = Math.min(mn, e.z[i]! + hh)
              mx = Math.max(mx, e.z[i]! + hh)
            }
          }
          console.log(
            `| ${label} | ${n} | ${STOPS[c]![0]} | ${s.step}・${fmtTime(s.t)} | ${(pondHi * 1000).toFixed(2)}・${(pondLo * 1000).toFixed(2)} | ${outside.toExponential(2)} | ${((mx - mn) * 1000).toFixed(3)} | ${e.outflowTotal === 0 ? ((mx - level) * 1000).toFixed(3) : '—'} |`,
          )
        }
      }
      for (let c = 0; c < STOPS.length; c++) {
        if (!done[c])
          console.log(
            `| ${label} | ${n} | ${STOPS[c]![0]} | 届かず（${e.stepCount} step・${fmtTime(e.t)}） | | | | |`,
          )
      }
    }
  }
  console.log('')
}

// ---------------------------------------------------------------------------------------------
// 再レビュー M1: 満水との一致の 3 つの地形を、§9.1 の止め方（水深の変化 < 0.1 mm/h）で単独に回した実時間
if (which === 'fill') {
  console.log(
    '## §9.1 の満水との一致: 止め方（流れによる水深の変化 < 0.1 mm/h）までの実時間（素の Node、単独）',
  )
  console.log('')
  console.log(
    '| 地形 | n | step | シミュレーションの時間 | 実時間（s） | ms/step | 池のセルの max|H − F|（mm） | 池の外の最大水深（mm） |',
  )
  console.log('|---|---:|---:|---|---:|---:|---:|---:|')
  const fills: [string, Terrain][] = [
    [
      '凹凸（24 × 24、セル 1 m）',
      buildTerrain(
        24,
        24,
        1,
        (x, y) => 10 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 0.02 * x,
      ),
    ],
    [
      '凹凸と無効セル（24 × 20、セル 3.9 m）',
      buildTerrain(24, 20, 3.9, (x, y) =>
        x >= 9 && x <= 11 && y >= 8 && y <= 10
          ? Number.NaN
          : 10 + 0.8 * Math.sin(x * 0.9) * Math.sin(y * 0.8),
      ),
    ],
    [
      '入れ子の窪地（20 × 20、セル 1 m）',
      buildTerrain(20, 20, 1, (x, y) => {
        if (x === 0 || y === 0 || x === 19 || y === 19) return x === 19 && y === 10 ? 1.5 : 3
        const bowl = 0.1 * Math.hypot(x - 9.5, y - 9.5)
        const pitA = Math.hypot(x - 6, y - 6) < 2 ? -0.5 : 0
        const pitB = Math.hypot(x - 13, y - 12) < 2.5 ? -0.3 : 0
        return bowl + pitA + pitB
      }),
    ],
  ]
  const small: [string, Terrain][] = [
    [
      '凹凸・小（12 × 12、セル 1 m）',
      buildTerrain(
        12,
        12,
        1,
        (x, y) => 10 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 0.02 * x,
      ),
    ],
    [
      '凹凸と無効セル・小（12 × 12、セル 3.9 m）',
      buildTerrain(12, 12, 3.9, (x, y) =>
        x >= 5 && x <= 6 && y >= 5 && y <= 6
          ? Number.NaN
          : 10 + 0.8 * Math.sin(x * 0.9) * Math.sin(y * 0.8),
      ),
    ],
    [
      '入れ子の窪地・小（12 × 12、セル 1 m）',
      buildTerrain(12, 12, 1, (x, y) => {
        if (x === 0 || y === 0 || x === 11 || y === 11) return x === 11 && y === 6 ? 1.5 : 3
        const bowl = 0.1 * Math.hypot(x - 5.5, y - 5.5)
        const pitA = Math.hypot(x - 3.5, y - 3.5) < 1.5 ? -0.5 : 0
        const pitB = Math.hypot(x - 8, y - 7.5) < 1.6 ? -0.3 : 0
        return bowl + pitA + pitB
      }),
    ],
  ]
  if (process.argv[4] === 'small') fills.splice(0, fills.length, ...small)
  const ns = (process.argv[3] ?? '0.1,0.03').split(',').map(Number)
  const stops = (process.argv[5] ?? '0.1').split(',').map(Number)
  for (const [label, t] of fills) {
    const an = analyzeDepressions4(t.elevation, t.validMask, t.width, t.height, t.cellSizeM)
    for (const n of ns)
      for (const stopMmH of stops) {
        const e = engine(t, { manningN: n })
        e.setRainAll(2000, 0)
        const t0 = performance.now()
        let s: StepInfo | null = null
        for (let k = 0; k < 2_000_000; k++) {
          s = e.step()
          if (s.dhMax < stopMmH / 3.6e6) break
        }
        const wall = (performance.now() - t0) / 1000
        let pond = 0
        let outside = 0
        for (let i = 0; i < e.h.length; i++) {
          if (t.validMask[i] === 0) continue
          if (an.labels[i] !== 0) pond = Math.max(pond, Math.abs(e.z[i]! + e.h[i]! - an.fill[i]!))
          else outside = Math.max(outside, e.h[i]!)
        }
        console.log(
          `| ${label}（止め方 < ${stopMmH} mm/h） | ${n} | ${s?.step} | ${fmtTime(e.t)} | ${wall.toFixed(2)} | ${((wall * 1000) / e.stepCount).toFixed(4)} | ${(pond * 1000).toFixed(2)} | ${(outside * 1000).toFixed(2)} |`,
        )
      }
  }
  console.log('')
}

// ---------------------------------------------------------------------------------------------
// U7: 静水の保存（§9.2 の (a)(b)）
if (on('u7')) {
  console.log('## U7: 静水の保存（ランダムな地形 40 × 40、置き方 (a)、雨なしで 500 step）')
  console.log('')
  console.log(
    '| 地形と水面 | 試行 | h がビット単位で変わらなかった試行 | max|Δh|（m） | 流量が 0 でない面が出た試行 | 水を置いたセルの平均 | Z + h ≠ 水面 のセルの延べ数 |',
  )
  console.log('|---|---:|---:|---:|---:|---:|---:|')
  for (const [aligned, cross] of [
    [true, false],
    [false, false],
    [true, true],
    [false, true],
  ] as const) {
    let same = 0
    let maxDiff = 0
    let flowed = 0
    let wetCells = 0
    let inexact = 0
    const trials = 50
    for (let k = 0; k < trials; k++) {
      const snap = (v: number) => (aligned ? Math.round(v * 256) / 256 : v)
      const cell = [1, 0.97, 3.9, 7.8][k % 4]!
      const base = cross ? 0 : 10
      const amp = cross ? 0.5 : 3
      const make = (shift: number): Terrain => {
        const r = rng(1000 + k)
        return buildTerrain(40, 40, cell, (x, y) => {
          if (k % 3 === 0 && x >= 30 && x <= 32 && y >= 5 && y <= 7) return Number.NaN
          const v =
            base +
            amp * Math.sin(x * 0.4 + k) * Math.cos(y * 0.3) +
            (r() - 0.5) * amp * (k % 5 === 0 ? 1.3 : 0.2)
          return snap(v + shift)
        })
      }
      let t = make(0)
      let an = analyzeDepressions4(t.elevation, t.validMask, t.width, t.height, cell)
      let big = [...an.depressions].sort((a, b) => b.capacityM3 - a.capacityM3)[0]
      if (cross && big !== undefined) {
        // 一番大きい窪地の底と満水の水面の中ほどが標高 0 になるようにずらす（水面が 0 をまたぎ、Sterbenz の条件を外れる）
        const mid = (t.elevation[big.pitIndex]! + big.spillElevation) / 2
        t = make(-mid)
        an = analyzeDepressions4(t.elevation, t.validMask, t.width, t.height, cell)
        big = [...an.depressions].sort((a, b) => b.capacityM3 - a.capacityM3)[0]
      }
      const r2 = rng(5000 + k)
      // 一番大きい窪地の底と満水の水面の間（水面が F で切られず η0 になるセルを作る）
      const floor = big === undefined ? base : t.elevation[big.pitIndex]!
      const eta0 = snap(
        big === undefined ? base : floor + (0.3 + 0.6 * r2()) * (big.spillElevation - floor),
      )
      const h0 = new Float64Array(t.width * t.height)
      for (let i = 0; i < h0.length; i++) {
        if (t.validMask[i] === 0) continue
        const top = Math.min(eta0, an.fill[i]!)
        h0[i] = Math.max(0, top - t.elevation[i]!)
      }
      for (let i = 0; i < h0.length; i++) {
        if (h0[i]! > 0) wetCells++
        if (h0[i]! > 0 && t.elevation[i]! + h0[i]! !== Math.min(eta0, an.fill[i]!)) inexact++
      }
      const e = engine(t, { window: k % 2 === 0 })
      e.setDepth(h0)
      let anyQ = false
      for (let s = 0; s < 500; s++) {
        e.step()
        if (!anyQ) {
          for (let f = 0; f < e.qx.length; f++) if (e.qx[f] !== 0) anyQ = true
          for (let f = 0; f < e.qy.length; f++) if (e.qy[f] !== 0) anyQ = true
        }
      }
      let d = 0
      let eq = true
      for (let i = 0; i < h0.length; i++) {
        const diff = Math.abs(e.h[i]! - h0[i]!)
        if (e.h[i] !== h0[i]) eq = false
        d = Math.max(d, diff)
      }
      if (eq) same++
      if (anyQ) flowed++
      maxDiff = Math.max(maxDiff, d)
    }
    console.log(
      `| ${aligned ? 'Z と η0 を 1/256 m の格子に載せる' : '格子に載せない'}${cross ? '・一番大きい池の水面が標高 0 をまたぐ' : '・標高 10 ± 約 3 m'} | ${trials} | ${same} | ${maxDiff.toExponential(2)} | ${flowed} | ${(wetCells / trials).toFixed(0)} | ${inexact} |`,
    )
  }
  console.log('')
}
