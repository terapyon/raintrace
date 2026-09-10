import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import { strings } from '../strings'

export type MissingFeature = 'webgl2' | 'offscreenCanvas'

interface Props {
  missing: readonly MissingFeature[]
}

/** 必須の機能（WebGL 2・OffscreenCanvas）が使えないブラウザへの案内（tech-spec §15.2） */
export function WebGLUnsupported({ missing }: Props) {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 2 }}>
      <Alert severity="error" data-testid="unsupported">
        <AlertTitle>{strings.unsupported.title}</AlertTitle>
        {strings.unsupported.body}
        <ul>
          {missing.map((feature) => (
            <li key={feature}>{strings.unsupported.missing[feature]}</li>
          ))}
        </ul>
      </Alert>
    </Box>
  )
}
