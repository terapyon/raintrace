/**
 * 計測用のフックの待ちと表示の道具（spec 05 §4.4、spec 06 §3）。pnpm build:perf のときだけビルドに入る
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

/** 地形の読み込み・3D の準備を待つ上限 */
export const WAIT_MS = 120_000
/** 視点を置いた後、タイルが揃うのを待つ上限 */
export const TILE_WAIT_MS = 60_000

export function waitFor(
  check: () => boolean,
  subscribe: (listener: () => void) => () => void,
  timeoutMs = WAIT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check()) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const off = subscribe(() => {
      if (!check()) return
      clearTimeout(timer)
      off()
      resolve()
    })
    timer = setTimeout(() => {
      off()
      reject(new Error('計測の準備が時間内に終わりませんでした'))
    }, timeoutMs)
  })
}

export const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** check が真になるまで intervalMs ごとに見る。timeoutMs を過ぎたら false */
export async function pollUntil(
  check: () => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<boolean> {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > timeoutMs) return false
    await sleep(intervalMs)
  }
  return true
}

/**
 * 要素の data-* が条件を満たすまで待つ（MutationObserver。時刻を測るので polling の粒度を入れない。
 * 計画で決めたこと 9）
 */
export function waitForDataset(
  element: HTMLElement,
  check: (dataset: DOMStringMap) => boolean,
  timeoutMs = WAIT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check(element.dataset)) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const observer = new MutationObserver(() => {
      if (!check(element.dataset)) return
      clearTimeout(timer)
      observer.disconnect()
      resolve()
    })
    observer.observe(element, { attributes: true })
    timer = setTimeout(() => {
      observer.disconnect()
      reject(new Error('計測の準備が時間内に終わりませんでした'))
    }, timeoutMs)
  })
}

/** 視点のタイル（地形・hillshade・背景）が揃うまで待つ。S は idle を待った（05 の計画で決めたこと 20） */
export async function waitTilesLoaded(
  map: MapLibreMap,
): Promise<{ loaded: boolean; waitMs: number }> {
  const start = performance.now()
  // jumpTo の後の描画でタイルの要求が始まるので、2 フレーム待ってから見る
  await nextFrame()
  await nextFrame()
  while (!map.areTilesLoaded()) {
    if (performance.now() - start > TILE_WAIT_MS) {
      return { loaded: false, waitMs: performance.now() - start }
    }
    await sleep(100)
  }
  return { loaded: true, waitMs: performance.now() - start }
}

export function show(value: unknown): void {
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
