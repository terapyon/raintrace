/**
 * 計測用のフック（spec 05 §4.4、R05-6、計画で決めたこと 20）。pnpm build:perf のときだけビルドに入る。
 * URL（例: ?lat=35.658&lon=139.7016&size=500&probe=fps&z=16&ex=10&pitch=85&water=0&hillshade=on&tiles=main）を読み、
 * 地形の読み込みの後に 3D の視点を置き、タイルが揃うのを待ち、水面ありなら「最速」で降雨を回して計測する。
 * 結果の JSON は <html data-fps-result> と画面の左上に出す（利用者の画面ではないので strings.ts を使わない）
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import { runFpsProbe } from '../map/fpsProbe'
import type { TileTimeSample } from '../map/view3d/options'
import type { SettingsStore } from '../state/settingsStore'
import { parsePerfParams } from './perfParams'
import type { TerrainSession } from './terrainSession'

/** タイルが揃ってから、frame と描画が落ち着くまで待つ時間 */
const SETTLE_MS = 3000
/** 地形の読み込み・3D の準備を待つ上限 */
const WAIT_MS = 120_000
/** 視点を置いた後、タイルが揃うのを待つ上限 */
const TILE_WAIT_MS = 60_000

function waitFor(
  check: () => boolean,
  subscribe: (listener: () => void) => () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check()) {
      resolve()
      return
    }
    const off = subscribe(() => {
      if (!check()) return
      clearTimeout(timer)
      off()
      resolve()
    })
    const timer = setTimeout(() => {
      off()
      reject(new Error('計測の準備が時間内に終わりませんでした'))
    }, WAIT_MS)
  })
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

/** 視点のタイル（地形・hillshade・背景）が揃うまで待つ。S は idle を待った（計画で決めたこと 20） */
async function waitTilesLoaded(map: MapLibreMap): Promise<{ loaded: boolean; waitMs: number }> {
  const start = performance.now()
  // jumpTo の後の描画でタイルの要求が始まるので、2 フレーム待ってから見る
  await nextFrame()
  await nextFrame()
  while (!map.areTilesLoaded()) {
    if (performance.now() - start > TILE_WAIT_MS) {
      return { loaded: false, waitMs: performance.now() - start }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return { loaded: true, waitMs: performance.now() - start }
}

function show(value: unknown): void {
  const pre = document.createElement('pre')
  pre.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:10000;max-height:90vh;overflow:auto;' +
    'background:#fff;color:#000;font-size:11px;padding:8px;margin:0'
  pre.textContent = JSON.stringify(value, null, 2)
  document.body.append(pre)
}

/** 視点を置くのに使う、地図の最小の面（テストでは偽物に差し替える） */
export interface ProbeView {
  center: [number, number]
  zoom: number
  pitch: number
  bearing: number
}

export interface ProbeMap {
  jumpTo(view: ProbeView): void
}

/**
 * 視点を置き、タイルが揃うのを待ってから、同じ視点をもう一度置く。
 *
 * 2 回置くのは、MapLibre の `_elevateCameraIfInsideTerrain` が
 * `terrain.getElevationForLngLatZoom(カメラの位置, ズーム)` で「そのとき読める」DEM からカメラの持ち上がりを
 * 決めるため。1 回目の jumpTo の時点ではタイルがまだ読めておらず、しかも要求するタイルの組は hillshade の
 * 有無で違うので、条件ごとに違う LOD の標高で持ち上がりが決まり、同じ視点を要求しても落ち着く先がずれる
 * （Task 5 の実測では、同じ「z16 ×10 p85」が 78.60° と 82.96° に分かれた）。タイルが揃ってから置き直せば、
 * 読める地形の上で計算されるので、条件どうしが同じ視点に収束する
 */
export async function placeViewOnLoadedTerrain<T>(
  map: ProbeMap,
  view: ProbeView,
  afterFirstJump: () => void,
  waitTiles: () => Promise<T>,
): Promise<T> {
  map.jumpTo(view)
  afterFirstJump()
  const tiles = await waitTiles()
  map.jumpTo(view)
  return tiles
}

export async function installPerfHook(
  session: TerrainSession,
  settings: SettingsStore,
): Promise<void> {
  const params = parsePerfParams(window.location.search)
  if (params === null) return
  const root = document.documentElement
  const renderTimes: number[] = []
  const tileTimes: TileTimeSample[] = []
  const prepareMs: number[] = []
  const waterBuildMs: number[] = []
  session.view3d.setOptions({
    tileGeneration: params.tiles,
    hillshade: params.hillshade,
    water: params.water,
    onRenderTime: (ms) => renderTimes.push(ms),
    onTileTime: (sample) => tileTimes.push(sample),
    onPrepareTime: (ms) => prepareMs.push(ms),
    onWaterBuildTime: (ms) => waterBuildMs.push(ms),
  })
  settings.getState().setDisplay({ verticalExaggeration: params.exaggeration })
  const { store } = session
  try {
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
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS))
    if (params.probe === 'view') {
      root.dataset.perfReady = 'true'
      return
    }
    const result = await runFpsProbe(map, params.durationMs, { renderTimes, tileTimes })
    // 測った視点。mode=3d の fps で 3D で描いていなければ（(c) で 2D に落ちた。URL に fallback=0 が無い）、
    // 2D の fps を 3D として記録しないよう失敗にする
    const achievedAfterRun = { mapZoom: map.getZoom(), mapPitch: map.getPitch() }
    const view3d = dataset.view3d ?? 'off'
    if (params.mode === '3d' && view3d !== '3d') {
      throw new Error(`3D で描いていません（data-view3d=${view3d}）。URL に fallback=0 を付ける`)
    }
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
    }
    root.dataset.fpsResult = JSON.stringify(report)
    show(report)
  } catch (error) {
    root.dataset.perfError = String(error)
    show({ error: String(error) })
  }
}
