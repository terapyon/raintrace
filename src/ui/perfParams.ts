import { PITCH_3D_DEG } from '../map/view3d/drawnZoom'
import { DEFAULT_VIEW3D_OPTIONS, type HillshadeOption } from '../map/view3d/options'
import { ARROW_SPACINGS, VERTICAL_EXAGGERATIONS } from '../state/persistedSettings'

/** fps・view（spec 05 §4.4）、steps・load（spec 06 §3・§4.2） */
export type PerfProbe = 'fps' | 'view' | 'steps' | 'load'

const PROBES: readonly PerfProbe[] = ['fps', 'view', 'steps', 'load']
const DEPTH_EVERY = [1, 2, 4, 8] as const
/** Web Mercator（MapLibre）が扱える緯度の範囲（urlState.ts と同じ） */
const MERCATOR_LAT_LIMIT = 85.051129

/** 計測用のフックの URL の項目（05 の計画で決めたこと 20、spec 06 §3）。地点と範囲・雨は 04 の lat・lon・size・mm・r を使う */
export interface PerfParams {
  probe: PerfProbe
  /** 3d: 3D に切り替えて置く。2d: 2D のまま同じ視点に置く（境界 16 の撮影の比較用。05 の Task 13） */
  mode: '2d' | '3d'
  zoom: number
  pitch: number
  bearing: number
  exaggeration: (typeof VERTICAL_EXAGGERATIONS)[number]
  /** 水面あり（降雨を「最速」で回し、水深を毎フレーム更新する）か、地形のみか */
  water: boolean
  hillshade: HillshadeOption
  /** fps の計測の窓。probe=steps の until=window の窓 */
  durationMs: number
  /** false は (c) の 2D への切り替えを止める（S の視点を 3D のまま測る） */
  fallback: boolean
  /** タイルが揃ってから撮る・測るまで待つ時間（ms） */
  settleMs: number
  /** false は水の流れの矢印を止める（arrows=0。spec 06 §5.1、計画で決めたこと 8） */
  arrows: boolean
  /**
   * 水深のテクスチャを N 回の更新に 1 回だけ転送する（depthEvery=N。spec 06 §5.1、計画で決めたこと 6）。
   * null は指定なし（View3d の既定に任せる。Task 22 で 1000 m の既定が変わりうる）
   */
  depthEvery: (typeof DEPTH_EVERY)[number] | null
  /**
   * 矢印の間隔の設定（arrowsM=5・10・20。表示の設定の flowVectorSpacingM を置き換える。1000 m の実効の間隔はその 2 倍）。
   * 矢印の本数と fps の関係を測る（spec 06 §5.1、M3）。null は指定なし・不正な値（設定を触らない）
   */
  arrowsM: (typeof ARROW_SPACINGS)[number] | null
  /** true は fps の窓の直前に再生を一時停止し、止めた水面を測る（pause=1。spec 06 §5.1、計画で決めたこと 7） */
  pauseBeforeRun: boolean
  /** probe=steps: settle は平衡か cap まで、window は durationMs だけ回す（計画で決めたこと 4） */
  until: 'settle' | 'window'
  /** probe=steps の平衡を待つ上限（ms。cap=） */
  capMs: number
  /** probe=load: 地図の読み込みの後に選ぶ地点（at=緯度,経度。計画で決めたこと 9） */
  at: { lat: number; lon: number } | null
}

const HILLSHADE_OPTIONS: readonly HillshadeOption[] = ['auto', 'on', 'off']

/** at=緯度,経度。形が違う・範囲の外なら null */
export function parseAt(raw: string | null): { lat: number; lon: number } | null {
  if (raw === null) return null
  const parts = raw.split(',')
  if (parts.length !== 2) return null
  const [lat, lon] = parts.map((part) => (part.trim() === '' ? Number.NaN : Number(part)))
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }
  if (Math.abs(lat) > MERCATOR_LAT_LIMIT || Math.abs(lon) > 180) return null
  return { lat, lon }
}

export function parsePerfParams(search: string): PerfParams | null {
  const params = new URLSearchParams(search)
  const rawProbe = params.get('probe')
  const probe = PROBES.find((p) => p === rawProbe)
  if (probe === undefined) return null
  const number = (key: string, fallback: number, min: number, max: number): number => {
    const raw = params.get(key)
    const value = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback
  }
  const oneOf = <T extends string | number>(list: readonly T[], value: unknown, fallback: T): T =>
    list.includes(value as T) ? (value as T) : fallback
  return {
    probe,
    mode: params.get('mode') === '2d' ? '2d' : '3d',
    zoom: number('z', 16, 0, 18),
    // 既定は 3D の視点の pitch（View3d.frame と同じ値。横断レビュー m5）
    pitch: number('pitch', PITCH_3D_DEG, 0, 85),
    bearing: number('bearing', 0, -180, 180),
    exaggeration: oneOf(VERTICAL_EXAGGERATIONS, Number(params.get('ex')), 1),
    water: params.get('water') !== '0',
    // 省いたときは 3D の既定に従う。Task 9 の組は既定のまま測る
    hillshade: oneOf(HILLSHADE_OPTIONS, params.get('hillshade'), DEFAULT_VIEW3D_OPTIONS.hillshade),
    durationMs: number('ms', 10_000, 1000, 60_000),
    fallback: params.get('fallback') !== '0',
    settleMs: number('settle', 3000, 0, 120_000),
    arrows: params.get('arrows') !== '0',
    depthEvery:
      params.get('depthEvery') === null
        ? null
        : oneOf(DEPTH_EVERY, Number(params.get('depthEvery')), 1),
    arrowsM: ARROW_SPACINGS.find((m) => String(m) === params.get('arrowsM')) ?? null,
    pauseBeforeRun: params.get('pause') === '1',
    until: params.get('until') === 'window' ? 'window' : 'settle',
    capMs: number('cap', 300_000, 1000, 1_800_000),
    at: parseAt(params.get('at')),
  }
}
