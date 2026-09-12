import type { Page } from '@playwright/test'
import type { View, WaterMeasure, ZFix } from '../../src/types'
import { allViews } from './views'

// 判定の閾値（計画 D9）
export const MIN_VISIBLE = 0.98
export const MAX_FLICKER = 0.01
// 数値の計測の視点（16 通り）: ズーム 15〜18 × 倍率 1・10 × pitch 60・85。スクリーンショットは 64 通りのまま（R1）
export const MEASURE_VIEWS: View[] = allViews().filter(
  (v) => (v.exaggeration === 1 || v.exaggeration === 10) && (v.pitch === 60 || v.pitch === 85),
)

export interface MeasureRow {
  scene: string
  zfix: ZFix
  view: View
  measure: WaterMeasure
}

export async function measure(page: Page): Promise<WaterMeasure> {
  return page.evaluate(async () => {
    if (window.spike === undefined) throw new Error('window.spike がありません')
    return window.spike.measure()
  })
}

/** 視点ごとの最小の可視率と最大のちらつきの表(ズーム × 垂直強調、pitch の 4 通りをまとめる) */
export function summarize(rows: MeasureRow[], scene: string, zfix: ZFix): string {
  const lines = [
    `### ${scene} / zfix=${zfix}`,
    '',
    '| ズーム | 強調 | 可視率の最小 | ちらつきの最大 | 判定 |',
    '|---|---|---:|---:|:---:|',
  ]
  for (const zoom of [15, 16, 17, 18]) {
    for (const exaggeration of [1, 2, 5, 10]) {
      const group = rows.filter(
        (r) =>
          r.scene === scene &&
          r.zfix === zfix &&
          r.view.zoom === zoom &&
          r.view.exaggeration === exaggeration,
      )
      if (group.length === 0) continue
      const visible = Math.min(...group.map((r) => r.measure.visibleRatio))
      const flicker = Math.max(...group.map((r) => r.measure.flickerRatio))
      const ok = visible >= MIN_VISIBLE && flicker <= MAX_FLICKER
      lines.push(
        `| ${zoom} | ${exaggeration} | ${visible.toFixed(4)} | ${(flicker * 100).toFixed(2)}% | ${ok ? '○' : '×'} |`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}
