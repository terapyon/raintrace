import type { Depression } from '../terrain/types.ts'
import {
  CULVERT_BLOCK_DEPOSIT_M,
  CULVERT_CLIMB_WEIGHT,
  CULVERT_END_CELLS,
  CULVERT_MAX_LENGTH_M,
} from './constants.ts'

export interface CulvertInput {
  /** 今の地形 */
  elevation: Float32Array
  /** 昔の地形（offsetM を足した高さ）。NaN は通れない */
  past: Float32Array
  validMask: Uint8Array
  /** 候補のセル（崩れる厚さ > 0 のセル）= 1 */
  candidate: Uint8Array
  /** 今の地形の窪地の解析 */
  labels: Int32Array
  depressions: readonly Depression[]
  size: number
  cellSizeM: number
  /** 長さの上限（m）。省くと CULVERT_MAX_LENGTH_M */
  maxLengthM?: number
}

export interface Culvert {
  /** pit から出口までのセル（4 近傍でつながる） */
  path: Int32Array
  /** path と同じ並びの、各セルの溝の底の高さ。pit から出口へ増えない */
  bed: Float32Array
  /** 候補の外の水路のセルのうち、候補のセルから水路に沿って CULVERT_END_CELLS 以内（入口側と出口側） */
  ends: Int32Array
  lengthM: number
  /** 上流の窪地の id（今の地形の解析） */
  depressionId: number
}

const DR = [0, 1, 0, -1]
const DC = [1, 0, -1, 0]

/** 費用の小さい順に取り出す二分ヒープ（費用と番号の並列配列） */
class MinHeap {
  private cost: number[] = []
  private cell: number[] = []
  get size(): number {
    return this.cost.length
  }
  push(cost: number, cell: number): void {
    let p = this.cost.length
    this.cost.push(cost)
    this.cell.push(cell)
    while (p > 0) {
      const q = (p - 1) >> 1
      if (this.cost[q]! <= cost) break
      this.swap(p, q)
      p = q
    }
  }
  /** 最小の費用のセルを取り出す。空のときは呼ばない */
  pop(): { cost: number; cell: number } {
    const top = { cost: this.cost[0]!, cell: this.cell[0]! }
    const lastCost = this.cost.pop()!
    const lastCell = this.cell.pop()!
    const n = this.cost.length
    if (n > 0) {
      this.cost[0] = lastCost
      this.cell[0] = lastCell
      let p = 0
      for (;;) {
        const a = 2 * p + 1
        const b = a + 1
        let m = p
        if (a < n && this.cost[a]! < this.cost[m]!) m = a
        if (b < n && this.cost[b]! < this.cost[m]!) m = b
        if (m === p) break
        this.swap(p, m)
        p = m
      }
    }
    return top
  }
  private swap(i: number, j: number): void {
    const c = this.cost[i]!
    this.cost[i] = this.cost[j]!
    this.cost[j] = c
    const k = this.cell[i]!
    this.cell[i] = this.cell[j]!
    this.cell[j] = k
  }
}

/** 候補のセルを含む、または候補のセルに 4 近傍で接する窪地のうち、significant で容量が最大のもの */
function pickUpstreamDepression(input: CulvertInput): Depression | null {
  const { labels, candidate, size, depressions } = input
  const touching = new Set<number>()
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const i = r * size + c
      const id = labels[i]!
      if (id <= 0 || touching.has(id)) continue
      let hit = candidate[i] === 1
      for (let d = 0; d < 4 && !hit; d++) {
        const rr = r + DR[d]!
        const cc = c + DC[d]!
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue
        hit = candidate[rr * size + cc] === 1
      }
      if (hit) touching.add(id)
    }
  }
  let best: Depression | null = null
  for (const d of depressions) {
    if (!d.significant || !touching.has(d.id)) continue
    if (best === null || d.capacityM3 > best.capacityM3) best = d
  }
  return best
}

/**
 * 盛土の下に仮定する水路を探す（spec 10b §2）。
 * 候補のセルに接する窪地の pit から、窪地と候補の外で pit より低いセルまで、昔の地形に沿った最も安い道を引く。
 * 見つからない・長すぎる・候補のセルを通らないときは null
 */
export function findCulvert(input: CulvertInput): Culvert | null {
  const { elevation, past, validMask, candidate, labels, size, cellSizeM } = input
  const maxLengthM = input.maxLengthM ?? CULVERT_MAX_LENGTH_M
  const dep = pickUpstreamDepression(input)
  if (dep === null) return null
  const pit = dep.pitIndex
  if (Number.isNaN(past[pit]!)) return null
  const pitZ = elevation[pit]!
  // 浮動小数の丸めで 1 歩分の余裕を失わないよう、わずかに足してから切り捨てる
  const maxSteps = Math.floor(maxLengthM / cellSizeM + 1e-9)

  const n = size * size
  const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY)
  const prev = new Int32Array(n).fill(-1)
  const steps = new Int32Array(n)
  const done = new Uint8Array(n)
  const heap = new MinHeap()
  dist[pit] = 0
  heap.push(0, pit)
  let exit = -1
  while (heap.size > 0) {
    const { cost, cell } = heap.pop()
    if (done[cell]) continue
    done[cell] = 1
    if (labels[cell] !== dep.id && candidate[cell] !== 1 && elevation[cell]! < pitZ) {
      exit = cell
      break
    }
    if (steps[cell]! + 1 > maxSteps) continue
    const r = Math.floor(cell / size)
    const c = cell % size
    for (let d = 0; d < 4; d++) {
      const rr = r + DR[d]!
      const cc = c + DC[d]!
      if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue
      const j = rr * size + cc
      if (done[j] || validMask[j] !== 1) continue
      const pj = past[j]!
      if (Number.isNaN(pj)) continue
      const next = cost + cellSizeM * (1 + CULVERT_CLIMB_WEIGHT * Math.max(0, pj - pitZ))
      if (next < dist[j]!) {
        dist[j] = next
        prev[j] = cell
        steps[j] = steps[cell]! + 1
        heap.push(next, j)
      }
    }
  }
  if (exit < 0) return null

  const cells: number[] = []
  for (let u = exit; u >= 0; u = prev[u]!) cells.push(u)
  cells.reverse()
  const path = Int32Array.from(cells)
  const lengthM = (path.length - 1) * cellSizeM
  if (lengthM > maxLengthM + 1e-6) return null
  const candidateAt: number[] = []
  for (let k = 0; k < path.length; k++) if (candidate[path[k]!] === 1) candidateAt.push(k)
  if (candidateAt.length === 0) return null

  // 溝の底: 今と昔の低い方。pit から出口へ増えないようにならす
  const bed = new Float32Array(path.length)
  for (let k = 0; k < path.length; k++) {
    const i = path[k]!
    bed[k] = Math.min(elevation[i]!, past[i]!)
    if (k > 0) bed[k] = Math.min(bed[k]!, bed[k - 1]!)
  }

  const ends: number[] = []
  for (let k = 0; k < path.length; k++) {
    if (candidate[path[k]!] === 1) continue
    if (candidateAt.some((kc) => Math.abs(kc - k) <= CULVERT_END_CELLS)) ends.push(path[k]!)
  }
  return { path, bed, ends: Int32Array.from(ends), lengthM, depressionId: dep.id }
}

/** z の水路のセルを min(z, bed) にした写し */
export function carveCulvert(z: Float32Array, culvert: Culvert): Float32Array {
  const out = z.slice()
  for (let k = 0; k < culvert.path.length; k++) {
    const i = culvert.path[k]!
    out[i] = Math.min(out[i]!, culvert.bed[k]!)
  }
  return out
}

/** ends のどこかに deposit ≥ CULVERT_BLOCK_DEPOSIT_M があれば true（水路の口が土でふさがれた） */
export function culvertBlocked(culvert: Culvert, deposit: Float32Array): boolean {
  for (const i of culvert.ends) if (deposit[i]! >= CULVERT_BLOCK_DEPOSIT_M) return true
  return false
}
