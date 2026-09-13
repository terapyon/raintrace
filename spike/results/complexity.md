# 複雑さ（行数・回避策の数、テストを含めない）

行数の出典: `wc -l spike/src/candidates/a.ts spike/src/candidates/terrarium.ts spike/src/candidates/threeWater.ts spike/src/candidates/b.ts spike/src/candidates/basemap.ts spike/src/candidates/braw.ts spike/src/candidates/glProgram.ts spike/src/shaders.ts spike/src/gridMesh.ts spike/src/mat4.ts`（本 Task の実測）。A の `resampleHeights`（`a.ts` 71〜120 行、50 行）は `grep -n "^function resampleHeights" -A 200 spike/src/candidates/a.ts | grep -m1 -n "^[0-9]*-}"` で特定した。

| 候補 | ファイル | 行数 | 回避策の数 | 回避策 |
|---|---|---:|---:|---|
| A | a.ts（`resampleHeights` を除く。257 − 50 = 207 行）、terrarium.ts（62 行）、threeWater.ts（168 行） | 437 | 2 | 1. `polygonOffset(−1, −4)`（zfix=offset、`threeWater.ts`）— 深度バッファの精度不足による z-fighting（1cm の膜と地形の高低差が z15〜z17・倍率1で区別できない）への対策（§4「合格基準1」・「z-fighting の対策の効果」）。2. `sampleZ17Corner`（`terrarium.ts`）— 出力画素に「z17 のセル中心 + 0.5」をそのまま書くと、MapLibre の `DEMData.sampleBilinear`（頂点＝タイル角の連続座標として補間、0.5 の補正なし）の解釈とずれ、地形が最大1画素ぶん南東にずれて（10%の斜面で z15 換算0.44m）1cm の膜が「浮く」形になる問題への対策。角の位置の高さを双線形で求め直して書く（§5「地形の生成の修正」） |
| A' | A（437 行）＋ `resampleHeights`（50 行） | 487 | 3 | A の 2 つ（`polygonOffset`、`sampleZ17Corner`）に加え、3. `resampleHeights` のズームの探索（`a.ts`）— `Map.queryTerrainElevation` は呼ぶたびに現在の視点が覆うタイルを数え直すため全セルにそのまま使うと非常に重い。3点のチェックセルで `Terrain.getElevationForLngLatZoom` と `queryTerrainElevation` が一致する DEM のズームを探し、見つかればそのズームで全セルを直接読み、見つからなければ全セルで `queryTerrainElevation` を呼ぶフォールバックに落ちる。**速い経路でも z15 で平均123.0ms・最大156.1ms（tech-spec §14.1 の 50ms 超過）、フォールバック経路は最大30392.8ms（z18、50ms の600倍超）**——効果の乏しい回避策である点も含めて1件として数える |
| B | b.ts（193 行）、basemap.ts（33 行） | 226 | 2 | 1. `polygonOffset`（zfix=offset、`b.ts` の `waterMaterial`）— A と同じ z-fighting 対策（B は地形・水面が同じ頂点・標高テクスチャを共有する構造でも、`renderOrder` と頂点共有だけでは防げないと判明。§4「z-fighting の対策の効果」）。2. `maskedGridIndices`／`skirt` パラメータ（`b.ts`。実体は共通の `gridMesh.ts`）— シェーダに無効セルの入力が無いため、無効セルにかかる四角形を地形・水面の両方の index から落とし、標高0へ落ちる巨大な尖りを防ぐ（§10「B の無効セルの対策」。対策の前後比較は未実施） |
| B-raw | braw.ts（251 行）、glProgram.ts（65 行）、basemap.ts（33 行） | 349 | 6 | B と同じ2つ（`polygonOffset`〈`braw.ts`〉、`maskedGridIndices`／`skirt`〈`braw.ts`〉）に加え、three が暗黙に肩代わりしていた GL 状態を自前で設定・後始末する4件（Task 7、fix round 1 で判明。RS-2 の判断材料）: 3. 背面カリング（`gl.enable(CULL_FACE); gl.cullFace(BACK); gl.frontFace(CCW)`、`braw.ts` 158〜160行）— three の `RawShaderMaterial` は既定 `side: FrontSide` で背面カリングが有効だが、braw で最初 `gl.disable(CULL_FACE)` のまま描いたところ real・高倍率で B と可視率が大きくずれた（裏面の三角形が遮蔽に影響）。4. `UNPACK_COLORSPACE_CONVERSION_WEBGL` を `NONE` に設定（`braw.ts` 112行）。5. 再アップロード時に `UNPACK_FLIP_Y_WEBGL`・`UNPACK_PREMULTIPLY_ALPHA_WEBGL` を `false` に設定（`braw.ts` 106〜107・144〜145行）。6. 明示的なリソースの後始末（`onRemove`）— 頂点バッファ（`gl.deleteBuffer(s.cells)`、`braw.ts` 224行）と、リンク後のシェーダ（`gl.detachShader`／`gl.deleteShader`、`glProgram.ts` 32〜35行）。**fix round 1 で訂正**: 当初の版は `cells` バッファを `GlState` に保持せず削除されず、シェーダも削除していなかった——「すべて自分で呼ぶ」という記述自体が誤りだった。手作業の後始末が漏れやすいこと自体を RS-2 の証拠として記録する。B・A では three の `geometry.dispose()`／`material.dispose()`／`resetState()` がこれを一括で肩代わりする |
| 共通 | shaders.ts（83 行）、gridMesh.ts（72 行）、mat4.ts（52 行） | 207 | — | — |

**凡例（何を回避策 1 件と数えるか。Task 10 で追記、Task 9 のレビューの数え直しによる）**: 回避策 1 件は、素直に書くと誤った絵・エラーになる問題を避けるために足した、独立に外せる対策 1 つ。spec S §2 が候補の方式として定めている処理（A の `addProtocol` での Terrarium への変換、B のベースマップのテクスチャ化）は、上の表（粒度 1）では数えない。どの候補も同じ粒度で数えるため、2 通りを並べる。

| 候補 | 粒度 1（上の表。方式そのものは数えない） | 粒度 2（方式の処理も 1 件ずつ数える） |
|---|---:|---|
| A | 2 | 3: `addProtocol` の Terrarium への変換、角の合わせ方（`sampleZ17Corner`）、`polygonOffset` |
| A' | 3 | 4: A の 3 つ + `resampleHeights` |
| B | 2 | 5: ベースマップの合成（`composeBasemap`）、縁（skirt）、基準の標高（`u_baseM` = `scene.minElevation`）、無効セルのマスク（`maskedGridIndices`/`ringCellValid`）、`polygonOffset` |
| B-raw | 6 | 9: B の 5 つ（同じ共有コードを呼ぶだけ）+ GL の状態の 4 件 |

どちらの粒度でも B-raw − B は 4（6 − 2、9 − 5）。B と B-raw が共有する部分は両方に同じだけ足されるので、差は粒度によらない。

**参考（暗黙の依存、回避策には数えない）**: B-raw は `blendEquation`・`colorMask`・stencil・scissor・`depthRange`・その他の `UNPACK_*` の既定を MapLibre 6.6.0 から暗黙に引き継ぐ（three なら `resetState()` が明示する）。これは「対策として書いたコード」ではなく「書かなかったことで生じる暗黙の依存」なので回避策の数には含めないが、RS-2（three を採るかどうかの判断）の材料として §4・§10 に記録済み。
