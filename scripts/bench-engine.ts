/**
 * エンジンのベンチマーク（spec 03 §5）。Node 24 で直接実行する（型注釈は Node が取り除く）:
 *
 *   pnpm bench:engine [上限の step 数（既定 100000）]
 *
 * 512 × 512 の合成地形（窪地と斜面を含む）に、半径 10m と 100m・雨量 100mm を降らせ、
 * 1 step の所要時間の中央値と p95、平衡までの step 数を Markdown の表で出す。
 * 計時はこのスクリプトで行う（src/simulation は performance を参照できない）。
 * CI のゲートにはしない。結果は PR に記録し、tech-spec §6.3 の基準（中央値 8ms、p95 16ms）と比べる
 */
import { TsSimulationEngine } from '../src/simulation/TsSimulationEngine.ts'
import type { RainfallInput, StepStats } from '../src/simulation/types.ts'

const SIZE = 512
const CELL_M = 0.98

/** 窪地: [中心の列, 中心の行, 深さ（m）, 広がり σ（セル）] */
const PITS: [number, number, number, number][] = [
  [256, 256, 3, 40],
  [120, 140, 2, 25],
  [400, 120, 1.5, 30],
  [150, 400, 2.5, 35],
  [380, 380, 1, 20],
]

/** 東へ 1% で下る斜面に、ガウス形の窪地 5 つと小さな凹凸を重ねた地形 */
function syntheticElevation(): Float32Array {
  const elevation = new Float32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let z = 50 - 0.01 * x * CELL_M + 0.05 * Math.sin(x * 0.3) * Math.sin(y * 0.2)
      for (const [cx, cy, depth, sigma] of PITS) {
        z -= depth * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma))
      }
      elevation[y * SIZE + x] = z
    }
  }
  return elevation
}

/** 昇順に並べた配列の p 分位点（最近傍法） */
function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[i] ?? Number.NaN
}

function run(label: string, elevation: Float32Array, rain: RainfallInput, maxSteps: number): void {
  const engine = new TsSimulationEngine()
  const validMask = new Uint8Array(SIZE * SIZE).fill(1)
  engine.loadTerrain(elevation, validMask, { width: SIZE, height: SIZE, cellSizeM: CELL_M })
  engine.addRainfall(rain)
  const times: number[] = []
  let last: StepStats | null = null
  const started = performance.now()
  for (let n = 0; n < maxSteps; n++) {
    const t0 = performance.now()
    last = engine.step()
    times.push(performance.now() - t0)
    if (last.settled) break
  }
  const seconds = (performance.now() - started) / 1000
  times.sort((a, b) => a - b)
  const settled = last?.settled ? `${last.step}` : `未到達（上限 ${maxSteps}）`
  const cells = [
    label,
    String(times.length),
    percentile(times, 0.5).toFixed(3),
    percentile(times, 0.95).toFixed(3),
    settled,
    (last?.maxDepth ?? 0).toFixed(3),
    (last?.massError ?? 0).toExponential(2),
    seconds.toFixed(1),
  ]
  console.log(`| ${cells.join(' | ')} |`)
}

const maxSteps = Number(process.argv[2] ?? 100_000)
if (!(Number.isInteger(maxSteps) && maxSteps > 0)) {
  console.error('usage: node scripts/bench-engine.ts [上限の step 数（正の整数）]')
  process.exit(1)
}
const elevation = syntheticElevation()
const center = { x: 256.5 * CELL_M, y: 256.5 * CELL_M }

console.log(`Node ${process.version}、${SIZE} × ${SIZE}、セル ${CELL_M}m、上限 ${maxSteps} step`)
console.log('')
console.log(
  '| 降雨 | step 数 | 中央値（ms） | p95（ms） | 平衡までの step | 最大水深（m） | 質量誤差（m³） | 所要（秒） |',
)
console.log('|---|---:|---:|---:|---:|---:|---:|---:|')
run('半径 10m・100mm', elevation, { ...center, radiusM: 10, amountMm: 100 }, maxSteps)
run('半径 100m・100mm', elevation, { ...center, radiusM: 100, amountMm: 100 }, maxSteps)
