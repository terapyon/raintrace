import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { MARKER_COLORS } from '../../map/overlayColors'
import { strings } from '../strings'

const KINDS = ['lowest', 'spill'] as const

/** 地図の ○ の凡例（spec 07 §3.6）。色は地図のレイヤーと同じ定数（map/overlayColors.ts）から読む */
export function MarkerLegend() {
  return (
    <Box
      role="img"
      aria-label={strings.legend.markersAria}
      data-testid="marker-legend"
      sx={{ my: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}
    >
      {KINDS.map((kind) => (
        <Box key={kind} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            component="span"
            data-testid={`marker-legend-${kind}`}
            style={{ backgroundColor: MARKER_COLORS[kind] }}
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid #ffffff',
              boxShadow: 1,
            }}
          />
          <Typography variant="caption">{strings.markerInfo[kind].title}</Typography>
        </Box>
      ))}
    </Box>
  )
}
