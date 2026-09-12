import { addProtocol, type CustomRenderMethodInput, MercatorCoordinate } from 'maplibre-gl'
import { pixelToLonLat } from '../../../src/dem/tileMath.ts'
import { projectToScreen } from '../mat4'
import type {
  ApiProbeResult,
  CandidateHandle,
  ElevationSampler,
  MountCandidate,
  ProbePoint,
  Scene,
} from '../types'
import { waitIdle } from '../waitIdle'
import { terrariumTile } from './terrarium'

const PROTOCOL = 'spikedem'
const DEM_SOURCE = 'spike-dem'
const HILLSHADE_SOURCE = 'spike-dem-hs'

// addProtocol はページで 1 回だけ登録する。サンプラーは場面ごとに差し替える
let activeSampler: ElevationSampler | null = null
let protocolRegistered = false

function registerProtocol(sample: ElevationSampler): void {
  activeSampler = sample
  if (protocolRegistered) return
  protocolRegistered = true
  // 返すのは ImageBitmap。MapLibre 6.6.0 の画像の要求はそのまま受け取る（計画 D6）
  addProtocol(PROTOCOL, async (request) => {
    const match = /^spikedem:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url)
    if (match === null || activeSampler === null) throw new Error(`不正な URL: ${request.url}`)
    const rgba = terrariumTile(activeSampler, Number(match[1]), Number(match[2]), Number(match[3]))
    const data = await createImageBitmap(new ImageData(rgba, 256, 256), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    return { data }
  })
}

/** 範囲の中の検査の地点。合成は台地（平ら）・すり鉢の中心・斜面の中ほど、実データは中心と北西寄り */
function probeCells(scene: Scene): { label: string; col: number; row: number }[] {
  const n = scene.range.size
  const at = (fx: number, fy: number) => ({ col: Math.floor(n * fx), row: Math.floor(n * fy) })
  return scene.name === 'synthetic'
    ? [
        { label: 'flat', ...at(0.5, 0.45) },
        { label: 'bowl', ...at(0.5, 0.25) },
        { label: 'slope', ...at(0.5, 0.75) },
      ]
    : [
        { label: 'center', ...at(0.5, 0.5) },
        { label: 'northwest', ...at(0.25, 0.25) },
      ]
}

export const mount: MountCandidate = async (map, scene) => {
  registerProtocol(scene.sample)
  const dem = {
    type: 'raster-dem' as const,
    tiles: [`${PROTOCOL}://{z}/{x}/{y}`],
    tileSize: 256,
    maxzoom: 17,
    encoding: 'terrarium' as const,
  }
  map.addSource(DEM_SOURCE, dem)
  // 陰影は地形と別のソースにする（同じソースだと MapLibre が警告を出す。計画 D18）
  map.addSource(HILLSHADE_SOURCE, dem)
  map.addLayer({
    id: 'spike-hillshade',
    type: 'hillshade',
    source: HILLSHADE_SOURCE,
    paint: { 'hillshade-exaggeration': 0.5 },
  })
  let exaggeration = 1
  map.setTerrain({ source: DEM_SOURCE, exaggeration })

  // 何も描かず、render の引数だけを覚えるレイヤー（判定 (1) の材料）
  let last: CustomRenderMethodInput | null = null
  map.addLayer({
    id: 'spike-probe',
    type: 'custom',
    renderingMode: '3d',
    render(_gl, options) {
      last = options
    },
  })

  const cells = probeCells(scene)
  const metersToMercator = MercatorCoordinate.fromLngLat([
    scene.center.lon,
    scene.center.lat,
  ]).meterInMercatorCoordinateUnits()

  const apiProbe = (): ApiProbeResult | null => {
    const options = last as CustomRenderMethodInput | null
    if (options === null) return null
    const canvas = map.getCanvas()
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const matrix = options.defaultProjectionData.mainMatrix
    const points: ProbePoint[] = cells.map(({ label, col, row }) => {
      const { range } = scene
      const ll = pixelToLonLat(range.originX + col + 0.5, range.originY + row + 0.5, range.z)
      const lngLat: [number, number] = [ll.lon, ll.lat]
      const merc = MercatorCoordinate.fromLngLat(lngLat)
      const simElevation = scene.elevation[row * range.size + col] ?? 0
      const terrainElevation = map.queryTerrainElevation(lngLat)
      const via = (meters: number) =>
        projectToScreen(matrix, [merc.x, merc.y, meters * metersToMercator], width, height)
      const projected = map.project(lngLat)
      return {
        label,
        lngLat,
        simElevation,
        terrainElevation,
        projected: { x: projected.x, y: projected.y },
        viaMatrixZ0: via(0),
        viaMatrixTerrain: terrainElevation === null ? null : via(terrainElevation),
        viaMatrixSim: via(simElevation * exaggeration),
      }
    })
    const mvp = Array.from(options.modelViewProjectionMatrix)
    return {
      optionKeys: Object.keys(options).sort(),
      nearZ: options.nearZ,
      farZ: options.farZ,
      fovRad: options.fov,
      mvpEqualsMain: mvp.every((v, i) => v === matrix[i]),
      centerElevation: map.getCenterElevation(),
      exaggeration,
      points,
    }
  }

  return {
    renderTimes: [],
    setExaggeration(value) {
      exaggeration = value
      map.setTerrain({ source: DEM_SOURCE, exaggeration: value })
    },
    // 水面は Task 3 で足す（この Task では地形と行列だけを見る）
    setDepth() {},
    setDebug() {},
    whenIdle: () => waitIdle(map),
    apiProbe,
  } satisfies CandidateHandle
}
