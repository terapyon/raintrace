import { describe, expect, it } from 'vitest'
import type { ElevationSampler } from '../types'
import { meshHeightAt, quantizeTerrarium } from './meshHeight'

/**
 * ElevationSampler の規約（scenes.ts の syntheticSampler と同じ）: 整数のセル index `gx` は、
 * 連続座標では `gx + 0.5`（セルの中心）の値を返す。テストの「真の高さ」はこの連続座標の関数
 * `trueHeight` で持ち、サンプラーはそれを +0.5 して評価する（meshHeightAt・sampleZ17Corner は
 * 連続座標をそのまま受け取るので、比較は `trueHeight(x, y)` と直接行える）
 */
function samplerFromContinuous(trueHeight: (x: number, y: number) => number): ElevationSampler {
  return (gx, gy) => trueHeight(gx + 0.5, gy + 0.5)
}

/** 放物面（すり鉢型）。ρ = 1/(2a) は頂点の曲率半径 */
function paraboloid(a: number, cx = 0, cy = 0): (x: number, y: number) => number {
  return (x, y) => a * ((x - cx) ** 2 + (y - cy) ** 2)
}

describe('quantizeTerrarium（Terrarium の 1/256m 量子化の往復）', () => {
  it('encode→decode の往復は 1/256m 以内の誤差にとどまる', () => {
    expect(quantizeTerrarium(12.3456)).toBeCloseTo(12.3456, 2)
    expect(Math.abs(quantizeTerrarium(12.3456) - 12.3456)).toBeLessThan(1 / 256)
  })
})

describe('meshHeightAt（レンダリングを介さない地形メッシュの高さ。タスクレビュー fix round 1）', () => {
  it('平面（傾き一定）ではメッシュは量子化以内の誤差で真の高さと一致する', () => {
    const trueHeight = (x: number, y: number) => 10 + 0.1 * x - 0.05 * y
    const sample = samplerFromContinuous(trueHeight)
    // 格子点からずらした位置（三角形の内部）で確かめる
    const x = 101.3
    const y = 203.7
    const mesh = meshHeightAt(sample, 17, x, y)
    expect(Math.abs(mesh - trueHeight(x, y))).toBeLessThan(0.01)
  })

  it('放物面（すり鉢型）では対角の中点でメッシュが真の面より高くなり、量は弦の高さ s²/(8ρ) と符合する', () => {
    // ρ = 600m（レビューの見積もりと同じ）、ズーム15（格子間隔 = 2 × 2^(17-15) = 8）
    const rho = 600
    const a = 1 / (2 * rho)
    const trueHeight = paraboloid(a)
    const sample = samplerFromContinuous(trueHeight)
    const zoom = 15
    const step = 2 * 2 ** (17 - zoom) // 8
    // 格子 (kx, ky) の対角の中点（中心から離れた場所。曲率の符号を確かめやすい）
    const kx = 50
    const ky = 50
    const midX = (kx + 0.5) * step
    const midY = (ky + 0.5) * step
    const mesh = meshHeightAt(sample, zoom, midX, midY)
    const truth = trueHeight(midX, midY)
    // 対角の弦の長さは step×√2 なので、弦の高さ（対角の2頂点の平均 − 真の中点）は a×step² / 2
    // （対角に沿った1次元の弦の高さの公式 L²/(8ρ) と、L = step√2・ρ = 1/(2a) から導ける一致を確認）
    const expectedSagitta = (a * step ** 2) / 2
    const actualSagitta = mesh - truth
    expect(actualSagitta).toBeGreaterThan(0) // メッシュは常に真の凸面より高い（沈み込みと逆向き）
    expect(actualSagitta).toBeCloseTo(expectedSagitta, 1)
  })

  it('ズームが低いほど格子間隔が広がり、弦の高さ（誤差）が大きくなる', () => {
    const rho = 600
    const a = 1 / (2 * rho)
    const trueHeight = paraboloid(a)
    const sample = samplerFromContinuous(trueHeight)
    const at = (zoom: number): number => {
      const step = 2 * 2 ** (17 - zoom)
      const kx = 50
      const ky = 50
      const midX = (kx + 0.5) * step
      const midY = (ky + 0.5) * step
      return meshHeightAt(sample, zoom, midX, midY) - trueHeight(midX, midY)
    }
    expect(at(15)).toBeGreaterThan(at(16))
    expect(at(16)).toBeGreaterThan(at(17))
  })
})
