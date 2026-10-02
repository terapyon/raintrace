/**
 * 地図の印（○）と流出の帯の色（spec 07 §3.6・§5.2）。地図のレイヤー（TerrainOverlay・WaterOverlay）、3D の水面へ
 * 渡す値（View3d）、凡例（ui）、E2E がここから読む（色を二重に持たない）。maplibre-gl を import しない純粋なモジュール
 */

/** ○ の色。最低点は青、あふれ出し点はオレンジ */
export const MARKER_COLORS = { lowest: '#1565c0', spill: '#ef6c00' } as const

/** 流出しているセルの帯の色（赤紫。水の青・窪地の配色・計測のマゼンタ〈probe=water〉と分ける） */
export const OUTFLOW_COLOR = '#c2185b'
export const OUTFLOW_OPACITY = 0.9
/** 流出中として塗る水深の閾値（m。R07-1）。θ（1e-5 m）より大きく、描画の閾値（1 cm）より小さい */
export const OUTFLOW_VISIBLE_M = 0.001

/** '#rrggbb' を [r, g, b]（0〜255）にする */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}
