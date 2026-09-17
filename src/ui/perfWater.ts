/**
 * probe=water（spec 06 §3、R06-7、計画で決めたこと 15）: 降雨を「最速」で wetMs だけ回して止め、zs の視点ごとに
 * 水面を 3 通りに描いて画素を数え、可視率・持ち上げ比・ちらつき率を出す。pnpm build:perf のときだけビルドに入る
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { WaterDebug } from '../map/view3d/options'
import type { SettingsStore } from '../state/settingsStore'
import type { PerfParams } from './perfParams'
import type { WaterProbeReport, WaterProbeRow } from './perfReports'
import {
  nextFrame,
  placeViewOnLoadedTerrain,
  sleep,
  waitFor,
  waitForDataset,
  waitTilesLoaded,
} from './perfWait'
import {
  JITTER_DEG,
  judgeWater,
  LIFT_M,
  magentaMask,
  measureWaterMasks,
  type WaterMeasure,
} from './perfWaterStats'
import type { TerrainSession } from './terrainSession'

/**
 * 次の描画の直後に、既定のフレームバッファの画素を読んでマスクにする。preserveDrawingBuffer を変えないため、
 * render イベントの中（合成の前）で読む。render は painter.render の直後に同期で発火する
 * （node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs 26187〜26197）。フレームバッファの切り替えは MapLibre の
 * GL の状態の cache を通す（gl.bindFramebuffer を直接呼ぶと MapLibre が覚えている値とずれる）。
 * map.painter.context.bindFramebuffer（dev.mjs 16954）は MapLibre 6.6.0 の内部（M6 の一覧に足す）
 */
function readMask(map: MapLibreMap): Promise<Uint8Array> {
  return new Promise((resolve) => {
    map.once('render', () => {
      const { context } = map.painter
      const { gl } = context
      context.bindFramebuffer.set(null)
      const rgba = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        rgba,
      )
      resolve(magentaMask(rgba))
    })
    map.triggerRepaint()
  })
}

/** 描き方を変えた後、タイルが揃って 1 フレーム描くのを待ってから読む */
async function drawAndRead(
  map: MapLibreMap,
  setDebug: (debug: WaterDebug) => void,
  debug: WaterDebug,
): Promise<Uint8Array> {
  setDebug(debug)
  await waitTilesLoaded(map)
  await nextFrame()
  return readMask(map)
}

async function measureWater(
  map: MapLibreMap,
  setDebug: (debug: WaterDebug) => void,
): Promise<WaterMeasure> {
  const bearing = map.getBearing()
  const footprint = await drawAndRead(map, setDebug, { mode: 'mask-nodepth', liftM: 0 })
  const lifted = await drawAndRead(map, setDebug, { mode: 'mask', liftM: LIFT_M })
  const visible: Uint8Array[] = []
  for (const delta of JITTER_DEG) {
    map.jumpTo({ bearing: bearing + delta })
    visible.push(await drawAndRead(map, setDebug, { mode: 'mask', liftM: 0 }))
  }
  map.jumpTo({ bearing })
  setDebug({ mode: 'off', liftM: 0 })
  const { gl } = map.painter.context
  return measureWaterMasks({
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    footprint,
    visible,
    lifted,
  })
}

/**
 * カメラの高さ − カメラの真下の地形の高さ（m）。MapLibre 6.6.0 の Map には transform の getter が無く
 * （計画の map.transform は型が通らない）、Map が持つ Camera（map._camera。dev.mjs 23231）の transform を使う。
 * map._camera は内部（型にはある。M6 の一覧に足す）。getCameraLngLat・getCameraAltitude は ITransform の型にある。
 * 基準を dev.mjs で確認: getCameraAltitude（dev.mjs 9564〜9565）は cos(pitch)·距離 / pixelPerMeter +
 * transform.elevation、queryTerrainElevation → getElevation（dev.mjs 10306〜10307）は DEM × exaggeration。
 * どちらも海面が基準で垂直強調を含むので、差はそろった値になる。地形が無ければ null（footprint の条件だけで評価する）
 */
function cameraClearanceM(map: MapLibreMap): number | null {
  const { transform } = map._camera
  const ground = map.queryTerrainElevation(transform.getCameraLngLat())
  return ground === null ? null : transform.getCameraAltitude() - ground
}

export async function runWaterProbe(
  session: TerrainSession,
  settings: SettingsStore,
  params: PerfParams,
  getSetDebug: () => ((debug: WaterDebug) => void) | null,
): Promise<WaterProbeReport> {
  const { store, simulation } = session
  await waitFor(
    () => store.getState().load.status === 'ready',
    (listener) => store.subscribe(listener),
  )
  store.getState().setViewMode('3d')
  await waitFor(
    () => store.getState().view3dStatus === '3d',
    (listener) => store.subscribe(listener),
  )
  const controller = session.view3d.mapController()
  const selected = store.getState().selected
  if (controller === null || selected === null) throw new Error('地図または地点がありません')
  const { map } = controller
  const container = map.getContainer()
  await waitForDataset(container, (dataset) => dataset.view3dFramed === 'true')
  // (c) で 2D に落ちていれば水面は作られず、waterReady を 120 秒待たされる。先にはっきりした理由で失敗させる
  // （perfSteps と同じ）
  const view3d = container.dataset.view3d ?? 'off'
  if (view3d !== '3d') {
    throw new Error(`3D で描いていません（data-view3d=${view3d}）。URL に fallback=0 を付ける`)
  }
  // Task 17a (ii) の後、水面はリンクの後に区画ごとに数フレームで出る。作った印（waterBuilds）では足りず、
  // すべての区画を描いた印（waterReady）まで待つ（画素を読む前に水面の全体が描かれている）
  await waitForDataset(container, (dataset) => Number(dataset.waterReady ?? '0') >= 1)
  const { amountMm, radiusM } = settings.getState().rainfall
  simulation.setSpeed('max')
  simulation.start(amountMm, radiusM)
  await sleep(params.wetMs)
  simulation.pause()
  // 止めた後の最後の frame（水面の転送）を流す
  await sleep(500)
  const rows: WaterProbeRow[] = []
  for (const zoom of params.zooms) {
    await placeViewOnLoadedTerrain(
      map,
      { center: [selected.lon, selected.lat], zoom, pitch: params.pitch, bearing: params.bearing },
      () => undefined,
      () => waitTilesLoaded(map),
    )
    await sleep(params.settleMs)
    const setDebug = getSetDebug()
    if (setDebug === null) throw new Error('水面がありません（onWaterDebug が呼ばれていない）')
    const clearance = cameraClearanceM(map)
    const measure = await measureWater(map, setDebug)
    const { verdict, reason } = judgeWater(measure, clearance)
    rows.push({
      requestedZoom: zoom,
      mapZoom: map.getZoom(),
      mapPitch: map.getPitch(),
      drawnTileZoom: container.dataset.drawnTileZoom ?? '',
      cameraClearanceM: clearance,
      measure,
      verdict,
      reason,
    })
  }
  return { params, stoppedAtStep: simulation.store.getState().stats?.step ?? null, rows }
}
