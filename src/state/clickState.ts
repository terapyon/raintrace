/**
 * 地図のクリックの意味（spec 04 §4、R04-1）。モードの切り替えなしで、地点の選択とセル情報を両立する。
 * 「地点を選択済み」は範囲を表示している（読み込みが ready）の意味（計画で決めたこと 13）
 */

/** 置く位置。lon・lat は地図の位置、x・y はビューポートの座標（px。地図のクリックの位置） */
interface Anchor {
  lon: number
  lat: number
  x: number
  y: number
}

/** 地図の ○（spec 07 §3.2）。あふれ出し点は窪地の id で引く */
export type MarkerRef = { marker: 'lowest' } | { marker: 'spill'; depressionId: number }

/** 開いているポップオーバー */
export type Popover =
  | { kind: 'closed' }
  | ({ kind: 'cell' | 'outside' } & Anchor)
  /** 印の説明（spec 07 §3）。markers は 1 個以上で、sortMarkers の順 */
  | ({ kind: 'marker'; markers: readonly MarkerRef[] } & Anchor)

/** クリックした場所。no-range は範囲を表示していない（未選択・読み込み中・失敗の後） */
export type ClickTarget = 'no-range' | 'inside' | 'outside'

export type ClickEvent =
  | { type: 'map-click'; target: ClickTarget; lon: number; lat: number; x: number; y: number }
  /** 「ここを降雨中心にする」「ここを新しい地点にする」 */
  | { type: 'confirm' }
  | { type: 'close' }
  | { type: 'marker-drag-end'; lon: number; lat: number }
  /** 地図の ○ のクリック（spec 07 §3.1）。当たった印をすべて渡す */
  | ({ type: 'marker-click'; markers: readonly MarkerRef[] } & Anchor)

export interface ClickTransition {
  popover: Popover
  /** 新しい地点にする位置（範囲を読み込み直し、リセットする。R04-2）。しなければ null */
  select: { lon: number; lat: number } | null
}

export const CLOSED: Popover = { kind: 'closed' }

/** 並びのキー。最低点が 0、あふれ出し点は窪地の id（1 から） */
const markerKey = (m: MarkerRef): number => (m.marker === 'lowest' ? 0 : m.depressionId)

/**
 * 最低点を先、あふれ出し点は depressionId の昇順に並べ、同じ印を 1 つにする（R07-4。queryRenderedFeatures は
 * タイルの境目で同じ地物を 2 回返しうる）。入力は変えない
 */
export function sortMarkers(markers: readonly MarkerRef[]): MarkerRef[] {
  const seen = new Set<number>()
  return [...markers]
    .sort((a, b) => markerKey(a) - markerKey(b))
    .filter((m) => {
      const key = markerKey(m)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export function reduceClick(popover: Popover, event: ClickEvent): ClickTransition {
  switch (event.type) {
    case 'map-click': {
      const { target, lon, lat, x, y } = event
      if (target === 'no-range') return { popover: CLOSED, select: { lon, lat } }
      return {
        popover: { kind: target === 'inside' ? 'cell' : 'outside', lon, lat, x, y },
        select: null,
      }
    }
    case 'marker-click': {
      const markers = sortMarkers(event.markers)
      if (markers.length === 0) return { popover: CLOSED, select: null }
      const { lon, lat, x, y } = event
      return { popover: { kind: 'marker', markers, lon, lat, x, y }, select: null }
    }
    case 'confirm':
      // 印の説明には「ここを降雨中心にする」が無い。Anchor を持つので、ここで弾かないと型は通ったまま
      // 新しい地点が選ばれてしまう（推奨 R2）
      if (popover.kind === 'closed' || popover.kind === 'marker') return { popover, select: null }
      return { popover: CLOSED, select: { lon: popover.lon, lat: popover.lat } }
    case 'close':
      return { popover: CLOSED, select: null }
    case 'marker-drag-end':
      return { popover: CLOSED, select: { lon: event.lon, lat: event.lat } }
  }
}
