/**
 * 8 近傍の固定の順序（東から時計回り）。y は南向きが正。D8 の方向の番号は、この順の index + 1。
 * 流向の決め方と Priority-Flood の走査の順を固定し、結果を決定的にする（spec 02 §5）。
 * 03 の FlowSolver.ts（src/simulation/FlowSolver.ts）は北西から行優先の順序を使う。どちらも決定的にする
 * ための固定の順序で、揃える必要は無いので、意図的に別の順序を使っている
 */
export const NEIGHBOR_DX: readonly number[] = [1, 1, 0, -1, -1, -1, 0, 1]
export const NEIGHBOR_DY: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1]

/** セルの一辺を 1 としたときの、中心どうしの距離（上下左右 1、斜め √2） */
export const NEIGHBOR_DISTANCE: readonly number[] = NEIGHBOR_DX.map((dx, k) =>
  dx !== 0 && NEIGHBOR_DY[k] !== 0 ? Math.SQRT2 : 1,
)
