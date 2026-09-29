// biome-ignore-all lint/style/noNonNullAssertion: 使い捨ての試作。型付き配列の添字は範囲内
/**
 * spec 08 の M0 の試作（使い捨て）: 合成の地形・越流の追跡・計測の道具
 */
import type { Depression4 } from './pf4.ts'

export interface Terrain {
  elevation: Float32Array
  validMask: Uint8Array
  width: number
  height: number
  cellSizeM: number
}

/** f(x, y) が NaN なら無効セル */
export function buildTerrain(
  width: number,
  height: number,
  cellSizeM: number,
  f: (x: number, y: number) => number,
): Terrain {
  const elevation = new Float32Array(width * height)
  const validMask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = f(x, y)
      if (Number.isNaN(v)) continue
      elevation[y * width + x] = v
      validMask[y * width + x] = 1
    }
  }
  return { elevation, validMask, width, height, cellSizeM }
}

/** 窪地の越流の通知（R03-6: 最低点の水面が spill − 1 cm に達したら 1 回）と、水位の推移の記録 */
export class SpillTracker {
  readonly list: Depression4[]
  readonly notifiedAt: Float64Array
  readonly notifiedStep: Float64Array
  /** 最低点の水面が spill − 1 cm を下回った最後の時刻（通知の後に下がったかを見る） */
  readonly lastBelowAt: Float64Array
  /** 通知の後に spill − 1 cm を下回った回数 */
  readonly dipsAfter: Int32Array
  /** 通知の後の最低点の水面の最小（spill 標高との差、m） */
  readonly minAfter: Float64Array

  constructor(list: Depression4[]) {
    this.list = list
    this.notifiedAt = new Float64Array(list.length).fill(Number.NaN)
    this.notifiedStep = new Float64Array(list.length).fill(Number.NaN)
    this.lastBelowAt = new Float64Array(list.length).fill(0)
    this.dipsAfter = new Int32Array(list.length)
    this.minAfter = new Float64Array(list.length).fill(Number.POSITIVE_INFINITY)
  }

  update(elevation: Float64Array, h: Float64Array, t: number, step: number): number[] {
    const events: number[] = []
    for (let k = 0; k < this.list.length; k++) {
      const d = this.list[k]!
      const eta = elevation[d.pitIndex]! + h[d.pitIndex]!
      const reached = h[d.pitIndex]! > 0 && eta >= d.spillElevation - 0.01
      if (!reached) {
        this.lastBelowAt[k] = t
        if (!Number.isNaN(this.notifiedAt[k]!)) this.dipsAfter[k]!++
      }
      if (!Number.isNaN(this.notifiedAt[k]!)) {
        const diff = eta - d.spillElevation
        if (diff < this.minAfter[k]!) this.minAfter[k] = diff
      }
      if (reached && Number.isNaN(this.notifiedAt[k]!)) {
        this.notifiedAt[k] = t
        this.notifiedStep[k] = step
        events.push(k)
      }
    }
    return events
  }
}

/** 池の中（4 近傍の窪地のセル）と外に分けた水の量 */
export function waterSplit(
  h: Float64Array,
  labels: Int32Array,
  significantIds: Set<number>,
  cellArea: number,
): {
  outsideVol: number
  outsideMaxH: number
  outsideWetCells: number
  pondVol: number
  smallPondVol: number
} {
  let outsideVol = 0
  let outsideMaxH = 0
  let outsideWetCells = 0
  let pondVol = 0
  let smallPondVol = 0
  for (let i = 0; i < h.length; i++) {
    const v = h[i]!
    if (v === 0) continue
    const l = labels[i]!
    if (l === 0) {
      outsideVol += v
      if (v > outsideMaxH) outsideMaxH = v
      if (v > 1e-5) outsideWetCells++
    } else if (significantIds.has(l)) pondVol += v
    else smallPondVol += v
  }
  return {
    outsideVol: outsideVol * cellArea,
    outsideMaxH,
    outsideWetCells,
    pondVol: pondVol * cellArea,
    smallPondVol: smallPondVol * cellArea,
  }
}

/**
 * 市松（2Δx）の成分の大きさ: 4 近傍がすべて濡れている内側のセルで、η − 4 近傍の η の平均 の絶対値の最大と RMS。
 * 滑らかな波なら曲率 × Δx² 程度に小さい。市松の振動なら水面の振れ幅そのものの大きさになる
 */
export function checkerAmplitude(
  z: Float64Array,
  h: Float64Array,
  width: number,
  height: number,
  minDepth: number,
): { max: number; rms: number; cells: number } {
  let max = 0
  let sum = 0
  let cells = 0
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if (h[i]! <= minDepth) continue
      if (
        h[i - 1]! <= minDepth ||
        h[i + 1]! <= minDepth ||
        h[i - width]! <= minDepth ||
        h[i + width]! <= minDepth
      )
        continue
      const e = z[i]! + h[i]!
      const avg =
        (z[i - 1]! +
          h[i - 1]! +
          z[i + 1]! +
          h[i + 1]! +
          z[i - width]! +
          h[i - width]! +
          z[i + width]! +
          h[i + width]!) /
        4
      // 水面が平らなら 0。底の凹凸は η に現れない（池の中）
      const d = Math.abs(e - avg)
      if (d > max) max = d
      sum += d * d
      cells++
    }
  }
  return { max, rms: cells > 0 ? Math.sqrt(sum / cells) : 0, cells }
}

/** 市松の振動の兆し: 濡れた面のうち、前の step と q の符号が逆になった面の割合 */
export class FlipCounter {
  private prevX: Float64Array
  private prevY: Float64Array

  constructor(qx: Float64Array, qy: Float64Array) {
    this.prevX = qx.slice()
    this.prevY = qy.slice()
  }

  update(qx: Float64Array, qy: Float64Array, minQ: number): { flips: number; faces: number } {
    let flips = 0
    let faces = 0
    for (let f = 0; f < qx.length; f++) {
      const a = this.prevX[f]!
      const b = qx[f]!
      if (Math.abs(a) > minQ && Math.abs(b) > minQ) {
        faces++
        if (a * b < 0) flips++
      }
    }
    for (let f = 0; f < qy.length; f++) {
      const a = this.prevY[f]!
      const b = qy[f]!
      if (Math.abs(a) > minQ && Math.abs(b) > minQ) {
        faces++
        if (a * b < 0) flips++
      }
    }
    this.prevX.set(qx)
    this.prevY.set(qy)
    return { flips, faces }
  }
}

export function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return h > 0
    ? `${h}h${String(m).padStart(2, '0')}m`
    : m > 0
      ? `${m}m${String(sec).padStart(2, '0')}s`
      : `${s.toFixed(1)}s`
}
