/**
 * 計測用のフック（spec 05 §4.4、spec 06 §3、R05-6・R06-5）。pnpm build:perf のときだけビルドに入る。
 * URL（例: ?lat=35.658&lon=139.7016&size=500&probe=fps&z=16&ex=10&pitch=85&water=0&hillshade=on）を読み、
 * 地形の読み込みの後に 3D の視点を置き、タイルが揃うのを待ち、水面ありなら「最速」で降雨を回して計測する。
 * 結果の JSON は <html data-fps-result> と画面の左上に出す（利用者の画面ではないので strings.ts を使わない）
 */
import { runFpsProbe } from '../map/fpsProbe'
import type { TileTimeSample } from '../map/view3d/options'
import type { SettingsStore } from '../state/settingsStore'
import {
  listenStepTimes,
  observeLongTasks,
  summarizeLongTasks,
  summarizeStepSeries,
} from './perfCollectors'
import { runLoadProbe } from './perfLoad'
import { parsePerfParams } from './perfParams'
import { runStepsProbe } from './perfSteps'
import {
  nextFrame,
  type ProbeView,
  placeViewOnLoadedTerrain,
  show,
  sleep,
  waitFor,
  waitTilesLoaded,
} from './perfWait'
import type { TerrainSession } from './terrainSession'

export async function installPerfHook(
  session: TerrainSession,
  settings: SettingsStore,
): Promise<void> {
  const params = parsePerfParams(window.location.search)
  if (params === null) return
  const root = document.documentElement
  // 長いタスクと 1 step の所要時間は、どの probe でも最初から集める（spec 06 §3、計画で決めたこと 2・10）
  const longTasks = observeLongTasks()
  const stepTimes = listenStepTimes()
  const renderTimes: number[] = []
  const tileTimes: TileTimeSample[] = []
  const prepareMs: number[] = []
  const waterBuildMs: number[] = []
  session.view3d.setOptions({
    hillshade: params.hillshade,
    water: params.water,
    boundaryFallback: params.fallback,
    // depthEvery=N の指定があるときだけ渡す（無ければ View3d の既定。spec 06 §5.1）
    ...(params.depthEvery === null ? {} : { depthUploadEvery: params.depthEvery }),
    onRenderTime: (ms) => renderTimes.push(ms),
    onTileTime: (sample) => tileTimes.push(sample),
    onPrepareTime: (ms) => prepareMs.push(ms),
    onWaterBuildTime: (ms) => waterBuildMs.push(ms),
  })
  settings.getState().setDisplay({
    verticalExaggeration: params.exaggeration,
    // arrows=0: 水の流れの矢印を止める（spec 06 §5.1、計画で決めたこと 8）。Worker は flowVectors() を呼ばない
    ...(params.arrows ? {} : { showFlowVectors: false }),
    // arrowsM=5・10・20: 矢印の間隔の設定（1000 m の実効はその 2 倍）。省けば設定を触らない（spec 06 §5.1）
    ...(params.arrowsM === null ? {} : { flowVectorSpacingM: params.arrowsM }),
  })
  /** 結果を <html data-*> と画面に出す */
  const publish = (key: 'stepsResult' | 'loadResult', report: unknown): void => {
    root.dataset[key] = JSON.stringify(report)
    show(report)
  }
  const { store } = session
  try {
    if (params.probe === 'steps') {
      publish('stepsResult', await runStepsProbe(session, settings, params, longTasks, stepTimes))
      return
    }
    if (params.probe === 'load') {
      publish(
        'loadResult',
        await runLoadProbe(session, params, longTasks, { prepareMs, waterBuildMs }),
      )
      return
    }
    await waitFor(
      () => store.getState().load.status === 'ready',
      (listener) => store.subscribe(listener),
    )
    if (params.mode === '3d') {
      store.getState().setViewMode('3d')
      await waitFor(
        () => store.getState().view3dStatus === '3d',
        (listener) => store.subscribe(listener),
      )
    }
    const controller = session.view3d.mapController()
    const selected = store.getState().selected
    if (controller === null || selected === null) throw new Error('地図または地点がありません')
    const { map } = controller
    const { dataset } = map.getContainer()
    if (params.mode === '3d') {
      // 3D の視点へ動き終えてから（View3d.frame の easeTo の moveend）置く。置いた視点は結果に入れ、
      // fps.perf.ts が URL と照合する（後から視点が動かされていれば落ちる）
      await waitFor(
        () => dataset.view3dFramed === 'true',
        (listener) => {
          map.on('moveend', listener)
          return () => map.off('moveend', listener)
        },
      )
    }
    const camera: ProbeView = {
      center: [selected.lon, selected.lat],
      zoom: params.zoom,
      pitch: params.pitch,
      bearing: params.bearing,
    }
    const tiles = await placeViewOnLoadedTerrain(
      map,
      camera,
      () => {
        if (!params.water) return
        session.simulation.setSpeed('max')
        const { amountMm, radiusM } = settings.getState().rainfall
        session.simulation.start(amountMm, radiusM)
      },
      () => waitTilesLoaded(map),
    )
    // 2 回目の jumpTo（読める地形の上で計算された視点）の直後の値。計測の後の値と一致すれば、
    // 計測の窓の間ずっとこの視点だったと言える（1 回の標本では、窓の間の視点を示せない）
    const achievedBeforeSettle = { mapZoom: map.getZoom(), mapPitch: map.getPitch() }
    await new Promise((resolve) => setTimeout(resolve, params.settleMs))
    if (params.probe === 'view') {
      root.dataset.perfReady = 'true'
      return
    }
    // pause=1: 止めた水面（転送 0・描画はそのまま）を測る（spec 06 §5.1、計画で決めたこと 7）
    if (params.water && params.pauseBeforeRun) {
      session.simulation.pause()
      await nextFrame()
      await nextFrame()
    }
    const runStart = performance.now()
    const result = await runFpsProbe(map, params.durationMs, { renderTimes, tileTimes })
    const runEnd = performance.now()
    // 測った視点。mode=3d の fps で 3D で描いていなければ（(c) で 2D に落ちた。URL に fallback=0 が無い）、
    // 2D の fps を 3D として記録しないよう失敗にする
    const achievedAfterRun = { mapZoom: map.getZoom(), mapPitch: map.getPitch() }
    const view3d = dataset.view3d ?? 'off'
    if (params.mode === '3d' && view3d !== '3d') {
      throw new Error(`3D で描いていません（data-view3d=${view3d}）。URL に fallback=0 を付ける`)
    }
    // 1 step の所要時間の要約は 1 秒遅れて届くので、窓の終わりの分が届くまで待ってから報告を作る
    await sleep(1500)
    // 計測の窓（fpsProbe のウォームアップの 1 秒を除く。D15 と同じ）の長いタスクと、
    // Worker が送った 1 step の所要時間
    const windowStart = runStart + result.warmupMs
    const summary = store.getState().summary
    const report = {
      params,
      view3d,
      // 既存の読み手のために、mapZoom・mapPitch は「計測の後」の値のまま残す
      ...achievedAfterRun,
      achievedBeforeSettle,
      achievedAfterRun,
      prepareMs,
      waterBuildMs,
      tiles,
      result,
      // perfSteps.runStepsProbe と同じ形（レビュー裁定 m4。fps の結果から DEM の水準を直接読めるようにする）
      terrain:
        summary === null
          ? null
          : {
              demLevel: summary.demLevel,
              cellSizeM: summary.cellSizeM,
              invalidRatio: summary.invalidRatio,
            },
      longTasks: summarizeLongTasks(longTasks.entries, longTasks.supported, windowStart, runEnd),
      stepTimes: summarizeStepSeries(stepTimes.series, windowStart, runEnd + 1500),
    }
    root.dataset.fpsResult = JSON.stringify(report)
    show(report)
  } catch (error) {
    root.dataset.perfError = String(error)
    show({ error: String(error) })
  }
}
