import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import type { TerrainSummary } from '../../state/appStore'
import { formatCellSize, formatDemLabel } from '../format'
import { strings } from '../strings'

/** 使った DEM とセルの大きさ（base-spec §40） */
export function DemInfoBadge({ summary }: { summary: TerrainSummary }) {
  const title = `${strings.panel.cellSize}: ${formatCellSize(summary.cellSizeM)}`
  return (
    <Tooltip title={title}>
      <Chip
        data-testid="dem-badge"
        size="small"
        label={formatDemLabel(summary.breakdown)}
        color={summary.demLevel === 1 ? 'primary' : 'warning'}
      />
    </Tooltip>
  )
}
