/**
 * 1 step 分の水移動の計算（spec 08 §3。4 近傍の局所慣性式）。エンジンの内部モジュールで、外部には公開しない。
 * 流量は面（セルとセルの境）に置き、面の走査は行優先の固定の順（結果を決定的にする）。02 の地形解析
 * （src/simulation/terrain/）は東から時計回りの順序を使う。どちらも決定的にするための固定の順序で、
 * 揃える必要は無いので、意図的に別の順序を使っている
 */
import { CFL_ALPHA, DRY_DEPTH_M, DT_MAX_S, FROUDE_MAX, GRAVITY, THETA } from './constants.ts'

/**
 * 4 近傍の面の表（北・西・東・南。spec 08 §3.7、R08-2）。y は南向きが正。07 の流出の縁のマスク
 * （outflowCells.ts）はこの表を import する（レビュー 1 の R1）
 */
export const NEIGHBOR_DX = Int8Array.of(0, -1, 1, 0)
export const NEIGHBOR_DY = Int8Array.of(-1, 0, 0, 1)

export interface TerrainArrays {
  width: number
  height: number
  elevation: Float32Array
  validMask: Uint8Array
}

/** 走査範囲。列 [x0, x1)、行 [y0, y1) */
export interface ScanWindow {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 流れのベクトル（x は東が正、y は南が正。m/s） */
export interface FlowVectors {
  x: Float32Array
  y: Float32Array
}

/** 面の両側とも有効セル */
export const FACE_INNER = 0
/**
 * 西（南北の面では北）の側が仮想セル。仮想セル（グリッドの外・無効セル）は流出元と同じ標高で水深 0
 * （R03-2、spec 08 §3.6）
 */
export const FACE_VIRTUAL_BEFORE = 1
/** 東（南北の面では南）の側が仮想セル */
export const FACE_VIRTUAL_AFTER = 2
/** 両側とも仮想セル（流れない） */
export const FACE_CLOSED = 3

/** 面の状態（spec 08 §3.1）。エンジンが 1 つ持ち、使い回す */
export interface Faces {
  width: number
  height: number
  /** 東西の面の単位幅流量（m²/s。東向きが正）。(width + 1) × height。面 (x, y) はセル (x − 1, y) と (x, y) の境 */
  qx: Float64Array
  /** 南北の面の単位幅流量（m²/s。南向きが正）。width × (height + 1)。面 (x, y) はセル (x, y − 1) と (x, y) の境 */
  qy: Float64Array
  /** この step の始めの状態の面の h_f（m）。乾いた面は 0。流速の集計に使う */
  hfx: Float64Array
  hfy: Float64Array
  kindX: Uint8Array
  kindY: Uint8Array
  /** 正値の制限で水をすべて出したセル（その step だけの印） */
  drained: Uint8Array
  /** θ 重み付けで使う、1 つ上の行の南北の面の更新する前の q（列ごと） */
  rowOld: Float64Array
}

export function createFaces(width: number, height: number, validMask: Uint8Array): Faces {
  const valid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && validMask[y * width + x] !== 0
  const kind = (before: boolean, after: boolean): number =>
    before && after
      ? FACE_INNER
      : after
        ? FACE_VIRTUAL_BEFORE
        : before
          ? FACE_VIRTUAL_AFTER
          : FACE_CLOSED
  const kindX = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x <= width; x++) kindX[y * (width + 1) + x] = kind(valid(x - 1, y), valid(x, y))
  }
  const kindY = new Uint8Array(width * (height + 1))
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < width; x++) kindY[y * width + x] = kind(valid(x, y - 1), valid(x, y))
  }
  return {
    width,
    height,
    qx: new Float64Array((width + 1) * height),
    qy: new Float64Array(width * (height + 1)),
    hfx: new Float64Array((width + 1) * height),
    hfy: new Float64Array(width * (height + 1)),
    kindX,
    kindY,
    drained: new Uint8Array(width * height),
    rowOld: new Float64Array(width),
  }
}

/** 流量をすべて 0 に戻す（reset） */
export function clearFaces(f: Faces): void {
  f.qx.fill(0)
  f.qy.fill(0)
  f.hfx.fill(0)
  f.hfy.fill(0)
}

/**
 * 次の step の時間刻み（spec 08 §3.3）。hMax はこの step の始めの最大水深、uMax は前の step の面の流速の最大。
 * 水が無ければ DT_MAX_S。雨の終わりで切るのはエンジン（TsSimulationEngine.step）
 */
export function timeStep(hMax: number, uMax: number, cellSizeM: number): number {
  const c = Math.max(Math.sqrt(GRAVITY * hMax), uMax)
  return c > 0 ? Math.min(DT_MAX_S, (CFL_ALPHA * cellSizeM) / c) : DT_MAX_S
}

/**
 * 走査範囲の中の面の流量を 1 step 進める（spec 08 §3.2・§3.4〜§3.6）。h は step の始めの水深で、読むだけ。
 * 走査範囲は列 [x0, x1)・行 [y0, y1) のセルで、東西の面は行 y0..y1 − 1 の面 x0..x1、南北の面は行 y0..y1 の
 * 列 x0..x1 − 1。範囲の外の面の q は 0（§3.8 の不変条件）。θ 重み付けの両隣は、この step で更新する前の値を使う:
 * 西（北）の隣は更新する前に取っておいた値、東（南）の隣はまだ更新していない値。グリッドの端の面の隣は q 自身、
 * 走査範囲の外の隣の面は保存されている値（0）をそのまま読む（計画で決めたこと 10）
 */
export function updateFaceFlows(
  t: TerrainArrays,
  h: Float64Array,
  win: ScanWindow,
  f: Faces,
  dt: number,
  cellSizeM: number,
  manningN: number,
): void {
  const { width, height, elevation: z } = t
  const { qx, qy, hfx, hfy, kindX, kindY, rowOld } = f
  const { x0, y0, x1, y1 } = win
  if (x0 >= x1) return
  const w1 = width + 1
  const gdtdx = (GRAVITY * dt) / cellSizeM
  const gdtn2 = GRAVITY * dt * manningN * manningN
  const fr2g = FROUDE_MAX * FROUDE_MAX * GRAVITY
  const half = (1 - THETA) / 2
  // 東西の面
  for (let y = y0; y < y1; y++) {
    const rowC = y * width
    const rowF = y * w1
    let prevOld = 0
    for (let x = x0; x <= x1; x++) {
      const i = rowF + x
      const qOld = qx[i]
      const left = x === 0 ? qOld : x > x0 ? prevOld : qx[i - 1]
      prevOld = qOld
      const kind = kindX[i]
      if (kind === FACE_CLOSED) {
        qx[i] = 0
        hfx[i] = 0
        continue
      }
      const a = rowC + x - 1
      const b = rowC + x
      let za: number
      let ha: number
      let zb: number
      let hb: number
      if (kind === FACE_VIRTUAL_BEFORE) {
        zb = z[b]
        hb = h[b]
        za = zb
        ha = 0
      } else if (kind === FACE_VIRTUAL_AFTER) {
        za = z[a]
        ha = h[a]
        zb = za
        hb = 0
      } else {
        za = z[a]
        ha = h[a]
        zb = z[b]
        hb = h[b]
      }
      const ea = za + ha
      const eb = zb + hb
      const hf = (ea > eb ? ea : eb) - (za > zb ? za : zb)
      if (hf <= DRY_DEPTH_M) {
        qx[i] = 0
        hfx[i] = 0
        continue
      }
      hfx[i] = hf
      const right = x === width ? qOld : qx[i + 1]
      let q = THETA * qOld + half * (left + right) - gdtdx * hf * (eb - ea)
      if (qOld !== 0) q /= 1 + (gdtn2 * (qOld < 0 ? -qOld : qOld)) / (hf * hf * Math.cbrt(hf))
      // フルード数の上限: |q| > FR·h_f·√(g·h_f) ⇔ q² > FR²·g·h_f³（平方根は上限が効くときだけ求める）
      if (q * q > fr2g * hf * hf * hf) {
        const cap = FROUDE_MAX * hf * Math.sqrt(GRAVITY * hf)
        q = q > 0 ? cap : -cap
      }
      // 仮想セルは水を持たないので、内向きの流量は 0 に切る（§3.6）
      if ((kind === FACE_VIRTUAL_BEFORE && q > 0) || (kind === FACE_VIRTUAL_AFTER && q < 0)) q = 0
      qx[i] = q
    }
  }
  // 南北の面。北の隣の面の更新する前の値は rowOld に取っておく
  for (let y = y0; y <= y1; y++) {
    const rowF = y * width
    for (let x = x0; x < x1; x++) {
      const i = rowF + x
      const qOld = qy[i]
      const above = y === 0 ? qOld : y > y0 ? rowOld[x] : qy[i - width]
      rowOld[x] = qOld
      const kind = kindY[i]
      if (kind === FACE_CLOSED) {
        qy[i] = 0
        hfy[i] = 0
        continue
      }
      const a = i - width
      const b = i
      let za: number
      let ha: number
      let zb: number
      let hb: number
      if (kind === FACE_VIRTUAL_BEFORE) {
        zb = z[b]
        hb = h[b]
        za = zb
        ha = 0
      } else if (kind === FACE_VIRTUAL_AFTER) {
        za = z[a]
        ha = h[a]
        zb = za
        hb = 0
      } else {
        za = z[a]
        ha = h[a]
        zb = z[b]
        hb = h[b]
      }
      const ea = za + ha
      const eb = zb + hb
      const hf = (ea > eb ? ea : eb) - (za > zb ? za : zb)
      if (hf <= DRY_DEPTH_M) {
        qy[i] = 0
        hfy[i] = 0
        continue
      }
      hfy[i] = hf
      const below = y === height ? qOld : qy[i + width]
      let q = THETA * qOld + half * (above + below) - gdtdx * hf * (eb - ea)
      if (qOld !== 0) q /= 1 + (gdtn2 * (qOld < 0 ? -qOld : qOld)) / (hf * hf * Math.cbrt(hf))
      if (q * q > fr2g * hf * hf * hf) {
        const cap = FROUDE_MAX * hf * Math.sqrt(GRAVITY * hf)
        q = q > 0 ? cap : -cap
      }
      if ((kind === FACE_VIRTUAL_BEFORE && q > 0) || (kind === FACE_VIRTUAL_AFTER && q < 0)) q = 0
      qy[i] = q
    }
  }
}

/**
 * 正値の制限（spec 08 §3.5）。セル i から出る面の流量の合計 dt·Σ(出る向きの q)/Δx が h_i を超えるなら、
 * i から出る面の q に h_i / out_i を掛け、drained に印を付ける。どの面も出る向きのセルは 1 つだけなので、
 * 縮めても両側の増減は一致する。縮めた q を次の step の q として持つ
 */
export function limitOutflows(
  t: TerrainArrays,
  h: Float64Array,
  win: ScanWindow,
  f: Faces,
  dt: number,
  cellSizeM: number,
): void {
  const { width, validMask } = t
  const { qx, qy, drained } = f
  const w1 = width + 1
  const k = dt / cellSizeM
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      drained[i] = 0
      if (validMask[i] === 0) continue
      const fw = y * w1 + x
      const fe = fw + 1
      const fn = i
      const fs = i + width
      const qw = qx[fw]
      const qe = qx[fe]
      const qn = qy[fn]
      const qs = qy[fs]
      const out =
        k * ((qw < 0 ? -qw : 0) + (qe > 0 ? qe : 0) + (qn < 0 ? -qn : 0) + (qs > 0 ? qs : 0))
      if (out <= h[i]) continue
      const s = h[i] / out
      if (qw < 0) qx[fw] = qw * s
      if (qe > 0) qx[fe] = qe * s
      if (qn < 0) qy[fn] = qn * s
      if (qs > 0) qy[fs] = qs * s
      drained[i] = 1
    }
  }
}

/**
 * 水深を更新する（spec 08 §3.2 の h'）。走査範囲の有効セルの next に書く（呼ぶ前の next は 0。WaterGrid の不変条件）。
 * 水をすべて出したセル（drained）は入ってくる量だけにし、自分の水はちょうど 0 にする（§3.5。計画で決めたこと 7）。
 * 丸めで負になった水深は 0 にする。戻り値は仮想セルへ出た流量の合計 Σq（m²/s）。× Δx × dt が流出量（m³）
 */
export function applyFaceFlows(
  t: TerrainArrays,
  h: Float64Array,
  next: Float64Array,
  win: ScanWindow,
  f: Faces,
  dt: number,
  cellSizeM: number,
): number {
  const { width, validMask } = t
  const { qx, qy, kindX, kindY, drained } = f
  const w1 = width + 1
  const k = dt / cellSizeM
  let outflow = 0
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      if (validMask[i] === 0) continue
      const fw = y * w1 + x
      const fe = fw + 1
      const fn = i
      const fs = i + width
      const qw = qx[fw]
      const qe = qx[fe]
      const qn = qy[fn]
      const qs = qy[fs]
      let v: number
      if (drained[i] === 1) {
        v = k * ((qw > 0 ? qw : 0) - (qe < 0 ? qe : 0) + (qn > 0 ? qn : 0) - (qs < 0 ? qs : 0))
      } else {
        v = h[i] + k * (qw - qe + qn - qs)
        if (v < 0) v = 0
      }
      if (kindX[fw] === FACE_VIRTUAL_BEFORE && qw < 0) outflow -= qw
      if (kindX[fe] === FACE_VIRTUAL_AFTER && qe > 0) outflow += qe
      if (kindY[fn] === FACE_VIRTUAL_BEFORE && qn < 0) outflow -= qn
      if (kindY[fs] === FACE_VIRTUAL_AFTER && qs > 0) outflow += qs
      next[i] = v
    }
  }
  return outflow
}

/** 走査範囲の面の流速 |q| / h_f の最大（m/s）。h_f はこの step の始めの値（spec 08 §3.3 の u_max、§3.9 の停止） */
export function faceVelocityMax(win: ScanWindow, f: Faces): number {
  const { width, qx, qy, hfx, hfy } = f
  const { x0, y0, x1, y1 } = win
  if (x0 >= x1) return 0
  const w1 = width + 1
  let u = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w1 + x
      const q = qx[i]
      if (q === 0) continue
      const v = (q < 0 ? -q : q) / hfx[i]
      if (v > u) u = v
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x
      const q = qy[i]
      if (q === 0) continue
      const v = (q < 0 ? -q : q) / hfy[i]
      if (v > u) u = v
    }
  }
  return u
}

/**
 * 走査範囲が before から after に変わったとき、before の面のうち after の面に入らないものの q を 0 にする
 * （spec 08 §3.8 の不変条件: 走査範囲の外の面の q は 0）。after が before より広がった分の面は、もともと 0
 */
export function clearFacesOutside(f: Faces, before: ScanWindow, after: ScanWindow): void {
  if (before.x0 >= before.x1) return
  const { width, qx, qy } = f
  const w1 = width + 1
  const empty = after.x0 >= after.x1
  for (let y = before.y0; y < before.y1; y++) {
    const rowInside = !empty && y >= after.y0 && y < after.y1
    for (let x = before.x0; x <= before.x1; x++) {
      if (rowInside && x >= after.x0 && x <= after.x1) continue
      qx[y * w1 + x] = 0
    }
  }
  for (let y = before.y0; y <= before.y1; y++) {
    const rowInside = !empty && y >= after.y0 && y <= after.y1
    for (let x = before.x0; x < before.x1; x++) {
      if (rowInside && x >= after.x0 && x < after.x1) continue
      qy[y * width + x] = 0
    }
  }
}

/**
 * 各セルの中心の流速（m/s。x は東、y は南が正。spec 08 §3.10）: 両側の面の流量の平均 ÷ 水深。水深が DRY_DEPTH_M
 * 以下のセルと走査範囲の外は 0。out を渡すと（大きさが合えば）それを 0 で埋めて書き、返す（使い回し。spec 06 §5.2）
 */
export function cellVelocities(
  t: TerrainArrays,
  h: Float64Array,
  win: ScanWindow,
  f: Faces,
  out?: FlowVectors,
): FlowVectors {
  const { width, height } = t
  const n = width * height
  let vx: Float32Array
  let vy: Float32Array
  if (out !== undefined && out.x.length === n && out.y.length === n) {
    vx = out.x
    vy = out.y
    vx.fill(0)
    vy.fill(0)
  } else {
    vx = new Float32Array(n)
    vy = new Float32Array(n)
  }
  const { qx, qy } = f
  const w1 = width + 1
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      const d = h[i]
      if (d <= DRY_DEPTH_M) continue
      const fw = y * w1 + x
      vx[i] = (qx[fw] + qx[fw + 1]) / 2 / d
      vy[i] = (qy[i] + qy[i + width]) / 2 / d
    }
  }
  return out !== undefined && vx === out.x ? out : { x: vx, y: vy }
}
