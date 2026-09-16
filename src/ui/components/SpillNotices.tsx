import Box from '@mui/material/Box'
import Snackbar from '@mui/material/Snackbar'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useStore } from 'zustand'
import type { SimulationStore, SpillNotice } from '../../state/simulationStore'
import { formatMeters } from '../format'
import { strings } from '../strings'

const message = (spill: SpillNotice): string =>
  strings.spill.started(formatMeters(spill.spillElevation), spill.step)

/** 越流イベント（base-spec §21、spec 04 §5.3）。最新のものを Snackbar で知らせ、パネルに一覧を残す */
export function SpillNotices({ simulation }: { simulation: SimulationStore }) {
  const spills = useStore(simulation, (s) => s.spills)
  // 知らせ終えた最後のもの。Reset で一覧が新しくなると、新しい越流はまた知らせる
  const [acknowledged, setAcknowledged] = useState<SpillNotice | null>(null)
  const latest = spills.at(-1)
  return (
    <>
      {spills.length > 0 && (
        <Box data-testid="spill-list">
          <Typography variant="subtitle2">{strings.spill.title}</Typography>
          {spills.map((spill) => (
            <Typography key={`${spill.depressionId}-${spill.step}`} variant="body2">
              {message(spill)}
            </Typography>
          ))}
        </Box>
      )}
      <Snackbar
        open={latest !== undefined && latest !== acknowledged}
        autoHideDuration={6000}
        onClose={() => setAcknowledged(latest ?? null)}
        message={latest === undefined ? '' : message(latest)}
      />
    </>
  )
}
