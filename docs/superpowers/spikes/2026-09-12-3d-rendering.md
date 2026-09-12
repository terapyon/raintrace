# Spike S: 3D 描画方式の比較 — 報告

- Status: 下書き（spike/3d-rendering で書き足している）
- 日付: 2026-09-12（開始）
- spec: `docs/superpowers/specs/2026-09-10-S-3d-rendering-spike-design.md`
- 計画: `docs/superpowers/plans/2026-09-12-S-3d-rendering-spike.md`
- コード: ブランチ `spike/3d-rendering`（マージしない）

## 1. 結論

（Task 10 で書く）

## 2. 環境

| 項目 | 値 |
|---|---|
| 起点のコミット | f199a02 |
| MapLibre GL JS | 6.6.0 |
| three | 0.185.1（@types/three 0.185.4、推移的依存 6 個: @dimforge/rapier3d-compat・@tweenjs/tween.js・@types/stats.js・@types/webxr・fflate・meshoptimizer。pnpm-lock.yaml による。開発時のみで、バンドルには入らない） |
| three の扱い | スパイクのブランチ（`spike/3d-rendering`）だけの依存。`main` には入っていない |
| 自動の計測 | Playwright 1.62.1 の Chromium、`--enable-unsafe-swiftshader`、960 × 600、deviceScaleFactor 1 |
| 本番のバンドル（スパイクの前） | 初期ロード 388.7 KB / 総量 525.0 KB |

## 3. 判定の方法

- 入力: 合成の場面（計画 D4）と、実データの場面（渋谷駅付近の DEM1A の実タイル 9 枚。`spike/fixtures/gsi/`、取得日と出典は同じ場所の README。範囲の最低・最高の標高、無効セル、満水の最大の水深は `spike/results/real-scene.md` の値を Task 1 Step 14 で写す）

**合格基準 2（1cm の膜の可視率・ちらつき）の数値の測り方（`spike/src/capture.ts`、計画 D9）**: `WaterMeasure` の 4 項目。

- `footprintPx`: 深度テストを切り、水面を不透明のマゼンタで描いたときの画素数（drawingBuffer の画素。水面のシェーダの `discard` は効くので、1cm 未満の場所は含まない）。地形に隠れているかどうかに関係ない、水面そのものの広さ
- `visibleRatio`: 深度テストを戻して同じ場所を描いたときに見えた画素数 ÷ `footprintPx`。1 に近いほど、地形に隠れず・沈んでいない
- `interiorPx`: `footprintPx` の縁を 2 画素だけ収縮（erode）した内側の画素数。縁のアンチエイリアスや 1px 単位のジャギーをちらつきと誤認しないため
- `flickerRatio`: `interiorPx` のうち、bearing を ±0.002° だけ動かした 3 枚（0・+0.002・−0.002）で見え方（見える/見えない）が変わった画素の割合。遠くの物体ほど 1px の視点移動で大きく動くので、内側だけに絞ることで「本当に不安定な z-fighting」と「画素の端の移動」を分ける

判定の閾値（計画 D9）: `visibleRatio` の最小が **0.98 以上**、かつ `flickerRatio` の最大が **1% 以下** で合格。閾値の判定に使う場面は **合成の斜面の 1cm の膜**（`water: 'film'`、`spike/e2e/matrix.spec.ts` の `plans`）——手前に遮る地物が無く、可視率が 1 未満になる理由が「z-fighting による沈み込み」しかないため。

`visibleRatio` は一方向にしか効かない指標であることに注意する: 遮蔽が正しく起きるべき場所で水面が地形を突き抜けて見えてしまうケースはこの計測では検出できない一方、遮るものが無い平面では、より強い `polygonOffset` ほど可視率が同じか高くなりやすい。したがって §4 の「offset2（−2, −8）の可視率が offset（−1, −4）よりわずかに高い」こと自体は対策の優劣を意味しない——両方とも判定 (2) に合格しており、本番には副作用の小さい弱い方（offset）を使うのが妥当な方向。

実データ（`real` の行）の値は参考値: 実際の池・満水面は周囲の地形が正当に隠す分を含む（`spike/results/water-a.md` の `real / zfix=offset` は可視率が z によっては 0.001〜0.9 台まで下がる）。ただし、この可視率の低さの内訳を地形による正当な遮蔽だけと決めつけることはできない: 無効セル周辺の水面のスライバー（§7・レビュー Important 2 参照。地中に潜っていて見えない分を含みうる）や、曲面（すり鉢）での LOD 由来の沈み込み（§4・レビュー Important 1 参照）も混じり得るため、内訳を切り分けていない参考値として扱う。

所要時間: `pnpm spike:e2e spike/e2e/matrix.spec.ts -g "matrix: a$"` は 4 分 37 秒（1 テスト）。内訳は、スクリーンショット 128 視点（64 視点 × 2 場面）× idle 1 回（`setView` の中の 1 回）と、数値の計測 4 通り × 16 視点 × idle 6 回（`setView` の 1 回 + `measureWater` の 5 回: `mask-nodepth` 1・jitter 3・`off` に戻す 1）で、128 + 64 × 6 = **512 回**の idle（見積もり 510 回とほぼ一致）。実測 277 秒 ÷ 512 ≈ **0.54 秒/idle**（想定の 0.5〜2 秒の範囲内）。20 分の締め切りに対して余裕があったため、実データの参考値の行は外さずそのまま回した。

## 4. 候補ごとの結果

| 観点 | A | A' | B | B-raw |
|---|---|---|---|---|
| 合格基準 1（1cm の膜: 可視率の最小・ちらつきの最大） | zfix=offset（`polygonOffset(−1, −4)`）で合成の斜面の膜（16 視点、`spike/results/water-a.md`）: 可視率の最小 **0.9986**（z15・倍率 10・pitch 85）、ちらつきの最大 **0.0077%**（z17・倍率 1・pitch 60）。ズーム 4 × 倍率 1・10 の 8 行すべて ○ → **判定 (2) 合格 = 深度の精度（平面の膜）**（規則 1 行目。offset で足り、offset2（−2, −8）は不要だが同等に合格 = 可視率の最小 0.9987・ちらつきの最大 0.0078%。`visibleRatio` は一方向の指標なので「offset2 が僅かに高い」ことは対策の優劣を意味しない。§3 参照）。**この合格の射程**: 膜は平面（slope）に乗っており、Task 2 の地形の生成の修正（§5）により平面の LOD/mesh のずれは 1cm 未満（slope の d は倍率 1 で −0.003m・倍率 10 で −0.029m、いずれも `0.01 × 倍率` を下回る＝規則の 2・3 行目「LOD による沈み込み」は本計測では構造上起こり得ない）。曲面（すり鉢、bowl）での LOD の沈み込みは対象外で、Task 2 の bowl の d は z15 で `0.01 × 倍率` を超える（+0.018m at ×1 > 0.01m、+0.176m at ×10 > 0.1m。正の d は MapLibre の地形がシミュレーションより高いことを意味し、すり鉢の縁で膜が沈む向き）。A' の論点として Task 4 の配分で扱う。Terrarium の量子化バイアス（§5）により slope の d は常に負（terrain がわずかに低い）ので、実効のクリアランスは倍率 1 で約 1.3cm（膜 10mm + バイアス 3mm）、倍率 10 で約 12.9cm（100mm + 29mm）と名目よりわずかに広いが、それでも zfix=none は倍率 1 で不合格のままなので、対策の効果は深度バッファの精度の問題であるという結論を変えない。**曲面（M1、`bowl-film.md`）**: すり鉢の面だけに 1cm の膜を乗せ、A・A' を zfix=offset・16 視点（MEASURE_VIEWS）で比較。**A は 8 行中 5 行が ×**（z15/z16/z17 の倍率 10、z18 の倍率 1・10。可視率は 0.21〜0.33 まで低下）→ **A 系は曲面で合格基準 1 を満たさない**。A の × の行と「d が膜を超える」（Task 2、bowl の中心の d が `0.01 × 倍率` を超える）行は一致しない: 一致するのは z15・倍率10（d=+0.1756m）の 1 行だけで、残り 4 つの × 行（z16×10: d=+0.0462m、z17×10: d=−0.0221m、z18×1: d=−0.0022m、z18×10: d=−0.0221m）はいずれも d が閾値を超えていない（z17・z18 では d はむしろ負）。逆に z15×1（d=+0.0176m > 0.01m）は d が超えているのに ○ のまま。→ **中心 1 点の d では曲面の沈み込みを説明できず、原因は未確定**（すり鉢の面全体に膜が乗るのに対し、d はすり鉢の中心 1 点の値でしかないため） | 曲面（M1、`bowl-film.md`）: **A' も 8 行中 5 行が × で、A と完全に同じ行のパターン**（z15/z16/z17 の倍率 10、z18 の倍率 1・10）。可視率も A とほぼ同水準（例: z15×10 は A 0.3208 に対し A' 0.3011）。→ **A' でも直らない = A 系は曲面で合格基準 1 を満たさない**。平面（斜面）の膜の数値計測（`water-a2.md`、zfix=offset・offset2、16 視点）は、A' の視点ごとの高さの取り直しコスト（下記「複雑さ」参照）により Playwright の 1 テスト 30 分の制限内に完了しなかった（スクリーンショット段階の `a2-synthetic.jpg`・`a2-real.jpg` は完了したが、数値計測の途中で test timeout。§7 参照）。平面での合格基準 1 の数値は本 Task では**未取得**（正直な未完了。再実行はしていない） |
| 合格基準 2（倍率の一致） | Step 8 の目視（`spike/results/sheets/a-synthetic.jpg`）: 3 つの池の縁に沈み込みや隙間は見えず、斜面の膜（下部の台形）はまだらでなく一様、垂直強調 ×10 でも池・膜と地形のずれは見えない（`a.ts` の `setExaggeration` が `map.setTerrain` と `water.setExaggeration` に同じ値を渡す）。Task 2 の表（§5）の bowl（曲面）の `地形 − シミュ × 倍率` は倍率に比例して z15 で 0.018→0.176m、z16 で 0.005→0.046m と増える（LOD の差が倍率に比例）が、膜が乗る slope（平面）では −0.003→−0.029m と小さいまま。地形の生成の修正（terrarium.ts の角合わせ）により、平面では LOD 由来のずれがほぼ残らないことと整合する | 地形（`map.setTerrain({ exaggeration })`）と水深（シェーダの `u_depthScale`）には A と同じく同じ倍率を掛ける（`a.ts` の `setExaggeration`。分岐は `variant`）。ただし A' の水面の基準の高さはシミュレーションの標高ではなく MapLibre の地形（`Terrain.getElevationForLngLatZoom` / `queryTerrainElevation`、倍率込み）そのものであり、**表示される水面の高さがシミュレーションの標高と食い違う**（tech-spec §5.5 の該当箇所の実測）: `a2-resample.md`（合成・固定の水、64 視点）によると、水のあるセルでの `|地形の高さ ÷ 倍率 − シミュレーションの標高|` の最大は **0.024m**（z15）、z16〜z18 では 0.004〜0.006m。すなわち A' は倍率 2 で最大約 5cm、倍率 10 で最大約 24cm、水面がシミュレーションの水位からずれて見える可能性がある（A' 固有の複雑さ） |
| 合格基準 3（fps、自動は参考・実 GPU は手動） | | | | |
| バンドル（gzip） | | | | |
| 複雑さ（行数・回避策の数） | | 高さの取り直し（`resampleHeights`）が主な複雑さ・回避策: `Map.queryTerrainElevation` は呼ぶたびに現在の視点が覆うタイルを数え直すため、全セル分そのまま呼ぶと非常に重い。回避策は 1 つ（ズームの探索: 3 点のチェックセルで `Terrain.getElevationForLngLatZoom` と `queryTerrainElevation` が一致する DEM のズームを探し、見つかればそのズームで全セルを直接読む。見つからなければ全セルで `queryTerrainElevation` を呼ぶフォールバック）。回避策が効く／効かないの境目はズームに強く依存する（`a2-resample.md`: フォールバックした視点数は z15=0/16、z16=2/16、z17=8/16、z18=15/16 と、ズームが上がるほど悪化）。**取り直しの時間の最大は 30392.8ms**（z18、フォールバック時）で、tech-spec §14.1 の「メインスレッドの最長ブロック 50ms」を **600 倍以上**超える。z15 では平均 123.0ms・最大 156.1ms とまだ許容範囲だが、z16 以降は平均 2.5〜21.7 秒まで悪化する | | |
| 継ぎ目 | — | — | | |
| z-fighting の対策の効果 | zfix=none は合成の斜面の膜で 8 行中 3 行が ×（z15・z16・z17 の倍率 1。可視率の最小 0.2185、ちらつきの最大 21.09%）、倍率 10 は none でも 8 行とも ○（可視率 0.9985 以上）。zfix=offset にすると 8 行すべて ○（可視率の最小 0.9986、ちらつきの最大 0.0077%）に改善。倍率 1 でだけ none が落ちるのは、深度バッファの精度に対して地形と水面の高さの差（1cm）が相対的に小さいため（倍率 10 では差が 10cm に広がり、offset なしでも深度テストで区別できる）。**Task 2 との照合（R3 の 2 つ目の確かめ）**: 膜が乗る slope の d（§5、terrain − sim × 倍率）は倍率 1 で −0.003m・倍率 10 で −0.029m で、いずれも絶対値が `0.01 × 倍率`（0.01m・0.1m）を下回る。LOD/mesh によるずれは 1cm 未満であり、zfix=none で倍率 1 にだけ現れた不合格は LOD ではなく深度精度の問題と判定できる（規則の 2 つ目、R3 と整合） | | |
| Custom Layer の API | 絶対標高。地形の高さは自前で与える（台地で誤差 0.06px 以下、16 通り全て。判定 (1) 合格 → A を A 系の本線にする） | 同じ `mainMatrix` に `queryTerrainElevation` を z として入れても 16 通り全て 0.000px（台地）。判定 (1) 合格のため A 系の副（Task 5 は最小） | | |
| 流れの矢印（symbol レイヤー） | `spike/src/candidates/arrows.ts`（symbol レイヤー、`showArrows`）で計測（`a-arrows.md`）。(a) 矢印は地形の面に載り、垂直強調（1・5・10）に追従する（MapLibre 自身が地形ソースから symbol を自動で地表に載せる。高さの計算は自前でしていない）。(b) 水面の Custom Layer の後（above）・前（below）のどちらに置いても、池（水深 2m）の上では矢印が隠れ、膜（1cm）の上では透けて見える——**レイヤーの描画順（above/below）ではなく、実際の深度差（GL の深度バッファ）で occlusion が決まっている**とみられる | A の矢印は MapLibre 自身の地形ソース（`spike-dem`）に載るだけで、A・A' で同じ地形ソースを共有するため、(b) の関係（池は隠れる・膜は透ける）は A' でも変わらないと**推測**する（A' 固有の検証は行っていない。水面の基準の高さが変わっても、地形上の矢印の高さ自体は変わらないため） | — | — |

## 5. Custom Layer の API（MapLibre 6.6.0）

型（maplibre-gl.d.ts、計画の「事前に確かめた事実」より）:

- `CustomLayerInterface`（7110 行）: `id`、`type: "custom"`、`renderingMode?: "2d" | "3d"`、`render: CustomRenderMethod`、`prerender?`、`onAdd?(map, gl: WebGL2RenderingContext)`、`onRemove?(map, gl)`。`CustomRenderMethod = (gl: WebGL2RenderingContext, options: CustomRenderMethodInput) => void`
- `CustomRenderMethodInput`（6926 行）: `farZ`、`nearZ`、`fov`（ラジアン）、`modelViewProjectionMatrix: mat4`、`projectionMatrix: mat4`、`shaderData: { variantName; vertexShaderPrelude; define }`、`defaultProjectionData: CustomLayerProjectionData`、`getProjectionData(params: CustomLayerProjectionDataParams) => RendererProjectionData`。型の説明: メルカトルでは `projectTile` が 0..1 のメルカトル座標を受け、`renderingMode: "3d"` なら z は等角（x・y と同じ単位）。「行列だけでよければ `defaultProjectionData.mainMatrix`」
- `Map.setTerrain(options: TerrainSpecification | null, styleOptions?): this`、`TerrainSpecification = { source: string; exaggeration?: number }`（既定 1）。`Map.queryTerrainElevation(lngLatLike): number | null` は「海抜の m、垂直強調を掛けた値」。実装は `terrain.getElevationForLngLat(lngLat, transform)` で、今の視点の覆うタイルの最大ズームの DEM から取る（LOD に依存する）。`Map.getCenterElevation(): number` がある
- `addProtocol(customProtocol: string, loadFn: AddProtocolAction): void`、`AddProtocolAction = (requestParameters: RequestParameters, abortController: AbortController) => Promise<GetResourceResponse<any>>`、`GetResourceResponse<T> = ExpiryData & { data: T }`

**地形の生成の修正（レビュー Important 2）**: `spike/src/candidates/terrarium.ts` の `terrariumTile` は当初、出力の画素 px に「z17 のグローバルピクセル px + 0.5（セルの中心）」の値をそのまま書いていた。しかし MapLibre の `DEMData.sampleBilinear`（`maplibre-gl-shared-dev.mjs` 17035 行、`cx = Math.floor(x)`、`tx = x − cx`、0.5 の補正なし）は、画素 px の値を「タイルの角からの連続座標 px（頂点。セルではない）の高さ」として扱う。この食い違いにより、z17 で 0.5 画素、z ≤ 16 ではさらに「親画素の中心」に丸め込む floor でもう 0.5 画素、合わせて最大 1 画素分、地形が南東にずれていた（10% の斜面で MapLibre の地形がシミュレーションより低く出る一方向の誤差。z15 で 0.44m、z16 で 0.245m、z17 pitch 0 で 0.148m、z17 pitch 60・z18 で 0.050m）。1cm の膜はこの斜面の上に乗るので、直さないと A の膜が「浮く」形になり、z-fighting ではなく可視率の観点で判定 (2) が誤った理由で通ってしまう恐れがあった。修正は `terrariumTile` が出力の画素 px に、z17 の連続座標 `(x × 256 + px) × scale`（角の位置。補正なし）の高さを、z17 のサンプラー（セルの中心の値を返す）から双線形で求めて書くようにした（`sampleZ17Corner`、全ズーム共通）。角はちょうど 2 セルの中間になるため重みは常に 0.5（周囲 4 セルの単純平均）になり、これは平面（10% の斜面）では傾きを変えない（線形関数の平均は中点の値と一致する）ため、判定 (1) の合否には影響しない。`spike/src/candidates/terrarium.test.ts` を新しい角の合わせ方に合わせて書き直した（RED: 旧い実装に対して新しいテストを実行すると 2 件が失敗、最大の食い違いは 1540.58m 相当。GREEN: 修正後は 3 件とも合格）。

実測（`spike/results/api-probe.json`、16 通り = zoom {15, 16, 17, 18} × exaggeration {1, 10} × pitch {0, 60}、合成の場面。上記の地形の生成の修正の後の値）:

- `optionKeys`（実際のキー、事前の想定どおり）: `defaultProjectionData`、`farZ`、`fov`、`getProjectionData`、`modelViewProjectionMatrix`、`nearZ`、`projectionMatrix`、`shaderData`
- `nearZ`: 常に 12（16 通り全て同じ）
- `farZ`: 929.85 〜 10045.13（pitch・zoom で変わる）
- `fov`: 常に 0.6435011087932844 rad（≈ 36.87°、固定）
- `mvpEqualsMain`（`modelViewProjectionMatrix` と `defaultProjectionData.mainMatrix` が同じか）: 16 通り全て **false**。矛盾ではない — MapLibre 6.6.0 のソース（`node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs`）を実際に読むと、`modelViewProjectionMatrix` は `transform._viewProjMatrix`（10926 行の getter。x・y はワールドの画素、z は m を `_pixelPerMeter` で画素に直した単位。11190〜11213 行で組み立てる）で、`mainMatrix` は `getProjectionDataForCustomLayer`（11381〜11405 行）が `_viewProjMatrix × calculateTileMatrix(0/0/0) × diag(EXTENT, EXTENT, worldSize / pixelsPerMeter, 1)`（`calculateTileMatrix` は `maplibre-gl-shared-dev.mjs` 19473〜19488 行。タイル 0/0/0 では `diag(worldSize/EXTENT, worldSize/EXTENT, 1)` になるので、まとめると `mainMatrix = modelViewProjectionMatrix × diag(worldSize, worldSize, worldSize/pixelsPerMeter, 1)`）で作る、別の行列。**Task 3・5 への申し送り**: 頂点は D7 のとおり `mainMatrix` だけを使い、z は m × 倍率 × `meterInMercatorCoordinateUnits()` で渡す。`modelViewProjectionMatrix` に頂点を通さない（x・y がワールド画素、渋谷付近で z17 なら約 3 × 10^7 になり、float32 の精度が足りない）

判定 (1) の 16 行（合成の場面、`flat`＝台地の 1 地点、`bowl`＝すり鉢の中心、`slope`＝10% の斜面かつ 1cm の膜の範囲の中の 1 地点。距離は CSS px、`map.project` からの誤差）:

| zoom | 倍率 | pitch | z=0 の距離 | 地形の距離 | シミュの距離 | bowl の 地形−シミュ×倍率 (m) | slope の 地形−シミュ×倍率 (m) |
|---|---|---|---|---|---|---|---|
| 15 | 1 | 0 | 0.289 | 0.000 | 0.000 | 0.018 | −0.003 |
| 15 | 1 | 60 | 17.535 | 0.000 | 0.001 | 0.018 | −0.003 |
| 15 | 10 | 0 | 2.405 | 0.000 | 0.000 | 0.176 | −0.029 |
| 15 | 10 | 60 | 159.292 | 0.000 | 0.008 | 0.176 | −0.029 |
| 16 | 1 | 0 | 1.131 | 0.000 | 0.000 | 0.005 | −0.003 |
| 16 | 1 | 60 | 34.408 | 0.000 | 0.002 | 0.005 | −0.003 |
| 16 | 10 | 0 | 8.107 | 0.000 | 0.001 | 0.046 | −0.027 |
| 16 | 10 | 60 | 287.434 | 0.000 | 0.016 | 0.046 | −0.027 |
| 17 | 1 | 0 | 4.333 | 0.000 | 0.000 | −0.001 | −0.002 |
| 17 | 1 | 60 | 66.318 | 0.000 | 0.003 | −0.002 | −0.003 |
| 17 | 10 | 0 | 24.670 | 0.000 | 0.002 | −0.012 | −0.022 |
| 17 | 10 | 60 | 481.632 | 0.000 | 0.031 | −0.022 | −0.032 |
| 18 | 1 | 0 | 15.989 | 0.000 | 0.001 | −0.002 | −0.003 |
| 18 | 1 | 60 | 123.725 | 0.000 | 0.006 | −0.002 | −0.003 |
| 18 | 10 | 0 | 66.743 | 0.000 | 0.009 | −0.022 | −0.032 |
| 18 | 10 | 60 | 730.601 | 0.000 | 0.061 | −0.022 | −0.032 |

判定 (1) の結果: **16 通りすべてで「シミュ」の列が 1px 以下（最大 0.061px）。判定の規則の 1 行目に当たる → 合格。A を A 系の本線にする**。`mainMatrix` は絶対標高（メルカトルの等角の z）で、MapLibre の地形の高さは含まれない。地形の高さをシミュレーションの標高 × 倍率で自前に与えれば、MapLibre の地形（hillshade・`queryTerrainElevation`）と同じ位置に描ける。「z=0」の列は台地でも 0.289px 〜 730.6px と大きく外れる。「地形」の列（`queryTerrainElevation` の値をそのまま高さにした場合。A' が使う値）は 16 通り全て 0.000px で `map.project` と一致するが、これは判定 (2) にとって A' の前提が成立する証拠ではなく、`map.project` 自身が地形有効時に `_pixelMatrix3D = clipSpaceToPixels × _viewProjMatrix`（同じカメラ行列）へ同じ `terrain.getElevationForLngLat` の値を渡して投影する、という構造上必ずそうなる一致（単位換算の裏付けにしかならない）。判定 (2) の証拠は「z=0」・「地形」・「シミュ」の対比（台地）にある。A'（`mainMatrix` に `queryTerrainElevation` × 倍率を z として入れる）自体は同じ `mainMatrix` を使うので技術的には成立するが、判定 (1) が合格した以上、A を A 系の本線にし、A'（Task 5）は最小の扱いにする。

すり鉢の中心（`bowl`、曲面）と斜面かつ膜の範囲の中の 1 点（`slope`、平面）での LOD のずれ（`queryTerrainElevation` − シミュの標高 × 倍率、ズームごとの最大の絶対値、m。地形の生成の修正の後）:

| zoom | bowl の最大の絶対値 (m) | slope の最大の絶対値 (m) |
|---|---|---|
| 15 | 0.176 | 0.029 |
| 16 | 0.046 | 0.027 |
| 17 | 0.022 | 0.032 |
| 18 | 0.022 | 0.032 |

ズームが上がるほど地形の DEM タイルの解像度が上がり、シミュレーションの標高（z17 のグリッド）との差は bowl（曲面）では縮む。slope（平面）では、地形の生成を角の位置に合わせる修正（上記）によって傾き自体のずれは消えているはずだが、Terrarium の量子化（1/256 m の切り捨て）が倍率倍されて残るため、ズームが上がっても 2〜3cm 程度で頭打ちになる（倍率 1 では 0.002〜0.003m で、量子化の刻みの範囲）。

**MapLibre の地形メッシュの粗さ（判定 (2) 向けの予想）**: MapLibre 6.6.0 の地形は DEM を画素ごとに描くのではなく、タイルあたり `meshSize = 128`（`maplibre-gl-dev.mjs` 10229 行、`Terrain` のコンストラクタ）の固定の格子で頂点を作り（`getTerrainMesh`、10493〜10510 行。`delta = EXTENT / meshSize`、頂点は `(x × delta, y × delta)` の (meshSize + 1)² 個）、頂点の間は線形に補間する。本 Task の raster-dem ソースは `tileSize: 256`（`spike/src/candidates/a.ts`）なので DEM の画素は 256 × 256、メッシュの頂点間隔は 256 ÷ 128 = **2 DEM 画素**（z17 換算で 2 × 0.9704m ≈ 1.94m ≈ 2m。`spike/src/scenes.ts` の `groundResolutionM` の値による）。台地・斜面（平面）ではメッシュの線形補間と実際の地形が一致するため影響しないが、すり鉢・こぶ（曲面）では、地形の生成を角の位置に合わせても、メッシュの頂点間（約 2m 四方）の中では MapLibre 側がなお線形近似になるため、数十 cm 規模の残差が乗る可能性がある。判定 (2) では、この「メッシュの粗さによる残差」と「水面の深度の精度」を混同しないよう、平面（slope）と曲面（bowl）を分けて見る。

Terrarium の刻み（1/256 m ≈ 0.0039 m ≈ 3.9mm、切り捨て）は 1cm の膜（`MIN_DEPTH_M` = 9.9mm、`spike/src/scenes.ts`）の半分未満（3.9mm は 9.9mm の約 40%）で、量子化は常に高さを切り捨てる方向（MapLibre の地形がシミュレーションよりわずかに低くなる、最大で倍率 × 3.9mm）にしか働かないため、A の膜のクリアランスをわずかに広げる向き（A に有利な偏り）になる。A' は `queryTerrainElevation` を高さにも水面にも使うと想定した場合は影響しない（判定 (1) の結果により A' は本線ではないので、これは参考）。

## 6. 1 日目の中間の判定

**判定 (1)（Custom Layer の行列に地形の高さが反映されるか）**: **合格**（`spike/results/api-probe.json`、§5 の 16 行、台地の点）。`mainMatrix` に「シミュレーションの標高 × 倍率」を高さとして投影した列（シミュ列）の `map.project` からの誤差は zoom {15, 16, 17, 18} × 倍率 {1, 10} × pitch {0, 60} の 16 通り全てで 1px 以下（最小 0.000px、最大 **0.061px**、z18・倍率 10・pitch60）。比較のため、高さを 0 とした列（z=0 列）は **0.289〜730.601px** と大きく外れ、`queryTerrainElevation` の値をそのまま高さにした列（地形列）は構造上の一致により 16 通り全て **0.000px**。→ `mainMatrix` は絶対標高で、地形の高さを自前で足せば MapLibre の地形と同じ位置に描ける。

**判定 (2)（A、zfix=offset・offset2 の良い方）**: **合格**（合成の斜面の 1cm の膜、`spike/results/water-a.md`、zoom {15, 16, 17, 18} × 倍率 {1, 10} の 8 行。各行は pitch {60, 85} の悪い方の値）。zfix=none は 8 行中 **3 行が ×**（**z15・z16・z17 の倍率 1** のみ。可視率の最小 0.2185・ちらつきの最大 21.09% はいずれも z15/z16 の倍率 1・pitch85。倍率 10 は 4 ズーム全て ○）。zfix=offset（`polygonOffset(−1, −4)`）は **8/8 ○**（可視率の最小 **0.9986**、ちらつきの最大 **0.0077%**、いずれも z15・倍率10）。zfix=offset2（`polygonOffset(−2, −8)`）も **8/8 ○**（可視率の最小 0.9987、ちらつきの最大 0.0078%）で同等に合格。`visibleRatio` は一方向の指標（§3）なので offset2 がわずかに高いことは優劣を意味せず、副作用の小さい offset を採用する。none が倍率 1 でのみ落ちるのは、slope（膜が乗る平面）の d（地形−シミュ×倍率）が −0.003m/−0.029m といずれも `0.01 × 倍率` 未満（§5）で、LOD ではなく深度バッファの精度の問題であることと整合する。

**射程の注意（Task 3 レビューの申し送り）**: この合格は平面（slope）に乗る 1cm の膜に限る。曲面（すり鉢、bowl）での LOD 由来の沈み込みは、平面の板（`spike/e2e/matrix.spec.ts` の合成場面）では構造上再現できず、本判定では測っていない。Task 2 の bowl の d（地形−シミュ×倍率、§5）は z15 で **+0.018m（倍率1）/ +0.176m（倍率10）** といずれも `0.01 × 倍率` を超え、正の d は MapLibre の地形がシミュレーションより高い＝すり鉢の縁で膜が沈む向きを示す。すなわち spec S の合格基準 1（1cm 以上の水が倍率 1〜10 で沈まない）は、曲面地形では **未検証** のまま残っている。

**表への当てはめ**: 判定 (1) 合格・判定 (2) 合格 → 配分の表（Task 4 Step 1）の **1 行目**。A を A 系の本線にする。Task 6・7 は予定どおり進める。

**配分の追加（controller の裁定、reviewer も合意）**:
1. **Task 5（A'）に曲面の追加測定を足す**: 「最小」（Step 1〜7: 高さの差・取り直しの時間・matrix・流れの矢印）に加え、すり鉢の曲面に 1cm の膜を乗せた合成場面の variant を 1 つ足し、A と A'（zfix=offset(−1,−4)）それぞれについて同じ可視率・ちらつきの方法で `MEASURE_VIEWS`（16 視点）を測る。目的: A が曲面で合格基準 1 を満たすか、A' で直るかという 05（A vs A'）の論点に答えるため。理由は上の射程の注意（bowl の d の予測）。コストはシーン variant 1 つ + matrix の実行 1 回（自動で約 5 分）で、3 日の枠内に収まる。
2. **Task 6 Step 9（B の 1cm の膜の対策の比較: none／offset／offset2）を、条件付きの任意ではなく必須にする**。理由: A の zfix=none が深度精度で不合格だったため、B の「頂点の共有 + 描画順だけ」が polygonOffset なしで足りるかが 05 の対策を直接左右する。matrix は既に 3 通りの zfix を回すので、追加のコストは表を読むだけ。
3. **Task 5（A 系）の中で、実データの針状ノイズ（§7）の切り分けを 30 分の時間箱で試す**: `spike/src/candidates/terrarium.ts` の無効セルの扱いを `?? 0` から「最も近い有効セルの標高で埋める」に変えた実データ場面を 1 回描き、針状ノイズが消えるかを見る。30 分で終わらなければコードを戻し、§11 に「無効セルを 0m にすると A の地形に穴が開く。05 では隣の有効セルの値で埋めるか、無効セルの周りの三角形を捨てる」と、他の原因候補（(2) `tileBlockSampler` の端の clamp、(3) 水面の `v_depth` のスライバー）とあわせて記録する（R4 の項目と統合してよい）。理由: `?? 0` が原因なら本番の A（spec 05 §4）にもそのまま現れるため。

**1 日目の所要時間と日程の見直し**: `git log --format='%h %ci %s' 2695c28..ef8029e` より、計画の反映のコミット（`2695c28`、20:58:04）から Task 3 修正の終わり（`ef8029e`、22:47:24）まで **1 時間 49 分 20 秒**。Task 1〜3 の見積もりの合計（約 2 時間 + 約 2 時間 + 約 3 時間 = 約 7 時間）に対して大幅に短い。Task 4（見積もり約 30 分）を足しても 2 日目の枠には食い込まない。日程（147 行）の打ち切りの規則（各 Task の見積もりを半日以上超えたら打ち切る）は、**使う必要がない**。

## 7. スクリーンショット

（Task 3・5・6・7 で足す。URL は Task 10 で付ける）

- `spike/results/sheets/a-synthetic.jpg`: 候補 A、合成の場面、`water: 'fixed'`（3 つの池 + 斜面の 1cm の膜）、zfix=offset（既定）。64 視点（ズーム 15〜18 × 倍率 1・2・5・10 × pitch 0・45・60・85）
- `spike/results/sheets/a-real.jpg`: 候補 A、実データの場面（渋谷駅付近の DEM1A 実タイル 9 枚）、`water: 'fixed'`（満水）、zfix=offset。同じ 64 視点。黒い針状のノイズが、特にズーム 15・16 の広い範囲で多数現れている。**原因は未確定（レビュー Important 2）**: `a-real.jpg` を見ると、水面の四角形の外側にも暗い筋がある（例: z15 ×1 p0 で右端まで伸びる横線、z16 ×1 p45 の斜めの筋）ため、水面のメッシュだけでは説明できず、地形側の要因が主と考えられる。候補は次の 3 つで、切り分けはできていない: (1) `spike/src/candidates/terrarium.ts` の `sampleZ17Corner`（31〜34 行）が無効値（null）を `?? 0` で 0m に落とし、周囲の有効な標高（約 15〜40m）との間に穴を掘る（倍率 10 では穴が 10 倍深くなる）、(2) `spike/src/scenes.ts` の `tileBlockSampler`（141〜142 行、`clamp(gx, block.x0, block.x1)`）がタイルブロックの端で座標を clamp するため、端の無効セルの 0m が範囲の外まで溝のように延びる、(3) `DemGrid` が無効セルの標高 0・水深 0 を残すことによる水面側の `v_depth` 補間のスライバー（半透明でほぼ地中に潜っており、目立ちにくい）。B・B-raw の `TERRAIN_VERTEX` も同じ `u_elevation` テクスチャを読むため、(1)(2) の地形側の穴があればそのまま引き継ぐ。したがって Task 5〜7 では、水面シェーダ側だけを直すのではなく、地形側（無効値の扱い）も合わせて対処する必要がある（§11 も参照）→ **Task 5 Step 11（M2）で切り分けた。§11 参照**
- `spike/results/sheets/a2-synthetic.jpg`・`spike/results/sheets/a2-real.jpg`（Task 5）: 候補 A'、A と同じ 64 視点。見た目は `a-synthetic.jpg`・`a-real.jpg` と区別が付かない（A' の水面もシミュレーションの標高 + MapLibre の地形の差だけシフトするため、判定 (1) が合格している台地では両者はほぼ一致する）。この 2 枚のスクリーンショット取得後、同じテスト内の数値計測（`water-a2.md`）は A' の高さの取り直しコストにより Playwright のテスト時間の制限（30 分）内に完了せず、`water-a2.{json,md}` は生成されていない（§4 参照。honest gap）
- `spike/results/sheets/a-arrows.jpg`（Task 5 Step 7）: 候補 A、流れの矢印（symbol レイヤー）。1 行目 above（水面の後）、2 行目 below（水面の前）、3 行目 above/viewport 揃え。結論は `spike/results/a-arrows.md` と §4「流れの矢印」の行
- `spike/results/sheets/a-real-needles.jpg`（Task 5 Step 11、M2）: 実データ、上段が無効画素 0m（`demFill=zero`）、下段が最も近い有効画素で埋めた地形（`demFill=nearest`）。**結論: 針状ノイズは穴埋めをしても一切変化しなかった**（`spike/results/a-real-needles.md`）→ 候補 (1)（`?? 0`）・候補 (2)（端の clamp）のどちらでもないと切り分けられたが、針が水面の外にも現れることから候補 (3)（水面のスライバー）だけでも説明できず、正の原因は未確定のまま（DEM1A の実データ自体の細かい起伏をヒルシェードが強調している可能性が高い、という新しい仮説が残る）

## 8. 推奨と理由

（Task 10 で書く）

## 9. tech-spec §5.5 の改訂案（T9）

（Task 10 で書く）

## 10. 05 への申し送り

（Task 10 で書く。以下は Task 5 の時点で分かっている材料）

- **A 系は曲面（すり鉢）で合格基準 1 を満たさない（M1、`bowl-film.md`）**: A・A' とも 8 行中 5 行が ×（z15〜z17 の倍率 10、z18 の倍率 1・10）で、A' に置き換えても直らない。05 で A 系を採る場合は、この曲面での沈み込み（原因未確定。中心 1 点の d では説明できない）への対策が必要になる。B 系を優先する根拠の 1 つになりうる
- 05 で A 系の矢印を symbol レイヤーで描けるか、Custom Layer で水面の高さに描く必要があるか: `a-arrows.md` の (b)（池は隠れる・膜は透ける、above/below の描画順に関わらず）を見る限り、symbol レイヤーは地形の高さにしか載せられず、A・A' の水面の高さには届かない。矢印を水面の少し上に見せたい用途では、symbol レイヤーではなく Custom Layer（three.js 側）で水面と同じ高さ計算を使って自前に描く必要があると考えられる
- A' の高さの取り直し（`resampleHeights`）は、z17・z18 でメインスレッドを最大 30 秒以上ブロックしうる（tech-spec §14.1 の 50ms を 600 倍超える）。05 で A' を採る場合はこのコストの取り扱い（デバウンス、Web Worker 化、フォールバック経路の高速化など）が課題になる
- 実データの針状ノイズ（M2、`a-real-needles.md`）は無効画素の穴埋めでは消えなかった。05 では、地形の無効値の扱い自体は原因から外れたが、正の原因（ヒルシェードが実データの細かい起伏を強調している可能性）を確かめる必要がある

## 11. 未確認の事項

- raster-dem の `encoding: 'custom'`（GSI の係数 655.36・2.56・0.01）で `addProtocol` を省く方法は試していない。正の標高だけなら線形に読めるが、負の標高と無効値（2^23）で崩れる
- B・B-raw の流れの矢印（インスタンス描画）は比べていない（05 で作る。計画 D20）
- 無効セルを含む DEM（R4・M2。Task 5 Step 11 で切り分けた）: `a-real.jpg`（§7）の黒い針状のノイズは、無効画素を最も近い有効画素の標高で埋めても**一切変化しなかった**（`spike/results/a-real-needles.md`、`spike/e2e/needles.spec.ts`）。これにより、候補 (1)（`terrarium.ts` の `?? 0`）・候補 (2)（`scenes.ts` の `tileBlockSampler` の端の clamp）のどちらも原因ではないと切り分けられた。ただし針は水面の矩形の外側にも同じ形で現れており、候補 (3)（水面の `v_depth` 補間のスライバー）だけでも説明できない。自動テストの背景タイル（`tests/e2e/fixtures/tile.png`）は単色で線画を含まないため、GSI 淡色地図の道路・等高線が原因という可能性も排除できる。残る説明は、渋谷駅前の密な人工地物による DEM1A 実データ自体の細かい起伏を `spike-hillshade`（`hillshade-exaggeration: 0.5`）が強調して描いている、というもの（バグではなく正しい地形の陰影の可能性）。正の原因の確定には至らず、05 に持ち越す
