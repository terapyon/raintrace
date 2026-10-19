import type { CollapseOverlay } from '../map/CollapseOverlay'
import type { CollapsePayload, CompareSide } from '../shared/protocol'
import type { CollapseState } from '../state/appStore'

/**
 * 崩れた後の重ね描きを今の状態に合わせる。崩れた後の地形を見せている（view が after）結果ができた状態の間だけ描き、
 * 新しく溜まった水は比べ終わったときだけ描く（比べ直し・取り消しで done を外れたら消す）
 */
export function syncCollapseOverlay(
  overlay: Pick<CollapseOverlay, 'show' | 'showCompare' | 'clear' | 'clearCompare'>,
  collapse: Pick<CollapseState, 'view' | 'status'> & {
    compare: Pick<CollapseState['compare'], 'status'>
  },
  data: {
    result: CollapsePayload | null
    compared: { before: CompareSide; after: CompareSide } | null
  },
): void {
  const { result, compared } = data
  if (collapse.view !== 'after' || collapse.status !== 'ready' || result === null) {
    overlay.clear()
    return
  }
  const geo = result.after.geo
  overlay.show(result, geo)
  if (collapse.compare.status === 'done' && compared !== null) {
    overlay.showCompare(compared.before.depth, compared.after.depth, geo)
  } else {
    overlay.clearCompare()
  }
}
