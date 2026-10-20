/**
 * 崩れる厚さ（m）を作る（spec 10）。候補のセルだけ ratio × max(0, 標高差)。
 * 候補以外のセル・負の値・NaN は 0
 */
export function removedThickness(
  delta: Float32Array,
  labels: Int32Array,
  candidateId: number,
  ratio: number,
): Float32Array {
  const removed = new Float32Array(delta.length)
  for (let i = 0; i < delta.length; i++) {
    if (labels[i] !== candidateId) continue
    const d = delta[i] ?? 0
    if (d > 0) removed[i] = ratio * d
  }
  return removed
}
