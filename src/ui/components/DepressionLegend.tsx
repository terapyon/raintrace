import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { depressionLegendCss } from '../../map/colormap'
import { strings } from '../strings'

/** 窪地の満水時の深さの凡例（02 の申し送り L4） */
export function DepressionLegend() {
  return (
    <Box role="img" aria-label={strings.legend.depressionAria} sx={{ my: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {strings.legend.depression}
      </Typography>
      <Box sx={{ height: 12, borderRadius: 0.5, background: depressionLegendCss() }} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="caption">{strings.legend.depressionMin}</Typography>
        <Typography variant="caption">{strings.legend.depressionMax}</Typography>
      </Box>
    </Box>
  )
}
