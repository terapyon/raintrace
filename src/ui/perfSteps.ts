/**
 * probe=steps（spec 06 §4.2）: 降雨を「最速」で回し、平衡（または cap・窓の終わり）までの step 数・時間と、
 * 1 step の所要時間・長いタスク・止まっている間の再描画を測る。pnpm build:perf のときだけビルドに入る
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { SettingsStore } from '../state/settingsStore'
import type { SimulationStore } from '../state/simulationStore'
import {
  type LongTaskCollector,
  type StepTimeListener,
  summarizeLongTasks,
  summarizeStepSeries,
} from './perfCollectors'
import type { PerfParams } from './perfParams'
import type { StepsReport } from './perfReports'
import { sleep, waitFor, waitForDataset } from './perfWait'
import type { TerrainSession } from './terrainSession'

/** 止めた後、再描画を数える前に待つ時間（最後の frame・矢印の反映を流す） */
export const IDLE_QUIET_MS = 1000
/** 止まっている間の再描画を数える時間 */
export const IDLE_WINDOW_MS = 2000
/** 1x の再生速度（R04-5） */
const STEPS_PER_SECOND_AT_1X = 60
/** Worker の要約は 1 秒ごとに届くので、窓の終わりを延ばす */
const SNAPSHOT_LAG_MS = 1500

export function minutesAt1x(steps: number): number {
  return steps / STEPS_PER_SECOND_AT_1X / 60
}

/** 平衡になったら true、limitMs を過ぎたら false。再生が失敗したら reject */
function waitSettled(sim: SimulationStore, limitMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const decided = (): boolean | null => {
      const { status, error } = sim.getState()
      if (error !== null) throw new Error(`再生が失敗しました: ${error}`)
      return status === 'settled' ? true : null
    }
    try {
      if (decided() === true) {
        resolve(true)
        return
      }
    } catch (error) {
      reject(error)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const off = sim.subscribe(() => {
      try {
        if (decided() !== true) return
        clearTimeout(timer)
        off()
        resolve(true)
      } catch (error) {
        clearTimeout(timer)
        off()
        reject(error)
      }
    })
    timer = setTimeout(() => {
      off()
      resolve(false)
    }, limitMs)
  })
}

function countRenders(map: MapLibreMap, windowMs: number): Promise<number> {
  return new Promise((resolve) => {
    let count = 0
    const onRender = (): void => {
      count++
    }
    map.on('render', onRender)
    setTimeout(() => {
      map.off('render', onRender)
      resolve(count)
    }, windowMs)
  })
}

export async function runStepsProbe(
  session: TerrainSession,
  settings: SettingsStore,
  params: PerfParams,
  longTasks: LongTaskCollector,
  stepTimes: StepTimeListener,
): Promise<StepsReport> {
  const { store, simulation } = session
  await waitFor(
    () => store.getState().load.status === 'ready',
    (listener) => store.subscribe(listener),
  )
  const controller = session.view3d.mapController()
  if (controller === null) throw new Error('地図がありません')
  const { map } = controller
  if (params.mode === '3d') {
    store.getState().setViewMode('3d')
    await waitFor(
      () => store.getState().view3dStatus === '3d',
      (listener) => store.subscribe(listener),
    )
    // 「3D while playing」だけを窓に入れるため、視点が定まる（view3dFramed）まで、水面ありなら水面ができる
    // （waterBuilds ≥ 1）まで、降雨を始める前に待つ（perfLoad の待ち方と揃える。横断レビュー R2）
    const container = map.getContainer()
    await waitForDataset(container, (dataset) => dataset.view3dFramed === 'true')
    if (params.water) {
      await waitForDataset(container, (dataset) => Number(dataset.waterBuilds ?? '0') >= 1)
    }
  }
  const { rainfall, area } = settings.getState()
  simulation.setSpeed('max')
  const limitMs = params.until === 'settle' ? params.capMs : params.durationMs
  const start = performance.now()
  simulation.start(rainfall.amountMm, rainfall.radiusM)
  const settled = await waitSettled(simulation.store, limitMs)
  const elapsedMs = performance.now() - start
  if (!settled) simulation.pause()
  const end = performance.now()
  await sleep(IDLE_QUIET_MS)
  const idleRenders = await countRenders(map, IDLE_WINDOW_MS)
  const final = simulation.store.getState().stats
  const steps = final?.step ?? 0
  const summary = store.getState().summary
  return {
    params,
    view3d: map.getContainer().dataset.view3d ?? 'off',
    sizeM: area.sizeM,
    rain: { amountMm: rainfall.amountMm, radiusM: rainfall.radiusM },
    terrain:
      summary === null
        ? null
        : {
            demLevel: summary.demLevel,
            cellSizeM: summary.cellSizeM,
            invalidRatio: summary.invalidRatio,
          },
    settled,
    steps,
    elapsedMs,
    minutesAt1x: minutesAt1x(steps),
    stepsPerSecond: elapsedMs > 0 ? steps / (elapsedMs / 1000) : 0,
    final,
    stepTimes: {
      ...summarizeStepSeries(stepTimes.series, start, end + SNAPSHOT_LAG_MS),
      series: stepTimes.series.filter((s) => s.atMs >= start && s.atMs < end + SNAPSHOT_LAG_MS),
    },
    longTasks: summarizeLongTasks(longTasks.entries, longTasks.supported, start, end),
    idleRenders,
    idleWindowMs: IDLE_WINDOW_MS,
  }
}
