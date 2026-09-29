/**
 * spec 08 の M0 の試作（使い捨て）: U4。綾瀬 500 m・全面を濡らす雨で、1 step の所要時間を今のエンジンと比べる。
 *
 *   node scripts/proto-08/u4.ts [site=ayase] [steps=600]
 *
 * - 今のエンジン（src/simulation の TsSimulationEngine）: 06 の条件（半径 = 範囲の半分・100 mm を一度に置く）
 * - 試作: 範囲全体の雨（100 mm/h × 1 時間）と、半径 = 範囲の半分の円の雨（100 mm/h × 1 時間）
 * どちらも最初の 100 step を捨て、続く steps の中央値と p95 を出す。他の重い処理と同時に回さない
 */
import { loadavg } from 'node:os'
import { TsSimulationEngine } from '../../src/simulation/TsSimulationEngine.ts'
import { LiEngine } from './li.ts'
import { loadSite, SITES, type SiteName } from './site.ts'

const site = (process.argv[2] ?? 'ayase') as SiteName
const steps = Number(process.argv[3] ?? 600)
const WARM = 100
const g = await loadSite(site, 500)
const half = (g.width * g.cellSizeM) / 2

function summary(times: number[]): string {
  const s = [...times].sort((a, b) => a - b)
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] ?? 0
  return `${at(0.5).toFixed(3)} | ${at(0.95).toFixed(3)}`
}

function timeCurrent(): string {
  const e = new TsSimulationEngine()
  e.loadTerrain(g.elevation, g.validMask, {
    width: g.width,
    height: g.height,
    cellSizeM: g.cellSizeM,
  })
  e.addRainfall({ x: g.center.x, y: g.center.y, radiusM: half, amountMm: 100 })
  const times: number[] = []
  for (let n = 0; n < WARM + steps; n++) {
    const t0 = performance.now()
    e.step()
    const dt = performance.now() - t0
    if (n >= WARM) times.push(dt)
  }
  return summary(times)
}

function timeLi(rain: 'all' | 'circle', skipSimS: number): string {
  const e = new LiEngine(g.elevation, g.validMask, g.width, g.height, g.cellSizeM)
  if (rain === 'all') e.setRainAll(100, 3600)
  else e.setRainCircle(g.center.x, g.center.y, half, 100, 3600)
  while (e.t < skipSimS) e.step()
  const times: number[] = []
  let sumDt = 0
  for (let n = 0; n < WARM + steps; n++) {
    const t0 = performance.now()
    const s = e.step()
    const dt = performance.now() - t0
    if (n >= WARM) {
      times.push(dt)
      sumDt += s.dt
    }
  }
  return `${summary(times)} | ${(sumDt / steps).toFixed(3)} | ${e.x1 - e.x0}×${e.y1 - e.y0}`
}

console.log(
  `# U4: ${SITES[site].label} 500 m（${g.width}×${g.height}）、Node ${process.version}、load average ${loadavg()
    .map((v) => v.toFixed(2))
    .join(' ')}`,
)
console.log('')
console.log('| エンジン・雨 | 中央値（ms） | p95（ms） | 平均の dt（s） | 走査範囲 |')
console.log('|---|---:|---:|---:|---|')
console.log(
  `| 今のエンジン・半径 ${half.toFixed(0)} m・100 mm（06 の全面を濡らす雨） | ${timeCurrent()} | — | — |`,
)
console.log(`| 試作・範囲全体の雨 100 mm/h（開始直後） | ${timeLi('all', 0)} |`)
console.log(`| 試作・範囲全体の雨 100 mm/h（10 分後から） | ${timeLi('all', 600)} |`)
console.log(
  `| 試作・半径 ${half.toFixed(0)} m・100 mm/h（10 分後から） | ${timeLi('circle', 600)} |`,
)
console.log(`| 今のエンジン・2 回目 | ${timeCurrent()} | — | — |`)
console.log('')
console.log(
  `load average（終わり） ${loadavg()
    .map((v) => v.toFixed(2))
    .join(' ')}`,
)
