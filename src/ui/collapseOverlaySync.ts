import type { CollapseOverlay } from '../map/CollapseOverlay'
import { MAX_SHOWN_DAMS } from '../shared/damDisplay'
import type { CollapsePayload } from '../shared/protocol'
import type { CollapseState } from '../state/appStore'

/**
 * 崩れた後の重ね描きを今の状態に合わせる。崩れた後の地形を見せている（view が after）結果ができた状態の間だけ描く
 */
export function syncCollapseOverlay(
  overlay: Pick<CollapseOverlay, 'show' | 'clear'>,
  collapse: Pick<CollapseState, 'view' | 'status'>,
  data: { result: CollapsePayload | null },
): void {
  const { result } = data
  if (collapse.view !== 'after' || collapse.status !== 'ready' || result === null) {
    overlay.clear()
    return
  }
  const geo = result.after.geo
  overlay.show(result, geo, MAX_SHOWN_DAMS)
}
