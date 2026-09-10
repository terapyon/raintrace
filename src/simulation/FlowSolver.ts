/**
 * 1 step 分の水移動の計算（spec 03 §3.2・§3.3・§3.9）。エンジンの内部モジュールで、外部には公開しない
 */
import { DIFFUSION_C, FLOW_THRESHOLD_M } from './constants.ts'

/** 8 近傍の固定順（北西、北、北東、西、東、南西、南、南東）。y は南向きが正 */
export const NEIGHBOR_DX = Int8Array.of(-1, 0, 1, -1, 1, -1, 0, 1)
export const NEIGHBOR_DY = Int8Array.of(-1, -1, -1, 0, 0, 1, 1, 1)
/** 近傍の重み w_j。上下左右は 1、斜めは 1/√2 */
export const NEIGHBOR_WEIGHT = Float64Array.of(
  Math.SQRT1_2,
  1,
  Math.SQRT1_2,
  1,
  1,
  Math.SQRT1_2,
  1,
  Math.SQRT1_2,
)
/** k = c / Σ_j w_j */
export const FLOW_K = DIFFUSION_C / (4 + 4 * Math.SQRT1_2)

/** 近傍の方向の単位ベクトル（流れのベクトル用） */
const UNIT_X = Float64Array.from(NEIGHBOR_DX, (dx, k) => dx * NEIGHBOR_WEIGHT[k])
const UNIT_Y = Float64Array.from(NEIGHBOR_DY, (dy, k) => dy * NEIGHBOR_WEIGHT[k])

export interface TerrainArrays {
  width: number
  height: number
  elevation: Float32Array
  validMask: Uint8Array
}

/** 走査範囲。列 [x0, x1)、行 [y0, y1) */
export interface ScanWindow {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 計算の作業領域。呼び出し側が1つ持ち、使い回す */
export interface Scratch {
  /** 各近傍への流量の候補 g_ij（m） */
  g: Float64Array
  /** 各近傍のセル番号。仮想セル（グリッドの外・無効セル）は −1 */
  nb: Int32Array
}

export function createScratch(): Scratch {
  return { g: new Float64Array(8), nb: new Int32Array(8) }
}

export interface StepFlow {
  /** 仮想セルへ出た水深の合計（m）。セル面積を掛けると流出量 */
  outflowDepth: number
  /** θ を超える水面差による流れが1つでもあった */
  flowed: boolean
}

/**
 * セル i（列 x、行 y）から各近傍への流量の候補 g_ij を scratch に書き、合計 G_i を返す。
 * グリッドの外と無効セルは、標高が i と同じで水深 0 の仮想セルとして扱う（§3.3）
 */
function outflowCandidates(
  t: TerrainArrays,
  w: Float64Array,
  x: number,
  y: number,
  i: number,
  s: Scratch,
): number {
  const { width, height, elevation, validMask } = t
  const zi = elevation[i]
  const hi = zi + w[i]
  let sum = 0
  for (let k = 0; k < 8; k++) {
    const nx = x + NEIGHBOR_DX[k]
    const ny = y + NEIGHBOR_DY[k]
    let j = -1
    let hj = zi
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      const c = ny * width + nx
      if (validMask[c] !== 0) {
        j = c
        hj = elevation[c] + w[c]
      }
    }
    const dh = hi - hj
    const gk = dh > FLOW_THRESHOLD_M ? FLOW_K * NEIGHBOR_WEIGHT[k] * dh : 0
    s.nb[k] = j
    s.g[k] = gk
    sum += gk
  }
  return sum
}

/**
 * W を読み、W' に書く（Jacobi 方式）。呼ぶ前に W' ← W（走査範囲のみ）を済ませておく。
 * 走査範囲の外の W は 0 であること
 */
export function solveStep(
  t: TerrainArrays,
  w: Float64Array,
  next: Float64Array,
  win: ScanWindow,
  s: Scratch,
): StepFlow {
  const { width } = t
  const { g, nb } = s
  let outflowDepth = 0
  let flowed = false
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      const wi = w[i]
      if (wi === 0) continue
      const total = outflowCandidates(t, w, x, y, i, s)
      if (total === 0) continue
      flowed = true
      if (total <= wi) {
        next[i] -= total
        for (let k = 0; k < 8; k++) {
          const f = g[k]
          if (f === 0) continue
          const j = nb[k]
          if (j < 0) outflowDepth += f
          else next[j] += f
        }
        continue
      }
      // 持っている水より多くは出さない（s = W_i / G_i < 1）。W'_i からは W_i をそのまま引き、
      // 丸め誤差で微小な水が残り続けないようにする。最後の近傍には max(0, W_i − given) を渡す。
      // given が丸めで W_i を僅かに超えると質量が ε だけ増えるが、ε は倍精度の丸めの桁
      // （W_i の 1e-16 倍程度）で、massTolerance の桁（投入量の 1e-9 倍）より十分小さい。
      // max(0, …) は、丸めで負の流量を渡して受け手の W を負にしないため
      const scale = wi / total
      next[i] -= wi
      let last = 7
      while (g[last] === 0) last--
      let given = 0
      for (let k = 0; k <= last; k++) {
        if (g[k] === 0) continue
        const f = k === last ? Math.max(0, wi - given) : scale * g[k]
        given += f
        const j = nb[k]
        if (j < 0) outflowDepth += f
        else next[j] += f
      }
    }
  }
  return { outflowDepth, flowed }
}

/**
 * 現在の W に §3.2 の式を当てはめたときの各セルの流出を、流出先の方向の単位ベクトルで
 * 重み付けして足したもの（m／step）。水は動かさない。濡れていないセルは 0
 */
export function computeFlowVectors(
  t: TerrainArrays,
  w: Float64Array,
  win: ScanWindow,
  s: Scratch,
): { x: Float32Array; y: Float32Array } {
  const { width, height } = t
  const vx = new Float32Array(width * height)
  const vy = new Float32Array(width * height)
  const { g } = s
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      const wi = w[i]
      if (wi === 0) continue
      const total = outflowCandidates(t, w, x, y, i, s)
      if (total === 0) continue
      const scale = total <= wi ? 1 : wi / total
      let sx = 0
      let sy = 0
      for (let k = 0; k < 8; k++) {
        const f = scale * g[k]
        sx += f * UNIT_X[k]
        sy += f * UNIT_Y[k]
      }
      vx[i] = sx
      vy[i] = sy
    }
  }
  return { x: vx, y: vy }
}
