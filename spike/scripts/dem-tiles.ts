/**
 * スパイクの実データの範囲にかかる DEM1A のタイルを 02 の計算で求め、取得の curl のコマンドを出す（一度だけ使う。G2）。
 * Node 24 はこの .ts を直接実行できる（計画 03 の scripts/bench-engine.ts と同じ）
 */
import { demTileUrl } from '../../src/dem/demSources.ts'
import { rangePixelRect } from '../../src/dem/gridRange.ts'
import { tilesInPixelRect } from '../../src/dem/tileMath.ts'
import { shibuyaRange } from '../src/scenes.ts'

const range = shibuyaRange()
for (const tile of tilesInPixelRect(rangePixelRect(range), range.z)) {
  const file = `spike/fixtures/gsi/dem1a-17-${tile.x}-${tile.y}.png`
  console.log(
    `curl -fsS -o ${file} ${demTileUrl('dem1a', tile)} || echo "取得できない: ${tile.x}/${tile.y}"`,
  )
}
