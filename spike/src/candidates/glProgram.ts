/** 生の WebGL2 の補助（B-raw）。three を使わないとき、自分で書く必要があった分がこのファイル */

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (shader === null) throw new Error('シェーダを作れません')
  gl.shaderSource(shader, `#version 300 es\n${source}`)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`シェーダのコンパイルに失敗: ${gl.getShaderInfoLog(shader) ?? ''}`)
  }
  return shader
}

export function compileProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const program = gl.createProgram()
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex))
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment))
  gl.bindAttribLocation(program, 0, 'a_cell')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`プログラムのリンクに失敗: ${gl.getProgramInfoLog(program) ?? ''}`)
  }
  return program
}

export function uniformLocations<T extends string>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly T[],
): Record<T, WebGLUniformLocation | null> {
  const out = {} as Record<T, WebGLUniformLocation | null>
  for (const name of names) out[name] = gl.getUniformLocation(program, name)
  return out
}

/** 1 チャンネルの浮動小数点のテクスチャ（R32F）。texelFetch で読むので補間とミップマップは要らない */
export function createFloatTexture(
  gl: WebGL2RenderingContext,
  n: number,
  data: Float32Array,
): WebGLTexture {
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, n, n)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, n, gl.RED, gl.FLOAT, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}
