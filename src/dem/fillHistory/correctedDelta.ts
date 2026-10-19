import { OFFSET_EXCLUDE_M } from './constants.ts'

function median(values: Float64Array): number {
  const sorted = values.slice().sort()
  const mid = sorted.length >> 1
  const hi = sorted[mid] ?? NaN
  return sorted.length % 2 ? hi : ((sorted[mid - 1] ?? NaN) + hi) / 2
}

/**
 * ΔZ = 今 − 昔 を出し、範囲全体の系統的なずれ（測量・基準の違い）を中央値で取り除く。
 * ずれは 2 回で求める。1 回目の中央値 m1 から OFFSET_EXCLUDE_M を超えて離れたセル（盛土の台など）を除き、
 * 残ったセルの中央値をもう一度取る（2 回で止める）。
 * 今が無効（validMask 0）か昔が NaN のセルは NaN。有効なセルが無ければ null。
 */
export function correctedDelta(
  current: Float32Array,
  validMask: Uint8Array,
  past: Float32Array,
): { delta: Float32Array; offsetM: number } | null {
  const raw = new Float32Array(current.length).fill(NaN)
  const valid: number[] = []
  for (let i = 0; i < current.length; i++) {
    const p = past[i] ?? NaN
    if (validMask[i] === 0 || Number.isNaN(p)) continue
    const d = (current[i] ?? NaN) - p
    raw[i] = d
    valid.push(d)
  }
  if (valid.length === 0) return null

  const m1 = median(Float64Array.from(valid))
  const kept = valid.filter((d) => Math.abs(d - m1) <= OFFSET_EXCLUDE_M)
  const offsetM = kept.length > 0 ? median(Float64Array.from(kept)) : m1

  const delta = new Float32Array(raw.length)
  for (let i = 0; i < raw.length; i++) delta[i] = (raw[i] ?? NaN) - offsetM
  return { delta, offsetM }
}
