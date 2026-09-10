import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Switch from '@mui/material/Switch'
import { useTheme } from '@mui/material/styles'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import type { ReactNode } from 'react'
import { useStore } from 'zustand'
import type { AppStore, CursorElevation, DisplaySettings } from '../../state/appStore'
import {
  formatCellSize,
  formatCoordinate,
  formatCubicMeters,
  formatMeters,
  formatPercent,
} from '../format'
import { strings } from '../strings'
import { DemInfoBadge } from './DemInfoBadge'

const PANEL_WIDTH = 320
const FLOW_SPACINGS = [5, 10, 20] as const

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
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

/** 地点・DEM 情報・標高・窪地・表示の切り替え（spec 02 §6.2） */
export function Panel({ store, onRetry }: { store: AppStore; onRetry: () => void }) {
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const selected = useStore(store, (s) => s.selected)
  const load = useStore(store, (s) => s.load)
  const summary = useStore(store, (s) => s.summary)
  const cursor = useStore(store, (s) => s.cursor)
  const display = useStore(store, (s) => s.display)
  const setDisplay = useStore(store, (s) => s.setDisplay)
  const toggle =
    (key: 'elevation' | 'depressions' | 'flow') =>
    (_: unknown, checked: boolean): void =>
      setDisplay({ [key]: checked })

  return (
    <Drawer
      variant="permanent"
      anchor={wide ? 'right' : 'bottom'}
      slotProps={{
        paper: {
          sx: {
            width: wide ? PANEL_WIDTH : '100%',
            maxHeight: wide ? '100%' : '45dvh',
            p: 2,
            opacity: 0.95,
          },
        },
      }}
    >
      <Box data-testid="panel">
        <Typography variant="h6">{strings.panel.title}</Typography>
        {selected === null ? (
          <Typography variant="body2">{strings.panel.notSelected}</Typography>
        ) : (
          <>
            <Row label={strings.panel.point} testId="selected-point">
              {formatCoordinate(selected.lat)}, {formatCoordinate(selected.lon)}
            </Row>
            <Row label={strings.panel.range}>{strings.panel.rangeValue}</Row>
          </>
        )}
        {load.status === 'loading' && (
          <Box sx={{ my: 1 }}>
            <Typography variant="body2">{strings.panel.loading}</Typography>
            <LinearProgress
              variant={load.started > 0 ? 'determinate' : 'indeterminate'}
              value={load.started > 0 ? (load.done / load.started) * 100 : 0}
            />
          </Box>
        )}
        {load.status === 'failed' && load.reason !== 'superseded' && (
          <Alert
            severity={load.reason === 'no-data' ? 'info' : 'error'}
            data-testid="load-error"
            sx={{ my: 1 }}
            action={
              load.reason === 'no-data' ? undefined : (
                <Button color="inherit" size="small" onClick={onRetry}>
                  {strings.panel.retry}
                </Button>
              )
            }
          >
            {strings.errors[load.reason]}
          </Alert>
        )}
        {summary !== null && (
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
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2">{strings.panel.display}</Typography>
            <FormControlLabel
              control={<Switch checked={display.elevation} onChange={toggle('elevation')} />}
              label={strings.panel.showElevation}
            />
            <FormControlLabel
              control={<Switch checked={display.depressions} onChange={toggle('depressions')} />}
              label={strings.panel.showDepressions}
            />
            <FormControlLabel
              control={<Switch checked={display.flow} onChange={toggle('flow')} />}
              label={strings.panel.showFlow}
            />
            <Row label={strings.panel.flowSpacing}>
              <ToggleButtonGroup
                size="small"
                exclusive
                value={display.flowSpacingM}
                onChange={(_, value: DisplaySettings['flowSpacingM'] | null) => {
                  if (value !== null) setDisplay({ flowSpacingM: value })
                }}
              >
                {FLOW_SPACINGS.map((m) => (
                  <ToggleButton key={m} value={m}>
                    {m} m
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Row>
          </>
        )}
      </Box>
    </Drawer>
  )
}
