import { type CustomLayerInterface, MercatorCoordinate } from 'maplibre-gl'
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  CanvasTexture,
  CustomBlending,
  DataTexture,
  FloatType,
  GLSL3,
  LessEqualDepth,
  LinearFilter,
  Matrix4,
  Mesh,
  NearestFilter,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RawShaderMaterial,
  RedFormat,
  Scene as ThreeScene,
  WebGLRenderer,
} from 'three'
import { gridVertices, maskedGridIndices } from '../gridMesh'
import { gridModelMatrix, multiply } from '../mat4'
import { MIN_DEPTH_M } from '../scenes'
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX, WATER_FRAGMENT, WATER_VERTEX } from '../shaders'
import type { CandidateHandle, MountCandidate, WaterDebug } from '../types'
import { waitIdle } from '../waitIdle'
import { composeBasemap } from './basemap'

function floatTexture(data: Float32Array, n: number): DataTexture {
  const texture = new DataTexture(data, n, n, RedFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/**
 * B: 範囲の中の地形と水面を 1 つの Custom Layer で描く。範囲の外は MapLibre の平面の地図（地形なし）。
 * 地形と水面は同じ頂点（セル番号）と同じ標高のテクスチャを使い、水面を後に描く（spec S §3 の B の対策）
 */
export const mount: MountCandidate = async (map, scene, params) => {
  const { range } = scene
  const n = range.size
  const m = n + 2 // 縁つきの頂点の一辺（計画 D17）
  const renderTimes: number[] = []

  const basemap = new CanvasTexture(await composeBasemap(range))
  basemap.flipY = false // canvas の 1 行目（北）を v = 0 に置く（シェーダの v_uv と同じ向き）
  basemap.minFilter = LinearFilter
  basemap.generateMipmaps = false
  const elevationTexture = floatTexture(scene.elevation.slice(), n)
  const depthData = scene.depth.slice()
  const depthTexture = floatTexture(depthData, n)

  // シェーダには無効セルの入力が無いので（05 の申し送り §11）、無効セルにかかる四角形は
  // JS 側の index（三角形の頂点番号）の組み立てで落とす。縁（範囲の外、a_cell が [0, n) の外）は
  // 高さが常に 0 に固定される（TERRAIN_VERTEX の ring 判定）ので無効セルの対象にしない
  const isValid = (col: number, row: number): boolean => {
    const cx = col - 1
    const cy = row - 1
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) return true
    return scene.validMask[cy * n + cx] === 1
  }

  // 頂点は地形と水面で共有する。水面は内側の n × n だけ、地形は縁を含めるかを skirt で選ぶ
  const cells = new BufferAttribute(gridVertices(n, true), 2)
  const terrainGeometry = new BufferGeometry()
  terrainGeometry.setAttribute('a_cell', cells)
  terrainGeometry.setIndex(
    new BufferAttribute(
      params.skirt ? maskedGridIndices(m, 0, m, isValid) : maskedGridIndices(m, 1, n, isValid),
      1,
    ),
  )
  const waterGeometry = new BufferGeometry()
  waterGeometry.setAttribute('a_cell', cells)
  waterGeometry.setIndex(new BufferAttribute(maskedGridIndices(m, 1, n, isValid), 1))

  const metersToMercator = MercatorCoordinate.fromLngLat([
    scene.center.lon,
    scene.center.lat,
  ]).meterInMercatorCoordinateUnits()
  const model = gridModelMatrix(range, metersToMercator)
  const matrix = { value: new Matrix4() }
  const elevScale = { value: 1 }
  const common = {
    u_matrix: matrix,
    u_elevation: { value: elevationTexture },
    u_size: { value: n },
    // 最低の標高を高さ 0（平面の地図の高さ）にする（計画 D17）
    u_baseM: { value: scene.minElevation },
    u_elevScale: elevScale,
  }
  const terrainMaterial = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    uniforms: { ...common, u_cellM: { value: range.cellSizeM }, u_basemap: { value: basemap } },
    depthFunc: LessEqualDepth,
  })
  const waterUniforms = {
    ...common,
    u_depth: { value: depthTexture },
    u_depthScale: { value: 1 },
    u_minDepth: { value: MIN_DEPTH_M },
    u_debug: { value: 0 },
  }
  const waterMaterial = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: waterUniforms,
    depthFunc: LessEqualDepth,
  })
  waterMaterial.polygonOffset = params.zfix !== 'none'
  waterMaterial.polygonOffsetFactor = params.zfix === 'offset2' ? -2 : -1
  waterMaterial.polygonOffsetUnits = params.zfix === 'offset2' ? -8 : -4

  const setDebug = (mode: WaterDebug): void => {
    waterUniforms.u_debug.value = mode === 'off' ? 0 : 1
    if (mode === 'off') {
      waterMaterial.transparent = true
      waterMaterial.blending = CustomBlending
      waterMaterial.blendSrc = OneFactor
      waterMaterial.blendDst = OneMinusSrcAlphaFactor
    } else {
      waterMaterial.transparent = false
      waterMaterial.blending = NoBlending
    }
    waterMaterial.depthTest = mode !== 'mask-nodepth'
    waterMaterial.depthWrite = mode !== 'mask-nodepth'
    waterMaterial.needsUpdate = true
    map.triggerRepaint()
  }
  setDebug('off')

  const terrainMesh = new Mesh(terrainGeometry, terrainMaterial)
  const waterMesh = new Mesh(waterGeometry, waterMaterial)
  for (const mesh of [terrainMesh, waterMesh]) mesh.frustumCulled = false
  terrainMesh.renderOrder = 0
  waterMesh.renderOrder = 1 // 水面を地形の後に描く
  const threeScene = new ThreeScene()
  threeScene.add(terrainMesh, waterMesh)
  const camera = new Camera()
  let renderer: WebGLRenderer | null = null

  const layer: CustomLayerInterface = {
    id: 'spike-b',
    type: 'custom',
    renderingMode: '3d',
    onAdd(targetMap, gl) {
      renderer = new WebGLRenderer({ canvas: targetMap.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
    },
    render(gl, input) {
      if (renderer === null) return
      const start = performance.now()
      matrix.value.fromArray(multiply(input.defaultProjectionData.mainMatrix, model))
      renderer.resetState()
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      renderer.render(threeScene, camera)
      renderTimes.push(performance.now() - start)
    },
    onRemove() {
      terrainGeometry.dispose()
      waterGeometry.dispose()
      terrainMaterial.dispose()
      waterMaterial.dispose()
      basemap.dispose()
      elevationTexture.dispose()
      depthTexture.dispose()
      renderer?.dispose()
    },
  }
  map.addLayer(layer)

  return {
    renderTimes,
    setExaggeration(value) {
      // 合格基準 2: 地形と水面が同じ uniform（u_elevScale）を読むので、倍率は構造上一致する
      elevScale.value = value
      waterUniforms.u_depthScale.value = value
      map.triggerRepaint()
    },
    setDepth(depth) {
      depthData.set(depth)
      depthTexture.needsUpdate = true
      map.triggerRepaint()
    },
    setDebug,
    whenIdle: () => waitIdle(map),
  } satisfies CandidateHandle
}
