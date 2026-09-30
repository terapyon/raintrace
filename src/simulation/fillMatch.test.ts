import { describe, expect, it } from 'vitest'
import { analyzeDepressions } from './terrain/analyzeDepressions.ts'
import {
  buildTerrain,
  engineOn,
  QUIET_FILL_M_PER_S,
  runUntilQuiet,
  type Terrain,
} from './testing/fixtures.test-support.ts'

/** 池のセル（4 近傍の Priority-Flood で窪地に入るセル）の |H − F| の許容（tech-spec §6.6 の目標。spec 08 §9.1） */
const POND_TOLERANCE_M = 0.01
/**
 * 池の外の有効セルの水深の許容（spec 08 §9.1）。止め方 3 mm/h の後も、緩い斜面には mm の膜が残る
 * （試作の最大 3.36 mm）。本物の不一致（1 cm 以上）は捕まえる。**後から黙って緩めない**（M0 の承認の軽微 m2。
 * 外れたら先に止め方の閾値か manningN を動かし、レビュー役に渡す）
 */
const OUTSIDE_TOLERANCE_M = 0.005
/** 上限の step 数（spec 08 §9.1。試作では 6,708〜32,646 step） */
const MAX_STEPS = 1_000_000

/**
 * 地形と摩擦（spec 08 §9.1 の表。n は地形ごとに選んだ。凹凸は n = 0.03 だと排水の慣性で池の水位が F より約 17 mm 下がる）。
 * 「凹凸（24 × 24）」は素の Node で 750 ms を超えるため fillMatch.slow.test.ts に移した（Task 6 Step 4）
 */
const TERRAINS: [string, Terrain, number][] = [
  [
    '凹凸と無効セル（24 × 20、セル 3.9 m、n = 0.03）',
    buildTerrain(24, 20, 3.9, (x, y) =>
      x >= 9 && x <= 11 && y >= 8 && y <= 10
        ? Number.NaN
        : 10 + 0.8 * Math.sin(x * 0.9) * Math.sin(y * 0.8),
    ),
    0.03,
  ],
  [
    '入れ子の窪地（12 × 12、セル 1 m、東の縁に高さ 1.5 m の切れ目、n = 0.03）',
    buildTerrain(12, 12, 1, (x, y) => {
      if (x === 0 || y === 0 || x === 11 || y === 11) return x === 11 && y === 6 ? 1.5 : 3
      const bowl = 0.1 * Math.hypot(x - 5.5, y - 5.5)
      const pitA = Math.hypot(x - 3.5, y - 3.5) < 1.5 ? -0.5 : 0
      const pitB = Math.hypot(x - 8, y - 7.5) < 1.6 ? -0.3 : 0
      return bowl + pitA + pitB
    }),
    0.03,
  ],
]

describe('満水との一致（spec 08 §9.1、4 近傍の analyzeDepressions）', () => {
  it.each(TERRAINS)(
    '%s: 範囲全体に 2 m を一度に置き、水深の変化が 3 mm/h 未満になった水面が 4 近傍の F と一致する',
    (_, t, manningN) => {
      const { fill, labels } = analyzeDepressions({
        elevation: t.elevation,
        validMask: t.validMask,
        ...t.meta,
      })
      const engine = engineOn(t, { manningN })
      engine.setRainfall({
        x: 0,
        y: 0,
        radiusM: 1,
        intensityMmPerH: 2000,
        durationS: 0,
        wholeRange: true,
      })
      runUntilQuiet(engine, QUIET_FILL_M_PER_S, MAX_STEPS)
      const w = engine.waterDepth()
      let pond = 0
      let outside = 0
      let pondCells = 0
      let outsideCells = 0
      for (let i = 0; i < w.length; i++) {
        if ((t.validMask[i] ?? 0) === 0) continue
        const d = w[i] ?? 0
        expect(d).toBeGreaterThanOrEqual(0)
        if ((labels[i] ?? 0) !== 0) {
          pond = Math.max(pond, Math.abs((t.elevation[i] ?? 0) + d - (fill[i] ?? 0)))
          pondCells++
        } else {
          outside = Math.max(outside, d)
          outsideCells++
        }
      }
      expect(pondCells).toBeGreaterThan(0)
      expect(outsideCells).toBeGreaterThan(0)
      expect(pond).toBeLessThanOrEqual(POND_TOLERANCE_M)
      expect(outside).toBeLessThanOrEqual(OUTSIDE_TOLERANCE_M)
    },
    30_000,
  )
})
