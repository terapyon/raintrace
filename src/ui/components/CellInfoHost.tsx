import { useStore } from 'zustand'
import type { TerrainSession } from '../terrainSession'
import { CellInfoPopover } from './CellInfoPopover'

/**
 * セル情報のポップオーバーをストアにつなぐ。値は開いた位置のセルを、統計の更新（10Hz）ごとに
 * SimulationClient の手元の水深から読み直す（配列を props・ストアに載せない。計画で決めたこと 14）
 */
export function CellInfoHost({ session }: { session: TerrainSession }) {
  const popover = useStore(session.store, (s) => s.popover)
  useStore(session.simulation.store, (s) => s.stats?.step)
  const cell = popover.kind === 'cell' ? session.cellInfo(popover.lon, popover.lat) : null
  return (
    <CellInfoPopover
      popover={popover}
      cell={cell}
      onConfirm={() => session.dispatchClick({ type: 'confirm' })}
      onClose={() => session.dispatchClick({ type: 'close' })}
    />
  )
}
