import Alert from '@mui/material/Alert'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useStore } from 'zustand'
import type { AppStore, ViewMode } from '../../state/appStore'
import { type PersistedSettings, VERTICAL_EXAGGERATIONS } from '../../state/persistedSettings'
import type { SettingsStore } from '../../state/settingsStore'
import { strings } from '../strings'
import { Row } from './TerrainInfo'

type Exaggeration = PersistedSettings['display']['verticalExaggeration']

/** 2D と 3D の切り替え（spec 05 §3.6）、垂直強調（§3.2）、3D の状態の知らせ */
export function View3dSettings({ app, settings }: { app: AppStore; settings: SettingsStore }) {
  const viewMode = useStore(app, (s) => s.viewMode)
  const status = useStore(app, (s) => s.view3dStatus)
  const exaggeration = useStore(settings, (s) => s.display.verticalExaggeration)
  return (
    <>
      <Row label={strings.view3d.mode}>
        <ToggleButtonGroup
          size="small"
          exclusive
          aria-label={strings.view3d.mode}
          value={viewMode}
          onChange={(_, value: ViewMode | null) => {
            if (value !== null) app.getState().setViewMode(value)
          }}
        >
          <ToggleButton value="2d">{strings.view3d.view2d}</ToggleButton>
          <ToggleButton value="3d">{strings.view3d.view3d}</ToggleButton>
        </ToggleButtonGroup>
      </Row>
      <Row label={strings.view3d.exaggeration}>
        <ToggleButtonGroup
          size="small"
          exclusive
          disabled={viewMode !== '3d'}
          aria-label={strings.view3d.exaggeration}
          value={exaggeration}
          onChange={(_, value: Exaggeration | null) => {
            if (value !== null) settings.getState().setDisplay({ verticalExaggeration: value })
          }}
        >
          {VERTICAL_EXAGGERATIONS.map((value) => (
            <ToggleButton key={value} value={value}>
              {strings.view3d.exaggerationValue(value)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Row>
      {viewMode === '3d' && status === 'loading' && (
        <Typography variant="body2" role="status" data-testid="view3d-loading">
          {strings.view3d.loading}
        </Typography>
      )}
      {viewMode === '3d' && status === 'error' && (
        <Alert severity="error" data-testid="view3d-error" sx={{ my: 1 }}>
          {strings.view3d.error}
        </Alert>
      )}
    </>
  )
}
