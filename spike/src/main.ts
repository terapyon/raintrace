import 'maplibre-gl/dist/maplibre-gl.css'
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { createGsiPaleStyle } from '../../src/map/gsiStyle'
import { measureWater } from './capture'
import { loadDemTiles } from './demTiles'
import { parseParams, type SpikeParams } from './params'
import { buildRealScene, buildSyntheticScene, shibuyaRange } from './scenes'
import type {
  CandidateHandle,
  CandidateId,
  MountCandidate,
  Scene,
  SpikeGlobal,
  View,
} from './types'
import { waitIdle } from './waitIdle'

setWorkerUrl(workerUrl)

/** 候補は動的 import で読み、候補ごとのチャンクにする（計画 D3、Task 9 で大きさを測る） */
const candidates: Partial<Record<CandidateId, () => Promise<{ mount: MountCandidate }>>> = {
  a: () => import('./candidates/a'),
}

const status = document.getElementById('status')
const show = (text: string): void => {
  if (status !== null) status.textContent = text
}

async function buildScene(params: SpikeParams): Promise<Scene> {
  if (params.scene === 'real') {
    const range = shibuyaRange()
    return buildRealScene(range, await loadDemTiles(range))
  }
  return buildSyntheticScene(params.water === 'film' ? 'film' : 'fixed')
}

function rendererName(map: MapLibreMap): string {
  const gl = map.painter.context.gl
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info === null ? '不明' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
}

async function start(): Promise<void> {
  const cspViolations: string[] = []
  document.addEventListener('securitypolicyviolation', (event) => {
    cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`)
  })
  const params = parseParams(location.search)
  const scene = await buildScene(params)
  const map = new MapLibreMap({
    container: 'map',
    style: createGsiPaleStyle({
      text: '国土地理院',
      url: 'https://maps.gsi.go.jp/development/ichiran.html',
    }),
    center: [scene.center.lon, scene.center.lat],
    zoom: params.zoom,
    pitch: params.pitch,
    bearing: 0,
    maxZoom: 18,
    maxPitch: 85,
    fadeDuration: 0,
    attributionControl: { compact: false },
    // capture=1 のときだけ画面を読み取れるようにする。fps の計測では切る（計画 D9・D15）
    canvasContextAttributes: { antialias: true, preserveDrawingBuffer: params.capture },
  })
  map.on('error', (event) => console.error(event.error))
  await map.once('load')

  let candidate: CandidateHandle | null = null
  if (params.candidate !== null) {
    const load = candidates[params.candidate]
    if (load === undefined) throw new Error(`候補 ${params.candidate} はまだありません`)
    candidate = await (await load()).mount(map, scene, params)
    candidate.setExaggeration(params.exaggeration)
  }
  const spike: SpikeGlobal = {
    map,
    scene,
    params,
    candidate,
    cspViolations,
    async setView(view: View) {
      map.jumpTo({
        center: [scene.center.lon, scene.center.lat],
        zoom: view.zoom,
        pitch: view.pitch,
        bearing: 0,
      })
      candidate?.setExaggeration(view.exaggeration)
      await (candidate === null ? waitIdle(map) : candidate.whenIdle())
    },
    async measure() {
      if (candidate === null) throw new Error('候補がありません')
      if (!params.capture) throw new Error('capture=1 で開いてください')
      return measureWater(map, candidate)
    },
  }
  window.spike = spike
  await (candidate === null ? waitIdle(map) : candidate.whenIdle())
  show(
    `${params.candidate ?? '候補なし'} / ${scene.name} / N=${scene.range.size} / ${rendererName(map)}`,
  )
  document.documentElement.dataset.spikeReady = 'true'
}

start().catch((error: unknown) => {
  console.error(error)
  show(`失敗: ${String(error)}`)
  document.documentElement.dataset.spikeError = String(error)
})
