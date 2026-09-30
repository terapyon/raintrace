import type { Page } from '@playwright/test'
import { hexToRgb, MARKER_COLORS } from '../../../src/map/overlayColors'
import { type Blob, colorBlobs, decodePng } from './png'

/** ○ の色の許容（各成分）。explanations.spec.ts の MARKER_TOLERANCE と同じ */
const MARKER_TOLERANCE = 12
/** ○ とみなす塊の最小の画素数 */
const MARKER_MIN_PX = 10
/**
 * ○ の中心からこれだけ離れていればクリックが ○ に当たらない（px）。当たりは中心から最大
 * MARKER_HIT_PX（4）+ 半径 6 + 縁 2 = 12 px なので、その 2 倍の余裕
 */
export const MARKER_CLEAR_PX = 24

/** 画面の地図に描かれた ○（最低点・あふれ出し点）の中心（ページの座標） */
export async function findAllMarkers(page: Page): Promise<Blob[]> {
  const img = decodePng(await page.screenshot())
  return [MARKER_COLORS.lowest, MARKER_COLORS.spill].flatMap((hex) =>
    colorBlobs(img, hexToRgb(hex), MARKER_TOLERANCE).filter((b) => b.count >= MARKER_MIN_PX),
  )
}

/** 点 p がどの ○ からも MARKER_CLEAR_PX 以上離れているか */
export function clearOfMarkers(p: { x: number; y: number }, markers: readonly Blob[]): boolean {
  return markers.every((m) => Math.hypot(m.x - p.x, m.y - p.y) >= MARKER_CLEAR_PX)
}
