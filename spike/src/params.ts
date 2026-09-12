import { FILM_DEPTH_M } from './scenes'
import type { CandidateId, SceneName, WaterMode, ZFix } from './types'

export interface SpikeParams {
  candidate: CandidateId | null
  scene: SceneName
  water: WaterMode
  exaggeration: number
  pitch: number
  zoom: number
  zfix: ZFix
  capture: boolean // preserveDrawingBuffer を有効にし、画面を読み取れるようにする（計画 D9）
  skirt: boolean // B・B-raw の縁（計画 D17）
  probe: 'fps' | null
  demFill: 'zero' | 'nearest' // 実データの A の地形の無効画素（M2 の切り分け用）
  filmDepth: number // bowlFilm の膜の水深（m、既定 0.01）。Task 5b: 20cm の持ち上げた基準膜との比較に使う
}

function pick<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

function numberIn(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

/** URL の引数を読む（計画 D3）。知らない値と範囲の外の数値は既定値にする */
export function parseParams(search: string): SpikeParams {
  const query = new URLSearchParams(search)
  const candidates: readonly CandidateId[] = ['a', 'a2', 'b', 'braw']
  return {
    candidate: candidates.find((id) => id === query.get('candidate')) ?? null,
    scene: pick(query.get('scene'), ['synthetic', 'real'], 'synthetic'),
    water: pick(query.get('water'), ['fixed', 'film', 'bowlFilm', 'dynamic'], 'fixed'),
    exaggeration: numberIn(query.get('exaggeration'), 0.1, 20, 1),
    pitch: numberIn(query.get('pitch'), 0, 85, 60),
    zoom: numberIn(query.get('zoom'), 2, 18, 17),
    zfix: pick(query.get('zfix'), ['none', 'offset', 'offset2'], 'offset'),
    capture: query.get('capture') === '1',
    skirt: query.get('skirt') !== '0',
    probe: query.get('probe') === 'fps' ? 'fps' : null,
    demFill: query.get('demFill') === 'nearest' ? 'nearest' : 'zero',
    // すり鉢の深さ(3m)より十分浅い範囲に限る（下限は既定の1cm。MIN_DEPTH_M（0.0099）と揃えると
    // Float32 の丸めで膜が消える境目と一致してしまうため、下限は 0.01 にする。タスクレビュー M-3）
    filmDepth: numberIn(query.get('filmDepth'), 0.01, 1, FILM_DEPTH_M),
  }
}
