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

/** 盛土の履歴の標高差（spec 09 §4.2）。+5 m で薄く、+20 m 以上で濃い（線形）。盛土（増えた）は赤系、切土（減った）は青系 */
export const FILL_RISE_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [254, 205, 190],
  [183, 28, 28],
]
export const FILL_CUT_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [187, 222, 251],
  [13, 71, 161],
]
/** 標高差の色が最も濃くなる差（m）。下限は dem/fillHistory/constants の FILL_THRESHOLD_M */
export const FILL_DELTA_FULL_M = 20
/** 標高差の塗りの不透明度（0〜255） */
export const FILL_DELTA_ALPHA = 170
/** 候補の縁の色。選んだ候補は黄 */
export const FILL_EDGE_COLOR = '#455a64'
export const FILL_EDGE_SELECTED_COLOR = '#ffd600'

/** 人工地形（地理院の地形分類）の色。盛土地・埋立地、切土地、改変工事中 */
export const LANDFORM_COLORS = {
  fill: '#8d6e63',
  cut: '#00897b',
  construction: '#6a1b9a',
} as const
/** 大規模盛土造成地（A54）の線と塗り */
export const A54_COLOR = '#ff6f00'
/** 候補の印の色。選んだ候補は黄 */
export const FILL_MARKER_COLOR = '#37474f'

/** 崩れた土が積もった厚さ（spec 10 §5.4）。0.01 m 以上で茶、5 m で最も濃い（線形） */
export const COLLAPSE_DEPOSIT_STOPS: ReadonlyArray<readonly [number, number, number]> = [
  [215, 190, 160],
  [93, 52, 20],
]
export const COLLAPSE_DEPOSIT_MIN_M = 0.01
export const COLLAPSE_DEPOSIT_FULL_M = 5
export const COLLAPSE_DEPOSIT_ALPHA = 200
/** 崩れた跡（市松の薄い灰） */
export const COLLAPSE_SCAR_COLOR = '#9e9e9e'
export const COLLAPSE_SCAR_ALPHA = 150
/** せき止められた窪地の輪郭と、あふれ出し点 */
export const COLLAPSE_DAM_COLOR = '#e65100'
/** 崩れたせいで新しく溜まった水（濃い青紫） */
export const COLLAPSE_NEW_WATER_COLOR = '#4527a0'
export const COLLAPSE_NEW_WATER_ALPHA = 220
