import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import type { AppStore } from '../state/appStore'
import { MapView } from './components/MapView'
import { Panel } from './components/Panel'
import { TerrainSessionBinder } from './components/TerrainSessionBinder'
import { type MissingFeature, WebGLUnsupported } from './components/WebGLUnsupported'
import type { TerrainSession } from './terrainSession'
import { theme } from './theme'

interface Props {
  missingFeatures: readonly MissingFeature[]
  session: TerrainSession | null
  store: AppStore | null
}

export function App({ missingFeatures, session, store }: Props) {
  return (
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline />
      {missingFeatures.length > 0 ? (
        <WebGLUnsupported missing={missingFeatures} />
      ) : (
        <>
          {/* Worker を起動できなかった場合（session が null）は、地図だけを出す */}
          <MapView>{session !== null && <TerrainSessionBinder session={session} />}</MapView>
          {session !== null && store !== null && (
            <Panel store={store} onRetry={() => session.retry()} />
          )}
        </>
      )}
    </ThemeProvider>
  )
}
