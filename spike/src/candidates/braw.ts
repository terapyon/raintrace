import { type CustomLayerInterface, MercatorCoordinate } from 'maplibre-gl'
import { gridVertices, maskedGridIndices, ringCellValid } from '../gridMesh'
import { gridModelMatrix, multiply } from '../mat4'
import { MIN_DEPTH_M } from '../scenes'
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX, WATER_FRAGMENT, WATER_VERTEX } from '../shaders'
import type { CandidateHandle, MountCandidate, WaterDebug } from '../types'
import { waitIdle } from '../waitIdle'
import { composeBasemap } from './basemap'
import { compileProgram, createFloatTexture, uniformLocations } from './glProgram'

const TERRAIN_UNIFORMS = [
  'u_matrix',
  'u_elevation',
  'u_size',
  'u_baseM',
  'u_elevScale',
  'u_cellM',
  'u_basemap',
] as const
const WATER_UNIFORMS = [
  'u_matrix',
  'u_elevation',
  'u_depth',
  'u_size',
  'u_baseM',
  'u_elevScale',
  'u_depthScale',
  'u_minDepth',
  'u_debug',
] as const

interface GlState {
  terrain: WebGLProgram
  water: WebGLProgram
  terrainU: Record<(typeof TERRAIN_UNIFORMS)[number], WebGLUniformLocation | null>
  waterU: Record<(typeof WATER_UNIFORMS)[number], WebGLUniformLocation | null>
  vao: WebGLVertexArrayObject
  terrainIndex: WebGLBuffer
  terrainCount: number
  waterIndex: WebGLBuffer
  waterCount: number
  elevation: WebGLTexture
  depth: WebGLTexture
  basemap: WebGLTexture
}

/**
 * B-raw: B と同じ描き方（頂点を共有し、水面を後に描く）を three なしで書く（RS-2）。
 * シェーダ・メッシュ・ベースマップ・無効セルの落とし方は b.ts と共通にし、違いを three の有無だけにする
 */
export const mount: MountCandidate = async (map, scene, params) => {
  const { range } = scene
  const n = range.size
  const m = n + 2
  const renderTimes: number[] = []
  const basemapCanvas = await composeBasemap(range)
  // 標高は texSubImage2D が即座に GPU へコピーするので slice は必須ではないが、
  // scene.elevation を他所と共有したまま書き換えないよう b.ts と同じ防御的コピーにする
  const elevationData = scene.elevation.slice()
  const depthData = scene.depth.slice()
  let depthDirty = false
  let exaggeration = 1
  let debug: WaterDebug = 'off'
  const metersToMercator = MercatorCoordinate.fromLngLat([
    scene.center.lon,
    scene.center.lat,
  ]).meterInMercatorCoordinateUnits()
  const model = gridModelMatrix(range, metersToMercator)

  // シェーダには無効セルの入力が無いので、無効セルにかかる四角形は index の組み立てで落とす
  // （b.ts と同じ判定を `gridMesh.ts` の `ringCellValid` で共有する。中間の判定の反映レビュー対応）
  const isValid = ringCellValid(n, scene.validMask)

  let state: GlState | null = null

  const layer: CustomLayerInterface = {
    id: 'spike-braw',
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      const terrain = compileProgram(gl, TERRAIN_VERTEX, TERRAIN_FRAGMENT)
      const water = compileProgram(gl, WATER_VERTEX, WATER_FRAGMENT)
      const vao = gl.createVertexArray()
      gl.bindVertexArray(vao)
      const cells = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, cells)
      gl.bufferData(gl.ARRAY_BUFFER, gridVertices(n, true), gl.STATIC_DRAW)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
      gl.bindVertexArray(null)
      const indexBuffer = (data: Uint32Array): WebGLBuffer => {
        const buffer = gl.createBuffer()
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW)
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
        return buffer
      }
      // 無効セルの落とし方は b.ts と同じ（ringCellValid を共有）。B-raw も同じ判定を使う
      const terrainIndices = params.skirt
        ? maskedGridIndices(m, 0, m, isValid)
        : maskedGridIndices(m, 1, n, isValid)
      const waterIndices = maskedGridIndices(m, 1, n, isValid)
      const basemap = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, basemap)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, basemapCanvas)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      state = {
        terrain,
        water,
        terrainU: uniformLocations(gl, terrain, TERRAIN_UNIFORMS),
        waterU: uniformLocations(gl, water, WATER_UNIFORMS),
        vao,
        terrainIndex: indexBuffer(terrainIndices),
        terrainCount: terrainIndices.length,
        waterIndex: indexBuffer(waterIndices),
        waterCount: waterIndices.length,
        elevation: createFloatTexture(gl, n, elevationData),
        depth: createFloatTexture(gl, n, depthData),
        basemap,
      }
    },
    render(gl, input) {
      const s = state
      if (s === null) return
      const start = performance.now()
      if (depthDirty) {
        gl.bindTexture(gl.TEXTURE_2D, s.depth)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, n, gl.RED, gl.FLOAT, depthData)
        depthDirty = false
      }
      const matrix = new Float32Array(multiply(input.defaultProjectionData.mainMatrix, model))
      // MapLibre は render の後に自分の GL の状態を戻す（setDirty）。ここで使う状態はすべて自分で設定する
      // （three の WebGLRenderer.setViewport 相当。B と同じ描画結果になるよう明示的に揃える）
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      gl.bindVertexArray(s.vao)
      // b.ts の RawShaderMaterial は既定で side: FrontSide（three.js の既定値）なので、WebGLRenderer は
      // 背面（三角形の裏側）を描かない。b と同じ結果になるよう、生の WebGL でも背面を落とす
      // （回避策: 実データの場面で最初 disable のままにしたところ、real・×10 の可視率が b と大きくずれた。
      // 合成の場面はほぼ平面なので違いが出ず、real の起伏で裏面の三角形が水面の遮蔽に影響していた）
      gl.enable(gl.CULL_FACE)
      gl.cullFace(gl.BACK)
      gl.frontFace(gl.CCW)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.disable(gl.BLEND)

      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram は WebGL の API で React の hook ではない
      gl.useProgram(s.terrain)
      gl.uniformMatrix4fv(s.terrainU.u_matrix, false, matrix)
      gl.uniform1i(s.terrainU.u_size, n)
      gl.uniform1f(s.terrainU.u_baseM, scene.minElevation)
      gl.uniform1f(s.terrainU.u_elevScale, exaggeration)
      gl.uniform1f(s.terrainU.u_cellM, range.cellSizeM)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, s.elevation)
      gl.uniform1i(s.terrainU.u_elevation, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, s.basemap)
      gl.uniform1i(s.terrainU.u_basemap, 1)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.terrainIndex)
      gl.drawElements(gl.TRIANGLES, s.terrainCount, gl.UNSIGNED_INT, 0)

      // 水面は地形の後に、同じ頂点で描く（spec S §3 の B の対策）
      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram は WebGL の API で React の hook ではない
      gl.useProgram(s.water)
      gl.uniformMatrix4fv(s.waterU.u_matrix, false, matrix)
      gl.uniform1i(s.waterU.u_size, n)
      gl.uniform1f(s.waterU.u_baseM, scene.minElevation)
      gl.uniform1f(s.waterU.u_elevScale, exaggeration)
      gl.uniform1f(s.waterU.u_depthScale, exaggeration)
      gl.uniform1f(s.waterU.u_minDepth, MIN_DEPTH_M)
      gl.uniform1i(s.waterU.u_debug, debug === 'off' ? 0 : 1)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, s.elevation)
      gl.uniform1i(s.waterU.u_elevation, 0)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, s.depth)
      gl.uniform1i(s.waterU.u_depth, 2)
      if (debug === 'off') {
        gl.enable(gl.BLEND)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      }
      if (debug === 'mask-nodepth') {
        gl.disable(gl.DEPTH_TEST)
        gl.depthMask(false)
      }
      if (params.zfix !== 'none') {
        gl.enable(gl.POLYGON_OFFSET_FILL)
        gl.polygonOffset(params.zfix === 'offset2' ? -2 : -1, params.zfix === 'offset2' ? -8 : -4)
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, s.waterIndex)
      gl.drawElements(gl.TRIANGLES, s.waterCount, gl.UNSIGNED_INT, 0)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      gl.bindVertexArray(null)
      renderTimes.push(performance.now() - start)
    },
    onRemove(_map, gl) {
      const s = state
      if (s === null) return
      gl.deleteProgram(s.terrain)
      gl.deleteProgram(s.water)
      gl.deleteVertexArray(s.vao)
      gl.deleteBuffer(s.terrainIndex)
      gl.deleteBuffer(s.waterIndex)
      for (const texture of [s.elevation, s.depth, s.basemap]) gl.deleteTexture(texture)
      state = null
    },
  }
  map.addLayer(layer)

  return {
    renderTimes,
    setExaggeration(value) {
      // 合格基準 2: 地形と水面の描画に同じ変数を渡す（b.ts と同じく構造上ずれ得ない）
      exaggeration = value
      map.triggerRepaint()
    },
    setDepth(depth) {
      depthData.set(depth)
      depthDirty = true
      map.triggerRepaint()
    },
    setDebug(mode) {
      debug = mode
      map.triggerRepaint()
    },
    whenIdle: () => waitIdle(map),
  } satisfies CandidateHandle
}
