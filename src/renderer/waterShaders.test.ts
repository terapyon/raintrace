import { describe, expect, it } from 'vitest'
import { WATER_FRAGMENT, WATER_VERTEX } from './waterShaders'

/** シェーダは文字列なので、式の要（spec 05 §3.1）が入っていることを確かめる。GL での振る舞いは E2E と手動で見る */
describe('水面のシェーダ（spec 05 §3.1）', () => {
  it('頂点シェーダ: texelFetch で標高と水深を読み、(標高 + 水深) × 垂直強調を高さにする', () => {
    expect(WATER_VERTEX).toContain('texelFetch(u_elevation, cell, 0)')
    expect(WATER_VERTEX).toContain('texelFetch(u_depth, cell, 0)')
    expect(WATER_VERTEX).toContain('(z + (d >= u_minDepth ? d : 0.0)) * u_exaggeration')
    expect(WATER_VERTEX).toContain('u_matrix * vec4(a_cell + 0.5, h, 1.0)')
  })

  it('フラグメントシェーダ: 1 cm 未満を捨て、LUT を texelFetch で読み、premultiplied の色を出す', () => {
    expect(WATER_FRAGMENT).toContain('if (v_depth < u_minDepth) discard;')
    expect(WATER_FRAGMENT).toContain('texelFetch(u_lut, ivec2(k, 0), 0)')
    expect(WATER_FRAGMENT).toContain('fragColor = vec4(rgb * u_alpha, u_alpha);')
  })

  it('#version を付けない（three の RawShaderMaterial が glslVersion: GLSL3 で付ける）', () => {
    expect(WATER_VERTEX).not.toContain('#version')
    expect(WATER_FRAGMENT).not.toContain('#version')
  })
})
