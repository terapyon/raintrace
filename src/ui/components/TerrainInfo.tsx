import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Typography from '@mui/material/Typography'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import type { AppStore, CursorElevation } from '../../state/appStore'
import { formatCellSize, formatCubicMeters, formatMeters, formatPercent } from '../format'
import { strings } from '../strings'
import { DemInfoBadge } from './DemInfoBadge'

export function Row({
  label,
  children,
  testId,
}: {
  label: string
  children: ReactNode
  testId?: string
}) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" component="div" data-testid={testId}>
        {children}
      </Typography>
    </Box>
  )
}

function cursorText(cursor: CursorElevation | null): string {
  if (cursor === null) return '—'
  if (cursor.kind === 'outside') return strings.panel.cursorOutside
  if (cursor.kind === 'no-data') return strings.panel.cursorNoData
  return formatMeters(cursor.meters)
}

/** DEM 情報・無効セル・標高・カーソル位置・窪地（spec 02 §6.2）。summary が無ければ何も出さない */
export function TerrainInfo({ store }: { store: AppStore }) {
  const summary = useStore(store, (s) => s.summary)
  const cursor = useStore(store, (s) => s.cursor)
  if (summary === null) return null
  return (
    <>
      <Divider sx={{ my: 1 }} />
      <Row label={strings.panel.dem}>
        <DemInfoBadge summary={summary} />
      </Row>
      <Row label={strings.panel.cellSize}>{formatCellSize(summary.cellSizeM)}</Row>
      <Row label={strings.panel.invalidRatio} testId="invalid-ratio">
        {formatPercent(summary.invalidRatio)}
      </Row>
      {summary.demLevel !== 1 && (
        <Alert severity="warning" sx={{ my: 1 }}>
          {strings.dem.notDem1aNote}
        </Alert>
      )}
      <Divider sx={{ my: 1 }} />
      <Typography variant="subtitle2">{strings.panel.elevation}</Typography>
      {summary.elevationRange !== null && (
        <>
          <Row label={strings.panel.elevationMin} testId="elevation-min">
            {formatMeters(summary.elevationRange.min)}
          </Row>
          <Row label={strings.panel.elevationMax} testId="elevation-max">
            {formatMeters(summary.elevationRange.max)}
          </Row>
        </>
      )}
      <Row label={strings.panel.cursor} testId="cursor-elevation">
        {cursorText(cursor)}
      </Row>
      <Divider sx={{ my: 1 }} />
      <Typography variant="subtitle2">{strings.panel.depressions}</Typography>
      <Row label={strings.panel.depressionCount} testId="depression-count">
        {summary.depressionCount} {strings.panel.depressionCountUnit}
      </Row>
      {summary.largestDepression !== null && (
        <>
          <Typography variant="body2" color="text.secondary">
            {strings.panel.largest}
          </Typography>
          <Row label={strings.panel.maxDepth}>
            {formatMeters(summary.largestDepression.maxDepthM)}
          </Row>
          <Row label={strings.panel.capacity}>
            {formatCubicMeters(summary.largestDepression.capacityM3)}
          </Row>
          <Row label={strings.panel.spillElevation}>
            {formatMeters(summary.largestDepression.spillElevation)}
          </Row>
        </>
      )}
    </>
  )
}
