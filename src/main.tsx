import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SimulationClient } from './bridge/SimulationClient'
import { type AppStore, createAppStore } from './state/appStore'
import { App } from './ui/App'
import type { MissingFeature } from './ui/components/WebGLUnsupported'
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

const missingFeatures = detectMissingFeatures()
let session: TerrainSession | null = null
let store: AppStore | null = null
if (missingFeatures.length === 0) {
  try {
    // Worker を所有する SimulationClient はアプリで 1 つ。ping もそれで行う（01 の申し送り H2）。
    // Worker の生成は、CSP で塞がれた場合などに同期的に例外を投げる
    const client = new SimulationClient()
    store = createAppStore()
    session = new TerrainSession(client, store)
    checkWorker(client)
  } catch (error) {
    console.error(error)
    document.documentElement.dataset.workerReady = 'false'
  }
}

createRoot(container).render(
  <StrictMode>
    <App missingFeatures={missingFeatures} session={session} store={store} />
  </StrictMode>,
)
