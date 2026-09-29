import { describe, expect, it } from 'vitest'
import { WATER_FRAGMENT, WATER_VERTEX } from './waterShaders'

/** シェーダは文字列なので、式の要（spec 05 §3.1）が入っていることを確かめる。GL での振る舞いは E2E と手動で見る */
describe('水面のシェーダ（spec 05 §3.1）', () => {
  it('頂点シェーダ: texelFetch で標高と水深を読み、(標高 + 水深) × 垂直強調を高さにする', () => {
    expect(WATER_VERTEX).toContain('texelFetch(u_elevation, cell, 0)')
    expect(WATER_VERTEX).toContain('texelFetch(u_depth, cell, 0)')
    expect(WATER_VERTEX).toContain('(z + (d >= u_minDepth ? d : 0.0) + lift) * u_exaggeration')
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

  it('計測用（probe=water）: u_debug.x が 1 なら判定用の不透明のマゼンタで描き、u_debug.y だけ持ち上げる（spec 06 §3）', () => {
    expect(WATER_VERTEX).toContain('float lift = u_debug.x > 0.5 ? u_debug.y : 0.0;')
    expect(WATER_FRAGMENT).toContain('if (u_debug.x > 0.5) {')
    expect(WATER_FRAGMENT).toContain('fragColor = vec4(1.0, 0.0, 1.0, 1.0);')
    // 1 cm 未満を捨てる判定は、判定用の色より先（footprint は 1 cm 以上の水面）
    expect(WATER_FRAGMENT.indexOf('discard')).toBeLessThan(
      WATER_FRAGMENT.indexOf('u_debug.x > 0.5'),
    )
  })
})

describe('流出の帯のシェーダ（spec 07 §5.2、推奨 R5）', () => {
  it('頂点シェーダ: u_outflowNearest の平らな添字 k を読み、k のセルの水深を u_depth から引く。非表示と計測の間は読まない', () => {
    expect(WATER_VERTEX).toContain('if (u_showOutflow > 0.5 && u_debug.x <= 0.5) {')
    expect(WATER_VERTEX).toContain('int k = int(texelFetch(u_outflowNearest, cell, 0).r);')
    expect(WATER_VERTEX).toContain(
      'texelFetch(u_depth, ivec2(k % u_size, k / u_size), 0).r >= u_outflowMinDepth',
    )
    // 高さの式は変えない（持ち上げない。スパイクの判定 (e)）
    expect(WATER_VERTEX).toContain('(z + (d >= u_minDepth ? d : 0.0) + lift) * u_exaggeration')
  })

  it('varying は smooth（provoking vertex で辺ごとに見え方が変わる flat は使わない）', () => {
    expect(WATER_VERTEX).toContain('smooth out float v_outflow;')
    expect(WATER_FRAGMENT).toContain('smooth in float v_outflow;')
    expect(WATER_VERTEX).not.toMatch(/\bflat\b/)
    expect(WATER_FRAGMENT).not.toMatch(/\bflat\b/)
  })

  it('フラグメントシェーダ: v_outflow > 0.5 なら 1 cm の discard より先に、流出の色（premultiplied）を出す', () => {
    expect(WATER_FRAGMENT).toContain('if (v_outflow > 0.5) {')
    expect(WATER_FRAGMENT).toContain('fragColor = u_outflowColor;')
    expect(WATER_FRAGMENT.indexOf('v_outflow > 0.5')).toBeLessThan(
      WATER_FRAGMENT.indexOf('discard'),
    )
  })

  it('スパイク専用の uniform は入れない', () => {
    for (const name of ['u_outflowGround', 'u_outflowLift', 'u_outflowMask', 'OUTFLOW_QUALIFIER']) {
      expect(WATER_VERTEX).not.toContain(name)
      expect(WATER_FRAGMENT).not.toContain(name)
    }
  })
})
