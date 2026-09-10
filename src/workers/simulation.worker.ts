import { assembleGrid } from '../dem/DemGrid'
import { selectDem, tileKey } from '../dem/demSelection'
import { rangeCorners } from '../dem/gridRange'
import type { MainToWorkerMessage, TerrainGeo, WorkerToMainMessage } from '../shared/protocol'
import { analyzeTerrain } from '../simulation/terrain/analyzeTerrain'
import { createGsiTileFetcher, HttpError, NetworkError } from './demLoader'
import { packTerrain, type RetainedTerrain } from './terrainResult'

declare const self: DedicatedWorkerGlobalScope

function post(message: WorkerToMainMessage, transfer: Transferable[] = []): void {
  self.postMessage(message, transfer)
}

// 新しい地点の読み込みが来たら、取得中のものを取り消す（spec 02 §4.3）
let current: AbortController | null = null

// Worker が保持する最新の地形（M1）。新しい読み込みが成功するまでは前のものを残す
// （メインスレッドの SimulationClient.terrain と同じ）。04 でエンジンに渡す
// （loadTerrain と、significant の窪地を setDepressions）
export let terrain: RetainedTerrain | null = null

self.addEventListener('message', (event: MessageEvent<MainToWorkerMessage>) => {
  const message = event.data
  switch (message.type) {
    case 'ping':
      post({ type: 'pong', id: message.id })
      break
    case 'loadTerrain': {
      current?.abort()
      const controller = new AbortController()
      current = controller
      void loadTerrain(message, controller)
      break
    }
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
    const analysis = analyzeTerrain({
      elevation: grid.elevation,
      validMask: grid.validMask,
      width: grid.width,
      height: grid.height,
      cellSizeM: grid.cellSizeM,
    })
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
    const { retained, payload, transfer } = packTerrain(requestId, grid, analysis, geo)
    // 読み込みに成功したので、post の前に保持する地形を差し替える
    terrain = retained
    post({ type: 'terrainLoaded', requestId, terrain: payload }, transfer as Transferable[])
  } catch (error) {
    if (signal.aborted) return // 新しい読み込みに置き換わった
    const reason =
      error instanceof HttpError || error instanceof NetworkError ? 'network' : 'internal'
    post({ type: 'terrainFailed', requestId, reason, message: String(error) })
    // 1 枚の失敗で読み込み全体が失敗したので、残りの取得を止める（計画のレビュー P4）
    controller.abort()
  }
}
