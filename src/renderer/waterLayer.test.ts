/**
 * waterLayer.ts の、GL なしで確かめられる振る舞い（Task 8 の申し送りの反映）。
 * WebGLRenderer は作らない（onAdd・render は呼ばない）ので、DataTexture・RawShaderMaterial などの生成は
 * three の中で GL を一切使わない（GPU 資源は WebGLRenderer が初めて描くときに確保する）
 */
import { DataTexture, FloatType, RedFormat } from 'three'
import { describe, expect, it, vi } from 'vitest'
import {
  buildUniforms,
  CELL_ATTRIBUTE,
  COMPILE_TIMEOUT_MS,
  createCompileGate,
  patchesToReveal,
  resolveDepthData,
  shouldUploadDepth,
  UPLOAD_BUDGET_BYTES,
  type WaterLayerOptions,
} from './waterLayer'
import { gridPatches, patchBytes } from './waterMesh'
import { WATER_FRAGMENT, WATER_VERTEX } from './waterShaders'
import type { WaterLut } from './waterTextures'

describe('resolveDepthData（setWater の長さ不一致の分岐。E2E では到達しない。Task 8 のレビューの Minor 4）', () => {
  const zeros = new Float32Array(4)

  it('大きさが合えばそのまま使う', () => {
    const water = new Float32Array([1, 2, 3, 4])
    expect(resolveDepthData(water, 2, zeros)).toBe(water)
  })

  it('null なら zeros（水を消す）', () => {
    expect(resolveDepthData(null, 2, zeros)).toBe(zeros)
  })

  it('大きさが違えば zeros（水を消す。0 埋めで描く）', () => {
    const tooShort = new Float32Array([1, 2, 3])
    expect(resolveDepthData(tooShort, 2, zeros)).toBe(zeros)
    const tooLong = new Float32Array([1, 2, 3, 4, 5])
    expect(resolveDepthData(tooLong, 2, zeros)).toBe(zeros)
  })
})

/** `uniform 型 名前;` の宣言から名前だけを拾う（GLSL ES 3.00 の 1 行 1 宣言。waterShaders.ts の書式に合わせる） */
function declaredUniformNames(source: string): string[] {
  return [...source.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1] as string)
}

/** `in 型 名前;` の宣言から名前だけを拾う */
function declaredInNames(source: string): string[] {
  return [...source.matchAll(/^\s*in\s+\w+\s+(\w+)\s*;/gm)].map((m) => m[1] as string)
}

describe('uniform の名前がシェーダの宣言とマテリアルで一致する（Task 8 のレビューの Important、コントローラーの指示 B）', () => {
  it('WATER_VERTEX・WATER_FRAGMENT の uniform 宣言の集合が、buildUniforms が作る uniform の名前の集合とちょうど一致する', () => {
    const declared = new Set([
      ...declaredUniformNames(WATER_VERTEX),
      ...declaredUniformNames(WATER_FRAGMENT),
    ])
    // buildUniforms は GL を使わない（DataTexture・Matrix4 は three の中では GL に触れない）
    const dummyTexture = new DataTexture(new Float32Array(1), 1, 1, RedFormat, FloatType)
    const lut: WaterLut = {
      rgb: new Uint8Array([1, 2, 3]),
      bandsPerM: 20,
      maxIndex: 0,
      epsilonM: 0.001,
      alpha: 0.8,
      minDepthM: 0.01,
    }
    const options: Pick<WaterLayerOptions, 'size' | 'exaggeration' | 'lut'> = {
      size: 2,
      exaggeration: 2,
      lut,
    }
    const uniforms = buildUniforms(dummyTexture, dummyTexture, dummyTexture, options)
    const built = new Set(Object.keys(uniforms))
    // 双方向（余分も欠落も許さない）
    expect(built).toEqual(declared)
    // u_matrix は 3D 座標変換の要で、頂点シェーダにしか出ない。false になれば宣言の拾い方自体が壊れている
    expect(declaredUniformNames(WATER_VERTEX)).toContain('u_matrix')
    expect(declaredUniformNames(WATER_FRAGMENT)).toContain('u_lut')
  })

  it('a_cell（頂点の格子座標の attribute）が頂点シェーダに宣言され、geometry に渡す名前（CELL_ATTRIBUTE）と一致する', () => {
    expect(declaredInNames(WATER_VERTEX)).toEqual([CELL_ATTRIBUTE])
  })
})

describe('shouldUploadDepth（depthEvery=N。spec 06 §5.1）', () => {
  it('N が 1 以下なら毎回転送する', () => {
    expect([1, 2, 3].map((k) => shouldUploadDepth(k, 1))).toEqual([true, true, true])
    expect(shouldUploadDepth(5, 0)).toBe(true)
  })

  it('N = 2 なら 2 回目・4 回目、N = 4 なら 4 回目だけ転送する', () => {
    expect([1, 2, 3, 4].map((k) => shouldUploadDepth(k, 2))).toEqual([false, true, false, true])
    expect([1, 2, 3, 4, 8].map((k) => shouldUploadDepth(k, 4))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ])
  })
})

/** 外から resolve・reject できる Promise（compileAsync の代わり） */
function deferred(): {
  promise: Promise<unknown>
  resolve: () => void
  reject: (error: unknown) => void
} {
  let resolve: () => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<unknown>((res, rej) => {
    resolve = () => res(undefined)
    reject = rej
  })
  return { promise, resolve, reject }
}

/** then の続きを流す（Promise の解決の後のマイクロタスクを全部走らせる） */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createCompileGate（compileAsync の待ちと資源の解放の順。spec 06 §5.2、Task 17a (i)）', () => {
  it('プログラムができるまで ready は false、できたら true になり onReady を 1 回呼ぶ', async () => {
    const release = vi.fn()
    const onReady = vi.fn()
    const gate = createCompileGate(release, onReady)
    const compiled = deferred()
    gate.start(compiled.promise)
    expect(gate.ready()).toBe(false)
    await flush()
    expect(gate.ready()).toBe(false)
    compiled.resolve()
    await flush()
    expect(gate.ready()).toBe(true)
    expect(onReady).toHaveBeenCalledTimes(1)
    expect(release).not.toHaveBeenCalled()
  })

  it('待ちの途中で dispose すると、待ちが終わるまで release を呼ばず、終わったら release だけを呼ぶ（描かない）', async () => {
    const release = vi.fn()
    const onReady = vi.fn()
    const gate = createCompileGate(release, onReady)
    const compiled = deferred()
    gate.start(compiled.promise)
    gate.dispose()
    expect(gate.disposed()).toBe(true)
    expect(release).not.toHaveBeenCalled()
    gate.dispose()
    compiled.resolve()
    await flush()
    expect(release).toHaveBeenCalledTimes(1)
    expect(onReady).not.toHaveBeenCalled()
    expect(gate.ready()).toBe(false)
  })

  it('できた後に dispose すると、すぐに release を 1 回だけ呼び、ready は false に戻る', async () => {
    const release = vi.fn()
    const gate = createCompileGate(release, () => {})
    const compiled = deferred()
    gate.start(compiled.promise)
    compiled.resolve()
    await flush()
    gate.dispose()
    gate.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    expect(gate.ready()).toBe(false)
  })

  it('start の前（onAdd の前）の dispose はすぐに release を呼び、その後の start は何もしない', async () => {
    const release = vi.fn()
    const onReady = vi.fn()
    const gate = createCompileGate(release, onReady)
    gate.dispose()
    expect(release).toHaveBeenCalledTimes(1)
    const compiled = deferred()
    gate.start(compiled.promise)
    compiled.resolve()
    await flush()
    expect(release).toHaveBeenCalledTimes(1)
    expect(onReady).not.toHaveBeenCalled()
    expect(gate.ready()).toBe(false)
  })

  it('Promise が reject されても待ちは終わる（描く側に戻す。dispose の後なら release を呼ぶ）', async () => {
    const onReady = vi.fn()
    const gate = createCompileGate(() => {}, onReady)
    const failed = deferred()
    gate.start(failed.promise)
    failed.reject(new Error('compile'))
    await flush()
    expect(gate.ready()).toBe(true)
    expect(onReady).toHaveBeenCalledTimes(1)

    const release = vi.fn()
    const disposedGate = createCompileGate(release, () => {})
    const failedLater = deferred()
    disposedGate.start(failedLater.promise)
    disposedGate.dispose()
    failedLater.reject(new Error('compile'))
    await flush()
    expect(release).toHaveBeenCalledTimes(1)
  })
})

describe('createCompileGate の上限の時間（Task 17a (i) のレビューの Minor 1: 決着しない待ち）', () => {
  it('待ちが決着しないまま上限の時間が過ぎると、描く側に戻す（ready・onReady 1 回）。後から解決しても 2 回目はない', async () => {
    vi.useFakeTimers()
    try {
      const release = vi.fn()
      const onReady = vi.fn()
      const gate = createCompileGate(release, onReady, 100)
      const compiled = deferred()
      gate.start(compiled.promise)
      vi.advanceTimersByTime(99)
      expect(gate.ready()).toBe(false)
      vi.advanceTimersByTime(1)
      expect(gate.ready()).toBe(true)
      expect(onReady).toHaveBeenCalledTimes(1)
      compiled.resolve()
      await vi.runAllTimersAsync()
      expect(onReady).toHaveBeenCalledTimes(1)
      expect(release).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('待ちの途中で dispose し、待ちが決着しない（喪失から 10 ms 以内の復帰）ときも、上限の時間で release を 1 回呼ぶ', async () => {
    vi.useFakeTimers()
    try {
      const release = vi.fn()
      const onReady = vi.fn()
      const gate = createCompileGate(release, onReady)
      gate.start(new Promise(() => {}))
      gate.dispose()
      vi.advanceTimersByTime(COMPILE_TIMEOUT_MS - 1)
      expect(release).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(release).toHaveBeenCalledTimes(1)
      await vi.runAllTimersAsync()
      expect(release).toHaveBeenCalledTimes(1)
      expect(onReady).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('上限の時間より前に解決すれば、上限のタイマーは残らない', async () => {
    vi.useFakeTimers()
    try {
      const gate = createCompileGate(
        () => {},
        () => {},
      )
      const compiled = deferred()
      gate.start(compiled.promise)
      compiled.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(gate.ready()).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('patchesToReveal（1 フレームに見せる区画の数。spec 06 §5.2、Task 17a）', () => {
  it('見せていない先頭から、合計が目安を超えない数', () => {
    expect(patchesToReveal([3, 3, 3], 0, 7)).toBe(2)
    expect(patchesToReveal([3, 3, 3], 2, 7)).toBe(1)
  })

  it('1 区画が目安を超えても 1 つは進める', () => {
    expect(patchesToReveal([10, 1], 0, 7)).toBe(1)
  })

  it('残りが無ければ 0', () => {
    expect(patchesToReveal([3], 1, 7)).toBe(0)
  })

  it('実際の区画の大きさと UPLOAD_BUDGET_BYTES では、1000 m（N = 1031）は 3 フレーム（7・8・10 区画）、500 m（N = 515）は 1 フレーム（9 区画）で見せ終える（端の区画は小さい）', () => {
    const frames = (n: number): number[] => {
      const bytes = gridPatches(n).map(patchBytes)
      const out: number[] = []
      for (let revealed = 0; revealed < bytes.length; ) {
        const count = patchesToReveal(bytes, revealed, UPLOAD_BUDGET_BYTES)
        out.push(count)
        revealed += count
      }
      return out
    }
    expect(frames(1031)).toEqual([7, 8, 10])
    expect(frames(515)).toEqual([9])
  })
})
