/**
 * 2D の流出の帯の塗り分け（spec 07 §5.1・§5.2）。WaterOverlay が描画フレームごとに呼ぶ。帯のセル（band）だけを
 * 走査し、前回塗ったセルの一覧を持って、そこだけを消す。maplibre-gl を import しない純粋なモジュール
 */
import type { OutflowCells } from '../simulation/outflowCells'
import { hexToRgb, OUTFLOW_COLOR, OUTFLOW_VISIBLE_M } from './overlayColors'

const [R, G, B] = hexToRgb(OUTFLOW_COLOR)

/** 塗っているセルの一覧（先頭 count 個）と、次の描画で塗るセルを集める作業領域。どちらも帯のセル数の大きさ */
export interface OutflowPainted {
  cells: Int32Array
  next: Int32Array
  count: number
}

export function createOutflowPainted(band: Int32Array): OutflowPainted {
  return { cells: new Int32Array(band.length), next: new Int32Array(band.length), count: 0 }
}

/** 塗っているセルを全部透明にする（setWater(null)。推奨 R4）。消したものがあれば true */
export function clearOutflow(rgba: Uint8ClampedArray, painted: OutflowPainted): boolean {
  if (painted.count === 0) return false
  for (let k = 0; k < painted.count; k++) rgba[(painted.cells[k] ?? 0) * 4 + 3] = 0
  painted.count = 0
  return true
}

/**
 * 帯のセルのうち、nearest の指すセルの水深が OUTFLOW_VISIBLE_M（1 mm。R07-1）以上のものを OUTFLOW_COLOR で塗る
 * （不透明。重ねの不透明度はレイヤーの raster-opacity）。塗るセルが前回と同じなら rgba に触れず false
 * （呼び出し側は転送しない。計画で決めたこと 7）。変われば前回の分を消して塗り、true
 */
export function paintOutflow(
  water: ArrayLike<number>,
  outflow: Pick<OutflowCells, 'band' | 'nearest'>,
  rgba: Uint8ClampedArray,
  painted: OutflowPainted,
): boolean {
  const { band, nearest } = outflow
  const next = painted.next
  let count = 0
  for (let k = 0; k < band.length; k++) {
    const i = band[k] ?? 0
    // NaN は比較が偽になり、塗らない
    if ((water[nearest[i] ?? -1] ?? 0) >= OUTFLOW_VISIBLE_M) next[count++] = i
  }
  if (count === painted.count) {
    let same = true
    for (let k = 0; k < count && same; k++) same = next[k] === painted.cells[k]
    if (same) return false
  }
  clearOutflow(rgba, painted)
  for (let k = 0; k < count; k++) {
    const o = (next[k] ?? 0) * 4
    rgba[o] = R
    rgba[o + 1] = G
    rgba[o + 2] = B
    rgba[o + 3] = 255
  }
  painted.next = painted.cells
  painted.cells = next
  painted.count = count
  return true
}
