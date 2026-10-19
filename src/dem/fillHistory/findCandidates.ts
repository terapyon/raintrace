import { FILL_MIN_AREA_M2, FILL_THRESHOLD_M } from './constants.ts'
import type { GridFrame } from './resamplePast.ts'

export interface CandidateStats {
  id: number
  cellCount: number
  areaM2: number
  /** かたまりの中の標高差の最大（m） */
  maxRiseM: number
  /** 参考値: Σ 標高差 × セルの面積（m³） */
  volumeM3: number
  /** セルの番号の平均（小数） */
  centroid: { col: number; row: number }
  /** 外接する矩形。col1・row1 は含む */
  bbox: { col0: number; row0: number; col1: number; row1: number }
}

/**
 * 標高差が +FILL_THRESHOLD_M 以上のセルを 4 近傍でつなげてかたまりにし、
 * 面積が FILL_MIN_AREA_M2 未満のものを捨てる。NaN のセルは対象外（かたまりを分ける）。
 * labels は候補のセルに id（面積の大きい順に 1 から）、それ以外は 0。
 */
export function findCandidates(
  delta: Float32Array,
  frame: GridFrame,
): { labels: Int32Array; candidates: CandidateStats[] } {
  const { size, cellSizeM } = frame
  const cellArea = cellSizeM * cellSizeM
  const visited = new Uint8Array(size * size)
  const queue = new Int32Array(size * size) // 幅優先の塗り（再帰を使わない）
  const found: (Omit<CandidateStats, 'id'> & { cells: number[] })[] = []

  for (let start = 0; start < size * size; start++) {
    if (visited[start] || !((delta[start] ?? Number.NaN) >= FILL_THRESHOLD_M)) continue

    let head = 0
    let tail = 0
    queue[tail++] = start
    visited[start] = 1
    let sumCol = 0
    let sumRow = 0
    let maxRise = -Infinity
    let sumDelta = 0
    let col0 = size
    let row0 = size
    let col1 = -1
    let row1 = -1

    while (head < tail) {
      const i = queue[head++] as number
      const col = i % size
      const row = (i - col) / size
      const v = delta[i] as number
      sumCol += col
      sumRow += row
      sumDelta += v
      if (v > maxRise) maxRise = v
      if (col < col0) col0 = col
      if (col > col1) col1 = col
      if (row < row0) row0 = row
      if (row > row1) row1 = row

      const around = [
        col > 0 ? i - 1 : -1,
        col < size - 1 ? i + 1 : -1,
        row > 0 ? i - size : -1,
        row < size - 1 ? i + size : -1,
      ]
      for (const j of around) {
        if (j < 0 || visited[j] || !((delta[j] ?? Number.NaN) >= FILL_THRESHOLD_M)) continue
        visited[j] = 1
        queue[tail++] = j
      }
    }

    const cellCount = tail
    if (cellCount * cellArea < FILL_MIN_AREA_M2) continue
    found.push({
      cellCount,
      areaM2: cellCount * cellArea,
      maxRiseM: maxRise,
      volumeM3: sumDelta * cellArea,
      centroid: { col: sumCol / cellCount, row: sumRow / cellCount },
      bbox: { col0, row0, col1, row1 },
      cells: Array.from(queue.subarray(0, cellCount)),
    })
  }

  // 面積の大きい順（同じ面積なら見つけた順）に id を振る
  found.sort((a, b) => b.areaM2 - a.areaM2)
  const labels = new Int32Array(size * size)
  const candidates = found.map(({ cells, ...stats }, k) => {
    const id = k + 1
    for (const c of cells) labels[c] = id
    return { id, ...stats }
  })
  return { labels, candidates }
}
