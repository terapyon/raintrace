import type { CollapseOverlay } from '../map/CollapseOverlay'
import { MAX_SHOWN_DAMS } from '../shared/damDisplay'
import type { CollapsePayload } from '../shared/protocol'
import type { CollapseState } from '../state/appStore'

/**
 * 崩れたと仮定した結果の重ね描きを今の状態に合わせる。結果ができた状態（ready）の間、
 * 崩れる前・崩れた後のどちらを見せていても描く（見え方は CollapseOverlay.show が view で決める。spec 10b §4.1）
 */
export function syncCollapseOverlay(
  overlay: Pick<CollapseOverlay, 'show' | 'clear'>,
  collapse: Pick<CollapseState, 'view' | 'status'>,
  result: CollapsePayload | null,
): void {
  if (collapse.status !== 'ready' || result === null) {
    overlay.clear()
    return
  }
  overlay.show(result, result.after.geo, { markerCount: MAX_SHOWN_DAMS, view: collapse.view })
}
