import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import type { Popover as PopoverState } from '../../state/clickState'
import type { CellInfo } from '../cellInfo'
import { formatMeters } from '../format'
import { strings } from '../strings'

interface Props {
  popover: PopoverState
  /** popover が cell のときのセルの値 */
  cell: CellInfo | null
  onConfirm: () => void
  onClose: () => void
}

function Value({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" data-testid={testId}>
        {formatMeters(value)}
      </Typography>
    </Box>
  )
}

/**
 * 地図のクリックの結果（spec 04 §4）。範囲の中はセル情報、範囲の外は「新しい地点」。
 * 背景を持たない: 開いている間の地図のクリックもそのまま地図に届き、TerrainSession の reduceClick が
 * 開き直す・閉じる。外の枠（root）はクリックを通し、紙（paper）だけが受ける。焦点を閉じ込めず、
 * スクロールも止めない。Escape は Modal が onClose に渡す（焦点がポップオーバーの中にあるとき）
 */
export function CellInfoPopover({ popover, cell, onConfirm, onClose }: Props) {
  const open = popover.kind !== 'closed'
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={open ? { top: popover.y, left: popover.x } : { top: 0, left: 0 }}
      hideBackdrop
      disableScrollLock
      disableEnforceFocus
      slotProps={{
        root: { sx: { pointerEvents: 'none' } },
        paper: { sx: { pointerEvents: 'auto' } },
      }}
    >
      <Box data-testid="cell-info" sx={{ p: 1.5, minWidth: 200 }}>
        {popover.kind === 'cell' &&
          (cell?.kind === 'value' ? (
            <>
              <Value
                label={strings.cellInfo.elevation}
                value={cell.elevationM}
                testId="cell-elevation"
              />
              <Value label={strings.cellInfo.depth} value={cell.depthM} testId="cell-depth" />
              <Value label={strings.cellInfo.level} value={cell.levelM} testId="cell-level" />
            </>
          ) : (
            <Typography variant="body2">{strings.cellInfo.noData}</Typography>
          ))}
        {open && (
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <Button size="small" variant="contained" onClick={onConfirm}>
              {popover.kind === 'cell' ? strings.cellInfo.useAsCenter : strings.cellInfo.newPoint}
            </Button>
            <Button size="small" onClick={onClose}>
              {strings.cellInfo.close}
            </Button>
          </Box>
        )}
      </Box>
    </Popover>
  )
}
