import Paper from '@mui/material/Paper'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import { useStore } from 'zustand'
import { strings } from '../strings'
import type { TerrainSession } from '../terrainSession'

/**
 * 崩れる前と後の地形の切り替え（spec 10 §5.4）。地図の左上、2D・3D の切り替えと昔・今の切り替えの下に置く。
 * 崩れた後の計算が済んだ（ready）ときだけ出す。地形の差し替えの間は押せない
 */
export function ScenarioToggle({ session }: { session: TerrainSession }) {
  const app = session.store
  const ready = useStore(app, (s) => s.collapse.status === 'ready')
  const view = useStore(app, (s) => s.collapse.view)
  const swapping = useStore(app, (s) => s.collapse.swapping)
  if (!ready) return null
  return (
    <Paper
      elevation={3}
      sx={{ position: 'fixed', top: 112, left: 16, zIndex: (theme) => theme.zIndex.fab }}
    >
      <ToggleButtonGroup
        size="small"
        exclusive
        disabled={swapping}
        aria-label={strings.scenario.label}
        value={view}
        onChange={(_, value: 'before' | 'after' | null) => {
          if (value !== null) void session.collapse.setView(value)
        }}
      >
        <ToggleButton value="before" sx={{ px: 2, fontWeight: 'bold' }}>
          {strings.scenario.before}
        </ToggleButton>
        <ToggleButton value="after" sx={{ px: 2, fontWeight: 'bold' }}>
          {strings.scenario.after}
        </ToggleButton>
      </ToggleButtonGroup>
    </Paper>
  )
}
