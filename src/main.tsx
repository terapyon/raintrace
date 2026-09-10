import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SimulationClient } from './bridge/SimulationClient'
import { App } from './ui/App'
import type { MissingFeature } from './ui/components/WebGLUnsupported'

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
function checkWorker(): void {
  const root = document.documentElement
  const fail = (error: unknown): void => {
    console.error(error)
    root.dataset.workerReady = 'false'
  }
  try {
    // Worker の生成は、CSP で塞がれた場合などに同期的に例外を投げる
    new SimulationClient().ping().then(() => {
      root.dataset.workerReady = 'true'
    }, fail)
  } catch (error) {
    fail(error)
  }
}

const container = document.getElementById('root')
if (container === null) throw new Error('#root が見つかりません')

const missingFeatures = detectMissingFeatures()

createRoot(container).render(
  <StrictMode>
    <App missingFeatures={missingFeatures} />
  </StrictMode>,
)

if (missingFeatures.length === 0) checkWorker()
