import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { type WaterPalette, waterLegendCss } from '../../map/waterColormap'
import { strings } from '../strings'

/** 水深の凡例（spec 04 §6.1） */
export function WaterLegend({ palette }: { palette: WaterPalette }) {
  return (
    <Box role="img" aria-label={strings.legend.waterAria} data-testid="water-legend" sx={{ my: 1 }}>
      <Typography variant="caption" color="text.secondary">
        {strings.legend.water}（
        {palette === 'stepped' ? strings.legend.waterStepped : strings.legend.waterContinuous}）
      </Typography>
      <Box sx={{ height: 12, borderRadius: 0.5, background: waterLegendCss(palette) }} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="caption">{strings.legend.waterMin}</Typography>
        <Typography variant="caption">{strings.legend.waterMid}</Typography>
        <Typography variant="caption">{strings.legend.waterMax}</Typography>
      </Box>
    </Box>
  )
}
