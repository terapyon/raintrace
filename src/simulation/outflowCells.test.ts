import { describe, expect, it } from 'vitest'
import { NEIGHBOR_DX, NEIGHBOR_DY } from './FlowSolver.ts'
import {
  buildOutflowCells,
  OUTFLOW_BAND_RATIO,
  outflowBandCells,
  outflowBoundaryMask,
  outflowNearest,
} from './outflowCells.ts'

/** 行ごとの文字列から有効セルのマスクを作る（'#' は有効、'.' は無効） */
function grid(rows: string[]): { validMask: Uint8Array; width: number; height: number } {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const validMask = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) validMask[y * width + x] = row[x] === '#' ? 1 : 0
  })
  return { validMask, width, height }
}

/** 0/1 の配列を行ごとの文字列にする */
function rowsOf(values: ArrayLike<number>, width: number): string[] {
  const rows: string[] = []
  for (let i = 0; i < values.length; i += width) {
    rows.push(Array.from({ length: width }, (_, x) => String(values[i + x])).join(''))
  }
  return rows
}

/** 決まった種の擬似乱数（mulberry32） */
function random(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const allValid = (n: number): Uint8Array => new Uint8Array(n * n).fill(1)
const chebyshev = (a: number, b: number, width: number): number =>
  Math.max(
    Math.abs((a % width) - (b % width)),
    Math.abs(Math.floor(a / width) - Math.floor(b / width)),
  )

describe('outflowBoundaryMask（spec 07 §5.1）', () => {
  it('全部有効なら、グリッドの端の 1 周だけが 1 で、内側は 0', () => {
    const { validMask, width, height } = grid(['####', '####', '####', '####'])
    expect(rowsOf(outflowBoundaryMask(validMask, width, height), width)).toEqual([
      '1111',
      '1001',
      '1001',
      '1111',
    ])
  })

  it('内側の無効セルの上下左右が 1 になり（斜めは 0。FlowSolver の面の表が 4 近傍。spec 08 §3.7）、無効セルそのものは 0', () => {
    const { validMask, width, height } = grid([
      '#######',
      '#######',
      '#######',
      '###.###',
      '#######',
      '#######',
      '#######',
    ])
    expect(rowsOf(outflowBoundaryMask(validMask, width, height), width)).toEqual([
      '1111111',
      '1000001',
      '1001001',
      '1010101',
      '1001001',
      '1000001',
      '1111111',
    ])
  })

  it('近傍の表は FlowSolver の NEIGHBOR_DX・NEIGHBOR_DY と同じ（表から作った期待値と一致する。推奨 R3）', () => {
    const next = random(11)
    const width = 13
    const height = 9
    const validMask = Uint8Array.from({ length: width * height }, () => (next() < 0.2 ? 0 : 1))
    const expected = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (validMask[i] === 0) continue
        for (let k = 0; k < NEIGHBOR_DX.length; k++) {
          const nx = x + (NEIGHBOR_DX[k] ?? 0)
          const ny = y + (NEIGHBOR_DY[k] ?? 0)
          const outside = nx < 0 || nx >= width || ny < 0 || ny >= height
          if (outside || validMask[ny * width + nx] === 0) expected[i] = 1
        }
      }
    }
    expect(Array.from(outflowBoundaryMask(validMask, width, height))).toEqual(Array.from(expected))
  })
})

describe('outflowBandCells（R07-5、計画で決めたこと 2）', () => {
  it('帯の幅は一辺のセル数の 1% を切り上げ、1 未満にしない', () => {
    expect(OUTFLOW_BAND_RATIO).toBe(0.01)
    expect(outflowBandCells(500)).toBe(5)
    expect(outflowBandCells(516)).toBe(6)
    expect(outflowBandCells(1031)).toBe(11)
    expect(outflowBandCells(258)).toBe(3)
    expect(outflowBandCells(50)).toBe(1)
  })
})

describe('outflowNearest（spec 07 §5.1、軽微 m6）', () => {
  it('帯の幅が 1 なら、マスクのセルは自分自身を指し、ほかと無効セルは −1', () => {
    const { validMask, width, height } = grid(['#####', '#####', '##.##', '#####', '#####'])
    const mask = outflowBoundaryMask(validMask, width, height)
    const nearest = outflowNearest(mask, validMask, width, height, 1)
    for (let i = 0; i < nearest.length; i++) {
      expect(nearest[i]).toBe(mask[i] === 1 ? i : -1)
    }
    expect(nearest[2 * width + 2]).toBe(-1)
  })

  it('帯の幅の境目: 深さ bandCells − 1 までが帯で、その先は −1', () => {
    const n = 11
    const validMask = allValid(n)
    const nearest = outflowNearest(outflowBoundaryMask(validMask, n, n), validMask, n, n, 3)
    const row = Array.from({ length: n }, (_, x) => ((nearest[5 * n + x] ?? -1) >= 0 ? 1 : 0))
    expect(row).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1])
  })

  it('全部有効なら、帯の中の各セルの nearest はマスクのセルで、チェビシェフ距離は端からの距離 fromEdge に一致する。帯は端からの距離で決まる', () => {
    const n = 15
    const band = 4
    const validMask = allValid(n)
    const mask = outflowBoundaryMask(validMask, n, n)
    const nearest = outflowNearest(mask, validMask, n, n, band)
    for (let i = 0; i < n * n; i++) {
      const x = i % n
      const y = Math.floor(i / n)
      const fromEdge = Math.min(x, y, n - 1 - x, n - 1 - y)
      const j = nearest[i] ?? -1
      if (fromEdge <= band - 1) {
        expect(mask[j]).toBe(1)
        expect(chebyshev(i, j, n)).toBe(fromEdge)
      } else {
        expect(j).toBe(-1)
      }
    }
  })

  it('始点を添字の昇順で入れた幅優先探索で最初に届いたものを指す（決定的）', () => {
    const n = 11
    const validMask = allValid(n)
    const mask = outflowBoundaryMask(validMask, n, n)
    const a = outflowNearest(mask, validMask, n, n, 3)
    // (x=1, y=5) に隣り合うマスクのセルは (0,4)=44・(0,5)=55・(0,6)=66。添字の小さい 44 が先に届く
    expect(a[5 * n + 1]).toBe(44)
    // (x=1, y=1) に隣り合うマスクのセルは 0・1・2・11・22。0 が先に届く
    expect(a[1 * n + 1]).toBe(0)
    expect(Array.from(outflowNearest(mask, validMask, n, n, 3))).toEqual(Array.from(a))
  })

  it('沿岸（右半分が無効）: 無効セルの縁に沿って帯ができ、無効セルは −1（Review Focus 2）', () => {
    const { validMask, width, height } = grid([
      '#####.....',
      '#####.....',
      '#####.....',
      '#####.....',
      '#####.....',
    ])
    const mask = outflowBoundaryMask(validMask, width, height)
    const nearest = outflowNearest(mask, validMask, width, height, 2)
    // x=4 は無効セルに接するのでマスク、x=3 は深さ 1 で帯、無効セルは −1
    expect(nearest[2 * width + 4]).toBe(2 * width + 4)
    expect(nearest[2 * width + 3]).toBeGreaterThanOrEqual(0)
    expect(nearest[2 * width + 5]).toBe(-1)
  })

  it('無効セルの壁の向こうには、幅優先探索が壁を越えて届かない（壁の向こうは −1 か、壁の向こう側のマスクから届く）', () => {
    // 幅 9、高さ 5。x = 4 の列を丸ごと無効にして、左右を完全に分ける壁にする
    const { validMask, width, height } = grid([
      '####.####',
      '####.####',
      '####.####',
      '####.####',
      '####.####',
    ])
    const mask = outflowBoundaryMask(validMask, width, height)
    const nearest = outflowNearest(mask, validMask, width, height, 2)
    // 壁のセル自身は常に −1
    expect(nearest[2 * width + 4]).toBe(-1)
    // 壁のすぐ右（x = 5）はマスクそのもの。1 つ内側（x = 6）はその帯（深さ 1）
    const wallAdjacentRight = 2 * width + 5
    const bandRight = 2 * width + 6
    expect(nearest[wallAdjacentRight]).toBe(wallAdjacentRight)
    const j = nearest[bandRight] ?? -1
    expect(j).toBeGreaterThanOrEqual(0)
    // 届いた先は右側（x >= 5）のセルで、壁を挟んだ左側（x <= 3）から届いたのではない
    expect(j % width).toBeGreaterThanOrEqual(5)
  })
})

describe('buildOutflowCells', () => {
  it('band は nearest が 0 以上のセルの添字の昇順の一覧', () => {
    const n = 20
    const cells = buildOutflowCells(allValid(n), n)
    const expected: number[] = []
    for (let i = 0; i < n * n; i++) if ((cells.nearest[i] ?? -1) >= 0) expected.push(i)
    expect(Array.from(cells.band)).toEqual(expected)
    // n = 20 は帯の幅 1（端の 1 周 = 76 セル）
    expect(cells.band.length).toBe(76)
    // マスクは送らない（メインで読まれていない。spec 08 §5.3、N8）
    expect(Object.keys(cells).sort()).toEqual(['band', 'nearest'])
  })

  it('全部無効なら、マスクも帯も空で、nearest はすべて −1（Review Focus 2）', () => {
    const n = 8
    const cells = buildOutflowCells(new Uint8Array(n * n), n)
    expect(cells.band.length).toBe(0)
    expect(Array.from(outflowBoundaryMask(new Uint8Array(n * n), n, n)).every((v) => v === 0)).toBe(
      true,
    )
    expect(Array.from(cells.nearest).every((v) => v === -1)).toBe(true)
  })

  it('1000 m（1031²）でも、帯のセル数が端の 1 周（4(n − 1)）より多い（性能は Task 10 の計測で見る）', () => {
    const n = 1031
    const cells = buildOutflowCells(allValid(n), n)
    expect(cells.band.length).toBeGreaterThan(4 * (n - 1))
  })
})
