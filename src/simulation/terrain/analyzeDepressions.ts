import { CellQueue } from './CellQueue.ts'
import { NEIGHBOR_DX, NEIGHBOR_DY } from './neighbors.ts'
import type { Depression, DepressionAnalysis, TerrainGrid } from './types.ts'

/** 表示と越流イベントの対象にする窪地の閾値（R02-3） */
export const SIGNIFICANT_DEPRESSION = { minDepthM: 0.05, minAreaM2: 10 } as const

/**
 * 標高は Float32 で持つので、F − Z に絶対標高に応じた丸めの誤差が乗る
 *（3.05 − 3.00 は 0.04999995、1000.05 − 1000.00 は 0.04998779）。
 * DEM は 1cm 刻みなので、1mm の余裕なら隣の値と取り違えない
 */
export const DEPTH_TOLERANCE_M = 1e-3

/** 窪地が表示と越流イベントの対象か（R02-3。Float32 の丸めを吸収する） */
export function isSignificant(
  d: Pick<Depression, 'maxDepthM' | 'areaM2'>,
  criteria: { minDepthM: number; minAreaM2: number } = SIGNIFICANT_DEPRESSION,
): boolean {
  return d.maxDepthM >= criteria.minDepthM - DEPTH_TOLERANCE_M && d.areaM2 >= criteria.minAreaM2
}

/**
 * Priority-Flood（Barnes ほか, 2014）で満水時の水面 F と窪地を求める（spec 02 §5）。
 * - 起点は、グリッドの端のセルと、無効セルに隣接するセル（03 の境界の扱い R03-2 と揃える）
 * - 取り出したセル c の近傍 n が Z_n < F_c なら、n は窪地の中にあり F_c まで引き上げられる。
 *   c がまだ引き上げられていなければ、新しい窪地で、c がその spill point になる
 * - 引き上げ済みのセルどうしが別のラベルで隣り合ったら、同じ水位の 1 つの窪地として併合する
 *   （同じ標高の縁が複数あると、別々に始まった引き上げが後で出会う）。併合した窪地の spill point は、先にできた方のもの
 */
export function analyzeDepressions(
  grid: TerrainGrid,
  criteria: { minDepthM: number; minAreaM2: number } = SIGNIFICANT_DEPRESSION,
): DepressionAnalysis {
  const { elevation, validMask, width, height, cellSizeM } = grid
  const n = width * height
  const fill = new Float32Array(n)
  const rawLabels = new Int32Array(n)
  const closed = new Uint8Array(n)
  const queue = new CellQueue(n)
  // 窪地の仮の番号の union-find。番号 0 は「窪地の外」
  const parent: number[] = [0]
  const spillOf: number[] = [-1]
  const find = (id: number): number => {
    let root = id
    while (parent[root] !== root) root = parent[root]
    let current = id
    while (parent[current] !== root) {
      const next = parent[current]
      parent[current] = root
      current = next
    }
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
      for (let k = 0; k < 8 && !seed; k++) seed = !isValid(x + NEIGHBOR_DX[k], y + NEIGHBOR_DY[k])
      if (!seed) continue
      fill[i] = elevation[i]
      closed[i] = 1
      queue.push(i, fill[i])
    }
  }

  for (let c = queue.pop(); c !== -1; c = queue.pop()) {
    const fc = fill[c]
    const cx = c % width
    const cy = (c - cx) / width
    const cLabel = rawLabels[c]
    for (let k = 0; k < 8; k++) {
      const nx = cx + NEIGHBOR_DX[k]
      const ny = cy + NEIGHBOR_DY[k]
      if (!isValid(nx, ny)) continue
      const j = ny * width + nx
      if (closed[j] === 1) {
        if (cLabel !== 0 && rawLabels[j] !== 0) union(cLabel, rawLabels[j])
        continue
      }
      closed[j] = 1
      if (elevation[j] < fc) {
        fill[j] = fc
        if (cLabel !== 0) {
          rawLabels[j] = cLabel
        } else {
          const id = parent.length
          parent.push(id)
          spillOf.push(c)
          rawLabels[j] = id
        }
      } else {
        fill[j] = elevation[j]
      }
      queue.push(j, fill[j])
    }
  }

  // 仮の番号を、併合の代表（先にできた方）ごとに 1 から振り直す
  const finalOf = new Int32Array(parent.length)
  const representatives: number[] = [0]
  for (let id = 1; id < parent.length; id++) {
    if (find(id) === id) {
      representatives.push(id)
      finalOf[id] = representatives.length - 1
    }
  }
  for (let id = 1; id < parent.length; id++) finalOf[id] = finalOf[find(id)]

  const count = representatives.length
  const labels = new Int32Array(n)
  const cells = new Int32Array(count)
  const volume = new Float64Array(count)
  const maxDepth = new Float64Array(count)
  const pit = new Int32Array(count).fill(-1)
  const cellArea = cellSizeM * cellSizeM
  for (let i = 0; i < n; i++) {
    const raw = rawLabels[i]
    if (raw === 0) continue
    const id = finalOf[raw]
    labels[i] = id
    const depth = fill[i] - elevation[i]
    cells[id]++
    volume[id] += depth * cellArea
    if (depth > maxDepth[id]) maxDepth[id] = depth
    if (pit[id] === -1 || elevation[i] < elevation[pit[id]]) pit[id] = i
  }

  const depressions: Depression[] = []
  for (let id = 1; id < count; id++) {
    const depression: Omit<Depression, 'significant'> = {
      id,
      pitIndex: pit[id],
      spillIndex: spillOf[representatives[id]],
      spillElevation: fill[pit[id]],
      maxDepthM: maxDepth[id],
      areaM2: cells[id] * cellArea,
      capacityM3: volume[id],
      cellCount: cells[id],
    }
    depressions.push({ ...depression, significant: isSignificant(depression, criteria) })
  }
  return { fill, labels, depressions }
}
