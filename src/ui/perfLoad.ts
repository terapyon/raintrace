/**
 * probe=load（spec 06 §3・§5、計画で決めたこと 9）: at= の地点を地図のクリックと同じ経路（TerrainSession.select）で
 * 選び、2D の地形が出るまでと、mode=3d なら続けて 3D を押してから最初の 3D のフレームまでを測る。
 * 地理院に実際に接続する（本番のタイルの経路）。pnpm build:perf のときだけビルドに入る
 */
import { type LongTaskCollector, summarizeLongTasks } from './perfCollectors'
import type { PerfParams } from './perfParams'
import type { LoadReport, To3dTiming } from './perfReports'
import { nextFrame, pollUntil, WAIT_MS, waitFor, waitForDataset, waitTilesLoaded } from './perfWait'
import type { TerrainSession } from './terrainSession'

export async function runLoadProbe(
  session: TerrainSession,
  params: PerfParams,
  longTasks: LongTaskCollector,
  samples: { prepareMs: number[]; waterBuildMs: number[] },
): Promise<LoadReport> {
  const at = params.at
  if (at === null) throw new Error('probe=load には at=緯度,経度 が要ります（lat・lon は付けない）')
  const { store } = session
  const loaded = await pollUntil(() => session.view3d.mapController()?.isLoaded() === true, WAIT_MS)
  const controller = session.view3d.mapController()
  if (!loaded || controller === null) throw new Error('地図の読み込みが時間内に終わりませんでした')
  const { map } = controller
  const container = map.getContainer()
  if (store.getState().selected !== null) {
    throw new Error('起動時に地点が選ばれています。URL から lat・lon を外してください')
  }
  await nextFrame()
  const start = performance.now()
  const ready = waitFor(
    () => store.getState().load.status === 'ready',
    (listener) => store.subscribe(listener),
  ).then(() => performance.now())
  // waitForDataset・その後の待ちが先に失敗しても、ready がその後に timeout で reject したときに
  // unhandled rejection を出さない（ready はこの下で await するので、握りつぶしても失敗は伝わる。R-g）
  ready.catch(() => {})
  session.select(at.lon, at.lat)
  await waitForDataset(container, (dataset) => dataset.rangeShown === 'true')
  await nextFrame()
  await nextFrame()
  const shown = performance.now()
  const readyAt = await ready

  let to3d: To3dTiming | null = null
  let to3dWindow: [number, number] | null = null
  if (params.mode === '3d') {
    const pressed = performance.now()
    store.getState().setViewMode('3d')
    await waitFor(
      () => store.getState().view3dStatus === '3d',
      (listener) => store.subscribe(listener),
    )
    const status = performance.now()
    let waterBuilt: number | null = null
    if (params.water) {
      await waitForDataset(container, (dataset) => Number(dataset.waterBuilds ?? '0') >= 1)
      waterBuilt = performance.now()
    }
    const tiles = await waitTilesLoaded(map)
    await nextFrame()
    await nextFrame()
    const first = performance.now()
    to3d = {
      statusMs: status - pressed,
      waterBuiltMs: waterBuilt === null ? null : waterBuilt - pressed,
      tilesLoaded: tiles.loaded,
      firstFrameMs: first - pressed,
    }
    to3dWindow = [pressed, first]
  }
  return {
    params,
    sizeM: Number(new URLSearchParams(window.location.search).get('size') ?? '500'),
    selectToReadyMs: readyAt - start,
    selectTo2dMs: shown - start,
    to3d,
    prepareMs: samples.prepareMs,
    waterBuildMs: samples.waterBuildMs,
    longTasks: {
      load: summarizeLongTasks(longTasks.entries, longTasks.supported, start, shown),
      to3d:
        to3dWindow === null
          ? null
          : summarizeLongTasks(
              longTasks.entries,
              longTasks.supported,
              to3dWindow[0],
              to3dWindow[1],
            ),
      entries: longTasks.entries.filter((entry) => entry.startMs >= start),
    },
  }
}
