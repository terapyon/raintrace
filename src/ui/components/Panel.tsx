import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import LinearProgress from '@mui/material/LinearProgress'
import { useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useState } from 'react'
import { useStore } from 'zustand'
import type { LoadFailureReason } from '../../state/appStore'
import type { SettingsStore } from '../../state/settingsStore'
import { formatCoordinate } from '../format'
import { strings } from '../strings'
import type { TerrainSession } from '../terrainSession'
import { ControlsSection } from './ControlsSection'
import { DisclaimerNotice } from './DisclaimerDialog'
import { DisplaySettings } from './DisplaySettings'
import { SpillNotices } from './SpillNotices'
import { StatisticsPanel } from './StatisticsPanel'
import { Row, TerrainInfo } from './TerrainInfo'

const PANEL_WIDTH = 320

/**
 * 失敗の理由ごとの出し方。データが無い・対応範囲の外は、再試行しても変わらないので知らせるだけ。
 * 理由が増えたら、Record の型が漏れを知らせる
 */
const FAILURE_DISPLAY: Record<
  LoadFailureReason,
  { severity: 'info' | 'error'; retryable: boolean }
> = {
  'no-data': { severity: 'info', retryable: false },
  'out-of-range': { severity: 'info', retryable: false },
  network: { severity: 'error', retryable: true },
  internal: { severity: 'error', retryable: true },
  worker: { severity: 'error', retryable: true },
}

export function Panel({
  session,
  settings,
  onShowDisclaimer,
}: {
  session: TerrainSession
  settings: SettingsStore
  onShowDisclaimer: () => void
}) {
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const [collapsed, setCollapsed] = useState(false)
  const store = session.store
  const simulation = session.simulation
  const selected = useStore(store, (s) => s.selected)
  const load = useStore(store, (s) => s.load)
  const sizeM = useStore(settings, (s) => s.area.sizeM)
  const hidden = collapsed && !wide
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
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6">{strings.panel.title}</Typography>
          {!wide && (
            <Button
              size="small"
              aria-expanded={!collapsed}
              aria-controls="panel-body"
              onClick={() => setCollapsed((c) => !c)}
            >
              {collapsed ? strings.panel.expand : strings.panel.collapse}
            </Button>
          )}
        </Box>
        {!hidden && (
          <Box id="panel-body">
            {selected === null ? (
              <Typography variant="body2">{strings.panel.notSelected}</Typography>
            ) : (
              <>
                <Row label={strings.panel.point} testId="selected-point">
                  {formatCoordinate(selected.lat)}, {formatCoordinate(selected.lon)}
                </Row>
                <Row label={strings.panel.range}>{strings.panel.rangeValue(sizeM)}</Row>
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
            {load.status === 'failed' && (
              <Alert
                severity={FAILURE_DISPLAY[load.reason].severity}
                data-testid="load-error"
                sx={{ my: 1 }}
                action={
                  FAILURE_DISPLAY[load.reason].retryable ? (
                    <Button color="inherit" size="small" onClick={() => session.retry()}>
                      {strings.panel.retry}
                    </Button>
                  ) : undefined
                }
              >
                {strings.errors[load.reason]}
              </Alert>
            )}
            <Divider sx={{ my: 1 }} />
            <ControlsSection
              settings={settings}
              simulation={simulation.store}
              hasTerrain={load.status === 'ready'}
              actions={simulation}
              onReload={() => session.retry()}
            />
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2">{strings.stats.title}</Typography>
            <StatisticsPanel simulation={simulation.store} />
            <SpillNotices simulation={simulation.store} />
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2">{strings.panel.terrain}</Typography>
            <TerrainInfo store={store} />
            <Divider sx={{ my: 1 }} />
            <DisplaySettings app={store} settings={settings} />
          </Box>
        )}
        <DisclaimerNotice onShowFull={onShowDisclaimer} />
      </Box>
    </Drawer>
  )
}
