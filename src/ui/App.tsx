import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { MapView } from './components/MapView'
import { type MissingFeature, WebGLUnsupported } from './components/WebGLUnsupported'
import { theme } from './theme'

interface Props {
  missingFeatures: readonly MissingFeature[]
}

export function App({ missingFeatures }: Props) {
  return (
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline />
      {missingFeatures.length > 0 ? <WebGLUnsupported missing={missingFeatures} /> : <MapView />}
    </ThemeProvider>
  )
}
