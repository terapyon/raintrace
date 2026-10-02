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
 * 地形と摩擦（spec 08 §9.1 の表）。素の Node で 750 ms を超えるため fillMatch.test.ts から移した
 * （Task 6 Step 4。計画で決めたこと 15）
 */
const TERRAINS: [string, Terrain, number][] = [
  [
    '凹凸（24 × 24、セル 1 m、n = 0.05）',
    buildTerrain(24, 24, 1, (x, y) => 10 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 0.02 * x),
    0.05,
  ],
]

describe('満水との一致（spec 08 §9.1、4 近傍の analyzeDepressions）（重い地形。spec 08 §9.1）', () => {
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
    120_000,
  )
})
