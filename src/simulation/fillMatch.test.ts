import { describe, expect, it } from 'vitest'
import { FLOW_THRESHOLD_M } from './constants.ts'
import { analyzeDepressions } from './terrain/analyzeDepressions.ts'
import {
  buildTerrain,
  engineOn,
  outletDistances,
  runUntilSettled,
  type Terrain,
} from './testing/fixtures.test-support.ts'

/** 02 の地形解析による満水時の水面 F（無効セルは 0）。02 の API に合わせるのはこの関数だけ */
function filledSurface(t: Terrain): Float32Array {
  return analyzeDepressions({ elevation: t.elevation, validMask: t.validMask, ...t.meta }).fill
}

/** 流出口が下り続ける地形（流出口の先が平らだと、θ の傾きが流出口の先まで積み上がる） */
const TERRAINS: [string, Terrain][] = [
  [
    '凹凸（24 × 24、セル 1m）',
    buildTerrain(24, 24, 1, (x, y) => 10 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 0.02 * x),
  ],
  [
    '凹凸と無効セル（24 × 20、セル 3.9m）',
    buildTerrain(24, 20, 3.9, (x, y) =>
      x >= 9 && x <= 11 && y >= 8 && y <= 10
        ? Number.NaN
        : 10 + 0.8 * Math.sin(x * 0.9) * Math.sin(y * 0.8),
    ),
  ],
  [
    '入れ子の窪地（20 × 20、セル 1m、東の縁に高さ 1.5m の切れ目）',
    buildTerrain(20, 20, 1, (x, y) => {
      if (x === 0 || y === 0 || x === 19 || y === 19) return x === 19 && y === 10 ? 1.5 : 3
      const bowl = 0.1 * Math.hypot(x - 9.5, y - 9.5)
      const pitA = Math.hypot(x - 6, y - 6) < 2 ? -0.5 : 0
      const pitB = Math.hypot(x - 13, y - 12) < 2.5 ? -0.3 : 0
      return bowl + pitA + pitB
    }),
  ],
]

describe('満水との一致（spec 03 §6.1、02 の analyzeDepressions）', () => {
  // この 30,000ms は it.each の 3 つすべてに効く。必要なのは入れ子の窪地だけ（平衡まで約 54,000 step
  // かかり、カバレッジの計測（pnpm test:coverage）の v8 の計測のオーバーヘッドで既定の 5,000ms を超える）
  it.each(TERRAINS)(
    '%s: 十分な水を入れて平衡させた水面が F と一致する',
    (_, t) => {
      const F = filledSurface(t)
      const d = outletDistances(t, F)
      const { width, height, cellSizeM } = t.meta
      let validCells = 0
      for (let i = 0; i < t.validMask.length; i++) if ((t.validMask[i] ?? 0) !== 0) validCells++
      const engine = engineOn(t)
      // グリッド全体に 2m の雨。窪地を満たした残りは領域外へ流れ出る
      engine.addRainfall({
        x: (width * cellSizeM) / 2,
        y: (height * cellSizeM) / 2,
        radiusM: Math.hypot(width, height) * cellSizeM,
        amountMm: 2000,
      })
      runUntilSettled(engine, 200_000)
      const w = engine.waterDepth()
      let checked = 0
      let checkedOutside = 0
      for (let i = 0; i < w.length; i++) {
        const di = d[i] ?? -1
        if (di < 0) {
          if ((t.validMask[i] ?? 0) === 0) continue
          // 窪地の外の有効セル（F_i = Z_i）: そこからは、標高が Z_i 以下のセルだけを通ってグリッドの
          // 端か無効セルの隣まで届く経路がある。平衡では、経路を下流から 1 ホップさかのぼるごとに
          // 水面は高々 θ しか上がらず（乾いたセルの水面は標高で Z_i 以下）、終点は仮想セルと同じ標高
          // なので水深は θ 以下。したがって w_i ≤ θ × (経路長 + 1) ≤ θ × (有効セルの数 + 1)。
          // 24 × 24 なら約 5.8mm で、DEM の刻み 1cm より小さいので、本物の不一致は捕まえる
          const wi = w[i] ?? 0
          expect(wi).toBeGreaterThanOrEqual(0)
          expect(wi).toBeLessThanOrEqual(FLOW_THRESHOLD_M * (validCells + 1) + 1e-9)
          checkedOutside++
          continue
        }
        const h = (t.elevation[i] ?? 0) + (w[i] ?? 0)
        const f = F[i] ?? 0
        // 許容: F − 1e-9 ≤ H ≤ F + θ × (d(i) + 2) + 1e-9。池の水面は流出口から 1 ホップごとに最大 θ 高くなりうる。
        // さらに、端・無効セルに接する流出口は、仮想セルが同じ標高なので水面差がその水深そのものになり、
        // θ 以下の水を持ったまま止まる（+2 のうちの 1 つ分）。下限は、水面が低すぎる不具合を捕まえる
        expect(h).toBeGreaterThanOrEqual(f - 1e-9)
        expect(h - f).toBeLessThanOrEqual(FLOW_THRESHOLD_M * (di + 2) + 1e-9)
        checked++
      }
      expect(checked).toBeGreaterThan(0)
      expect(checkedOutside).toBeGreaterThan(0)
    },
    30_000,
  )
})
