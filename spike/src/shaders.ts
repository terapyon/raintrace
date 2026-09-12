/**
 * 地形と水面の GLSL ES 3.00（#version は付けない。three の RawShaderMaterial は glslVersion: GLSL3 で
 * 前に付け、B-raw は自分で付ける）。A の水面・B・B-raw で共通にし、候補の差を描き方だけにする（計画 D7）。
 * 頂点はセル番号（a_cell）だけを持ち、高さは texelFetch で付ける（spec 05 §3.1）
 */

const PRECISION = `precision highp float;
precision highp int;
precision highp sampler2D;
`

/** 高さ（m）= (標高 − 基準) × u_elevScale + 水深 × u_depthScale。A' は標高に倍率が入っているので u_elevScale = 1 */
export const WATER_VERTEX = `${PRECISION}
in vec2 a_cell;
uniform mat4 u_matrix;
uniform sampler2D u_elevation;
uniform sampler2D u_depth;
uniform int u_size;
uniform float u_baseM;
uniform float u_elevScale;
uniform float u_depthScale;
uniform float u_minDepth;
out float v_depth;
void main() {
  ivec2 cell = clamp(ivec2(a_cell), ivec2(0), ivec2(u_size - 1));
  float z = texelFetch(u_elevation, cell, 0).r;
  float d = texelFetch(u_depth, cell, 0).r;
  v_depth = d;
  // 1cm 未満の頂点は地形と同じ高さに置く（B では地形と頂点が一致する）
  float h = (z - u_baseM) * u_elevScale + (d >= u_minDepth ? d * u_depthScale : 0.0);
  gl_Position = u_matrix * vec4(a_cell + 0.5, h, 1.0);
}
`

export const WATER_FRAGMENT = `${PRECISION}
in float v_depth;
uniform float u_minDepth;
uniform int u_debug;
out vec4 fragColor;
void main() {
  if (v_depth < u_minDepth) discard;
  // MapLibre のブレンドは premultiplied（ONE, ONE_MINUS_SRC_ALPHA）。u_debug = 1 は判定用の不透明のマゼンタ（計画 D9）
  fragColor = u_debug == 1 ? vec4(1.0, 0.0, 1.0, 1.0) : vec4(0.08, 0.35, 0.75, 1.0) * 0.7;
}
`

/** B・B-raw の地形。縁（範囲の外の頂点）は高さ 0（平面の地図の高さ）まで下ろす。陰影は差分の法線から（計画 D18） */
export const TERRAIN_VERTEX = `${PRECISION}
in vec2 a_cell;
uniform mat4 u_matrix;
uniform sampler2D u_elevation;
uniform int u_size;
uniform float u_baseM;
uniform float u_elevScale;
uniform float u_cellM;
out vec2 v_uv;
out float v_shade;
float heightAt(ivec2 c) {
  return (texelFetch(u_elevation, clamp(c, ivec2(0), ivec2(u_size - 1)), 0).r - u_baseM) * u_elevScale;
}
void main() {
  ivec2 cell = ivec2(a_cell);
  bool ring = any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(u_size)));
  ivec2 c = clamp(cell, ivec2(0), ivec2(u_size - 1));
  float h = ring ? 0.0 : heightAt(c);
  float dx = heightAt(c + ivec2(1, 0)) - heightAt(c - ivec2(1, 0));
  float dy = heightAt(c + ivec2(0, 1)) - heightAt(c - ivec2(0, 1));
  vec3 normal = normalize(vec3(-dx, -dy, 2.0 * u_cellM));
  v_shade = 0.6 + 0.4 * max(dot(normal, normalize(vec3(-0.5, -0.5, 1.0))), 0.0);
  v_uv = (vec2(c) + 0.5) / float(u_size);
  gl_Position = u_matrix * vec4(a_cell + 0.5, h, 1.0);
}
`

export const TERRAIN_FRAGMENT = `${PRECISION}
in vec2 v_uv;
in float v_shade;
uniform sampler2D u_basemap;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(u_basemap, v_uv).rgb * v_shade, 1.0);
}
`
