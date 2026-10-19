import { describe, expect, it } from 'vitest'
import { correctedDelta } from './correctedDelta.ts'

const N = 100

function run(current: Float32Array, mask: Uint8Array, past: Float32Array) {
  const result = correctedDelta(current, mask, past)
  if (result === null) throw new Error('null が返った')
  return result
}

/** 昔: 傾斜面。今: 昔 + shift。blockEvery 個に 1 つ +10 m の台を載せる */
function build(shift: number, isBlock: (i: number) => boolean) {
  const past = new Float32Array(N)
  const current = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    past[i] = 100 + i * 0.125 // 2 進で正確に表せる値にして Float32 の丸めを避ける
    current[i] = (past[i] ?? 0) + shift + (isBlock(i) ? 10 : 0)
  }
  return { past, current, mask: new Uint8Array(N).fill(1) }
}

describe('correctedDelta', () => {
  it('全体のずれ +0.5・+2・−3 m を取り除く（草案 §79）', () => {
    for (const shift of [0.5, 2, -3]) {
      const { past, current, mask } = build(shift, (i) => i % 10 === 0)
      const { delta, offsetM } = run(current, mask, past)
      expect(offsetM).toBeCloseTo(shift, 6)
      expect(delta[1]).toBeCloseTo(0, 6)
      expect(delta[0]).toBeCloseTo(10, 6)
    }
  })

  it('台が多くても（40%）、外れを除いた 2 回目の中央値はずれに近い', () => {
    for (const shift of [0.5, 2, -3]) {
      const { past, current, mask } = build(shift, (i) => i % 10 < 4)
      const { offsetM } = run(current, mask, past)
      expect(Math.abs(offsetM - shift)).toBeLessThanOrEqual(0.01)
    }
  })

  it('今が無効・昔が NaN のセルは NaN', () => {
    const { past, current, mask } = build(1, () => false)
    mask[3] = 0
    past[4] = NaN
    const { delta } = run(current, mask, past)
    expect(delta[3]).toBeNaN()
    expect(delta[4]).toBeNaN()
    expect(delta[5]).toBeCloseTo(0, 6)
  })

  it('有効なセルが無ければ null', () => {
    const { past, current } = build(1, () => false)
    expect(correctedDelta(current, new Uint8Array(N), past)).toBeNull()
    expect(
      correctedDelta(current, new Uint8Array(N).fill(1), new Float32Array(N).fill(NaN)),
    ).toBeNull()
  })
})
