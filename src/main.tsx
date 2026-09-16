import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SimulationClient } from './bridge/SimulationClient'
import { createAppStore } from './state/appStore'
import { createSettingsStore, safeLocalStorage } from './state/settingsStore'
import { createSimulationStore } from './state/simulationStore'
import { parseUrlView } from './state/urlState'
import { App } from './ui/App'
import type { MissingFeature } from './ui/components/WebGLUnsupported'
import { SimulationSession } from './ui/simulationSession'
import { TerrainSession } from './ui/terrainSession'

/** 必須の機能を確かめる（spec 01 §4.3）。確かめに使った WebGL のコンテキストはすぐ解放する */
function detectMissingFeatures(): MissingFeature[] {
  const missing: MissingFeature[] = []
  const gl = document.createElement('canvas').getContext('webgl2')
  if (gl === null) missing.push('webgl2')
  else gl.getExtension('WEBGL_lose_context')?.loseContext()
  if (typeof OffscreenCanvas === 'undefined') missing.push('offscreenCanvas')
  return missing
}

/** 起動時に Worker と ping を往復させ、結果をルート要素に記す（spec 01 §4.4、§6） */
function checkWorker(client: SimulationClient): void {
  const root = document.documentElement
  client.ping().then(
    () => {
      root.dataset.workerReady = 'true'
    },
    (error: unknown) => {
      console.error(error)
      root.dataset.workerReady = 'false'
    },
  )
}

const container = document.getElementById('root')
if (container === null) throw new Error('#root が見つかりません')

// 設定は localStorage から読み、URL の値で上書きする（URL > localStorage。spec 04 §7）
const settings = createSettingsStore(safeLocalStorage())
settings.getState().applyUrl(parseUrlView(window.location.search))

const missingFeatures = detectMissingFeatures()
let session: TerrainSession | null = null
if (missingFeatures.length === 0) {
  const store = createAppStore()
  try {
    // Worker を所有する SimulationClient はアプリで 1 つ。ping もそれで行う（01 の申し送り H2）。
    // Worker の生成は、CSP で塞がれた場合などに同期的に例外を投げる。
    // TerrainSession の生成は代入だけなので、Worker を作った後に例外は出ない
    const client = new SimulationClient()
    const simulation = new SimulationSession(client, createSimulationStore(), settings)
    session = new TerrainSession(client, store, simulation, settings)
    checkWorker(client)
  } catch (error) {
    console.error(error)
    document.documentElement.dataset.workerReady = 'false'
  }
}

createRoot(container).render(
  <StrictMode>
    <App missingFeatures={missingFeatures} session={session} settings={settings} />
  </StrictMode>,
)

// 計測用のフック（spec 05 §4.4）。通常のビルドでは __RAINTRACE_PERF__ が false に置き換わり、この分岐ごと消える
if (__RAINTRACE_PERF__ && session !== null) {
  const target = session
  void import('./ui/perfHook').then(({ installPerfHook }) => installPerfHook(target, settings))
}
