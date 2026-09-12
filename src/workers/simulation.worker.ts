import { assembleGrid } from '../dem/DemGrid'
import { selectDem, tileKey } from '../dem/demSelection'
import { rangeCorners } from '../dem/gridRange'
import { inServiceArea } from '../dem/serviceArea'
import type { MainToWorkerMessage, TerrainGeo, WorkerToMainMessage } from '../shared/protocol'
import { analyzeTerrain } from '../simulation/terrain/analyzeTerrain'
import { createGsiTileFetcher, HttpError, NetworkError } from './demLoader'
import { SimulationRunner } from './simulationRunner'
import { packTerrain } from './terrainResult'

declare const self: DedicatedWorkerGlobalScope

function post(message: WorkerToMainMessage, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer)
}

// 再生（spec 04 §5）。地形の真の状態はエンジンだけが持つ（Worker は grid を保持しない）
const runner = new SimulationRunner({
  post,
  now: () => performance.now(),
  setTimer: (run, delayMs) => setTimeout(run, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
})

// 新しい地点の読み込みが来たら、取得中のものを取り消す（spec 02 §4.3）
let current: AbortController | null = null

self.addEventListener('message', (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data
  switch (message.type) {
    case 'ping':
      post({ type: 'pong', id: message.id })
      break
    case 'loadTerrain': {
      // 地点の変更はリセット（spec 04 §3）。前の地形の再生を止め、その frame を送らない
      runner.suspend()
      current?.abort()
      const controller = new AbortController()
      current = controller
      void loadTerrain(message, controller)
      break
    }
    default:
      runner.handle(message)
  }
})

async function loadTerrain(
  message: Extract<MainToWorkerMessage, { type: 'loadTerrain' }>,
  controller: AbortController,
): Promise<void> {
  const { requestId } = message
  const { signal } = controller
  let started = 0
  let done = 0
  const report = (): void => post({ type: 'terrainProgress', requestId, done, started })
  try {
    // 対応範囲（日本）の外なら、タイルを取得せずに知らせる（クリック・URL 経由のどちらも通る）。
    // try の中に置き、「失敗はすべて terrainFailed になる」を位置に依存させない
    if (!inServiceArea(message.lon, message.lat)) {
      post({
        type: 'terrainFailed',
        requestId,
        reason: 'out-of-range',
        message: '対応範囲（日本）の外の地点',
      })
      return
    }
    const fetchTile = createGsiTileFetcher(signal, {
      onStart: () => {
        started++
        report()
      },
      onDone: () => {
        done++
        report()
      },
    })
    const selection = await selectDem(message.lon, message.lat, message.sizeM, fetchTile)
    if (signal.aborted) return
    const grid = assembleGrid(selection.range, (tx, ty) => selection.tiles.get(tileKey(tx, ty)))
    if (grid.invalidRatio === 1) {
      post({ type: 'terrainFailed', requestId, reason: 'no-data', message: '範囲の全画素が無効値' })
      return
    }
    const analysis = analyzeTerrain(grid)
    const { range, tier } = selection
    const geo: TerrainGeo = {
      level: tier.level,
      z: range.z,
      originX: range.originX,
      originY: range.originY,
      size: range.size,
      cellSizeM: range.cellSizeM,
      corners: rangeCorners(range),
      breakdown: selection.breakdown,
      invalidRatio: grid.invalidRatio,
    }
    const { payload, transfer } = packTerrain(grid, analysis, geo)
    // エンジンに渡してから送る。grid への参照はこの関数を抜けると消え、エンジンの複製だけが残る
    runner.loadTerrain(requestId, grid, analysis.depressions)
    post({ type: 'terrainLoaded', requestId, terrain: payload }, transfer)
  } catch (error) {
    if (signal.aborted) return // 新しい読み込みに置き換わった
    const reason =
      error instanceof HttpError || error instanceof NetworkError ? 'network' : 'internal'
    post({ type: 'terrainFailed', requestId, reason, message: String(error) })
    // 1 枚の失敗で読み込み全体が失敗したので、残りの取得を止める（計画のレビュー P4）
    controller.abort()
  }
}
