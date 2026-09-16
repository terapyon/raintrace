import { describe, expect, it } from 'vitest'
import { CLOSED, type ClickEvent, type Popover, reduceClick } from './clickState'

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
