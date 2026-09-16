/**
 * 地図のクリックの意味（spec 04 §4、R04-1）。モードの切り替えなしで、地点の選択とセル情報を両立する。
 * 「地点を選択済み」は範囲を表示している（読み込みが ready）の意味（計画で決めたこと 13）
 */

/** 開いているポップオーバー。x・y は置く位置（ビューポートの座標、px。地図のクリックの位置） */
export type Popover =
  | { kind: 'closed' }
  | { kind: 'cell' | 'outside'; lon: number; lat: number; x: number; y: number }

/** クリックした場所。no-range は範囲を表示していない（未選択・読み込み中・失敗の後） */
export type ClickTarget = 'no-range' | 'inside' | 'outside'

export type ClickEvent =
  | { type: 'map-click'; target: ClickTarget; lon: number; lat: number; x: number; y: number }
  /** 「ここを降雨中心にする」「ここを新しい地点にする」 */
  | { type: 'confirm' }
  | { type: 'close' }
  | { type: 'marker-drag-end'; lon: number; lat: number }

export interface ClickTransition {
  popover: Popover
  /** 新しい地点にする位置（範囲を読み込み直し、リセットする。R04-2）。しなければ null */
  select: { lon: number; lat: number } | null
}

export const CLOSED: Popover = { kind: 'closed' }

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
    case 'confirm':
      if (popover.kind === 'closed') return { popover, select: null }
      return { popover: CLOSED, select: { lon: popover.lon, lat: popover.lat } }
    case 'close':
      return { popover: CLOSED, select: null }
    case 'marker-drag-end':
      return { popover: CLOSED, select: { lon: event.lon, lat: event.lat } }
  }
}
