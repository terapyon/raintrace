/**
 * 積もった土の形を整える（spec 10 §3.2 の部品 4）。RainTrace の決め方（論文に無い）。
 *
 * - 4 近傍の組で、高さ（base + deposit）の差が tan(reposeDeg) × cellSizeM を超えたら、超えた分の半分を
 *   高い側から低い側へ移す。移す量は高い側の deposit が上限（積もった土だけを動かし、地山は削らない）
 * - 1 回の掃引で動いた量の最大が 1e-4 m 未満になるか、200 回で止める
 * - 無効なセルとの組は見ない（無効なセルへは移さない）
 * - 移した分はすぐに高さに反映する（順に更新する）ので、1 つのセルから出す量の合計が deposit を超えない。
 *   向きの偏りを抑えるため、掃引の向きを 1 回ごとに逆にする
 * - 和の誤差を抑えるため倍精度で計算し、最後に deposit へ書き戻す
 */

/** 1 回の掃引で動いた量の最大がこれ未満なら止める（m） */
const SETTLE_TOLERANCE_M = 1e-4
/** 掃引の回数の上限 */
const SETTLE_MAX_ITERATIONS = 200

export function settleDeposit(
  base: Float32Array,
  deposit: Float32Array,
  validMask: Uint8Array,
  size: number,
  cellSizeM: number,
  reposeDeg: number,
): void {
  const n = size * size
  const limit = Math.tan((reposeDeg * Math.PI) / 180) * cellSizeM
  const d = new Float64Array(n)
  for (let i = 0; i < n; i++) d[i] = deposit[i] ?? 0

  /** 組 (i, j) を整える。動いた量を返す */
  const relax = (i: number, j: number): number => {
    if (validMask[j] === 0) return 0
    const diff = base[i] + d[i] - (base[j] + d[j])
    const excess = Math.abs(diff) - limit
    if (!(excess > 0)) return 0
    const high = diff > 0 ? i : j
    const low = diff > 0 ? j : i
    const move = Math.min(excess / 2, d[high])
    if (!(move > 0)) return 0
    d[high] -= move
    d[low] += move
    return move
  }

  for (let iter = 0; iter < SETTLE_MAX_ITERATIONS; iter++) {
    const forward = iter % 2 === 0
    let maxMove = 0
    for (let k = 0; k < n; k++) {
      const i = forward ? k : n - 1 - k
      if (validMask[i] === 0) continue
      const c = i % size
      if (c + 1 < size) maxMove = Math.max(maxMove, relax(i, i + 1))
      if (i + size < n) maxMove = Math.max(maxMove, relax(i, i + size))
    }
    if (maxMove < SETTLE_TOLERANCE_M) break
  }

  for (let i = 0; i < n; i++) deposit[i] = d[i]
}
