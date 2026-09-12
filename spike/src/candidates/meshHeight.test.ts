import { describe, expect, it } from 'vitest'
import type { ElevationSampler } from '../types'
import { meshHeightAt, quantizeTerrarium } from './meshHeight'
import { decodeTerrarium, terrariumTile } from './terrarium'

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

describe('meshHeightAt の zoom の意味の固定（タスクレビュー fix round 3、N1）', () => {
  it('zoom は「描かれている地形タイル」のズームであり、その頂点は1つ下（zoom-1）のDEMの1画素にちょうど重なる', () => {
    // fix round 2 は「zoom は DEM 自体のズーム」と誤解し、地形タイルのズームから deltaZoom(1) を
    // もう一度引いて渡したため、格子間隔が2倍・弦の高さが4倍になった（re-review で発覚）。
    // ここでは meshHeightAt(tileZoom) の頂点が、terrariumTile（実際に DEM の生成に使う関数）が
    // zoom = tileZoom-1 で作るタイルの画素とちょうど一致することを、別経路（画像の RGBA を経由する
    // terrariumTile）で確かめて、2つの実装のあいだで zoom の意味がずれていないことを固定する
    const trueHeight = (x: number, y: number) => 10 + 0.2 * x - 0.1 * y // 平面: 量子化以外の誤差が出ない
    const sample: ElevationSampler = (gx, gy) => trueHeight(gx + 0.5, gy + 0.5)
    for (const tileZoom of [13, 14, 15, 16, 17, 18]) {
      const demZoom = tileZoom - 1 // 地形タイルが読む DEM のズーム（deltaZoom = 1、固定）
      const demTile = terrariumTile(sample, demZoom, 0, 0) // 実際の DEM 生成と同じ関数
      const readDemPixel = (px: number, py: number): number => {
        const o = (py * 256 + px) * 4
        return decodeTerrarium(demTile[o] ?? 0, demTile[o + 1] ?? 0, demTile[o + 2] ?? 0)
      }
      // meshHeightAt(tileZoom) の頂点 (k, k) は z17 連続座標 k*step（内部の scale=2^(17-tileZoom)）に立つ。
      // 「1頂点=1DEM画素」なら、DEM タイル（zoom=demZoom）の画素 (k, k) も同じ z17 座標のはず
      for (const k of [0, 1, 5, 50, 120]) {
        const onGrid = k * (2 * 2 ** (17 - tileZoom)) // 頂点そのものの位置（三角形分割に依らない）
        const vertexHeight = meshHeightAt(sample, tileZoom, onGrid, onGrid)
        expect(vertexHeight).toBeCloseTo(readDemPixel(k, k), 6)
      }
    }
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

  it('放物面（すり鉢型）では対角の中点でメッシュが真の面より高くなり、量は弦の高さ (L√2)²/(8ρ) と符合する', () => {
    // ρ = 600m（すり鉢の設計値どおり。半径60m・深さ3mの放物面 z = 3(r/60)² の頂点の曲率半径 = 60²/(2×3) = 600）
    // ズーム15（格子間隔 = 2 × 2^(17-15) = 8）
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
    // 対角の弦の長さ L = step×√2 なので、弦の高さ（対角の2頂点の平均 − 真の中点）は L²/(8ρ) = a×step² / 2
    // （対角の1次元の弦の高さの公式そのもの。曲率半径の違いではなく、対角に沿った長さで説明できることを
    // タスクレビュー fix round 2 で確認した）
    const expectedSagitta = (a * step ** 2) / 2
    const actualSagitta = mesh - truth
    expect(actualSagitta).toBeGreaterThan(0) // メッシュは常に真の凸面より高い（沈み込みと逆向き）
    // Terrarium の量子化（1/256m）以内の誤差で解析値と一致する（fix round 2: ±0.05m → 量子化限界まで厳密化）
    expect(Math.abs(actualSagitta - expectedSagitta)).toBeLessThan(1 / 256)
  })

  it('鞍点（z = xy）では対角の向き（左上→右下）で三角形分割が決まり、逆向き（右上→左下）の分割とは異なる値になる', () => {
    // 鞍点は双線形（xy の項を持つ）なので、格子の4隅の値は sampleZ17Corner の双線形補間で厳密に再現できる
    // （量子化を除く）一方、三角形分割（区分線形）は対角の向きに依存する——TL-BR と TR-BL で別の値になる
    const trueHeight = (x: number, y: number) => x * y
    const sample = samplerFromContinuous(trueHeight)
    const zoom = 17
    const step = 2 // zoom17 の格子間隔
    // 隅の値（量子化前）: v00=f(0,0)=0, v10=f(2,0)=0, v01=f(0,2)=0, v11=f(2,2)=4
    const u = 0.3
    const v = 0.8 // v > u なので meshHeightAt は左下の三角形 (v00, v11, v01) を使う
    const x = u * step
    const y = v * step
    const mesh = meshHeightAt(sample, zoom, x, y)
    // 左上(v00)→右下(v11) の対角で分割した場合の解析値（三角形 v00, v11, v01。meshHeightAt の v>u の式と同じ）
    const tlBr = 0 * (1 - v) + 4 * u + 0 * (v - u) // = 1.2
    // 右上(v10)→左下(v01) で分割した場合の解析値（三角形 v10, v11, v01。u+v=1.1>1 側）
    const trBl = (1 - v) * 0 + (u + v - 1) * 4 + (1 - u) * 0 // = 0.4
    expect(tlBr).not.toBeCloseTo(trBl, 1) // 2つの分割が実際に異なる値を与えることの確認
    expect(Math.abs(mesh - tlBr)).toBeLessThan(1 / 256) // 量子化（1/256m）以内（タスクレビュー N5）
    expect(mesh).not.toBeCloseTo(trBl, 1)
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
