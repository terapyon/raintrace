import Paper from '@mui/material/Paper'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { useStore } from 'zustand'
import type { AppStore, ViewMode } from '../../state/appStore'
import { strings } from '../strings'

/**
 * 2D と 3D の切り替え（spec 05 §3.6）。地図の左上に置く。パネルは広い画面で右、狭い画面で下にあるので重ならない。
 * 垂直強調と 3D の状態の知らせはパネル（View3dSettings）に残す
 */
export function ViewModeToggle({ app }: { app: AppStore }) {
  const viewMode = useStore(app, (s) => s.viewMode)
  return (
    <Paper
      elevation={3}
      sx={{ position: 'fixed', top: 16, left: 16, zIndex: (theme) => theme.zIndex.fab }}
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        aria-label={strings.view3d.mode}
        value={viewMode}
        onChange={(_, value: ViewMode | null) => {
          if (value !== null) app.getState().setViewMode(value)
        }}
      >
        <ToggleButton value="2d" sx={{ px: 2, fontWeight: 'bold' }}>
          {strings.view3d.view2d}
        </ToggleButton>
        <ToggleButton value="3d" sx={{ px: 2, fontWeight: 'bold' }}>
          {strings.view3d.view3d}
        </ToggleButton>
      </ToggleButtonGroup>
    </Paper>
  )
}
