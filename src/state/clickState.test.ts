import { describe, expect, it } from 'vitest'
import {
  CLOSED,
  type ClickEvent,
  type MarkerRef,
  type Popover,
  reduceClick,
  sortMarkers,
} from './clickState'

const P = { lon: 139.7, lat: 35.6, x: 100, y: 200 }
const Q = { lon: 139.8, lat: 35.7, x: 300, y: 50 }
const cell: Popover = { kind: 'cell', ...P }
const outside: Popover = { kind: 'outside', ...P }
const click = (target: 'no-range' | 'inside' | 'outside', at = Q): ClickEvent => ({
  type: 'map-click',
  target,
  ...at,
})

describe('reduceClick（spec 04 §4、R04-1）', () => {
  it.each<[string, Popover, ClickEvent, Popover, { lon: number; lat: number } | null]>([
    [
      '範囲が無いとき、クリックした位置を地点にする',
      CLOSED,
      click('no-range'),
      CLOSED,
      { lon: Q.lon, lat: Q.lat },
    ],
    [
      '範囲が無いとき、開いていても閉じて地点にする',
      cell,
      click('no-range'),
      CLOSED,
      { lon: Q.lon, lat: Q.lat },
    ],
    ['範囲の中のクリックでセル情報を開く', CLOSED, click('inside'), { kind: 'cell', ...Q }, null],
    [
      'セル情報を開いたまま別の場所をクリックすると、そこに開き直す',
      cell,
      click('inside'),
      { kind: 'cell', ...Q },
      null,
    ],
    [
      '範囲の外のクリックで「新しい地点」を開く',
      CLOSED,
      click('outside'),
      { kind: 'outside', ...Q },
      null,
    ],
    [
      '「ここを降雨中心にする」でその位置を地点にする',
      cell,
      { type: 'confirm' },
      CLOSED,
      { lon: P.lon, lat: P.lat },
    ],
    [
      '「ここを新しい地点にする」でその位置を地点にする',
      outside,
      { type: 'confirm' },
      CLOSED,
      { lon: P.lon, lat: P.lat },
    ],
    ['閉じているときの確定は何もしない', CLOSED, { type: 'confirm' }, CLOSED, null],
    ['閉じる（セル情報）', cell, { type: 'close' }, CLOSED, null],
    ['閉じる（新しい地点）', outside, { type: 'close' }, CLOSED, null],
    [
      'マーカーを離した位置を地点にする',
      cell,
      { type: 'marker-drag-end', lon: Q.lon, lat: Q.lat },
      CLOSED,
      { lon: Q.lon, lat: Q.lat },
    ],
    [
      '閉じているときもマーカーのドラッグで地点にする',
      CLOSED,
      { type: 'marker-drag-end', lon: Q.lon, lat: Q.lat },
      CLOSED,
      { lon: Q.lon, lat: Q.lat },
    ],
  ])('%s', (_, before, event, popover, select) => {
    expect(reduceClick(before, event)).toEqual({ popover, select })
  })
})

describe('reduceClick の印（spec 07 §3.2、推奨 R2、R07-4）', () => {
  const lowest: MarkerRef = { marker: 'lowest' }
  const spill = (depressionId: number): MarkerRef => ({ marker: 'spill', depressionId })
  const markerClick = (markers: MarkerRef[], at = Q): ClickEvent => ({
    type: 'marker-click',
    markers,
    ...at,
  })
  const marker: Popover = { kind: 'marker', markers: [lowest], ...P }

  it('marker-click で印の説明を開く。最低点を先、あふれ出し点は depressionId の昇順に並べ、重複を除く', () => {
    expect(reduceClick(CLOSED, markerClick([spill(3), lowest, spill(1), spill(3)]))).toEqual({
      popover: { kind: 'marker', markers: [lowest, spill(1), spill(3)], ...Q },
      select: null,
    })
  })

  it('セル情報を開いているときの marker-click も、印の説明に開き直す', () => {
    expect(reduceClick(cell, markerClick([spill(2)])).popover).toEqual({
      kind: 'marker',
      markers: [spill(2)],
      ...Q,
    })
  })

  it('印が 0 個の marker-click は閉じる', () => {
    expect(reduceClick(marker, markerClick([]))).toEqual({ popover: CLOSED, select: null })
  })

  it('印の説明を開いているときの confirm は何もしない（新しい地点を選ばない）', () => {
    expect(reduceClick(marker, { type: 'confirm' })).toEqual({ popover: marker, select: null })
  })

  it('close で閉じ、地図のクリックでセル情報に開き直す', () => {
    expect(reduceClick(marker, { type: 'close' })).toEqual({ popover: CLOSED, select: null })
    expect(reduceClick(marker, click('inside')).popover).toEqual({ kind: 'cell', ...Q })
  })

  it('sortMarkers は入力の配列を変えない', () => {
    const input = [spill(2), lowest]
    sortMarkers(input)
    expect(input).toEqual([spill(2), lowest])
  })
})
