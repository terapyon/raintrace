import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import type { Popover as PopoverState } from '../../state/clickState'
import { formatArea, formatMeters, formatVolume } from '../format'
import type { MarkerInfoRow } from '../markerInfo'
import { strings } from '../strings'

interface Props {
  popover: PopoverState
  /** popover が marker のときの数値（sortMarkers の順） */
  rows: readonly MarkerInfoRow[]
  onClose: () => void
}

function Value({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" data-testid={testId}>
        {value}
      </Typography>
    </Box>
  )
}

function Row({ row }: { row: MarkerInfoRow }) {
  const text = strings.markerInfo[row.marker]
  return (
    <Box data-testid={`marker-info-${row.marker}`}>
      <Typography variant="subtitle2">{text.title}</Typography>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {text.body}
      </Typography>
      {row.marker === 'lowest' ? (
        <Value
          label={strings.markerInfo.elevation}
          value={formatMeters(row.elevationM)}
          testId="marker-elevation"
        />
      ) : (
        <>
          <Value
            label={strings.markerInfo.spillElevation}
            value={formatMeters(row.spillElevationM)}
            testId="marker-spill-elevation"
          />
          <Value
            label={strings.markerInfo.maxDepth}
            value={formatMeters(row.maxDepthM)}
            testId="marker-max-depth"
          />
          <Value
            label={strings.markerInfo.capacity}
            value={formatVolume(row.capacityM3)}
            testId="marker-capacity"
          />
          <Value
            label={strings.markerInfo.area}
            value={formatArea(row.areaM2)}
            testId="marker-area"
          />
        </>
      )}
    </Box>
  )
}

/**
 * 地図の ○ の説明（spec 07 §3.4）。形は CellInfoPopover と同じ（背景を持たず、root はクリックを通し、紙だけが
 * 受ける。焦点を閉じ込めず、スクロールも止めない）。印が複数なら Divider で区切って縦に並べる（R07-4）
 */
export function MarkerInfoPopover({ popover, rows, onClose }: Props) {
  const open = popover.kind === 'marker' && rows.length > 0
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
        // 閉じた後も消える間（transition）は紙が開いた位置に残る。そこでクリックを受けると、同じ位置の地図の
        // クリックが紙に吸われて届かない（spec 08 Task 14 の修正ラウンド 1。閉じた直後の同じ点のクリックが
        // 開かなかった）。開いている間だけ受ける
        paper: { sx: { pointerEvents: open ? 'auto' : 'none' } },
      }}
    >
      <Box data-testid="marker-info" sx={{ p: 1.5, minWidth: 220, maxWidth: 320 }}>
        {rows.map((row, k) => (
          <Box key={row.marker === 'lowest' ? 'lowest' : `spill-${row.depressionId}`}>
            {k > 0 && <Divider sx={{ my: 1 }} />}
            <Row row={row} />
          </Box>
        ))}
        <Box sx={{ mt: 1 }}>
          <Button size="small" onClick={onClose}>
            {strings.markerInfo.close}
          </Button>
        </Box>
      </Box>
    </Popover>
  )
}
