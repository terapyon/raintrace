import { describe, expect, it } from 'vitest'
import { buildTerrain, engineOn } from '../simulation/testing/fixtures.test-support'
import { thinFlowArrows } from './flowArrows'

describe('thinFlowArrows（spec 04 §5.1）', () => {
  it.each([
    [1, 0, 90],
    [0, 1, 180],
    [-1, 0, 270],
    [0, -1, 0],
    [1, -1, 45],
  ])('ベクトル (%f, %f) の方位は %f 度（y は南が正、北が 0° で時計回り）', (x, y, bearing) => {
    const arrows = thinFlowArrows(Float32Array.of(x), Float32Array.of(y), 1, 1, 1, 1)
    expect(Array.from(arrows.slice(0, 2))).toEqual([0, 0])
    expect(arrows[2]).toBeCloseTo(bearing, 4)
    expect(arrows[3]).toBeCloseTo(Math.hypot(x, y), 6)
  })

  it('矢印の間隔ごとに間引き、流れの無いセルは出さない', () => {
    // 4 × 4・セル 1m・間隔 2m: 列・行 1 と 3 の 4 セルを見る。(3, 3) は流れが無い
    const vx = new Float32Array(16).fill(1)
    const vy = new Float32Array(16)
    vx[3 * 4 + 3] = 0
    const arrows = thinFlowArrows(vx, vy, 4, 4, 1, 2)
    const cells = []
    for (let k = 0; k < arrows.length; k += 4) cells.push([arrows[k], arrows[k + 1]])
    expect(cells).toEqual([
      [1, 1],
      [3, 1],
      [1, 3],
    ])
  })

  it('間隔がセルより小さくても毎セル', () => {
    const arrows = thinFlowArrows(new Float32Array(4).fill(1), new Float32Array(4), 2, 2, 7.8, 5)
    expect(arrows.length).toBe(16)
  })

  it('東へ下る斜面に置いた水の矢印は東（90°）を向く（FlowSolver のベクトルの向きの約束の確かめ）', () => {
    const t = buildTerrain(9, 9, 1, (x) => (8 - x) * 0.2)
    const engine = engineOn(t)
    engine.addRainfall({ x: 4.5, y: 4.5, radiusM: 0.4, amountMm: 100 })
    const v = engine.flowVectors()
    const arrows = thinFlowArrows(v.x, v.y, 9, 9, 1, 1)
    let bearing = Number.NaN
    for (let k = 0; k < arrows.length; k += 4) {
      if (arrows[k] === 4 && arrows[k + 1] === 4) bearing = arrows[k + 2] ?? Number.NaN
    }
    expect(bearing).toBeCloseTo(90, 3)
  })
})
