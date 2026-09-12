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

判定の閾値（計画 D9）: `visibleRatio` の最小が **0.98 以上**、かつ `flickerRatio` の最大が **1% 以下** で合格。閾値の判定に使う場面は **合成の斜面の 1cm の膜**（`water: 'film'`、`spike/e2e/matrix.spec.ts` の `plans`）——手前に遮る地物が無く、可視率が 1 未満になる理由が「z-fighting による沈み込み」しかないため。実データ（`real` の行）は参考値: 実際の池・満水面は周囲の地形（丘・法面）に正当に隠れる部分を含むので、可視率が低くても z-fighting とは限らない（`spike/results/water-a.md` の `real / zfix=offset` は可視率が z によっては 0.001〜0.9 台まで下がるが、これは主に地形による正当な遮蔽）。

所要時間: `pnpm spike:e2e spike/e2e/matrix.spec.ts -g "matrix: a$"` は 4 分 37 秒（1 テスト）。内訳は概算でスクリーンショット 128 視点 × idle 1 回、数値の計測 4 通り × 16 視点 × idle 5 回（`mask-nodepth` 1 回・jitter 3 回・`off` に戻す 1 回）で計 約 448 回の idle（見積もり 510 回に近い）。20 分の締め切りに対して余裕があったため、実データの参考値の行は外さずそのまま回した。

## 4. 候補ごとの結果

| 観点 | A | A' | B | B-raw |
|---|---|---|---|---|
| 合格基準 1（1cm の膜: 可視率の最小・ちらつきの最大） | zfix=offset（`polygonOffset(−1, −4)`）で合成の斜面の膜（16 視点、`spike/results/water-a.md`）: 可視率の最小 **0.9986**（z15・倍率 10・pitch 85）、ちらつきの最大 **0.0077%**（z17・倍率 1・pitch 60）。ズーム 4 × 倍率 1・10 の 8 行すべて ○ → **判定 (2) 合格**（規則 1 行目。対策で足りる。offset で足り、offset2（−2, −8）は不要だが同等に合格 = 可視率の最小 0.9987・ちらつきの最大 0.0078%） | | | |
| 合格基準 2（倍率の一致） | Step 8 の目視（`spike/results/sheets/a-synthetic.jpg`）: 3 つの池の縁に沈み込みや隙間は見えず、斜面の膜（下部の台形）はまだらでなく一様、垂直強調 ×10 でも池・膜と地形のずれは見えない（`a.ts` の `setExaggeration` が `map.setTerrain` と `water.setExaggeration` に同じ値を渡す）。Task 2 の表（§5）の bowl（曲面）の `地形 − シミュ × 倍率` は倍率に比例して z15 で 0.018→0.176m、z16 で 0.005→0.046m と増える（LOD の差が倍率に比例）が、膜が乗る slope（平面）では −0.003→−0.029m と小さいまま。地形の生成の修正（terrarium.ts の角合わせ）により、平面では LOD 由来のずれがほぼ残らないことと整合する | | |
| 合格基準 3（fps、自動は参考・実 GPU は手動） | | | | |
| バンドル（gzip） | | | | |
| 複雑さ（行数・回避策の数） | | | | |
| 継ぎ目 | — | — | | |
| z-fighting の対策の効果 | zfix=none は合成の斜面の膜で 8 行中 3 行が ×（z15・z16・z17 の倍率 1。可視率の最小 0.2185、ちらつきの最大 21.09%）、倍率 10 は none でも 8 行とも ○（可視率 0.9985 以上）。zfix=offset にすると 8 行すべて ○（可視率の最小 0.9986、ちらつきの最大 0.0077%）に改善。倍率 1 でだけ none が落ちるのは、深度バッファの精度に対して地形と水面の高さの差（1cm）が相対的に小さいため（倍率 10 では差が 10cm に広がり、offset なしでも深度テストで区別できる） | | |
| Custom Layer の API | 絶対標高。地形の高さは自前で与える（台地で誤差 0.06px 以下、16 通り全て。判定 (1) 合格 → A を A 系の本線にする） | 同じ `mainMatrix` に `queryTerrainElevation` を z として入れても 16 通り全て 0.000px（台地）。判定 (1) 合格のため A 系の副（Task 5 は最小） | | |
| 流れの矢印（symbol レイヤー） | | | — | — |

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

（Task 4 で書く）

## 7. スクリーンショット

（Task 3・5・6・7 で足す。URL は Task 10 で付ける）

- `spike/results/sheets/a-synthetic.jpg`: 候補 A、合成の場面、`water: 'fixed'`（3 つの池 + 斜面の 1cm の膜）、zfix=offset（既定）。64 視点（ズーム 15〜18 × 倍率 1・2・5・10 × pitch 0・45・60・85）
- `spike/results/sheets/a-real.jpg`: 候補 A、実データの場面（渋谷駅付近の DEM1A 実タイル 9 枚）、`water: 'fixed'`（満水）、zfix=offset。同じ 64 視点。無効セル（線路沿い、02 の手動確認で 0.2%）の隣接セルで `v_depth` の補間が z=0 まで落ちる細い三角形が、特にズーム 15・16 の広い範囲で黒い針状のノイズとして多数現れている（§11 の未確認の事項に記載済みの懸念が実データで実際に発生することを確認。B・B-raw や次の Task で対処が要る）

## 8. 推奨と理由

（Task 10 で書く）

## 9. tech-spec §5.5 の改訂案（T9）

（Task 10 で書く）

## 10. 05 への申し送り

（Task 10 で書く）

## 11. 未確認の事項

- raster-dem の `encoding: 'custom'`（GSI の係数 655.36・2.56・0.01）で `addProtocol` を省く方法は試していない。正の標高だけなら線形に読めるが、負の標高と無効値（2^23）で崩れる
- B・B-raw の流れの矢印（インスタンス描画）は比べていない（05 で作る。計画 D20）
- 無効セルを含む DEM: 無効の頂点（標高 0・水深 0）が水のある有効セルの隣にあると、`v_depth` の補間で細い三角形が z = 0 まで落ちる。05 では、無効の頂点の高さを隣の有効セルに寄せるか、その三角形を捨てる必要がある。実データ（渋谷の実タイル）には無効セルがある（02 の手動確認で 0.2%、線路に沿った線）ので、`real` のコンタクトシートで現れたかどうかと、そのコマを書く
