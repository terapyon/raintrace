/**
 * 流出しているセルの表示のための、地形だけで決まる表（spec 07 §5.1）。地形を読み込んだときに Worker で
 * 1 回だけ作り（workers/simulation.worker.ts）、TerrainPayload.outflow でメインへ送る。エンジンの計算には使わない。
 *
 * 仮想セル（グリッドの外・無効セル）は元のセルと同じ標高で水深 0 として扱われる（spec 03 §3.3、FlowSolver.ts）。
 * そのため「近傍にグリッドの外か無効セルを含む有効セル」は、水深が θ を超えればその step に必ず外へ流す。
 * 近傍の定義は FlowSolver の NEIGHBOR_DX・NEIGHBOR_DY をそのまま使う（08 で流れが 4 近傍になれば、マスクも
 * 一緒に変わる。推奨 R3）。帯の広げ方は見た目の規則なので、FlowSolver の表とは独立に 8 近傍で歩く
 */
import { NEIGHBOR_DX, NEIGHBOR_DY } from './FlowSolver.ts'

/** 帯の幅を範囲の一辺の何割にするか（R07-5） */
export const OUTFLOW_BAND_RATIO = 0.01

/** 帯を広げる歩み（8 近傍。FlowSolver の表とは独立。spec 07 §5.1） */
const BAND_DX = [-1, 0, 1, -1, 1, -1, 0, 1]
const BAND_DY = [-1, -1, -1, 0, 0, 1, 1, 1]

export interface OutflowCells {
  /** 有効セルのうち、近傍にグリッドの外か無効セルを含むものが 1 */
  mask: Uint8Array
  /** 各セルが帯の中なら、幅優先探索で最初に届いたマスクのセルの添字。マスクのセルは自分自身。帯の外・無効セルは −1 */
  nearest: Int32Array
  /** nearest が 0 以上のセルの添字（昇順）。2D の描画はここだけを走査する */
  band: Int32Array
}

/** 有効セルのうち、近傍（FlowSolver の表）にグリッドの外か無効セルを含むものを 1 にする */
export function outflowBoundaryMask(
  validMask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (validMask[i] === 0) continue
      for (let k = 0; k < NEIGHBOR_DX.length; k++) {
        const nx = x + NEIGHBOR_DX[k]
        const ny = y + NEIGHBOR_DY[k]
        // 無効の判定は FlowSolver と同じく validMask[c] !== 0 の否定
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || validMask[ny * width + nx] === 0) {
          mask[i] = 1
          break
        }
      }
    }
  }
  return mask
}

/**
 * 帯の幅（セル数）。範囲の一辺（N セル × セルの大きさ m）の 1% をセルの大きさで割って切り上げる = ceil(N × 1%)。
 * 0.01 × 500 が浮動小数点で 5 をわずかに超えないよう 1e-9 を引く。1 未満にはしない（計画で決めたこと 2）
 */
export function outflowBandCells(size: number): number {
  return Math.max(1, Math.ceil(size * OUTFLOW_BAND_RATIO - 1e-9))
}

/**
 * マスクのセルからの多始点の幅優先探索（spec 07 §5.1、軽微 m6）。始点は添字の昇順でキューに入れるので、
 * 結果は決定的。歩みは有効セルだけを通り、深さ bandCells − 1 で打ち切る（帯の太さはマスクのセルを含めて
 * bandCells セル）。帯の外・無効セルは −1
 */
export function outflowNearest(
  mask: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  bandCells: number,
): Int32Array {
  const n = width * height
  const nearest = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let tail = 0
  for (let i = 0; i < n; i++) {
    if (mask[i] === 1) {
      nearest[i] = i
      queue[tail++] = i
    }
  }
  let head = 0
  for (let depth = 1; depth < bandCells && head < tail; depth++) {
    const levelEnd = tail
    for (; head < levelEnd; head++) {
      const c = queue[head]
      const cx = c % width
      const cy = (c - cx) / width
      for (let k = 0; k < BAND_DX.length; k++) {
        const nx = cx + BAND_DX[k]
        const ny = cy + BAND_DY[k]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const j = ny * width + nx
        if (validMask[j] === 0 || nearest[j] !== -1) continue
        nearest[j] = nearest[c]
        queue[tail++] = j
      }
    }
  }
  return nearest
}

/** 一辺 size セルの範囲の流出の表を作る（地形の読み込みのときに 1 回） */
export function buildOutflowCells(validMask: Uint8Array, size: number): OutflowCells {
  const mask = outflowBoundaryMask(validMask, size, size)
  const nearest = outflowNearest(mask, validMask, size, size, outflowBandCells(size))
  let count = 0
  for (let i = 0; i < nearest.length; i++) if (nearest[i] >= 0) count++
  const band = new Int32Array(count)
  for (let i = 0, k = 0; i < nearest.length; i++) if (nearest[i] >= 0) band[k++] = i
  return { mask, nearest, band }
}
