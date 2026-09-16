/**
 * 水深の2つのバッファ（W と W'）と走査範囲（spec 03 §3.5）。
 *
 * 不変条件: step と step の間では、next はすべて 0 で、current は走査範囲の外で 0 である。
 * endStep で入れ替えた後、書き込み先になる古いバッファを今の走査範囲で 0 にして、これを保つ
 */
import { FLOODED_DEPTH_M } from './constants.ts'

export interface WaterSummary {
  /** Σ W（m）。セル面積を掛けると貯留量 */
  depthSum: number
  /** 最大水深（m） */
  maxDepth: number
  /** 水深が FLOODED_DEPTH_M 以上のセルの数 */
  floodedCells: number
}

export class WaterGrid {
  readonly width: number
  readonly height: number
  /** true なら走査範囲を常にグリッド全体にする（scanMode: 'full'） */
  readonly full: boolean
  /** W（現在の水深） */
  current: Float64Array
  /** W'（次の step の書き込み先） */
  next: Float64Array
  /** 走査範囲。列 [x0, x1)、行 [y0, y1)。空のときは x0 = x1 */
  x0 = 0
  y0 = 0
  x1 = 0
  y1 = 0

  constructor(width: number, height: number, full: boolean) {
    this.width = width
    this.height = height
    this.full = full
    this.current = new Float64Array(width * height)
    this.next = new Float64Array(width * height)
    this.resetWindow()
  }

  /** 水をすべて消す */
  clear(): void {
    this.current.fill(0)
    this.next.fill(0)
    this.resetWindow()
  }

  /** セルの矩形（列 [cx0, cx1)、行 [cy0, cy1)）と、その周囲 1 セルを走査範囲に含める */
  include(cx0: number, cy0: number, cx1: number, cy1: number): void {
    if (this.full) return
    const x0 = Math.max(0, cx0 - 1)
    const y0 = Math.max(0, cy0 - 1)
    const x1 = Math.min(this.width, cx1 + 1)
    const y1 = Math.min(this.height, cy1 + 1)
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

  /** W' ← W（走査範囲のみ） */
  beginStep(): void {
    const { width, x0, x1, current, next } = this
    for (let y = this.y0; y < this.y1; y++) {
      const a = y * width + x0
      next.set(current.subarray(a, a + (x1 - x0)), a)
    }
  }

  /**
   * W と W' を入れ替え、新しい W を走査範囲で集計し、走査範囲を濡れたセルの外接矩形と
   * その周囲 1 セルに更新する。
   *
   * 新しく濡れたセルは、すべて今の走査範囲の中にある。根拠は次の 2 点:
   * (1) 今の走査範囲は、step の前に濡れていたセルと、その周囲 1 セルを含む
   * (2) 水の出どころは W > 0 のセルだけで、水は 1 step に 8 近傍（周囲 1 セル）までしか動かない
   * したがって、集計と外接矩形の計算は今の走査範囲だけを見ればよい
   */
  endStep(): WaterSummary {
    const w = this.next
    this.next = this.current
    this.current = w
    const { width, x0, x1, next } = this
    let depthSum = 0
    let maxDepth = 0
    let floodedCells = 0
    let wetX0 = width
    let wetX1 = 0
    let wetY0 = this.height
    let wetY1 = 0
    for (let y = this.y0; y < this.y1; y++) {
      const row = y * width
      next.fill(0, row + x0, row + x1)
      for (let x = x0; x < x1; x++) {
        const d = w[row + x]
        if (d === 0) continue
        depthSum += d
        if (d > maxDepth) maxDepth = d
        if (d >= FLOODED_DEPTH_M) floodedCells++
        if (x < wetX0) wetX0 = x
        if (x + 1 > wetX1) wetX1 = x + 1
        if (y < wetY0) wetY0 = y
        wetY1 = y + 1
      }
    }
    if (!this.full) {
      this.resetWindow()
      if (wetX1 > 0) this.include(wetX0, wetY0, wetX1, wetY1)
    }
    return { depthSum, maxDepth, floodedCells }
  }

  private resetWindow(): void {
    this.x0 = 0
    this.y0 = 0
    this.x1 = this.full ? this.width : 0
    this.y1 = this.full ? this.height : 0
  }
}
