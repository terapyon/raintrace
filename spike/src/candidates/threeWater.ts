import { type CustomLayerInterface, type Map as MapLibreMap, MercatorCoordinate } from 'maplibre-gl'
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  CustomBlending,
  DataTexture,
  FloatType,
  GLSL3,
  LessEqualDepth,
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
import { gridIndices, gridVertices } from '../gridMesh'
import { gridModelMatrix, multiply } from '../mat4'
import { MIN_DEPTH_M } from '../scenes'
import { WATER_FRAGMENT, WATER_VERTEX } from '../shaders'
import type { Scene, WaterDebug, ZFix } from '../types'

export interface ThreeWaterOptions {
  id: string
  scene: Scene
  elevation: Float32Array // テクスチャに上げる標高（A はシミュレーションの標高、A' は MapLibre の地形の高さ）
  elevScale: 'exaggeration' | 'one' // A' は 'one'（標高に倍率が入っている）
  zfix: ZFix
  renderTimes: number[]
}

export interface ThreeWater {
  layer: CustomLayerInterface
  setExaggeration(value: number): void
  setDepth(depth: Float32Array): void
  setElevation(elevation: Float32Array): void
  setDebug(mode: WaterDebug): void
}

/** 1 チャンネルの浮動小数点のテクスチャ（R32F）。補間はしない（texelFetch で読む） */
function floatTexture(data: Float32Array, n: number): DataTexture {
  const texture = new DataTexture(data, n, n, RedFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/** three で水面を描く Custom Layer（A・A'）。MapLibre の GL のコンテキストを共有する */
export function createThreeWater(map: MapLibreMap, options: ThreeWaterOptions): ThreeWater {
  const { scene } = options
  const n = scene.range.size
  const elevationData = options.elevation.slice()
  const depthData = scene.depth.slice()
  const elevationTexture = floatTexture(elevationData, n)
  const depthTexture = floatTexture(depthData, n)

  const geometry = new BufferGeometry()
  geometry.setAttribute('a_cell', new BufferAttribute(gridVertices(n, false), 2))
  geometry.setIndex(new BufferAttribute(gridIndices(n, 0, n), 1))
  const metersToMercator = MercatorCoordinate.fromLngLat([
    scene.center.lon,
    scene.center.lat,
  ]).meterInMercatorCoordinateUnits()
  const model = gridModelMatrix(scene.range, metersToMercator)

  const uniforms = {
    u_matrix: { value: new Matrix4() },
    u_elevation: { value: elevationTexture },
    u_depth: { value: depthTexture },
    u_size: { value: n },
    u_baseM: { value: 0 },
    u_elevScale: { value: 1 },
    u_depthScale: { value: 1 },
    u_minDepth: { value: MIN_DEPTH_M },
    u_debug: { value: 0 },
  }
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms,
    depthFunc: LessEqualDepth,
  })
  // z-fighting の対策（spec S §3）: 水面を地形の後に描き、深度を手前へずらす
  material.polygonOffset = options.zfix !== 'none'
  material.polygonOffsetFactor = options.zfix === 'offset2' ? -2 : -1
  material.polygonOffsetUnits = options.zfix === 'offset2' ? -8 : -4

  const setDebug = (mode: WaterDebug): void => {
    uniforms.u_debug.value = mode === 'off' ? 0 : 1
    if (mode === 'off') {
      material.transparent = true
      material.blending = CustomBlending
      material.blendSrc = OneFactor
      material.blendDst = OneMinusSrcAlphaFactor
    } else {
      material.transparent = false
      material.blending = NoBlending
    }
    material.depthTest = mode !== 'mask-nodepth'
    material.depthWrite = mode !== 'mask-nodepth'
    material.needsUpdate = true
    map.triggerRepaint()
  }
  setDebug('off')

  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false // 位置は u_matrix で決まり、three のカメラは使わない（計画 D7）
  const threeScene = new ThreeScene()
  threeScene.add(mesh)
  const camera = new Camera()
  let renderer: WebGLRenderer | null = null

  const layer: CustomLayerInterface = {
    id: options.id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(targetMap, gl) {
      renderer = new WebGLRenderer({ canvas: targetMap.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
    },
    render(gl, input) {
      if (renderer === null) return
      const start = performance.now()
      uniforms.u_matrix.value.fromArray(multiply(input.defaultProjectionData.mainMatrix, model))
      renderer.resetState()
      // MapLibre が canvas の大きさを変えても、three の viewport が古いままにならないようにする
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      renderer.render(threeScene, camera)
      options.renderTimes.push(performance.now() - start)
    },
    onRemove() {
      geometry.dispose()
      material.dispose()
      elevationTexture.dispose()
      depthTexture.dispose()
      renderer?.dispose()
    },
  }

  return {
    layer,
    setExaggeration(value) {
      uniforms.u_elevScale.value = options.elevScale === 'one' ? 1 : value
      uniforms.u_depthScale.value = value
      map.triggerRepaint()
    },
    setDepth(depth) {
      depthData.set(depth)
      depthTexture.needsUpdate = true
      map.triggerRepaint()
    },
    setElevation(elevation) {
      elevationData.set(elevation)
      elevationTexture.needsUpdate = true
      map.triggerRepaint()
    },
    setDebug,
  }
}
