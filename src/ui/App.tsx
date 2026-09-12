import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import type { SettingsStore } from '../state/settingsStore'
import { MapView } from './components/MapView'
import { Panel } from './components/Panel'
import { TerrainSessionBinder } from './components/TerrainSessionBinder'
import { type MissingFeature, WebGLUnsupported } from './components/WebGLUnsupported'
import type { TerrainSession } from './terrainSession'
import { theme } from './theme'

interface Props {
  missingFeatures: readonly MissingFeature[]
  session: TerrainSession | null
  settings: SettingsStore
}

export function App({ missingFeatures, session, settings }: Props) {
  return (
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline />
      {missingFeatures.length > 0 ? (
        <WebGLUnsupported missing={missingFeatures} />
      ) : (
        <>
          {/* Worker を起動できなかった場合（session が null）は、地図だけを出す */}
          <MapView>{session !== null && <TerrainSessionBinder session={session} />}</MapView>
          {session !== null && (
            <Panel store={session.store} settings={settings} onRetry={() => session.retry()} />
          )}
        </>
      )}
    </ThemeProvider>
  )
}
