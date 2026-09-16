/**
 * Priority-Flood 用の優先度付きキュー（二分ヒープ）。値の小さい順に取り出し、同じ値なら先に入れたものを
 * 先に出す。挿入順を第2キーにして、同じ標高の縁が複数あるときの結果を決定的にする（spec 02 §5）。
 * 各セルは高々 1 回だけ入れる前提で、容量をセル数にする
 */
export class CellQueue {
  private readonly heap: Int32Array // 挿入の通し番号
  private readonly cellOf: Int32Array // 通し番号 → セル
  private readonly keyOf: Float64Array // 通し番号 → 値
  private size = 0
  private pushed = 0

  constructor(capacity: number) {
    this.heap = new Int32Array(capacity)
    this.cellOf = new Int32Array(capacity)
    this.keyOf = new Float64Array(capacity)
  }

  get length(): number {
    return this.size
  }

  push(cell: number, key: number): void {
    if (this.pushed >= this.heap.length) throw new Error('CellQueue の容量を超えました')
    const seq = this.pushed++
    this.cellOf[seq] = cell
    this.keyOf[seq] = key
    let i = this.size++
    this.heap[i] = seq
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!this.less(this.heap[i], this.heap[parent])) break
      this.swap(i, parent)
      i = parent
    }
  }

  /** 最小の要素のセルを取り出す。空なら -1 */
  pop(): number {
    if (this.size === 0) return -1
    const top = this.heap[0]
    this.size--
    if (this.size > 0) {
      this.heap[0] = this.heap[this.size]
      this.siftDown(0)
    }
    return this.cellOf[top]
  }

  private siftDown(start: number): void {
    let i = start
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let smallest = i
      if (left < this.size && this.less(this.heap[left], this.heap[smallest])) smallest = left
      if (right < this.size && this.less(this.heap[right], this.heap[smallest])) smallest = right
      if (smallest === i) return
      this.swap(i, smallest)
      i = smallest
    }
  }

  private less(a: number, b: number): boolean {
    const ka = this.keyOf[a]
    const kb = this.keyOf[b]
    return ka < kb || (ka === kb && a < b)
  }

  private swap(i: number, j: number): void {
    const t = this.heap[i]
    this.heap[i] = this.heap[j]
    this.heap[j] = t
  }
}
