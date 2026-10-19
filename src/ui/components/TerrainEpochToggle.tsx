import Paper from '@mui/material/Paper'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { useStore } from 'zustand'
import type { AppStore } from '../../state/appStore'
import { strings } from '../strings'

/**
 * 3D の地形を昔と今で切り替える（spec 09 §4.3）。2D・3D の切り替え（ViewModeToggle）の下に置く。
 * 3D で、昔との比べ結果があるときだけ出す。2D の重ね描きは変えない
 */
export function TerrainEpochToggle({ app }: { app: AppStore }) {
  const visible = useStore(app, (s) => s.viewMode === '3d' && s.fillHistory.status === 'ready')
  const epoch = useStore(app, (s) => s.terrainEpoch)
  if (!visible) return null
  return (
    <Paper
      elevation={3}
      sx={{ position: 'fixed', top: 64, left: 16, zIndex: (theme) => theme.zIndex.fab }}
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        aria-label={strings.epoch.label}
        value={epoch}
        onChange={(_, value: 'now' | 'past' | null) => {
          if (value !== null) app.getState().setTerrainEpoch(value)
        }}
      >
        <ToggleButton value="past" sx={{ px: 2, fontWeight: 'bold' }}>
          {strings.epoch.past}
        </ToggleButton>
        <ToggleButton value="now" sx={{ px: 2, fontWeight: 'bold' }}>
          {strings.epoch.now}
        </ToggleButton>
      </ToggleButtonGroup>
    </Paper>
  )
}
