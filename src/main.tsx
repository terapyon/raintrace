import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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

const container = document.getElementById('root')
if (container === null) throw new Error('#root が見つかりません')

createRoot(container).render(
  <StrictMode>
    <App missingFeatures={detectMissingFeatures()} />
  </StrictMode>,
)
