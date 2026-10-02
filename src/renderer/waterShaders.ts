/**
 * 水面の GLSL ES 3.00（#version は付けない。three の RawShaderMaterial が glslVersion: GLSL3 で付ける）。
 * 頂点は格子の局所座標（a_cell）だけを持ち、高さを texelFetch で付ける（spec 05 §3.1。浮動小数点テクスチャの
 * 線形補間の拡張は要らない）。式は waterTextures.ts の waterVertexHeightM・lutIndex と同じ
 */
const PRECISION = `precision highp float;
precision highp int;
precision highp sampler2D;
`

export const WATER_VERTEX = `${PRECISION}
in vec2 a_cell;
uniform mat4 u_matrix;
uniform sampler2D u_elevation;
uniform sampler2D u_depth;
uniform int u_size;
uniform float u_exaggeration;
uniform float u_minDepth;
uniform vec2 u_debug;
uniform sampler2D u_outflowNearest;
uniform float u_outflowMinDepth;
uniform float u_showOutflow;
out float v_depth;
smooth out float v_outflow;
void main() {
  ivec2 cell = clamp(ivec2(a_cell), ivec2(0), ivec2(u_size - 1));
  float z = texelFetch(u_elevation, cell, 0).r;
  float d = texelFetch(u_depth, cell, 0).r;
  v_depth = d;
  // 計測（probe=water。spec 06 §3）: u_debug.x が 1 なら u_debug.y（m。垂直強調の前）だけ持ち上げる。通常は 0.0 を足すだけ
  float lift = u_debug.x > 0.5 ? u_debug.y : 0.0;
  // 流出の帯（spec 07 §5.2）: このセルが帯の中なら、u_outflowNearest に最も近いマスクのセルの平らな添字 k がある
  // （帯の外は -1）。k のセルの水深が u_outflowMinDepth 以上なら 1。非表示の間と計測の間（u_debug.x）は読まず 0
  // （計測のマゼンタと混ぜない）。頂点はセルの中心にあり、補間した値を 0.5 で切ると 4 辺とも同じ太さの帯になる
  float outflow = 0.0;
  if (u_showOutflow > 0.5 && u_debug.x <= 0.5) {
    int k = int(texelFetch(u_outflowNearest, cell, 0).r);
    if (k >= 0 && texelFetch(u_depth, ivec2(k % u_size, k / u_size), 0).r >= u_outflowMinDepth) {
      outflow = 1.0;
    }
  }
  v_outflow = outflow;
  // 高さ = (標高 + 水深) × 垂直強調。1 cm 未満の頂点は地形と同じ高さに置く（帯も持ち上げない。05 の polygonOffset で足りる）
  float h = (z + (d >= u_minDepth ? d : 0.0) + lift) * u_exaggeration;
  gl_Position = u_matrix * vec4(a_cell + 0.5, h, 1.0);
}
`

export const WATER_FRAGMENT = `${PRECISION}
in float v_depth;
smooth in float v_outflow;
uniform float u_minDepth;
uniform sampler2D u_lut;
uniform float u_bandsPerM;
uniform int u_maxIndex;
uniform float u_epsilon;
uniform float u_alpha;
uniform vec2 u_debug;
uniform vec4 u_outflowColor;
out vec4 fragColor;
void main() {
  // 流出の帯（spec 07 §5.2、推奨 R5）: 補間した v_outflow が 0.5 を超えるところは、1 cm 未満でも捨てず、
  // 1 cm 以上でも水の色ではなく流出の色（premultiplied）で塗る。捨てないことと塗ることは同じ v_outflow で決める
  if (v_outflow > 0.5) {
    fragColor = u_outflowColor;
    return;
  }
  // 1 cm 未満は描かない（base-spec §30）
  if (v_depth < u_minDepth) discard;
  // 計測（probe=water）: 判定用の不透明のマゼンタ（S の measureWater と同じ色。spec 06 §3）
  if (u_debug.x > 0.5) {
    fragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }
  int k = min(u_maxIndex, int(floor((v_depth + u_epsilon) * u_bandsPerM)));
  vec3 rgb = texelFetch(u_lut, ivec2(k, 0), 0).rgb;
  // MapLibre のブレンドは premultiplied（ONE, ONE_MINUS_SRC_ALPHA）
  fragColor = vec4(rgb * u_alpha, u_alpha);
}
`
