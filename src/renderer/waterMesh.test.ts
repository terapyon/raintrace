import { describe, expect, it } from 'vitest'
import { type GridPatch, gridPatches, patchBytes, patchIndices, patchVertices } from './waterMesh'

/**
 * Task 17a の前の一枚の格子の実装の写し（区画版と同じ三角形になることの基準。src からは消した）。
 * 頂点番号は行優先の (行 × n + 列)
 */
function legacyGridIndices(n: number): Uint32Array {
  const out = new Uint32Array((n - 1) * (n - 1) * 6)
  let k = 0
  for (let row = 0; row < n - 1; row++) {
    for (let col = 0; col < n - 1; col++) {
      const a = row * n + col
      const b = a + 1
      const d = a + n
      const e = d + 1
      out[k++] = a
      out[k++] = d
      out[k++] = b
      out[k++] = b
      out[k++] = d
      out[k++] = e
    }
  }
  return out
}

/** 3 つ組にして、向きを保ったまま辞書順に並べ替える（三角形の集合の比較用） */
function sortedTriangles(indices: ArrayLike<number>): string[] {
  const out: string[] = []
  for (let i = 0; i < indices.length; i += 3) {
    out.push(`${indices[i]},${indices[i + 1]},${indices[i + 2]}`)
  }
  return out.sort()
}

/** 区画の索引を、区画の頂点の (列, 行) を通して格子全体の頂点番号 (行 × n + 列) に直す */
function globalIndices(patch: GridPatch, n: number): number[] {
  const vertices = patchVertices(patch)
  return Array.from(patchIndices(patch), (v) => {
    const col = vertices[v * 2] as number
    const row = vertices[v * 2 + 1] as number
    return row * n + col
  })
}

describe('水面の格子の区画（spec 05 §3.1、spec 06 §5.2 Task 17a）', () => {
  it('gridPatches(7, 3) は 2 × 2 = 4 区画を行優先（北から、西から）に並べる', () => {
    expect(gridPatches(7, 3)).toEqual([
      { col0: 0, row0: 0, cols: 3, rows: 3 },
      { col0: 3, row0: 0, cols: 3, rows: 3 },
      { col0: 0, row0: 3, cols: 3, rows: 3 },
      { col0: 3, row0: 3, cols: 3, rows: 3 },
    ])
  })

  it('gridPatches(8, 3) は 3 × 3 = 9 区画で、東と南の端の区画は 1 セル', () => {
    const patches = gridPatches(8, 3)
    expect(patches).toHaveLength(9)
    expect(patches[2]).toEqual({ col0: 6, row0: 0, cols: 1, rows: 3 })
    expect(patches[6]).toEqual({ col0: 0, row0: 6, cols: 3, rows: 1 })
    expect(patches[8]).toEqual({ col0: 6, row0: 6, cols: 1, rows: 1 })
  })

  it('区画の頂点は格子全体の（列, 行）を区画の中の行優先で持つ', () => {
    expect(Array.from(patchVertices({ col0: 3, row0: 6, cols: 2, rows: 1 }))).toEqual([
      3, 6, 4, 6, 5, 6, 3, 7, 4, 7, 5, 7,
    ])
  })

  it('区画の三角形は (a, d, b)(b, d, e)。頂点番号は区画の中の行優先', () => {
    const indices = patchIndices({ col0: 3, row0: 3, cols: 2, rows: 2 })
    expect(indices).toBeInstanceOf(Uint16Array)
    expect(indices.length).toBe(2 * 2 * 2 * 3)
    expect(Array.from(indices.slice(0, 6))).toEqual([0, 3, 1, 1, 3, 4])
  })

  it('n = 8・patchCells = 3 の区画の三角形の集合（向きを含む）は、旧版の一枚の格子と一致する', () => {
    const n = 8
    const fromPatches = gridPatches(n, 3).flatMap((patch) => globalIndices(patch, n))
    expect(sortedTriangles(fromPatches)).toEqual(sortedTriangles(legacyGridIndices(n)))
  })

  it('1000 m（N = 1031）は 25 区画、三角形の合計は 2 × 1030²、各区画の頂点は 65,536 個以下で索引は頂点数未満', () => {
    const patches = gridPatches(1031)
    expect(patches).toHaveLength(25)
    let triangles = 0
    for (const patch of patches) {
      const vertexCount = patchVertices(patch).length / 2
      const indices = patchIndices(patch)
      expect(vertexCount).toBeLessThanOrEqual(65_536)
      let max = 0
      for (const v of indices) max = Math.max(max, v)
      expect(max).toBe(vertexCount - 1)
      expect(patchBytes(patch)).toBe(patchVertices(patch).byteLength + indices.byteLength)
      triangles += indices.length / 3
    }
    expect(triangles).toBe(2 * 1030 ** 2)
  })

  it('500 m（N = 515）は 9 区画、三角形の合計は 2 × 514²', () => {
    const patches = gridPatches(515)
    expect(patches).toHaveLength(9)
    expect(patches.reduce((sum, patch) => sum + patch.cols * patch.rows * 2, 0)).toBe(2 * 514 ** 2)
  })
})
