/**
 * waterLayer.ts の、GL なしで確かめられる振る舞い（Task 8 の申し送りの反映）。
 * WebGLRenderer は作らない（onAdd・render は呼ばない）ので、DataTexture・RawShaderMaterial などの生成は
 * three の中で GL を一切使わない（GPU 資源は WebGLRenderer が初めて描くときに確保する）
 */
import { DataTexture, FloatType, RedFormat } from 'three'
import { describe, expect, it } from 'vitest'
import {
  buildUniforms,
  CELL_ATTRIBUTE,
  resolveDepthData,
  shouldUploadDepth,
  type WaterLayerOptions,
} from './waterLayer'
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
