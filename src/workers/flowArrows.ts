import { ARROW_MIN_VELOCITY_M_PER_S } from '../simulation/constants'

/**
 * 水の流れの矢印（spec 04 §5.1、base-spec §32、spec 08 §3.10）。flowVectors()（m/s）を spacingM ごとに
 * 間引き、流速が ARROW_MIN_VELOCITY_M_PER_S 以上のセルだけを [列, 行, 方位（度）, 大きさ（m/s）] の並びに
 * する（局所慣性式では、ほとんど止まった水にも微小な流速が残るため）。
 * 間引きの位置は 02 の地形の流向（map/terrainFeatures.ts の flowFeatures）と同じ（間隔の半分から始める）
 */
export function thinFlowArrows(
  vx: Float32Array,
  vy: Float32Array,
  width: number,
  height: number,
  cellSizeM: number,
  spacingM: number,
): Float32Array<ArrayBuffer> {
  const step = Math.max(1, Math.round(spacingM / cellSizeM))
  const offset = Math.floor(step / 2)
  const out: number[] = []
  for (let row = offset; row < height; row += step) {
    for (let col = offset; col < width; col += step) {
      const i = row * width + col
      const x = vx[i] ?? 0
      const y = vy[i] ?? 0
      const magnitude = Math.hypot(x, y)
      if (!(magnitude >= ARROW_MIN_VELOCITY_M_PER_S)) continue
      // エンジンの流速は y が南向きが正。北を 0° とする時計回りの方位は atan2(x, −y)
      const bearing = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360
      out.push(col, row, bearing, magnitude)
    }
  }
  return Float32Array.from(out)
}
