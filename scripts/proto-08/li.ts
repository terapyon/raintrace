// biome-ignore-all lint/style/noNonNullAssertion: 使い捨ての試作。型付き配列の添字は範囲内（src/simulation と同じく検査を省く）
/**
 * spec 08 の M0 の試作（使い捨て。計画の最後に消す。spec 08 §11）: 4 近傍の局所慣性式（spec 08 §3）。
 * - 面の流量 qx（(W+1) × H、東向きが正）・qy（W × (H+1)、南向きが正）。§3.1
 * - q ← (q − g·h_f·dt·S) / (1 + g·dt·n²·|q| / h_f^(7/3))、h_f = max(η) − max(Z)。§3.2
 * - θ 重み付け（de Almeida ほか 2012）は theta < 1 のときだけ。1 なら Bates ほか 2010 のまま
 * - dt = min(DT_MAX, α·Δx / max(√(g·h_max), u_max))。雨の終わりで切る。§3.3
 * - h_f ≤ DRY_DEPTH なら q = 0。§3.4
 * - フルード数の上限、正値の制限（出る面を縮める。すべて出るセルは水深 0）。§3.5
 * - グリッドの外と無効セルは、流出元と同じ標高・水深 0 の仮想セル（R03-2）。流入の向きは 0 に切る。§3.6
 * - 走査範囲は濡れたセルの外接矩形と周囲 1 セル。外れた面の q は 0 にする。§3.8
 * - 雨は各 step の終わりに ρ·dt を足す（t < T_rain の間）。§4.2
 */
import { planRainfall } from '../../src/simulation/Rainfall.ts'

export const G = 9.81

export interface LiOptions {
  manningN: number
  alpha: number
  dtMax: number
  dryDepth: number
  froudeMax: number
  /** 1 なら θ 重み付けなし（Bates 2010） */
  theta: number
  /** false なら常に全体を走査する */
  window: boolean
}

export const DEFAULTS: LiOptions = {
  manningN: 0.03,
  alpha: 0.5,
  dtMax: 2,
  dryDepth: 1e-5,
  froudeMax: 1,
  theta: 0.8,
  window: true,
}

export interface StepInfo {
  step: number
  dt: number
  /** step の終わりの経過時間（s） */
  t: number
  /** step の終わりの最大水深 */
  hMax: number
  /** この step の面の流速 |q|/h_f の最大（正値の制限の後） */
  uMax: number
  /** この step の流出量（m³） */
  outflow: number
  /** 雨がこの step の終わりの時点で降っている */
  raining: boolean
  /** この step の流れによる水深の変化の速さの最大 |Δh|/dt（m/s。雨の分を除く） */
  dhMax: number
  /** h_f ≥ 1 mm の面だけの流速の最大（m/s） */
  uMax1mm: number
  /** h_f ≥ 1 cm（描画の閾値）の面だけの流速の最大（m/s） */
  uMax1cm: number
  /** h_f ≥ 0.1 mm の面だけの流速の最大（m/s） */
  uMax01mm: number
  /** この step の面の単位幅流量の最大 |q|（m²/s） */
  qMax: number
  /** フルード数の上限が効いた面の数 */
  capped: number
  /** 正値の制限が効いたセルの数 */
  limited: number
  /** 丸めで負になり 0 に切ったセルの数 */
  clamped: number
}

export class LiEngine {
  readonly W: number
  readonly H: number
  readonly dx: number
  readonly o: LiOptions
  readonly z: Float64Array
  readonly m: Uint8Array
  h: Float64Array
  hNext: Float64Array
  readonly qx: Float64Array
  readonly qy: Float64Array
  /** この step の面の h_f（流速の集計用。h_f ≤ DRY_DEPTH の面は 0） */
  readonly hfx: Float64Array
  readonly hfy: Float64Array
  /** 面の種類: 0 = 両側有効、1 = 西（北）が仮想、2 = 東（南）が仮想、3 = 両側無効 */
  private readonly tx: Uint8Array
  private readonly ty: Uint8Array
  readonly drained: Uint8Array
  /** θ 重み付けで使う、上の行の南北の面の古い q */
  private readonly rowOld: Float64Array
  t = 0
  stepCount = 0
  totalIn = 0
  outflowTotal = 0
  hMax = 0
  uMaxPrev = 0
  x0 = 0
  y0 = 0
  x1 = 0
  y1 = 0
  private rainCells: Int32Array | null = null
  private rainAll = false
  private rainRate = 0
  /** 円の雨のセルの外接矩形（列 [x0, x1)、行 [y0, y1)） */
  private rainBox = [0, 0, 0, 0]
  rainEnd = 0

  constructor(
    elevation: Float32Array,
    validMask: Uint8Array,
    width: number,
    height: number,
    cellSizeM: number,
    options: Partial<LiOptions> = {},
  ) {
    this.W = width
    this.H = height
    this.dx = cellSizeM
    this.o = { ...DEFAULTS, ...options }
    const n = width * height
    this.z = Float64Array.from(elevation)
    this.m = validMask.slice()
    this.h = new Float64Array(n)
    this.hNext = new Float64Array(n)
    this.qx = new Float64Array((width + 1) * height)
    this.qy = new Float64Array(width * (height + 1))
    this.hfx = new Float64Array((width + 1) * height)
    this.hfy = new Float64Array(width * (height + 1))
    this.tx = new Uint8Array((width + 1) * height)
    this.ty = new Uint8Array(width * (height + 1))
    this.drained = new Uint8Array(n)
    this.rowOld = new Float64Array(width)
    const valid = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < width && y < height && this.m[y * width + x] === 1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x <= width; x++) {
        const a = valid(x - 1, y)
        const b = valid(x, y)
        this.tx[y * (width + 1) + x] = a && b ? 0 : !a && b ? 1 : a && !b ? 2 : 3
      }
    }
    for (let y = 0; y <= height; y++) {
      for (let x = 0; x < width; x++) {
        const a = valid(x, y - 1)
        const b = valid(x, y)
        this.ty[y * width + x] = a && b ? 0 : !a && b ? 1 : a && !b ? 2 : 3
      }
    }
    if (!this.o.window) {
      this.x1 = width
      this.y1 = height
    }
  }

  private include(cx0: number, cy0: number, cx1: number, cy1: number): void {
    if (!this.o.window) return
    const x0 = Math.max(0, cx0 - 1)
    const y0 = Math.max(0, cy0 - 1)
    const x1 = Math.min(this.W, cx1 + 1)
    const y1 = Math.min(this.H, cy1 + 1)
    if (this.x0 >= this.x1) {
      this.x0 = x0
      this.y0 = y0
      this.x1 = x1
      this.y1 = y1
      return
    }
    this.x0 = Math.min(this.x0, x0)
    this.y0 = Math.min(this.y0, y0)
    this.x1 = Math.max(this.x1, x1)
    this.y1 = Math.max(this.y1, y1)
  }

  /** 円の雨（planRainfall の割合）。intensityMmPerH × durationS。durationS = 0 は一度に置く */
  setRainCircle(x: number, y: number, radiusM: number, intensityMmPerH: number, durationS: number) {
    const meta = { width: this.W, height: this.H, cellSizeM: this.dx }
    if (durationS === 0) {
      const plan = planRainfall({ x, y, radiusM, amountMm: intensityMmPerH }, this.m, meta)
      for (const i of plan.cells) this.h[i]! += plan.depthM
      this.totalIn += plan.volumeM3
      this.include(plan.x0, plan.y0, plan.x1, plan.y1)
      this.refreshHMax()
      return
    }
    const plan = planRainfall({ x, y, radiusM, amountMm: 1 }, this.m, meta)
    this.rainCells = plan.cells
    this.rainAll = false
    // 1 mm の雨の水深 × 1 時間あたりの mm ÷ 3600
    this.rainRate = (plan.depthM * intensityMmPerH) / 3600
    this.rainEnd = durationS
    this.rainBox = [plan.x0, plan.y0, plan.x1, plan.y1]
    this.include(plan.x0, plan.y0, plan.x1, plan.y1)
  }

  /** 任意のセルの雨（試作の比較用。UI には無い） */
  setRainCells(cells: Int32Array, intensityMmPerH: number, durationS: number) {
    this.rainCells = cells
    this.rainAll = false
    this.rainRate = intensityMmPerH / 1000 / 3600
    this.rainEnd = durationS
    let x0 = this.W
    let y0 = this.H
    let x1 = 0
    let y1 = 0
    for (const i of cells) {
      const x = i % this.W
      const y = (i - x) / this.W
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x + 1)
      y1 = Math.max(y1, y + 1)
    }
    this.rainBox = [x0, y0, x1, y1]
    this.include(x0, y0, x1, y1)
  }

  /** 範囲全体の雨（§4.3） */
  setRainAll(intensityMmPerH: number, durationS: number) {
    const rate = intensityMmPerH / 1000 / 3600
    if (durationS === 0) {
      const d = intensityMmPerH / 1000
      for (let i = 0; i < this.h.length; i++) if (this.m[i] === 1) this.h[i]! += d
      this.totalIn += d * this.validCount() * this.dx * this.dx
      this.include(0, 0, this.W, this.H)
      this.refreshHMax()
      return
    }
    this.rainCells = null
    this.rainAll = true
    this.rainRate = rate
    this.rainEnd = durationS
    this.include(0, 0, this.W, this.H)
  }

  /** 任意の水深を置く（テスト用）。走査範囲は全体にする */
  setDepth(h: Float64Array) {
    this.h.set(h)
    let s = 0
    for (let i = 0; i < h.length; i++) s += h[i]!
    this.totalIn += s * this.dx * this.dx
    this.include(0, 0, this.W, this.H)
    this.refreshHMax()
  }

  validCount(): number {
    let c = 0
    for (let i = 0; i < this.m.length; i++) c += this.m[i]!
    return c
  }

  private refreshHMax() {
    let mx = 0
    for (let i = 0; i < this.h.length; i++) if (this.h[i]! > mx) mx = this.h[i]!
    this.hMax = mx
  }

  get raining(): boolean {
    return (this.rainAll || this.rainCells !== null) && this.t < this.rainEnd
  }

  /** 次の step の dt（§3.3。雨の終わりで切る） */
  nextDt(): number {
    const c = Math.max(Math.sqrt(G * this.hMax), this.uMaxPrev)
    let dt = c > 0 ? Math.min(this.o.dtMax, (this.o.alpha * this.dx) / c) : this.o.dtMax
    if (this.raining && this.t + dt > this.rainEnd) dt = this.rainEnd - this.t
    return dt
  }

  step(): StepInfo {
    const { W, H, dx, z, m, h, qx, qy, tx, ty, drained, hfx, hfy } = this
    const { manningN, dryDepth, froudeMax, theta } = this.o
    const n2 = manningN * manningN
    const dt = this.nextDt()
    const x0 = this.x0
    const y0 = this.y0
    const x1 = this.x1
    const y1 = this.y1
    const W1 = W + 1
    let capped = 0
    const useTheta = theta < 1
    const gdtdx = (G * dt) / dx
    const gdtn2 = G * dt * n2
    const fr2g = froudeMax * froudeMax * G
    const half = (1 - theta) / 2

    // 東西の面（行 y0..y1-1、面 x0..x1）
    for (let y = y0; y < y1; y++) {
      const rowC = y * W
      const rowF = y * W1
      let prevOld = 0
      for (let x = x0; x <= x1; x++) {
        const f = rowF + x
        const kind = tx[f]!
        const qOld = qx[f]!
        if (kind === 3) {
          qx[f] = 0
          prevOld = qOld
          continue
        }
        const ia = rowC + x - 1
        const ib = rowC + x
        let za: number
        let ha: number
        let zb: number
        let hb: number
        if (kind === 1) {
          zb = z[ib]!
          hb = h[ib]!
          za = zb
          ha = 0
        } else if (kind === 2) {
          za = z[ia]!
          ha = h[ia]!
          zb = za
          hb = 0
        } else {
          za = z[ia]!
          ha = h[ia]!
          zb = z[ib]!
          hb = h[ib]!
        }
        const ea = za + ha
        const eb = zb + hb
        const hf = (ea > eb ? ea : eb) - (za > zb ? za : zb)
        hfx[f] = hf
        if (hf <= dryDepth) {
          qx[f] = 0
          prevOld = qOld
          continue
        }
        let q0 = qOld
        if (useTheta) {
          const left = x > x0 ? prevOld : qOld
          const right = x < x1 ? qx[f + 1]! : qOld
          q0 = theta * qOld + half * (left + right)
        }
        let q = q0 - gdtdx * hf * (eb - ea)
        if (qOld !== 0) q /= 1 + (gdtn2 * (qOld < 0 ? -qOld : qOld)) / (hf * hf * Math.cbrt(hf))
        // フルード数の上限: |q| > FR·h_f·√(g·h_f) ⇔ q² > FR²·g·h_f³（平方根は上限が効くときだけ）
        if (q * q > fr2g * hf * hf * hf) {
          const cap = froudeMax * hf * Math.sqrt(G * hf)
          q = q > 0 ? cap : -cap
          capped++
        }
        if ((kind === 1 && q > 0) || (kind === 2 && q < 0)) q = 0
        qx[f] = q
        prevOld = qOld
      }
    }
    // 南北の面（行 y0..y1、列 x0..x1-1）。θ 重み付けは上下の面の古い q を使うので、上の行の古い値を rowOld に取っておく
    const rowOld = this.rowOld
    for (let y = y0; y <= y1; y++) {
      const rowF = y * W
      for (let x = x0; x < x1; x++) {
        const f = rowF + x
        const qOld = qy[f]!
        const above = y > y0 ? rowOld[x]! : qOld
        rowOld[x] = qOld
        const kind = ty[f]!
        if (kind === 3) {
          qy[f] = 0
          continue
        }
        const ia = f - W
        const ib = f
        let za: number
        let ha: number
        let zb: number
        let hb: number
        if (kind === 1) {
          zb = z[ib]!
          hb = h[ib]!
          za = zb
          ha = 0
        } else if (kind === 2) {
          za = z[ia]!
          ha = h[ia]!
          zb = za
          hb = 0
        } else {
          za = z[ia]!
          ha = h[ia]!
          zb = z[ib]!
          hb = h[ib]!
        }
        const ea = za + ha
        const eb = zb + hb
        const hf = (ea > eb ? ea : eb) - (za > zb ? za : zb)
        hfy[f] = hf
        if (hf <= dryDepth) {
          qy[f] = 0
          continue
        }
        let q0 = qOld
        if (useTheta) {
          const below = y < y1 ? qy[f + W]! : qOld
          q0 = theta * qOld + half * (above + below)
        }
        let q = q0 - gdtdx * hf * (eb - ea)
        if (qOld !== 0) q /= 1 + (gdtn2 * (qOld < 0 ? -qOld : qOld)) / (hf * hf * Math.cbrt(hf))
        if (q * q > fr2g * hf * hf * hf) {
          const cap = froudeMax * hf * Math.sqrt(G * hf)
          q = q > 0 ? cap : -cap
          capped++
        }
        if ((kind === 1 && q > 0) || (kind === 2 && q < 0)) q = 0
        qy[f] = q
      }
    }

    // 正値の制限（§3.5）
    const k = dt / dx
    let limited = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * W + x
        drained[i] = 0
        if (m[i] === 0) continue
        const fw = y * W1 + x
        const fe = fw + 1
        const fn = i
        const fs = i + W
        const qw = qx[fw]!
        const qe = qx[fe]!
        const qn = qy[fn]!
        const qs = qy[fs]!
        const out =
          k * ((qw < 0 ? -qw : 0) + (qe > 0 ? qe : 0) + (qn < 0 ? -qn : 0) + (qs > 0 ? qs : 0))
        if (out > h[i]!) {
          const s = out > 0 ? h[i]! / out : 0
          if (qw < 0) qx[fw] = qw * s
          if (qe > 0) qx[fe] = qe * s
          if (qn < 0) qy[fn] = qn * s
          if (qs > 0) qy[fs] = qs * s
          drained[i] = 1
          limited++
        }
      }
    }

    // 水深の更新・流出・集計・面の流速の最大
    const hn = this.hNext
    let outflow = 0
    let hMax = 0
    let clamped = 0
    let dhSum = 0
    let wx0 = W
    let wx1 = 0
    let wy0 = H
    let wy1 = 0
    const rainOn = this.t < this.rainEnd
    const rainD = rainOn ? this.rainRate * dt : 0
    // 範囲全体の雨は走査範囲（全体）の更新の中で足す。円の雨のセルは走査範囲の中にあり、濡れている
    const rainAllD = this.rainAll ? rainD : 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = y * W + x
        if (m[i] === 0) continue
        const fw = y * W1 + x
        const fe = fw + 1
        const fn = i
        const fs = i + W
        const qw = qx[fw]!
        const qe = qx[fe]!
        const qn = qy[fn]!
        const qs = qy[fs]!
        let v: number
        if (drained[i] === 1) {
          v = k * ((qw > 0 ? qw : 0) - (qe < 0 ? qe : 0) + (qn > 0 ? qn : 0) - (qs < 0 ? qs : 0))
        } else {
          v = h[i]! + k * (qw - qe + qn - qs)
          if (v < 0) {
            v = 0
            clamped++
          }
        }
        const dh = v > h[i]! ? v - h[i]! : h[i]! - v
        if (dh > dhSum) dhSum = dh
        if (tx[fw] === 1 && qw < 0) outflow -= qw
        if (tx[fe] === 2 && qe > 0) outflow += qe
        if (ty[fn] === 1 && qn < 0) outflow -= qn
        if (ty[fs] === 2 && qs > 0) outflow += qs
        if (rainAllD > 0) v += rainAllD
        hn[i] = v
        h[i] = 0
        if (v === 0) continue
        if (v > hMax) hMax = v
        if (x < wx0) wx0 = x
        if (x + 1 > wx1) wx1 = x + 1
        if (y < wy0) wy0 = y
        wy1 = y + 1
      }
    }
    if (rainD > 0) {
      if (this.rainAll) this.totalIn += rainD * this.validCount() * dx * dx
      else if (this.rainCells !== null) {
        for (const i of this.rainCells) {
          hn[i]! += rainD
          if (hn[i]! > hMax) hMax = hn[i]!
        }
        const [bx0, by0, bx1, by1] = this.rainBox as [number, number, number, number]
        if (bx0 < wx0) wx0 = bx0
        if (by0 < wy0) wy0 = by0
        if (bx1 > wx1) wx1 = bx1
        if (by1 > wy1) wy1 = by1
        this.totalIn += rainD * this.rainCells.length * dx * dx
      }
    }
    // 面の流速の最大（正値の制限の後の q。h_f は step の始めの状態）
    let uMax = 0
    let uMax1mm = 0
    let uMax1cm = 0
    let uMax01mm = 0
    let qMax = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const f = y * W1 + x
        const q = qx[f]!
        if (q === 0) continue
        const aq = q < 0 ? -q : q
        if (aq > qMax) qMax = aq
        const hff = hfx[f]!
        const u = aq / hff
        if (u > uMax) uMax = u
        if (hff >= 1e-4 && u > uMax01mm) uMax01mm = u
        if (hff >= 1e-3) {
          if (u > uMax1mm) uMax1mm = u
          if (hff >= 1e-2 && u > uMax1cm) uMax1cm = u
        }
      }
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x < x1; x++) {
        const f = y * W + x
        const q = qy[f]!
        if (q === 0) continue
        const aq = q < 0 ? -q : q
        if (aq > qMax) qMax = aq
        const hff = hfy[f]!
        const u = aq / hff
        if (u > uMax) uMax = u
        if (hff >= 1e-4 && u > uMax01mm) uMax01mm = u
        if (hff >= 1e-3) {
          if (u > uMax1mm) uMax1mm = u
          if (hff >= 1e-2 && u > uMax1cm) uMax1cm = u
        }
      }
    }
    this.h = hn
    this.hNext = h
    const outVol = outflow * dt * dx
    this.outflowTotal += outVol
    this.t += dt
    this.stepCount++
    this.hMax = hMax
    this.uMaxPrev = uMax
    if (this.o.window) {
      const ox0 = x0
      const oy0 = y0
      const ox1 = x1
      const oy1 = y1
      this.x0 = this.x1 = 0
      this.y0 = this.y1 = 0
      if (wx1 > 0) this.include(wx0, wy0, wx1, wy1)
      this.clearOutside(ox0, oy0, ox1, oy1)
    }
    return {
      step: this.stepCount,
      dt,
      t: this.t,
      hMax,
      uMax,
      uMax1mm,
      uMax1cm,
      uMax01mm,
      dhMax: dhSum / dt,
      qMax,
      outflow: outVol,
      raining: this.raining,
      capped,
      limited,
      clamped,
    }
  }

  /** 走査範囲から外れた面の q を 0 にする（§3.8 の不変条件） */
  private clearOutside(ox0: number, oy0: number, ox1: number, oy1: number) {
    const { W, qx, qy } = this
    const W1 = W + 1
    const inX = (x: number, y: number) =>
      y >= this.y0 && y < this.y1 && x >= this.x0 && x <= this.x1 && this.x0 < this.x1
    const inY = (x: number, y: number) =>
      y >= this.y0 && y <= this.y1 && x >= this.x0 && x < this.x1 && this.x0 < this.x1
    for (let y = oy0; y < oy1; y++)
      for (let x = ox0; x <= ox1; x++) if (!inX(x, y)) qx[y * W1 + x] = 0
    for (let y = oy0; y <= oy1; y++)
      for (let x = ox0; x < ox1; x++) if (!inY(x, y)) qy[y * W + x] = 0
  }

  stored(): number {
    let s = 0
    for (let i = 0; i < this.h.length; i++) s += this.h[i]!
    return s * this.dx * this.dx
  }
}
