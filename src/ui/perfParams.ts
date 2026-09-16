import { PITCH_3D_DEG } from '../map/view3d/drawnZoom'
import { DEFAULT_VIEW3D_OPTIONS, type HillshadeOption } from '../map/view3d/options'
import { VERTICAL_EXAGGERATIONS } from '../state/persistedSettings'

export type PerfProbe = 'fps' | 'view'

/** 計測用のフックの URL の項目（計画で決めたこと 20）。地点と範囲は 04 の lat・lon・size を使う */
export interface PerfParams {
  probe: PerfProbe
  /** 3d: 3D に切り替えて置く。2d: 2D のまま同じ視点に置く（境界 16 の撮影の比較用。Task 13） */
  mode: '2d' | '3d'
  zoom: number
  pitch: number
  bearing: number
  exaggeration: (typeof VERTICAL_EXAGGERATIONS)[number]
  /** 水面あり（降雨を「最速」で回し、水深を毎フレーム更新する）か、地形のみか */
  water: boolean
  hillshade: HillshadeOption
  durationMs: number
  /** false は (c) の 2D への切り替えを止める（S の視点を 3D のまま測る） */
  fallback: boolean
  /** タイルが揃ってから撮る・測るまで待つ時間（ms） */
  settleMs: number
}

const HILLSHADE_OPTIONS: readonly HillshadeOption[] = ['auto', 'on', 'off']

export function parsePerfParams(search: string): PerfParams | null {
  const params = new URLSearchParams(search)
  const probe = params.get('probe')
  if (probe !== 'fps' && probe !== 'view') return null
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
  }
}
