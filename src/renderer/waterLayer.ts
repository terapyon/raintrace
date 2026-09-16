/**
 * three で水面を描く Custom Layer（spec 05 §3.1、R05-2・R05-5）。MapLibre の GL のコンテキストを共有する。
 * S の spike/src/candidates/threeWater.ts から、A' の分岐と判定用の表示を除き、LUT の配色を足した。
 * このモジュールは View3d から動的 import で読む（three を初期ロードに入れない。spec 05 §3.8）
 */
import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl'
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  CustomBlending,
  DataTexture,
  FloatType,
  FrontSide,
  GLSL3,
  LessEqualDepth,
  Matrix4,
  Mesh,
  NearestFilter,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RawShaderMaterial,
  RedFormat,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGLRenderer,
} from 'three'
import { type GridPlacement, gridModelMatrix, multiplyMat4 } from './matrix'
import { gridIndices, gridVertices } from './waterMesh'
import { WATER_FRAGMENT, WATER_VERTEX } from './waterShaders'
import { packLutRgba, type WaterLut } from './waterTextures'

/** z-fighting の対策（spec 05 §3.1、S の報告 §10.3）: 水面を地形の後に描き、深度を手前へずらす */
const POLYGON_OFFSET_FACTOR = -1
const POLYGON_OFFSET_UNITS = -4

export interface WaterLayerOptions {
  id: string
  /** 一辺のセル数 N */
  size: number
  placement: GridPlacement
  /** 範囲の中心の緯度での 1 m のメルカトルの長さ（MercatorCoordinate.meterInMercatorCoordinateUnits） */
  metersToMercator: number
  /** 標高（N × N、m）。無効セルは埋めた後（地形のタイルと同じもの。計画で決めたこと 5） */
  elevation: Float32Array
  lut: WaterLut
  exaggeration: number
  /** 計測用。render の CPU の時間（ms） */
  onRenderTime: ((ms: number) => void) | null
}

export interface WaterLayer {
  layer: CustomLayerInterface
  /** 最新の水深（frame のバッファをそのまま指す。計画で決めたこと 15）。null・大きさの違う配列は水を消す */
  setWater(water: Float32Array | null): void
  /** 垂直強調（地形の setTerrain と同じ値。spec 05 §3.2） */
  setExaggeration(value: number): void
  setLut(lut: WaterLut): void
  /** three の資源を捨てる（onRemove・コンテキスト喪失）。2 回呼んでもよい */
  dispose(): void
}

/** 1 チャンネルの浮動小数点のテクスチャ（R32F）。補間しない（texelFetch で読む） */
function floatTexture(data: Float32Array, n: number): DataTexture {
  const texture = new DataTexture(data, n, n, RedFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

function lutTexture(lut: WaterLut): DataTexture {
  const rgba = packLutRgba(lut.rgb)
  const texture = new DataTexture(rgba, rgba.length / 4, 1, RGBAFormat, UnsignedByteType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

export function createWaterLayer(map: MapLibreMap, options: WaterLayerOptions): WaterLayer {
  const n = options.size
  const zeros = new Float32Array(n * n)
  const elevationTexture = floatTexture(options.elevation, n)
  const depthTexture = floatTexture(zeros, n)
  let lut = lutTexture(options.lut)
  const geometry = new BufferGeometry()
  geometry.setAttribute('a_cell', new BufferAttribute(gridVertices(n), 2))
  geometry.setIndex(new BufferAttribute(gridIndices(n), 1))
  const model = gridModelMatrix(options.placement, options.metersToMercator)
  const uniforms = {
    u_matrix: { value: new Matrix4() },
    u_elevation: { value: elevationTexture },
    u_depth: { value: depthTexture },
    u_size: { value: n },
    u_exaggeration: { value: options.exaggeration },
    u_minDepth: { value: options.lut.minDepthM },
    u_lut: { value: lut },
    u_bandsPerM: { value: options.lut.bandsPerM },
    u_maxIndex: { value: options.lut.maxIndex },
    u_epsilon: { value: options.lut.epsilonM },
    u_alpha: { value: options.lut.alpha },
  }
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms,
    depthFunc: LessEqualDepth,
    transparent: true,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    // 表の面だけを描く（S の A と同じ three の既定を明示する。MapLibre は描く前にカリングを既定に戻すので、
    // three が毎回設定する。着手前の確かめ P6）
    side: FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: POLYGON_OFFSET_FACTOR,
    polygonOffsetUnits: POLYGON_OFFSET_UNITS,
  })
  const mesh = new Mesh(geometry, material)
  // 位置は u_matrix で決まり、three のカメラは使わない
  mesh.frustumCulled = false
  const scene = new Scene()
  scene.add(mesh)
  const camera = new Camera()
  let renderer: WebGLRenderer | null = null
  let disposed = false

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    geometry.dispose()
    material.dispose()
    elevationTexture.dispose()
    depthTexture.dispose()
    lut.dispose()
    // 失ったコンテキストの上でも呼べる（WebGL の呼び出しは何もしない）。three が canvas に付けた購読も外す
    renderer?.dispose()
    renderer = null
  }

  const layer: CustomLayerInterface = {
    id: options.id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(targetMap, gl) {
      // context を渡すと、antialias などの WebGL の属性の指定は無視される（MapLibre が作ったコンテキストのまま）
      renderer = new WebGLRenderer({ canvas: targetMap.getCanvas(), context: gl })
      renderer.autoClear = false
    },
    render(gl, input) {
      if (renderer === null) return
      const start = performance.now()
      // mainMatrix × モデル行列を倍精度で掛け、Float32 にして渡す（spec 05 §3.1。modelViewProjectionMatrix は
      // x・y がワールドの画素で float32 の精度が足りないので使わない）
      uniforms.u_matrix.value.fromArray(multiplyMat4(input.defaultProjectionData.mainMatrix, model))
      // MapLibre と GL のコンテキストを共有するので、three が覚えている状態を捨ててから描く。
      // MapLibre が canvas の大きさを変えても古い viewport のままにならないよう、毎回合わせる
      renderer.resetState()
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      renderer.render(scene, camera)
      options.onRenderTime?.(performance.now() - start)
    },
    onRemove() {
      dispose()
    },
  }

  return {
    layer,
    setWater(water) {
      depthTexture.image.data = water !== null && water.length === n * n ? water : zeros
      // 次の描画で 1 回だけ texSubImage2D で上げる（N = 512 で 1 MB、1031 で 4.25 MB。spec 05 §3.1）
      depthTexture.needsUpdate = true
      map.triggerRepaint()
    },
    setExaggeration(value) {
      uniforms.u_exaggeration.value = value
      map.triggerRepaint()
    },
    setLut(next) {
      const texture = lutTexture(next)
      lut.dispose()
      lut = texture
      uniforms.u_lut.value = texture
      uniforms.u_bandsPerM.value = next.bandsPerM
      uniforms.u_maxIndex.value = next.maxIndex
      uniforms.u_epsilon.value = next.epsilonM
      uniforms.u_alpha.value = next.alpha
      uniforms.u_minDepth.value = next.minDepthM
      map.triggerRepaint()
    },
    dispose,
  }
}
