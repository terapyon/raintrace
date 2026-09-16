/**
 * Terrarium の符号化と、MapLibre の地形の画素の読み方（角の規約）に合わせた標高の標本化(spec 05 §4.2)。
 * S の spike/src/candidates/terrarium.ts（sampleZ17Corner）を、任意のズームのサンプラーに一般化した
 */

export const TERRARIUM_OFFSET_M = 32768

/** 高さ（m）を Terrarium（(R × 256 + G + B / 256) − 32768）の RGBA に書く。刻みは 1/256 m で切り捨て */
export function encodeTerrarium(h: number, out: Uint8ClampedArray, offset: number): void {
  // NaN・無限は 0 m にする（そのままだと画素が 0 になり、−32768 m の穴になる）
  const safe = Number.isFinite(h) ? h : 0
  const v = Math.min(65535.99, Math.max(0, safe + TERRARIUM_OFFSET_M))
  const whole = Math.floor(v)
  out[offset] = Math.floor(whole / 256)
  out[offset + 1] = whole % 256
  out[offset + 2] = Math.floor((v - whole) * 256)
  out[offset + 3] = 255
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - TERRARIUM_OFFSET_M
}

/**
 * セルの値の読み出し。gx・gy はそのズームのグローバルピクセル（整数）で、セル gx の中心は連続座標 gx + 0.5。
 * 値の無いところ（範囲の外など）は null
 */
export type CellSampler = (gx: number, gy: number) => number | null

/**
 * 角の規約: 連続座標 (x, y) の高さを、セルの中心の値から双線形で求める。MapLibre の DEMData.sampleBilinear は
 * 画素 px の値を「タイルの角からの連続座標 px（頂点）の高さ」として読むので、タイルの画素には角の位置の高さを書く
 * （セルの中心の値を書くと地形が最大 1 画素ずれる。S の報告 §5）。4 セルのどれかが null なら null
 */
export function sampleCorner(sample: CellSampler, x: number, y: number): number | null {
  const cx = Math.floor(x - 0.5)
  const cy = Math.floor(y - 0.5)
  const tx = x - 0.5 - cx
  const ty = y - 0.5 - cy
  const z00 = sample(cx, cy)
  const z10 = sample(cx + 1, cy)
  const z01 = sample(cx, cy + 1)
  const z11 = sample(cx + 1, cy + 1)
  if (z00 === null || z10 === null || z01 === null || z11 === null) return null
  return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty
}

/**
 * 無効セルを、4 近傍の歩数で最も近い有効セルの値で埋めた複製を返す（spec 05 §4.2。0 m にすると地形に穴が開き、
 * 倍率の分だけ深くなる）。有効セルから幅優先で広げる。有効セルが 1 つも無ければ fallbackM で埋める
 */
export function fillInvalidNearest(
  elevation: Float32Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  fallbackM = 0,
): Float32Array {
  const count = width * height
  const out = new Float32Array(count)
  const done = new Uint8Array(count)
  const queue = new Int32Array(count)
  let tail = 0
  for (let i = 0; i < count; i++) {
    if (validMask[i] !== 1) continue
    out[i] = elevation[i] ?? 0
    done[i] = 1
    queue[tail++] = i
  }
  if (tail === 0) return out.fill(fallbackM)
  for (let head = 0; head < tail; head++) {
    const i = queue[head] ?? 0
    const value = out[i] ?? 0
    const col = i % width
    // 西・東・北・南の順に、まだ値の無い近傍へ広げる（1000 m の 100 万セルで配列を作らないよう、展開して書く）
    if (col > 0 && done[i - 1] === 0) {
      done[i - 1] = 1
      out[i - 1] = value
      queue[tail++] = i - 1
    }
    if (col < width - 1 && done[i + 1] === 0) {
      done[i + 1] = 1
      out[i + 1] = value
      queue[tail++] = i + 1
    }
    if (i >= width && done[i - width] === 0) {
      done[i - width] = 1
      out[i - width] = value
      queue[tail++] = i - width
    }
    if (i + width < count && done[i + width] === 0) {
      done[i + width] = 1
      out[i + width] = value
      queue[tail++] = i + width
    }
  }
  return out
}
