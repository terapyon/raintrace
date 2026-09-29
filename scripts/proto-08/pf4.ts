/**
 * spec 08 の M0 の試作（使い捨て）: 4 近傍の Priority-Flood（spec 08 §3.7、R08-2）。
 * src/simulation/terrain/analyzeDepressions.ts を写し、近傍の表だけを 4 近傍（東・南・西・北）に替えたもの。
 * 起点の判定（端のセルと、4 近傍に無効セルがあるセル）と走査の両方が 4 近傍
 */
import { CellQueue } from '../../src/simulation/terrain/CellQueue.ts'

const DX4 = [1, 0, -1, 0]
const DY4 = [0, 1, 0, -1]

export interface Depression4 {
  id: number
  pitIndex: number
  spillElevation: number
  maxDepthM: number
  areaM2: number
  capacityM3: number
  significant: boolean
}

export interface Analysis4 {
  fill: Float32Array
  labels: Int32Array
  depressions: Depression4[]
}

export function analyzeDepressions4(
  elevation: Float32Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  cellSizeM: number,
): Analysis4 {
  const n = width * height
  const fill = new Float32Array(n)
  const rawLabels = new Int32Array(n)
  const closed = new Uint8Array(n)
  const queue = new CellQueue(n)
  const parent: number[] = [0]
  const find = (id: number): number => {
    let root = id
    while (parent[root] !== root) root = parent[root] ?? 0
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra < rb) parent[rb] = ra
    else if (rb < ra) parent[ra] = rb
  }
  const isValid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && validMask[y * width + x] === 1

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (validMask[i] === 0) continue
      let seed = x === 0 || y === 0 || x === width - 1 || y === height - 1
      for (let k = 0; k < 4 && !seed; k++) seed = !isValid(x + (DX4[k] ?? 0), y + (DY4[k] ?? 0))
      if (!seed) continue
      fill[i] = elevation[i] ?? 0
      closed[i] = 1
      queue.push(i, fill[i] ?? 0)
    }
  }
  for (let c = queue.pop(); c !== -1; c = queue.pop()) {
    const fc = fill[c] ?? 0
    const cx = c % width
    const cy = (c - cx) / width
    const cLabel = rawLabels[c] ?? 0
    for (let k = 0; k < 4; k++) {
      const nx = cx + (DX4[k] ?? 0)
      const ny = cy + (DY4[k] ?? 0)
      if (!isValid(nx, ny)) continue
      const j = ny * width + nx
      if (closed[j] === 1) {
        const lj = rawLabels[j] ?? 0
        if (cLabel !== 0 && lj !== 0) union(cLabel, lj)
        continue
      }
      closed[j] = 1
      const zj = elevation[j] ?? 0
      if (zj < fc) {
        fill[j] = fc
        if (cLabel !== 0) rawLabels[j] = cLabel
        else {
          const id = parent.length
          parent.push(id)
          rawLabels[j] = id
        }
      } else fill[j] = zj
      queue.push(j, fill[j] ?? 0)
    }
  }
  const finalOf = new Int32Array(parent.length)
  let count = 1
  for (let id = 1; id < parent.length; id++) if (find(id) === id) finalOf[id] = count++
  for (let id = 1; id < parent.length; id++) finalOf[id] = finalOf[find(id)] ?? 0
  const labels = new Int32Array(n)
  const cells = new Int32Array(count)
  const volume = new Float64Array(count)
  const maxDepth = new Float64Array(count)
  const pit = new Int32Array(count).fill(-1)
  const area = cellSizeM * cellSizeM
  for (let i = 0; i < n; i++) {
    const raw = rawLabels[i] ?? 0
    if (raw === 0) continue
    const id = finalOf[raw] ?? 0
    labels[i] = id
    const depth = (fill[i] ?? 0) - (elevation[i] ?? 0)
    cells[id] = (cells[id] ?? 0) + 1
    volume[id] = (volume[id] ?? 0) + depth * area
    if (depth > (maxDepth[id] ?? 0)) maxDepth[id] = depth
    const p = pit[id] ?? -1
    if (p === -1 || (elevation[i] ?? 0) < (elevation[p] ?? 0)) pit[id] = i
  }
  const depressions: Depression4[] = []
  for (let id = 1; id < count; id++) {
    const pitIndex = pit[id] ?? 0
    const maxDepthM = maxDepth[id] ?? 0
    const areaM2 = (cells[id] ?? 0) * area
    depressions.push({
      id,
      pitIndex,
      spillElevation: fill[pitIndex] ?? 0,
      maxDepthM,
      areaM2,
      capacityM3: volume[id] ?? 0,
      // R02-3（深さ 0.1 m 以上・面積 10 m² 以上。丸めの余裕 1 mm）
      significant: maxDepthM >= 0.1 - 1e-3 && areaM2 >= 10,
    })
  }
  return { fill, labels, depressions }
}
