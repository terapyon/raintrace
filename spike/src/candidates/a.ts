import {
  addProtocol,
  type CustomRenderMethodInput,
  LngLat,
  type Map as MapLibreMap,
  MercatorCoordinate,
} from 'maplibre-gl'
import { pixelToLonLat } from '../../../src/dem/tileMath.ts'
import { projectToScreen } from '../mat4'
import { MIN_DEPTH_M } from '../scenes'
import type {
  ApiProbeResult,
  CandidateHandle,
  ElevationSampler,
  MountCandidate,
  ProbePoint,
  ResampleInfo,
  Scene,
} from '../types'
import { waitIdle } from '../waitIdle'
import { setArrowLayer } from './arrows'
import { terrariumTile } from './terrarium'
import { createThreeWater } from './threeWater'

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

/**
 * A': 全セルの中心で MapLibre の地形の高さ（倍率込み）を読む。queryTerrainElevation は呼ぶたびに
 * 視点の覆うタイルを数え直すので、同じ値を返すズームを 3 点で探し、そのズームで Terrain を直接読む。
 * 見つからなければ全セルで queryTerrainElevation を呼ぶ（遅いが正しい）
 */
function resampleHeights(
  map: MapLibreMap,
  scene: Scene,
  exaggeration: number,
): { heights: Float32Array; info: ResampleInfo } {
  const start = performance.now()
  const { range } = scene
  const n = range.size
  const lons = new Float64Array(n)
  const lats = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    lons[i] = pixelToLonLat(range.originX + i + 0.5, range.originY, range.z).lon
    lats[i] = pixelToLonLat(range.originX, range.originY + i + 0.5, range.z).lat
  }
  const at = (col: number, row: number): LngLat => new LngLat(lons[col] ?? 0, lats[row] ?? 0)
  const checks = [at(n >> 1, n >> 1), at(n >> 2, n >> 2), at((3 * n) >> 2, (3 * n) >> 2)]
  const terrain = map.getTerrain() === null ? null : map.terrain
  let zoom: number | null = null
  if (terrain !== null) {
    for (let z = 17; z >= 0 && zoom === null; z--) {
      const same = checks.every((ll) => {
        const q = map.queryTerrainElevation(ll)
        return q !== null && Math.abs(terrain.getElevationForLngLatZoom(ll, z) - q) < 1e-6
      })
      if (same) zoom = z
    }
  }
  const heights = new Float32Array(n * n)
  let wetCells = 0
  let maxDiffM = 0
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col
      const ll = at(col, row)
      const h =
        terrain !== null && zoom !== null
          ? terrain.getElevationForLngLatZoom(ll, zoom)
          : (map.queryTerrainElevation(ll) ?? 0)
      heights[i] = h
      if ((scene.depth[i] ?? 0) >= MIN_DEPTH_M) {
        wetCells++
        maxDiffM = Math.max(maxDiffM, Math.abs(h / exaggeration - (scene.elevation[i] ?? 0)))
      }
    }
  }
  return {
    heights,
    info: { ms: performance.now() - start, zoom, fallback: zoom === null, wetCells, maxDiffM },
  }
}

export const mount: MountCandidate = async (map, scene, params) => {
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

  const renderTimes: number[] = []
  const variant = params.candidate === 'a2' ? 'a2' : 'a'
  // A: 水面の高さはシミュレーションの標高から。A': MapLibre の地形の高さ（倍率込み）に水深 × 倍率を足す（spec S §2）
  const water = createThreeWater(map, {
    id: 'spike-water',
    scene,
    elevation: scene.elevation,
    elevScale: variant === 'a2' ? 'one' : 'exaggeration',
    zfix: params.zfix,
    renderTimes,
  })
  map.addLayer(water.layer)

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

  let lastResample: ResampleInfo | null = null
  let frozen = false
  // 取り直しは視点（中心・ズーム・pitch・bearing・倍率）が変わったときだけ行い、そのときだけ記録する。
  // measure の中の idle（同じ視点、または固定中）では取り直さないので、記録は setView の時の値になる（R2）
  let resampledView = ''
  const viewKey = (): string => {
    const c = map.getCenter()
    return [c.lng, c.lat, map.getZoom(), map.getPitch(), map.getBearing(), exaggeration].join(',')
  }
  const whenIdle = async (): Promise<void> => {
    await waitIdle(map)
    if (variant !== 'a2' || frozen) return
    const key = viewKey()
    if (key === resampledView) return
    resampledView = key
    const { heights, info } = resampleHeights(map, scene, exaggeration)
    lastResample = info
    water.setElevation(heights)
    await waitIdle(map)
  }

  return {
    renderTimes,
    setExaggeration(value) {
      exaggeration = value
      // 合格基準 2: 地形と水面に同じ倍率を掛ける（A' の水面の地形の分は、次の whenIdle で取り直す）
      map.setTerrain({ source: DEM_SOURCE, exaggeration: value })
      water.setExaggeration(value)
    },
    setDepth: (depth) => water.setDepth(depth),
    setDebug: (mode) => water.setDebug(mode),
    whenIdle,
    apiProbe,
    lastResample: () => lastResample,
    freezeElevation(value) {
      frozen = value
    },
    async showArrows(placement, pitchAlignment) {
      setArrowLayer(map, scene, placement, pitchAlignment)
      await whenIdle()
    },
  } satisfies CandidateHandle
}
