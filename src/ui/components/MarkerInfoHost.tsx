import { useStore } from 'zustand'
import type { TerrainSession } from '../terrainSession'
import { MarkerInfoPopover } from './MarkerInfoPopover'

/** 印の説明のポップオーバーをストアにつなぐ。数値は開いたときの地形から読む（配列を props に載せない） */
export function MarkerInfoHost({ session }: { session: TerrainSession }) {
  const popover = useStore(session.store, (s) => s.popover)
  const rows = popover.kind === 'marker' ? session.markerInfo(popover.markers) : []
  return (
    <MarkerInfoPopover
      popover={popover}
      rows={rows}
      onClose={() => session.dispatchClick({ type: 'close' })}
    />
  )
}
