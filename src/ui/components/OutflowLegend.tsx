import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { OUTFLOW_COLOR, OUTFLOW_OPACITY } from '../../map/overlayColors'
import { strings } from '../strings'

/**
 * 流出の帯の凡例（spec 07 §5.3）。帯の内側のセルそのものは流出していないので、「この辺りから」と書く（R07-5）。
 * 色は地図と同じ定数（map/overlayColors.ts）
 */
export function OutflowLegend() {
  return (
    <Box
      role="img"
      aria-label={strings.legend.outflowAria}
      sx={{ my: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}
    >
      <Box
        component="span"
        data-testid="outflow-legend-swatch"
        style={{ backgroundColor: OUTFLOW_COLOR, opacity: OUTFLOW_OPACITY }}
        sx={{ width: 12, height: 12 }}
      />
      <Typography variant="caption">{strings.legend.outflow}</Typography>
    </Box>
  )
}
