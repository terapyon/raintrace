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

/** 頂点の格子座標の attribute 名（waterShaders.ts の a_cell と 1 対 1。waterLayer.test.ts が突き合わせる） */
export const CELL_ATTRIBUTE = 'a_cell'

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
  /**
   * 水深のテクスチャを setWater の何回に 1 回転送するか（1 は毎回）。計測の depthEvery=N（spec 06 §5.1）で、
   * 転送（texSubImage2D。1000 m で 4.25 MB）が fps を落としているかを切り分ける
   */
  depthUploadEvery: number
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

/** マテリアルの uniform（waterShaders.ts の宣言と名前が 1 対 1。GL なしで作れるので waterLayer.test.ts が確かめる） */
export interface WaterUniforms {
  [key: string]: { value: unknown }
  u_matrix: { value: Matrix4 }
  u_elevation: { value: DataTexture }
  u_depth: { value: DataTexture }
  u_size: { value: number }
  u_exaggeration: { value: number }
  u_minDepth: { value: number }
  u_lut: { value: DataTexture }
  u_bandsPerM: { value: number }
  u_maxIndex: { value: number }
  u_epsilon: { value: number }
  u_alpha: { value: number }
}

/**
 * setWater が使うデータを決める（大きさが合わないバッファ・null は水を消す）。GL を使わないので、
 * この module で唯一 GL なしで確かめられる振る舞い（Task 8 の申し送りの反映。waterLayer.test.ts）
 */
export function resolveDepthData(
  water: Float32Array | null,
  n: number,
  zeros: Float32Array,
): Float32Array {
  return water !== null && water.length === n * n ? water : zeros
}

/** setWater の updates 回目（1 から）で水深を転送するか（depthEvery=N。1 以下は毎回） */
export function shouldUploadDepth(updates: number, every: number): boolean {
  return every <= 1 || updates % every === 0
}

export function buildUniforms(
  elevationTexture: DataTexture,
  depthTexture: DataTexture,
  lut: DataTexture,
  options: Pick<WaterLayerOptions, 'size' | 'exaggeration' | 'lut'>,
): WaterUniforms {
  return {
    u_matrix: { value: new Matrix4() },
    u_elevation: { value: elevationTexture },
    u_depth: { value: depthTexture },
    u_size: { value: options.size },
    u_exaggeration: { value: options.exaggeration },
    u_minDepth: { value: options.lut.minDepthM },
    u_lut: { value: lut },
    u_bandsPerM: { value: options.lut.bandsPerM },
    u_maxIndex: { value: options.lut.maxIndex },
    u_epsilon: { value: options.lut.epsilonM },
    u_alpha: { value: options.lut.alpha },
  }
}

/** シェーダのプログラムの非同期のリンクの待ちと、資源の解放の順（GL を使わないので waterLayer.test.ts が確かめる） */
export interface CompileGate {
  /** compileAsync の Promise を渡す（onAdd で 1 回）。dispose の後は何もしない */
  start(compiled: Promise<unknown>): void
  /** プログラムができて、まだ捨てていないか。false の間 render は何も描かない */
  ready(): boolean
  disposed(): boolean
  /** 捨てる。待ちの途中なら、待ちが終わってから release を呼ぶ。2 回目からは何もしない */
  dispose(): void
}

/**
 * compileAsync の待ちの間に three の資源を捨てると、three の 10 ms ごとの確かめ（three 0.185.1 の
 * WebGLRenderer.compileAsync の checkMaterialsReady）が、消えたプログラムを読んで例外を投げる
 * （properties.get(material).currentProgram が undefined）。そのため待ちの途中の dispose は、待ちが
 * 終わるまで release を遅らせ、終わっても描かない（onReady を呼ばない）。
 * コンテキストの喪失の後も待ちは終わる（KHR_parallel_shader_compile の仕様で、喪失の後の
 * COMPLETION_STATUS_KHR は true を返す）。compileAsync は reject しないが、もし reject されたら、
 * 描く側に戻す（three が最初の描画で同期にリンクを待つ、Task 17a の前と同じ振る舞い）
 */
export function createCompileGate(release: () => void, onReady: () => void): CompileGate {
  let pending = false
  let programReady = false
  let isDisposed = false
  const settle = (): void => {
    pending = false
    if (isDisposed) {
      release()
      return
    }
    programReady = true
    onReady()
  }
  return {
    start(compiled) {
      if (isDisposed || pending || programReady) return
      pending = true
      compiled.then(settle, settle)
    },
    ready: () => programReady && !isDisposed,
    disposed: () => isDisposed,
    dispose() {
      if (isDisposed) return
      isDisposed = true
      if (!pending) release()
    },
  }
}

export function createWaterLayer(map: MapLibreMap, options: WaterLayerOptions): WaterLayer {
  const n = options.size
  const zeros = new Float32Array(n * n)
  const elevationTexture = floatTexture(options.elevation, n)
  const depthTexture = floatTexture(zeros, n)
  let lut = lutTexture(options.lut)
  const geometry = new BufferGeometry()
  geometry.setAttribute(CELL_ATTRIBUTE, new BufferAttribute(gridVertices(n), 2))
  geometry.setIndex(new BufferAttribute(gridIndices(n), 1))
  const model = gridModelMatrix(options.placement, options.metersToMercator)
  const uniforms = buildUniforms(elevationTexture, depthTexture, lut, options)
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
  let depthUpdates = 0

  const release = (): void => {
    geometry.dispose()
    material.dispose()
    elevationTexture.dispose()
    depthTexture.dispose()
    lut.dispose()
    // 失ったコンテキストの上でも呼べる（WebGL の呼び出しは何もしない）。three が canvas に付けた購読も外す
    renderer?.dispose()
    renderer = null
  }
  // プログラムができたら次のフレームを頼む（それまでの render は何も描かない）
  const gate = createCompileGate(release, () => map.triggerRepaint())
  const dispose = gate.dispose

  const layer: CustomLayerInterface = {
    id: options.id,
    type: 'custom',
    renderingMode: '3d',
    onAdd(targetMap, gl) {
      if (gate.disposed()) return
      // context を渡すと、antialias などの WebGL の属性の指定は無視される（MapLibre が作ったコンテキストのまま）
      renderer = new WebGLRenderer({ canvas: targetMap.getCanvas(), context: gl })
      renderer.autoClear = false
      // シェーダのリンクを描画のフレームの外で待つ（spec 06 §5.2、Task 17a (i)）。これが無いと、最初の
      // render で three がリンクの完了を同期で待ち（WebGLProgram の onFirstUse。60〜210 ms）、3D の切り替えの
      // 長いタスクになる。compile は GL のシェーダ・プログラムを作ってリンクを始めるだけで、バインドなどの
      // 状態を変えないので、MapLibre の描画の外（addLayer の中）で呼んでよい。
      // KHR_parallel_shader_compile の無い環境（E2E の chromium など）では、リンクの完了を同期でしか確かめ
      // られない（three の compileAsync も 10 ms 後に完了とみなす）ので、compileAsync を呼ばずに待ちを
      // すぐ終え、最初の描画で今までと同じく同期で待つ（振る舞いは Task 17a の前と同じ）。compileAsync を
      // 呼ぶと、three が拡張の無いことをコンソールに警告する（extensions.get）ため、has で先に確かめる
      gate.start(
        renderer.extensions.has('KHR_parallel_shader_compile')
          ? renderer.compileAsync(scene, camera)
          : Promise.resolve(),
      )
    },
    render(gl, input) {
      // プログラムができるまでは水面を描かない（onRenderTime も呼ばない）
      if (renderer === null || !gate.ready()) return
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
      // 破棄の後は終端（Task 8 の申し送りの反映）: ベースマップの切り替えの間の窓で呼ばれても、
      // 新しい DataTexture を確保して捨てられないまま残すことがない
      if (gate.disposed()) return
      // 参照は毎回差し替える（返却済みのバッファを指したままにしない。転送しない回は GPU の内容が前のまま）
      depthTexture.image.data = resolveDepthData(water, n, zeros)
      depthUpdates++
      // 次の描画で 1 回だけ texSubImage2D で上げる（N = 512 で 1 MB、1031 で 4.25 MB。spec 05 §3.1）。
      // 水を消す（null）ときは間引かない
      if (water === null || shouldUploadDepth(depthUpdates, options.depthUploadEvery)) {
        depthTexture.needsUpdate = true
      }
      map.triggerRepaint()
    },
    setExaggeration(value) {
      if (gate.disposed()) return
      uniforms.u_exaggeration.value = value
      map.triggerRepaint()
    },
    setLut(next) {
      if (gate.disposed()) return
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
