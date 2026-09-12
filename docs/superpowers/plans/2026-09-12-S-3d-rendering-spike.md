# Spike S 3D 描画方式の比較 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 地形と水面の 3D の描き方を 4 つの候補（A・A'・B・B-raw）の最小の試作で比べ、tech-spec §5.5 の合格基準に対する根拠つきの結論と §5.5 の改訂案（T9）を、`docs/superpowers/spikes/2026-09-12-3d-rendering.md` にまとめる。成果物はコードではなく結論である。

**Architecture:** 本番のコード（`src/`）には触れず、`spike/` の下に別の Vite のエントリ（`spike/index.html`、設定は `spike/vite.config.ts`）を作る。1 つのページが URL の引数で候補・場面・視点を切り替え、候補は動的 import で別チャンクにする（バンドルの差を測るため）。入力のグリッドは 02 の部品（`src/dem/gridRange.ts`・`DemGrid.ts`・`GsiDemDecoder.ts`、`src/simulation/terrain/analyzeTerrain.ts`）で渋谷駅付近の DEM1A の実タイル（一度だけ取得してブランチに置く）から組み立て、合成の場面は同じ形の関数で作る。Playwright（ポート 4174）で、視点の組み合わせのスクリーンショットと、水面の「見えている割合」「ちらつき」の数値、fps を自動で取り、実 GPU での fps はユーザーの手動の計測で補う。

**Tech Stack:** TypeScript 6.0、Vite 8.2、MapLibre GL JS 6.6.0（Custom Layer・`setTerrain`・`addProtocol`・`queryTerrainElevation`）、three 0.185.1（A・A'・B のみ）、生の WebGL2（B-raw）、Vitest 4、Playwright 1.62（Chromium、SwiftShader）、Biome 2

**Spec:** `docs/superpowers/specs/2026-09-10-S-3d-rendering-spike-design.md`（あわせて `specs/tech-spec.md` §2・§5.5・§7.7・§14.1・§14.2、spec 05 `docs/superpowers/specs/2026-09-10-05-3d-rendering-design.md`、裁定は `docs/superpowers/specs/2026-09-10-00-overview.md` §6 の RS-1〜RS-3。RS-3 は 2026-09-12 に「04 と並行して今始める」と決まった）

## Global Constraints

- 期間は 3 日（RS-1）。候補ごとの試作は半日〜1 日。スパイクを 05 の本実装にしない（UI・ストア・Worker との接続・クリックの処理・色分けの帯・インスタンス描画の矢印は作らない。A 系の symbol レイヤーの矢印だけは D20 の最小の比較をする）
- この計画は、承認の後に `docs/superpowers/plans/2026-09-12-S-3d-rendering-spike.md` としてスパイクのブランチにコミットしてから Task 1 を始める（コミット: `計画 S: 3D 描画方式の比較のスパイクの実装計画`）。報告の PR にも含める（D13）
- 作業はブランチ `spike/3d-rendering`（worktree `/home/terapyon/dev/terapyon/raintrace/.claude/worktrees/spike-3d-rendering`、f199a02 から）で行う。**このブランチは `main` にマージしない。** 報告だけを、`main` から切った別のブランチの小さな PR で入れる（Task 10）
- 本番のコード（`src/`、`index.html`、`vite.config.ts`、`playwright.config.ts`、`public/`、`tests/`）は変更しない。変更してよい既存のファイルは `package.json`・`pnpm-lock.yaml`・`tsconfig.json`・`vitest.config.ts`・`.gitignore` だけ（どれもこのブランチの中だけの変更）
- 並行する 04 の E2E がポート 4173 を使うので、スパイクの Playwright と preview は **4174 に `--strictPort`** で立てる。E2E は同時に 1 つだけ走らせる
- 新しい依存はスパイクのためだけに `three@0.185.1`（dependencies）と `@types/three@0.185.4`（devDependencies）。`pnpm add -E` で正確な版を固定する。このマシンには公開から 10 日のクールダウン（`minimumReleaseAge: 14400`、strict）が強制されていて、three 0.186.0（2026-09-08 公開）と @types/three 0.186.0（2026-09-11 公開）は使えない。pnpm が新しすぎる版の承認を求めても承認しない。ビルドスクリプトの許可を求められたら `pnpm-workspace.yaml` の `allowBuilds` に `false` で足す
- B-raw は three を import しない。B と B-raw は同じ GLSL（`spike/src/shaders.ts`）を使い、違いを「three の有無」だけにする
- CSP（`public/_headers`、tech-spec §7.7）を、スパイクの dev と preview の応答にも同じ文字列で付ける。CSP を緩めない。違反が出たらそれ自体を結果として記録する
- 品質の関門（このブランチの中）: 各 Task の終わりに `pnpm lint && pnpm typecheck && pnpm test` が通ること。カバレッジは見ない。`pnpm build`（本番のビルド）が変わらないことを Task 1 と Task 9 で確かめる。E2E を回した後は、`pnpm lint` の前に `pnpm exec biome format --write spike/results` を実行する（`spike/results/*.json` は `JSON.stringify` の出力で、Biome の書式と違う。P22）
- 書式は Biome（2 スペース、シングルクォート、セミコロンなし、行幅 100）。`spike/` は `useImportExtensions` の対象外（`biome.json` の overrides のとおり）だが、`src/dem`・`src/simulation` のファイルを import するときはそれらと同じく `.ts` を付ける
- 計画のコードの書式（行幅 100 での折り返しなど）と import の並び（モジュールの順と、名前付き import の中の順）は Biome が決める。`pnpm lint` が書式だけ・並びだけの差分で落ちたら、`pnpm format` で直してよい（`spike/results/*.json` を含む。計画 03 と同じ扱い。P22・S2・S5・G1）。lint の規則の違反（診断）は、書式の直しとは別に原因を直してから進む
- コメント・テスト名・コミットメッセージは日本語。1 Task につき 1 コミット（Task の途中の結果の記録を除く）。コミットの末尾に、実行するモデルの名前の `Co-Authored-By:` を付ける（例: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`。下の各 Task のコミット例では省略しているが、必ず付ける）
- 手動の手順は **【手動・ユーザー】** と明記し、実行役は代わりに行わない。結果が届くまで報告の該当欄は「ユーザーの計測待ち」と書く

## 計画で決めたこと

spec と依頼が決めていない細部を、最小限（YAGNI）で決めた。

| # | 決めたこと | 理由 |
|---|---|---|
| D1 | **1 日目は候補 A から始め、2 つの分かれ目を先に確かめる**（レビュー役の提案）。(1) MapLibre 6.6.0 の Custom Layer が受け取る行列と引数が、`setTerrain` を有効にしたときに地形の高さを反映するか（Task 2）。(2) 地形の上 1cm の水面の z-fighting（深度バッファの精度）と、spec S §3 の対策（水面を後に描き polygonOffset を付ける）（Task 3）。1 日目の終わりの Task 4 で、結果に応じて 2 日目以降の配分を決める（(1) が不合格なら A' を A 系の本線にする。(2) が A 系で見込みなしなら、頂点を共有する B・B-raw に時間を回す） | 候補を分けるのはこの 2 点で、どちらも A で最も早く確かめられる。結果で残りを絞れる |
| D2 | スパイクのコードは `spike/` にまとめ、独自の Vite の設定（`root: spike`、出力 `dist-spike/`）と tsconfig（`spike/tsconfig.json`、ルートの `tsconfig.json` から参照）を持つ。本番の `vite.config.ts` と `index.html` は使わない | 本番のコードとビルドを変えない。`pnpm typecheck`・`pnpm lint` がそのままスパイクも検査する |
| D3 | 1 つのページ（`spike/index.html`）を URL の引数で切り替える: `candidate=a|a2|b|braw`、`scene=synthetic|real`、`water=fixed|film|dynamic`、`exaggeration`、`pitch`、`zoom`、`zfix=none|offset|offset2`、`capture=1`、`skirt=0|1`、`probe=fps`。候補は `import()` で読み、候補ごとのチャンクにする | スクリーンショットの自動化と手動の計測が同じ URL で済む。バンドルの差を候補のチャンクで測れる |
| D4 | 場面は 2 つ。**合成**（`synthetic`）: 渋谷の地点に置いた 500m の範囲に、北側の標高 40m の台地に 3 つのすり鉢（半径 60m・深さ 3m、水深 5cm・50cm・2m の池）、南側に北へ 10% で上る斜面（1cm の膜）。**実データ**（`real`）: 渋谷駅付近（R02-7 の地点。E2E と同じ北緯 35.658°・東経 139.7016°）の 500m の範囲にかかる DEM1A の実タイル 9 枚（z17、x 116398〜116400・y 51622〜51624。中央の 116399・51623 が `tests/fixtures/gsi/` のフィクスチャ）を、Task 1 で地理院から一度だけ取得して `spike/fixtures/gsi/` に置く。ページは本番と同じ URL で取得し、自動の実行では Playwright がこのファイルで応答する。02 の `computeGridRange`・`assembleGrid` で組み立て、水深は 02 の `analyzeTerrain` の満水（fill − 標高）と 1cm の大きい方（すべての有効セルに 1cm 以上の水）。範囲の標高・無効セル・満水の最大の水深は実行時に求めて `spike/results/real-scene.md` に記録し、決め打ちしない | spec S §3（02 が済んでいれば実データ）のとおり（着手前の検査 G2）。1 枚のフィクスチャを繰り返すと、256 セルごとに最大約 12m の人工の段差ができる。タイルをブランチに置けば、自動の実行はネットワークに頼らず決定的になる |
| D5 | 地形の標高は「z17 のグローバルピクセル → 標高」の関数（`ElevationSampler`）で表し、シミュレーションのグリッドも、A の地形タイル（`addProtocol`）も、この 1 つの関数から作る。実データの関数は範囲にかかる 9 枚のタイルから読み、その外はタイルの端の値を延ばす（A の地形が範囲の外で 0m に落ちて段差を作らないように）。A のタイルは、ズーム z のピクセルの中心に当たる z17 のピクセルを 1 点で取る | グリッドと A の z17 のタイルが画素単位で一致するので、A で残るずれは MapLibre の LOD とメッシュによるものだけになる。本番の A は z15 以下で粗い DEM（DEM5・DEM10B）を使うので、このスパイクの A は**最良の場合**である。報告にそう書く |
| D6 | A の `addProtocol` の関数は、Terrarium 形式の RGBA から作った `ImageBitmap` をそのまま返す（PNG に符号化しない）。raster-dem の `tileSize: 256`、`maxzoom: 17`、`encoding: 'terrarium'`。無効値は 0m（spec 05 §4） | MapLibre 6.6.0 の画像の要求（`maplibre-gl-dev.mjs` の `doImageRequest`）は、応答の `data` が `ImageBitmap` ならそのまま使い、raster-dem の `loadTile` も `ImageBitmap` を受ける。符号化の往復を省ける |
| D7 | 描画の行列は `options.defaultProjectionData.mainMatrix`（Float64Array）を使い、グリッドの局所座標（列 + 0.5、行 + 0.5、m）からメルカトルへのモデル行列を JS の倍精度で掛けてから Float32 にして渡す。三つの候補とも同じ `u_matrix` の uniform を使い、three でも `RawShaderMaterial` にこの行列を渡す（three のカメラの行列は使わない） | メルカトル座標（約 0.9）を float32 の頂点に入れると、1 セル（約 3e-8）が精度の限界に近く、頂点が揺れる。行列を 1 つにそろえると、候補の差が「three の有無」と「地形の描き方」だけになる |
| D8 | 水面の頂点シェーダは `高さ = 水深 ≥ 1cm ? 標高 + 水深 : 標高`、フラグメントシェーダは水深 < 1cm を捨てる。1cm の比較には 0.0099 を使う（Float32 の 0.01 の丸めで膜が消えないように）。水面の色は 1 色（青、不透明度 0.7）。5cm 刻みの色分けは作らない | 色分けは 05 の仕事。沈み込みとちらつきの判定には 1 色で足りる |
| D9 | **沈み込みとちらつきを数値でも測る。** `capture=1` のときだけ `preserveDrawingBuffer: true` にし、水面を不透明のマゼンタ（ブレンドなし）で描いた画像から (a) 可視率 = 深度テストありのマゼンタの画素数 ÷ 深度テストなしの画素数、(b) ちらつき = bearing を 0・+0.002°・−0.002° にした 3 枚で、深度テストなしの水面の内側（2 画素削った範囲。遠くの画素の移動をちらつきと取り違えないため）の画素のうち、見え方が変わった画素の割合、を求める。判定は**合成の斜面の 1cm の膜**（遮るものが無い）で行い、閾値は可視率 0.98 以上・ちらつき 1% 以下とする。数値の計測の視点は 16 通り（ズーム 15〜18 × 倍率 1・10 × pitch 60・85。レビューの反映 R1）。実データの場面の値は、手前の地形が正当に隠す分を含むので参考値とする | spec は「並べて比べる」とするが、64 通り × 候補の目視だけでは合否の境目を決めにくい。数値は目視の補助で、判定の根拠を報告に残せる |
| D10 | スクリーンショットの組み合わせは、垂直強調 1・2・5・10 × pitch 0・45・60・85 × ズーム 15・16・17・18 の 64 通りを、場面 2 つ × 候補 4 つで撮る（画面 960 × 600、bearing 0、範囲の中心）。個々の PNG は `spike/out/`（git 管理外）に置き、候補 × 場面ごとに 1 枚の**コンタクトシート**（行 = ズーム × 垂直強調の 16 行、列 = pitch の 4 列、1 コマ 240 × 150、JPEG 品質 70）を Playwright で合成して `spike/results/sheets/` にコミットする（最大 8 枚）。64 枚の PNG を data URI で 1 つの HTML に入れると 20〜30 MB になる。まず `setContent` で試し、1 枚に 1 分以上かかるなら、`out/` に HTML を書いて `file://` で開き、`out/shots/` の PNG を相対パスで読む形（Task 3 Step 7 の `writeContactSheetFromFiles`）に切り替える（レビューの反映 R5） | 数百枚の PNG をコミットしない。1 枚で 1 候補・1 場面の全体を見比べられる |
| D11 | 報告の PR（`main` 向け）には、判断に効いた数枚（6 枚まで、各 200 KB 以下の JPEG）だけを `docs/superpowers/spikes/2026-09-12-3d-rendering/` に入れ、コンタクトシートとコードは `spike/3d-rendering` ブランチのコミットのハッシュ付きの URL で参照する。そのため、ユーザーに `spike/3d-rendering` も push してもらう（Task 10 の引き継ぎ） | `main` を軽く保ちつつ、spec S §4 の「コードはブランチに残し、報告から参照する」を満たす |
| D12 | 報告のファイル名の日付は **2026-09-12**（RS-3 の裁定の日＝スパイクの開始日）に固定する。途中の結果は、各 Task でこのブランチの報告の下書き（同じパス）に書き足し、Task 10 で報告のブランチへ写す | 途中で止まっても結果が残る。パスが全 Task で同じになる |
| D13 | この計画も、報告の PR に含めて `main` に入れる（`docs/superpowers/plans/2026-09-12-S-3d-rendering-spike.md`） | スパイクのブランチはマージしないので、ほかに計画を `main` に残す経路がない |
| D14 | tech-spec §5.5 と spec 05 §4 の**実際の改訂は、この PR では行わない。** 報告に改訂案（T9）の文面を書き、ユーザーの裁定の後に 05 の改訂（R05-3）と一緒に反映する | 推奨はユーザーの裁定の前に確定しない。PR を小さく保つ |
| D15 | fps の自動計測（ヘッドレスの Chromium、SwiftShader）は参考値とし、合否は **【手動・ユーザー】の実 GPU での計測**で決める。60fps の判定は「10 秒間の平均 57fps 以上、かつ 33.4ms を超えたフレームが 1% 以下」とする（画面のリフレッシュレートが 60Hz を超える場合も同じ閾値） | ソフトウェア描画の fps は GPU の性能を表さない。tech-spec §14.1 の「60fps 維持」を、vsync の揺れを許して判定できる形にする |
| D16 | 毎フレーム変わる水深は、スパイク用の Worker が N² の Float32Array（N = 516 で約 1.07MB）を作って転送し、メインが候補の `setDepth` でテクスチャへ上げる（バッファ 2 枚を往復させる）。各候補の Custom Layer の `render` の CPU 時間（アップロードを含む）も記録する | spec S §3 の「1MB の転送とアップロードの負荷」を、05 と同じ経路（Worker → 転送 → `texSubImage2D`）で見る |
| D17 | B の地形は、範囲の最低の標高を基準（高さ 0）にして描き、外周に地面（高さ 0）まで下ろす縁（スカート）を付ける（`skirt=0` で外せる）。範囲の外は MapLibre の平面の地図。ベースマップは淡色地図の z17 のタイルを範囲の画素にそろえて 1 枚の canvas に合成し、テクスチャにする | spec 05 §4 の方式 B のとおり。基準を最低点にすると、平面の地図との段差が最小になる。継ぎ目は縁のあり・なしの 2 枚と、境界での段差（m）で記録する |
| D18 | 地形の見た目の補助として、A には同じ DEM の `hillshade` レイヤー（地形とは別のソース）を、B・B-raw には法線からの簡単な陰影を付ける | 陰影が無いと、淡色地図の上で起伏がスクリーンショットに写らない |
| D19 | 型の確かめのためのユニットテストは、純粋な関数（URL の引数、場面の生成、グリッドとサンプラーの一致、Terrarium の符号化、メッシュの添字、行列の積）にだけ書く。描画は Playwright の数値とスクリーンショットで確かめる | TDD は結論を支える計算の正しさに絞る。描画の単体テストは tech-spec §11.4 のとおり行わない |
| D20 | 流れの矢印（spec 05 §3.3）は、**A 系についてだけ最小の比較をする**（Task 5 Step 7、約 30〜45 分）。04 の `arrows` は使わず、範囲に 20m おきの固定の点（向きは南で一定）の GeoJSON と、ImageData から `addImage` した矢印の symbol レイヤーで描く（`text-field` は使わない。CSP がグリフのサーバーを許していないため）。垂直強調 1・5・10 × pitch 0・60°（ズーム 17）で、(a) 地形の面に載り倍率に従うか、(b) 水面の Custom Layer の前・後に置いたとき水面に隠れるか上に描かれるか、(c) 水面の高さへ上げる手段が 6.6.0 にあるか、を既存のコンタクトシートの仕組みで記録する。B・B-raw のインスタンス描画の矢印は 05 で作るので比べない（報告の §11） | spec 05 §3.3 が、方式 A について S での比較を求めている。04 の出力に依らない固定の点にすれば、スパイクを 05 の実装にせずに済む |

## レビューの反映（2026-09-12）

レビュー役の承認（要修正なし）の際の推奨と軽微な指摘を、次のとおり取り込んだ。

| ID | 内容 | 反映先 |
|---|---|---|
| R1 | 判定 (2) の数値の計測を 16 視点（ズーム 15〜18 × 倍率 1・10 × pitch 60・85）に絞る。64 視点では 1 候補 約 1,500 回の idle（SwiftShader で 13〜50 分）になり、30 分の制限と 3 日に収まらない。スクリーンショットは 64 視点のまま。表の行はズーム × 倍率、閾値は変えない | D9、Task 3 Step 7・8・9、自己レビュー |
| R2 | A' は、`measureWater` の最初の idle の後から終わりまで高さを取り直さない（`freezeElevation`）。ちらつきの 3 枚を同じ高さで比べる。取り直しは視点が変わったときだけ行い、`ResampleInfo` は setView の時の値だけを記録する | Task 5 Step 2（`a.ts`・`capture.ts`・`types.ts`） |
| R3 | 判定 (2) の × の原因を分ける 2 つ目の規則: LOD の食い違いは「高さの差 × 倍率」で増えるので、× が倍率 1 → 10 で増えれば LOD、倍率によらず同じなら深度の精度。Task 2 のすり鉢の差と「1cm × 倍率」の比較で照らし合わせる | Task 3 Step 9 |
| R4 | 報告の §11 に、無効セルの頂点が z = 0 へ落ちる細い三角形（05 で頂点を寄せるか三角形を捨てる。G2 で実データを実タイルに替えたので、無効セル（02 の手動確認で 0.2%）の周りで現れるかを `real` のコンタクトシートで確かめる）を足す | 報告の骨組みの §11、Task 10 Step 4 |
| R5 | コンタクトシートの HTML が重い場合（data URI で 20〜30 MB）の代わりの経路 | D10、Task 3 Step 7 |
| R6 | 報告の §2 に「three はスパイクのブランチだけの依存で、main には入っていない」 | 報告の骨組みの §2 |

## 着手前の検査の反映（2026-09-12）

コントローラーの着手前の検査（`.superpowers/sdd/2026-09-12-S-3d-rendering-spike/preflight-scan.md`）の裁定を、次のとおり取り込んだ。

| ID | 内容 | 反映先 |
|---|---|---|
| P3 | Task 2 の `a.ts` の import から `type Map as MapLibreMap` を外す（Task 5 まで使わず、`noUnusedLocals` で TS6133）。Task 5 Step 2 の import の一覧で足し直す | Task 2 Step 8、Task 5 Step 2 |
| P17 | `dynamicWater.worker.ts` の `let base: Float32Array = new Float32Array(0)`（TS 6.0.3 の既定の型引数で TS2322 になるため） | Task 8 Step 1 |
| G2 | spec S §3（02 が済んでいれば実データ）に合わせ、実データの場面を 1 枚のフィクスチャの繰り返しから、渋谷駅付近の DEM1A の実タイル 9 枚に替える。タイルは 02 の範囲の計算で求めて一度だけ地理院から取得し、`spike/fixtures/gsi/` に README（URL・取得日・出典）と一緒にコミットする。ページは本番と同じ URL で取得し、自動の実行では Playwright がこのファイルで応答する（ネットワークに頼らず決定的）。範囲の標高・無効セル・満水の最大の水深は決め打ちせず、実行時に求めて `spike/results/real-scene.md` に記録する | D4・D5、「事前に確かめた事実」、Task 1（Files・Interfaces・Step 8・10・10b・11・12・14）、報告の骨組みの §3・§11、Task 6 Step 2、Task 8 Step 3、R4 |
| P15 | Task 8 の `main.ts` の最終形も `Partial<Record<CandidateId, …>>` と `load === undefined` の確かめを残す（打ち切りで候補を外しても build と typecheck が通る） | Task 8 Step 3 |
| P20 | `openSpike` の返す配列は後のエラーも受け取り続けるので、呼び出し側は参照を持ち（`lists.push(await openSpike(…))`）、最後に `expect(lists.flat()).toEqual([])` で確かめる（1 回だけ展開して写さない） | `views.ts` の説明、Task 3（`matrix.spec.ts`）、Task 6（`seam.spec.ts`）、Task 8（`fps.spec.ts`） |
| P22・S2・S5・G1 | 書式だけ・import の並びだけの差分は `pnpm format` で直してよい（`spike/results/*.json` を含む）。E2E の後は `pnpm exec biome format --write spike/results` を実行してから `pnpm lint` | Global Constraints |

## 中間の判定の反映（2026-09-12）

1 日目の中間の判定（報告の §6、コミット 88ba736）を受けた、コントローラーの裁定（レビュー役も合意）を次のとおり取り込んだ。

| ID | 内容 | 反映先 |
|---|---|---|
| M1 | 判定 (2) の合格は平面（斜面）の膜に限られ、曲面では Task 2 のすり鉢の d が z15 で `0.01 × 倍率` を超える（+0.018m・+0.176m）。合成の場面に曲面の膜の水（`water=bowlFilm`: すり鉢の中のセルだけに 1cm）を足し、A と A'（zfix=offset(−1, −4)。A' は計測の間 `freezeElevation`）を同じ可視率・ちらつきの方法で 16 視点測る。表（ズーム × 倍率、○/×）と Task 2 の d を並べ、「A は曲面で合格基準 1 を満たすか、A' で直るか」を書く | Task 5 Step 10、「日程」、報告の §4（A・A' の合格基準 1）・§10 |
| M2 | 実データの針状ノイズ（報告の §7）の切り分けを 30 分の時間箱で試す。A の地形だけ無効画素を最も近い有効画素の標高で埋めた場面（`demFill=nearest`）を描き、`a-real.jpg` で針が目立ったコマと並べる。消えれば地形の穴、消えなければ水面のスライバーが原因。時間箱を超えたらコードを戻し、§11 に決まった文面で記録する（R4 の項目と統合） | Task 5 Step 11、報告の §7・§11 |
| M3 | Task 6 Step 9（B の 1cm の膜の対策の比較: none・offset・offset2）を任意から必須にする（matrix は 3 通りを回しているので、表を読んで書くだけ） | Task 6 Step 9 |

## 事前に確かめた事実（2026-09-12、main のチェックアウトの `node_modules` と `pnpm view` で確認）

| 事実 | 計画への影響 |
|---|---|
| three の最新は 0.186.0（2026-09-08 公開、クールダウン内）。0.185.1（2026-07-01 公開）は使える。three 0.185.1 は依存を持たない。`sideEffects: ["./src/nodes/**/*"]`、ESM は `./build/three.module.js` | three 0.185.1 を固定する |
| three は型を同梱しない。@types/three は 0.185.4（2026-08-04 公開）が使える（0.186.0 は 2026-09-11 公開で不可）。@types/three 0.185 は `fflate`・`@types/webxr`・`meshoptimizer`・`@types/stats.js`・`@tweenjs/tween.js`・`@dimforge/rapier3d-compat` に依存する（開発時の型のためだけで、バンドルには入らない） | devDependencies に固定する。推移的依存の数を Task 1 で数えて報告に書く（tech-spec §13.6） |
| `CustomLayerInterface`（maplibre-gl.d.ts 7110 行）: `id`、`type: "custom"`、`renderingMode?: "2d" \| "3d"`、`render: CustomRenderMethod`、`prerender?`、`onAdd?(map, gl: WebGL2RenderingContext)`、`onRemove?(map, gl)`。`CustomRenderMethod = (gl: WebGL2RenderingContext, options: CustomRenderMethodInput) => void` | Task 2 で報告に写す |
| `CustomRenderMethodInput`（6926 行）: `farZ`、`nearZ`、`fov`（ラジアン）、`modelViewProjectionMatrix: mat4`、`projectionMatrix: mat4`、`shaderData: { variantName; vertexShaderPrelude; define }`、`defaultProjectionData: CustomLayerProjectionData`、`getProjectionData(params: CustomLayerProjectionDataParams) => RendererProjectionData`。型の説明: メルカトルでは `projectTile` が 0..1 のメルカトル座標を受け、`renderingMode: "3d"` なら z は等角（x・y と同じ単位）。「行列だけでよければ `defaultProjectionData.mainMatrix`」 | D7 のとおり `mainMatrix` を使う。z の単位と地形の高さの扱いは Task 2 で実測する |
| `drawCustom`（maplibre-gl-dev.mjs 18575 行）は、`mainMatrix` を `transform.getProjectionDataForCustomLayer()` から作る（タイル 0/0/0 の行列に `[EXTENT, EXTENT, worldSize / pixelsPerMeter]` の拡大を掛けたもの）。`renderingMode: "3d"` なら `painter.getDepthModeFor3D()`（地図と深度バッファを共有）、`"2d"` なら読み取りのみ。`render` の後に MapLibre は `context.setDirty()` で自分の GL の状態を戻す | 水面・地形は `"3d"` で描く。GL の状態は three の `resetState()` か自前で毎回設定する |
| `Map.setTerrain(options: TerrainSpecification \| null, styleOptions?): this`、`TerrainSpecification = { source: string; exaggeration?: number }`（既定 1）。`Map.queryTerrainElevation(lngLatLike): number \| null` は「海抜の m、垂直強調を掛けた値」。実装は `terrain.getElevationForLngLat(lngLat, transform)` で、今の視点の覆うタイルの最大ズームの DEM から取る（LOD に依存する）。`Map.getCenterElevation(): number` がある | A' の高さは視点で変わる。Task 5 で、視点を変えたときの値の変化を測る |
| `addProtocol(customProtocol: string, loadFn: AddProtocolAction): void`、`AddProtocolAction = (requestParameters: RequestParameters, abortController: AbortController) => Promise<GetResourceResponse<any>>`、`GetResourceResponse<T> = ExpiryData & { data: T }` | D6 |
| `RasterDEMSourceSpecification` の `tileSize` の既定は 512、`encoding` は `"terrarium" \| "mapbox" \| "custom"`（custom は `redFactor`・`greenFactor`・`blueFactor`・`baseShift`） | `tileSize: 256` を明示する。GSI の値は正の標高なら custom（655.36・2.56・0.01・0）で線形に読めるが、負の標高と無効値（2^23）で崩れるので、spec のとおり変換する（custom は試さず、報告の「未確認」に書く） |
| `MapOptions.maxPitch` の既定は 60（`defaultMaxPitch`）。`canvasContextAttributes?: WebGLContextAttributesWithType` がある | pitch 85° のため `maxPitch: 85` を渡す。D9 の `preserveDrawingBuffer` はここで渡す |
| @maplibre/maplibre-gl-style-spec 26.4.1（MapLibre 6.6.0 が使う版）の `latest.json` の symbol のレイアウトに `symbol-z-elevate` は無い。高さに関わりそうなのは `icon-pitch-alignment`（`map`・`viewport`・`auto`、向きだけ）と paint の `icon-translate`（2 次元のずれ）だけ。`Map.addImage(id, image: StyleImageSource, options?)` の `StyleImageSource` は `ImageData` を受ける | D20 の (c) は「6.6.0 には無い」を前提に、viewport 揃えのコマで確かめるだけにする |
| `Map.project(lnglat)` は、地形が有効なら `terrain.getElevationForLngLat` の高さで画面の位置を求める（dev.mjs 10984 行の `locationToScreenPoint`） | Task 2 の判定 (1) で、`mainMatrix` で投影した点と `map.project` を比べる |
| E2E の `tests/e2e/support/gsi.ts` の `routeGsi(context)` は、淡色地図を `tests/e2e/fixtures/tile.png`、DEM をすべて 1 枚のフィクスチャ（渋谷、z17、116399・51623）で返す。02 の式で求めると、渋谷（北緯 35.658°・東経 139.7016°）の 500m の範囲（z17 のセル 約 0.9704m、N = ceil(500 / 0.9704) = 516、北西端のグローバルピクセル (29798091, 13215405)）は x 116398〜116400・y 51622〜51624 の 9 枚にかかる。02 の手動確認（渋谷駅付近の 500m、`.handoff/02-dem-grid-2d.md`）は標高 8.78〜33.06 m、無効セル 0.2%（線路に沿った線）、最大の窪地の深さ 2.80 m | 淡色地図は `routeGsi` を再利用し、DEM1A はその後に登録する `routeSpikeDem` で `spike/fixtures/gsi/` の実タイルを返す（後に登録した route が先に効く）。02 の手動確認の値は参考にとどめ、実行時の値を記録する（地点の中心が同じとは限らない） |
| `playwright.config.ts` は 4173 で `pnpm preview`（workerd）を立て、Chromium に `--enable-unsafe-swiftshader` を渡す | スパイクは別の設定（4174、同じ起動の引数） |
| `tsconfig.app.json` は `tsconfig.sim.json`・`tsconfig.core.json` を参照して `src/simulation` を import する（参照が無いと `noUncheckedIndexedAccess` で `src/simulation` が落ちる。計画 03 の事実） | `spike/tsconfig.json` も同じ 2 つを参照する |
| CI は `pull_request` と `main` への push で動く | スパイクのブランチの push では CI は動かない（PR を作らない）。報告の PR では動く（ドキュメントだけなので影響なし） |

## ファイル構成

すべてブランチ `spike/3d-rendering` の上（Task 10 の報告のブランチを除く）。

| ファイル | 責務 | Task |
|---|---|---|
| `package.json`・`pnpm-lock.yaml`（変更） | three・@types/three、`spike:*` のスクリプト | 1 |
| `tsconfig.json`・`vitest.config.ts`・`.gitignore`（変更） | spike の参照、テストの対象、`dist-spike/` | 1 |
| `spike/tsconfig.json` | スパイクの型検査（DOM・node・vite/client、sim と core を参照） | 1 |
| `spike/vite.config.ts` | `root: spike`、CSP のヘッダ、チャンクの分け方（map・three） | 1 |
| `spike/playwright.config.ts`、`spike/.gitignore` | ポート 4174 の E2E、`out/` を除外 | 1 |
| `spike/index.html`、`spike/src/main.ts` | ページ。引数の解釈、地図、場面、候補の読み込み、`window.spike` | 1 |
| `spike/src/params.ts`（+ test） | URL の引数 → `SpikeParams` | 1 |
| `spike/src/types.ts` | `Scene`・`ElevationSampler`・`CandidateHandle` などの共通の型 | 1 |
| `spike/src/scenes.ts`（+ test） | 合成の場面と、実データの場面の組み立て（純粋な関数） | 1 |
| `spike/src/demTiles.ts` | 範囲にかかる DEM1A のタイルを本番と同じ URL で取得して復号する | 1 |
| `spike/scripts/dem-tiles.ts`、`spike/fixtures/gsi/`（9 枚と README） | 実タイルの一覧と取得のコマンド（一度だけ）、取得した実タイル | 1 |
| `spike/src/waitIdle.ts` | 1 枚描かせて地図の idle を待つ | 1 |
| `spike/src/mat4.ts`（+ test） | 4 × 4 の行列の積、グリッドのモデル行列、点の投影 | 2 |
| `spike/src/candidates/terrarium.ts`（+ test） | Terrarium の符号化とタイルの RGBA の生成 | 2 |
| `spike/src/candidates/a.ts` | A・A'。地形（`addProtocol`・`setTerrain`・hillshade）、行列の検査（`apiProbe`） | 2、3、5 |
| `spike/src/candidates/arrows.ts` | A の流れの矢印（固定の点の GeoJSON、ImageData の画像、symbol レイヤー） | 5 |
| `spike/src/gridMesh.ts`（+ test） | 格子のメッシュの頂点（セル番号）と添字（内側・縁つき） | 3 |
| `spike/src/shaders.ts` | 地形と水面の GLSL（B と B-raw と A の水面で共通） | 3 |
| `spike/src/candidates/threeWater.ts` | three の水面の Custom Layer（A・A'） | 3 |
| `spike/src/capture.ts` | 画面の取り込み、マスクの画素数、ちらつき | 3 |
| `spike/e2e/support/views.ts`、`spike/e2e/smoke.spec.ts` | 視点の組み合わせとページの操作、ページが開くことと CSP 違反が無いこと | 1、9 |
| `spike/e2e/support/contactSheet.ts` | コンタクトシートの合成 | 3 |
| `spike/e2e/apiProbe.spec.ts` | 判定 (1)（A の行列と地形の高さ） | 2 |
| `spike/e2e/matrix.spec.ts` | 64 通りのスクリーンショット、可視率・ちらつき（候補ごと） | 3、5、6、7 |
| `spike/e2e/resample.spec.ts`、`spike/e2e/stale.spec.ts` | A' の高さの取り直しの時間と食い違い、視点を動かしている間の見え方 | 5 |
| `spike/e2e/arrows.spec.ts` | A の流れの矢印と地形・水面の重なりのコンタクトシート | 5 |
| `spike/e2e/seam.spec.ts` | B 系の範囲の境界（縁あり・なし）と段差の表 | 6、7 |
| `spike/e2e/pick.spec.ts` | 報告に載せる 6 枚 | 10 |
| `spike/src/candidates/basemap.ts` | 淡色地図のタイルを範囲の canvas に合成する（B・B-raw） | 6 |
| `spike/src/candidates/b.ts` | B（three の地形と水面、縁） | 6 |
| `spike/src/candidates/braw.ts`、`spike/src/candidates/glProgram.ts` | B-raw（生の WebGL2） | 7 |
| `spike/src/water/dynamicWater.worker.ts`、`spike/src/water/dynamicWater.ts` | 毎フレーム変わる水深（Worker と転送） | 8 |
| `spike/src/fps.ts`、`spike/e2e/fps.spec.ts` | fps の計測（自動と手動の画面表示） | 8 |
| `spike/scripts/bundle-size.mjs` | 候補ごとのチャンクの gzip の合計と three の差 | 9 |
| `spike/results/*.json`・`spike/results/*.md`・`spike/results/sheets/*.jpg` | 計測の結果（コミットする） | 2〜9 |
| `docs/superpowers/spikes/2026-09-12-3d-rendering.md` | 報告（このブランチで書き足し、Task 10 で報告のブランチへ写す） | 2〜10 |
| 報告のブランチ `docs/S-3d-rendering-report`: 報告・選んだ画像・この計画 | `main` への PR | 10 |
| `/home/terapyon/dev/terapyon/raintrace/.handoff/S-3d-rendering.md`・`S-3d-rendering-pr.md`（git 管理外） | push と PR の手順、PR 本文 | 10 |

### 日程（RS-1 の 3 日）

| 日 | 午前 | 午後 | 終わりに |
|---|---|---|---|
| 1 日目 | Task 1（土台と場面）、Task 2（A の地形と判定 (1)） | Task 3（A の水面と判定 (2)） | Task 4（中間の判定と配分の決定） |
| 2 日目 | Task 5（A'、A の流れの矢印。Task 4 の裁定により「最小」〔Step 1〜7〕＋曲面（bowl）の 1cm 膜の A/A' 追加測定〔Step 10、約 1 時間〕＋実データの針状ノイズの切り分けを 30 分の時間箱で試す〔Step 11〕） | Task 6（B。Task 4 の裁定により Step 9〔1cm の膜の対策の比較〕は必須） | Task 6 の matrix の実行 |
| 3 日目 | Task 7（B-raw） | Task 8（fps）、Task 9（バンドル・複雑さ） | Task 10（報告・PR の準備・引き継ぎ） |

打ち切りの規則（spec S §5 の終了条件）: 各 Task の見積もりを半日以上超えたら、その候補はその時点までの結果で評価し、残りを「未評価（理由）」として報告に書いて次へ進む。3 日目の 15 時に Task 9 を始めていなければ、Task 8 の自動の fps と Task 9 は動いている候補だけで行う。Task 10 は削らない。

---
### Task 1: 土台（依存・Vite と Playwright の設定・ページ・場面）

**1 日目の午前（約 2 時間）。**

**Files:**
- Modify: `package.json`、`pnpm-lock.yaml`、`tsconfig.json`、`vitest.config.ts`、`.gitignore`
- Create: `spike/tsconfig.json`、`spike/vite.config.ts`、`spike/playwright.config.ts`、`spike/.gitignore`、`spike/index.html`
- Create: `spike/src/types.ts`、`spike/src/params.ts`、`spike/src/params.test.ts`、`spike/src/scenes.ts`、`spike/src/scenes.test.ts`、`spike/src/demTiles.ts`、`spike/src/waitIdle.ts`、`spike/src/main.ts`
- Create: `spike/scripts/dem-tiles.ts`、`spike/fixtures/gsi/dem1a-17-<x>-<y>.png`（9 枚）、`spike/fixtures/gsi/README.md`（Step 10b）、`spike/results/real-scene.md`（Step 14 の実行の結果）
- Create: `spike/e2e/support/views.ts`、`spike/e2e/smoke.spec.ts`
- Create: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`（報告の下書きの骨組み）

**Interfaces:**
- Consumes: `computeGridRange(lon, lat, sizeM, z): GridRange`・`GridRange`（`src/dem/gridRange.ts`）、`assembleGrid(range, lookup): AssembledGrid`・`DemTileData`（`src/dem/DemGrid.ts`）、`decodeGsiDem(rgba): DecodedDem`（`src/dem/GsiDemDecoder.ts`）、`TILE_SIZE`（`src/dem/tileMath.ts`）、`analyzeTerrain(grid): TerrainAnalysis`（`src/simulation/terrain/analyzeTerrain.ts`。`fill: Float32Array`）、`createGsiPaleStyle(attribution): StyleSpecification`（`src/map/gsiStyle.ts`）、`routeGsi(context): Promise<GsiCounts>`（`tests/e2e/support/gsi.ts`）、`tilesInPixelRect(rect, z): TileCoord[]`（`src/dem/tileMath.ts`）、`rangePixelRect(range): PixelRect`（`src/dem/gridRange.ts`）、`demTileUrl(dem, tile): string`（`src/dem/demSources.ts`）、`tileKey(x, y): string`（`src/dem/demSelection.ts`）
- Produces（`spike/src/types.ts`）:
  - `type ElevationSampler = (gx: number, gy: number) => number | null`（z17 のグローバルピクセル → 標高 m、null は無効値）
  - `type SceneName = 'synthetic' | 'real'`、`type WaterMode = 'fixed' | 'film' | 'dynamic'`、`type CandidateId = 'a' | 'a2' | 'b' | 'braw'`、`type ZFix = 'none' | 'offset' | 'offset2'`、`type WaterDebug = 'off' | 'mask' | 'mask-nodepth'`
  - `interface Scene { name; center: { lon; lat }; range: GridRange; elevation: Float32Array; validMask: Uint8Array; depth: Float32Array; sample: ElevationSampler; minElevation: number }`
  - `interface View { exaggeration: number; pitch: number; zoom: number }`
  - `interface CandidateHandle { setExaggeration(value: number): void; setDepth(depth: Float32Array): void; setDebug(mode: WaterDebug): void; whenIdle(): Promise<void>; readonly renderTimes: number[] }`
  - `type MountCandidate = (map: MapLibreMap, scene: Scene, params: SpikeParams) => Promise<CandidateHandle>`
  - `interface SpikeGlobal { map; scene; params; candidate: CandidateHandle | null; cspViolations: string[]; setView(view: View): Promise<void> }`（`window.spike`。後の Task で項目を足す）
- Produces（`spike/src/params.ts`）: `interface SpikeParams { candidate: CandidateId | null; scene: SceneName; water: WaterMode; exaggeration: number; pitch: number; zoom: number; zfix: ZFix; capture: boolean; skirt: boolean; probe: 'fps' | null }`、`parseParams(search: string): SpikeParams`
- Produces（`spike/src/scenes.ts`）: `SHIBUYA`、`RANGE_M = 500`、`DEM_Z = 17`、`POND_DEPTHS_M = [0.05, 0.5, 2]`、`FILM_DEPTH_M = 0.01`、`MIN_DEPTH_M = 0.0099`、`shibuyaRange(): GridRange`（合成と実データで共通）、`syntheticSampler(range): ElevationSampler`、`isFilmCell(range, col, row): boolean`、`buildSyntheticScene(water: 'fixed' | 'film'): Scene`、`tileBlockSampler(range: GridRange, tiles: ReadonlyMap<string, DemTileData>): ElevationSampler`、`buildRealScene(range: GridRange, tiles: ReadonlyMap<string, DemTileData>): Scene`
- Produces: `loadDemTiles(range: GridRange): Promise<Map<string, DemTileData>>`（`demTiles.ts`）、`waitIdle(map): Promise<void>`（`waitIdle.ts`）
- Produces（`spike/e2e/support/views.ts`）: `EXAGGERATIONS`・`PITCHES`・`ZOOMS`、`allViews(): View[]`、`spikeQuery(query: Record<string, string | number>): string`、`routeSpikeDem(context): Promise<void>`、`openSpike(page, context, query): Promise<string[]>`（ページのエラーの配列を返す。配列は後のエラーも受け取り続ける）、`setView(page, view): Promise<void>`

- [ ] **Step 0: 本番のバンドルの基準値を控える**

Run: `pnpm build && pnpm size`
Expected: 成功。「初期ロード: 388.x KB / 総量: 525.x KB」前後の 2 つの値を、報告の下書きの「環境」節に書くためにメモする（Task 1 Step 13 と Task 9 で、スパイクの変更の後も同じ値であることを確かめる）

- [ ] **Step 1: three と @types/three を固定の版で入れ、推移的依存を数える**

```bash
pnpm view three time --json | grep -E '"0\.18[5-6]'
pnpm view @types/three time --json | grep -E '"0\.18[5-6]'
pnpm add -E three@0.185.1
pnpm add -DE @types/three@0.185.4
pnpm list @types/three --depth Infinity --parseable | sort -u | wc -l
```

Expected: 0.185.1 は 2026-07-01、0.185.4 は 2026-08-04 の公開（今日 2026-09-12 から 10 日以上前）。install が成功し、`package.json` の dependencies に `"three": "0.185.1"`、devDependencies に `"@types/three": "0.185.4"` が入る。ビルドスクリプトの許可を求められたら、そのパッケージを `pnpm-workspace.yaml` の `allowBuilds` に `false` で足してやり直す。最後のコマンドの行数から、プロジェクトの根と @types/three 自身の 2 行を引いた数を、@types/three の推移的依存の数としてメモする（報告の「環境」の表に書く）。クールダウンで失敗したら、失敗したパッケージと版をメモし、`pnpm view <名前> time` で 10 日以上前の版を選んで固定する（three と @types/three の版は変えない）

- [ ] **Step 2: スクリプト・参照・テストの対象・除外を足す**

`package.json` の `scripts` の末尾（`"deploy:production"` の次）に足す:

```json
    "spike:build": "vite build --config spike/vite.config.ts",
    "spike:preview": "vite preview --config spike/vite.config.ts --port 4174 --strictPort",
    "spike:e2e": "playwright test --config spike/playwright.config.ts"
```

`tsconfig.json` の `references` の末尾に足す:

```json
    { "path": "./spike/tsconfig.json" }
```

`vitest.config.ts` の `include` を次にする:

```ts
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs', 'spike/**/*.test.ts'],
```

`.gitignore` の `dist/` の次の行に足す:

```
dist-spike/
```

`spike/.gitignore`:

```
# 個々のスクリーンショットと Playwright の出力。コミットするのは results/ だけ（計画 D10）
out/
```

- [ ] **Step 3: スパイクの tsconfig・Vite・Playwright の設定を書く**

`spike/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "tsBuildInfoFile": "../node_modules/.tmp/tsc/spike.tsbuildinfo",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["out", "results"],
  "references": [{ "path": "../tsconfig.sim.json" }, { "path": "../tsconfig.core.json" }]
}
```

`spike/vite.config.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// スパイク専用の設定（計画 D2）。本番の vite.config.ts・index.html は使わない
const root = fileURLToPath(new URL('.', import.meta.url))
const headersFile = readFileSync(fileURLToPath(new URL('../public/_headers', import.meta.url)), 'utf8')
// 本番と同じ CSP を dev と preview の応答に付ける（tech-spec §7.7）。緩めない
const csp = /Content-Security-Policy:\s*(.+)/.exec(headersFile)?.[1]?.trim()
if (csp === undefined) throw new Error('public/_headers に Content-Security-Policy がありません')
const headers = { 'Content-Security-Policy': csp }

export default defineConfig({
  root,
  publicDir: false,
  // HMR の WebSocket は CSP の connect-src に当たりうるので切る（スパイクでは再読み込みで足りる）
  server: { headers, hmr: false },
  preview: { headers },
  worker: { format: 'es' },
  build: {
    outDir: fileURLToPath(new URL('../dist-spike', import.meta.url)),
    emptyOutDir: true,
    manifest: true,
    rolldownOptions: {
      output: {
        // three を 1 つのチャンクにまとめ、候補のチャンクとの差を測れるようにする（Task 9）
        codeSplitting: {
          groups: [
            { name: 'map', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 20 },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
})
```

`spike/playwright.config.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

// 04 の E2E が 4173 を使うので、スパイクは 4174（Global Constraints）
const port = 4174

export default defineConfig({
  testDir: './e2e',
  outputDir: './out/test-results',
  // 64 通りの視点を 1 つのテストで回すので長くとる
  timeout: 30 * 60_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: 'pnpm spike:build && pnpm spike:preview',
    // 既定ではこの設定のディレクトリで動くので、リポジトリの根にする
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 960, height: 600 },
        deviceScaleFactor: 1,
        // GPU の無い環境でも WebGL を SwiftShader で動かす（本番の playwright.config.ts と同じ）
        launchOptions: { args: ['--enable-unsafe-swiftshader'] },
      },
    },
  ],
})
```

- [ ] **Step 4: 共通の型を書く**

`spike/src/types.ts`:

```ts
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { GridRange } from '../../src/dem/gridRange.ts'
import type { SpikeParams } from './params'

/** z17 のグローバルピクセル（整数）→ 標高（m）。null は無効値（計画 D5） */
export type ElevationSampler = (gx: number, gy: number) => number | null

export type SceneName = 'synthetic' | 'real'
export type WaterMode = 'fixed' | 'film' | 'dynamic'
export type CandidateId = 'a' | 'a2' | 'b' | 'braw'
/** z-fighting の対策（spec S §3）。offset は水面に polygonOffset(−1, −4)、offset2 は (−2, −8) を付ける */
export type ZFix = 'none' | 'offset' | 'offset2'
/** mask: 水面を不透明のマゼンタで描く。mask-nodepth: さらに深度テストを切る（計画 D9） */
export type WaterDebug = 'off' | 'mask' | 'mask-nodepth'

export interface Scene {
  name: SceneName
  center: { lon: number; lat: number }
  range: GridRange
  elevation: Float32Array // N × N、行優先（北から、西から）。無効セルは 0
  validMask: Uint8Array
  depth: Float32Array // 固定の水深（m）
  sample: ElevationSampler
  minElevation: number // 有効セルの最低の標高（B の基準。計画 D17）
}

export interface View {
  exaggeration: number
  pitch: number
  zoom: number
}

export interface CandidateHandle {
  /** 地形と水面に同じ倍率を掛ける（合格基準 2） */
  setExaggeration(value: number): void
  /** 水深のテクスチャを差し替える（N × N、m） */
  setDepth(depth: Float32Array): void
  setDebug(mode: WaterDebug): void
  /** タイルの読み込みなど、描画の準備が済んで 1 枚描き終えたら解決する */
  whenIdle(): Promise<void>
  /** Custom Layer の render の CPU 時間（ms）。新しいものを末尾に足す（Task 8 が読む） */
  readonly renderTimes: number[]
}

export type MountCandidate = (
  map: MapLibreMap,
  scene: Scene,
  params: SpikeParams,
) => Promise<CandidateHandle>

/** ページが Playwright と手動の計測に見せる窓口（window.spike） */
export interface SpikeGlobal {
  map: MapLibreMap
  scene: Scene
  params: SpikeParams
  candidate: CandidateHandle | null
  cspViolations: string[]
  setView(view: View): Promise<void>
}

declare global {
  interface Window {
    spike?: SpikeGlobal
  }
}
```

- [ ] **Step 5: URL の引数の失敗するテストを書く**

`spike/src/params.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseParams } from './params'

describe('parseParams', () => {
  it('引数が無ければ既定値になる', () => {
    expect(parseParams('')).toEqual({
      candidate: null,
      scene: 'synthetic',
      water: 'fixed',
      exaggeration: 1,
      pitch: 60,
      zoom: 17,
      zfix: 'offset',
      capture: false,
      skirt: true,
      probe: null,
    })
  })

  it('候補・場面・視点・対策を読む', () => {
    const params = parseParams(
      '?candidate=braw&scene=real&water=film&exaggeration=10&pitch=85&zoom=15&zfix=none&capture=1&skirt=0&probe=fps',
    )
    expect(params).toEqual({
      candidate: 'braw',
      scene: 'real',
      water: 'film',
      exaggeration: 10,
      pitch: 85,
      zoom: 15,
      zfix: 'none',
      capture: true,
      skirt: false,
      probe: 'fps',
    })
  })

  it('知らない値と範囲の外の数値は既定値にする', () => {
    const params = parseParams('?candidate=c&scene=x&pitch=90&zoom=19&exaggeration=-1')
    expect(params.candidate).toBeNull()
    expect(params.scene).toBe('synthetic')
    expect(params.pitch).toBe(60)
    expect(params.zoom).toBe(17)
    expect(params.exaggeration).toBe(1)
  })
})
```

- [ ] **Step 6: 失敗することを確かめる**

Run: `pnpm vitest run spike/src/params.test.ts`
Expected: FAIL（`Failed to resolve import "./params"`）

- [ ] **Step 7: 引数の解釈を書く**

`spike/src/params.ts`:

```ts
import type { CandidateId, SceneName, WaterMode, ZFix } from './types'

export interface SpikeParams {
  candidate: CandidateId | null
  scene: SceneName
  water: WaterMode
  exaggeration: number
  pitch: number
  zoom: number
  zfix: ZFix
  capture: boolean // preserveDrawingBuffer を有効にし、画面を読み取れるようにする（計画 D9）
  skirt: boolean // B・B-raw の縁（計画 D17）
  probe: 'fps' | null
}

function pick<T extends string>(value: string | null, options: readonly T[], fallback: T): T {
  return options.find((option) => option === value) ?? fallback
}

function numberIn(value: string | null, min: number, max: number, fallback: number): number {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback
}

/** URL の引数を読む（計画 D3）。知らない値と範囲の外の数値は既定値にする */
export function parseParams(search: string): SpikeParams {
  const query = new URLSearchParams(search)
  const candidates: readonly CandidateId[] = ['a', 'a2', 'b', 'braw']
  return {
    candidate: candidates.find((id) => id === query.get('candidate')) ?? null,
    scene: pick(query.get('scene'), ['synthetic', 'real'], 'synthetic'),
    water: pick(query.get('water'), ['fixed', 'film', 'dynamic'], 'fixed'),
    exaggeration: numberIn(query.get('exaggeration'), 0.1, 20, 1),
    pitch: numberIn(query.get('pitch'), 0, 85, 60),
    zoom: numberIn(query.get('zoom'), 2, 18, 17),
    zfix: pick(query.get('zfix'), ['none', 'offset', 'offset2'], 'offset'),
    capture: query.get('capture') === '1',
    skirt: query.get('skirt') !== '0',
    probe: query.get('probe') === 'fps' ? 'fps' : null,
  }
}
```

Run: `pnpm vitest run spike/src/params.test.ts`
Expected: PASS（3 件）

- [ ] **Step 8: 場面の失敗するテストを書く**

`spike/src/scenes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DemTileData } from '../../src/dem/DemGrid.ts'
import { tileKey } from '../../src/dem/demSelection.ts'
import { rangePixelRect } from '../../src/dem/gridRange.ts'
import { tilesInPixelRect } from '../../src/dem/tileMath.ts'
import {
  buildRealScene,
  buildSyntheticScene,
  FILM_DEPTH_M,
  isFilmCell,
  POND_DEPTHS_M,
  RANGE_M,
  shibuyaRange,
} from './scenes'

/** 無効値を少し含み、タイルごとに値の違う規則的な標高のタイル（実タイルの代わり。Node では PNG を復号しない） */
function patternTile(tx: number, ty: number): DemTileData {
  const elevation = new Float32Array(256 * 256)
  const validMask = new Uint8Array(256 * 256)
  for (let p = 0; p < elevation.length; p++) {
    if (p % 97 === 0) continue
    elevation[p] = 10 + (tx % 3) + (ty % 3) * 0.5 + (p % 7) * 0.1 + Math.floor(p / 256) * 0.01
    validMask[p] = 1
  }
  return { elevation, validMask }
}

/** 範囲にかかるタイル（渋谷では x・y とも 3 枚）を、02 の tileKey で引ける形にする */
function patternTiles(): Map<string, DemTileData> {
  const range = shibuyaRange()
  return new Map(
    tilesInPixelRect(rangePixelRect(range), range.z).map((t) => [tileKey(t.x, t.y), patternTile(t.x, t.y)]),
  )
}

describe('合成の場面（計画 D4）', () => {
  const scene = buildSyntheticScene('fixed')
  const { range } = scene
  const n = range.size

  it('範囲は渋谷の 500m 四方で、一辺は ceil(500 / セルの大きさ)', () => {
    expect(n).toBe(Math.ceil(RANGE_M / range.cellSizeM))
    expect(scene.validMask.every((v) => v === 1)).toBe(true)
  })

  it('グリッドの標高はサンプラーの値と全セルで一致する', () => {
    let mismatches = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const expected = Math.fround(scene.sample(range.originX + col, range.originY + row) ?? 0)
        if (scene.elevation[row * n + col] !== expected) mismatches++
      }
    }
    expect(mismatches).toBe(0)
  })

  it('3 つの池の最大の水深は 5cm・50cm・2m（1mm 以内）', () => {
    // 池は北側の同じ行の帯にあり、西から順に並ぶ。範囲を東西に 3 等分して最大値をとる
    const maxima = [0, 0, 0]
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (isFilmCell(range, col, row)) continue
        const k = Math.min(2, Math.floor((col / n) * 3))
        maxima[k] = Math.max(maxima[k] ?? 0, scene.depth[row * n + col] ?? 0)
      }
    }
    maxima.forEach((depth, k) => expect(depth).toBeCloseTo(POND_DEPTHS_M[k] ?? -1, 3))
  })

  it('膜のセルの水深は 1cm で、斜面は南へ 10% で下る', () => {
    const col = Math.floor(n / 2)
    const row = Math.floor(n * 0.7)
    expect(isFilmCell(range, col, row)).toBe(true)
    expect(scene.depth[row * n + col]).toBe(Math.fround(FILM_DEPTH_M))
    const drop = (scene.elevation[row * n + col] ?? 0) - (scene.elevation[(row + 10) * n + col] ?? 0)
    expect(drop).toBeCloseTo(0.1 * 10 * range.cellSizeM, 3)
  })

  it('film の水は膜だけで、池が無い', () => {
    const film = buildSyntheticScene('film')
    let wetOutsideFilm = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (!isFilmCell(range, col, row) && (film.depth[row * n + col] ?? 0) > 0) wetOutsideFilm++
      }
    }
    expect(wetOutsideFilm).toBe(0)
  })
})

describe('実データの場面（計画 D4・D5）', () => {
  const tiles = patternTiles()
  const scene = buildRealScene(shibuyaRange(), tiles)
  const { range } = scene
  const n = range.size

  it('範囲にかかるタイルは 9 枚（x 116398〜116400・y 51622〜51624）', () => {
    expect([...tiles.keys()].sort()).toEqual(
      [116398, 116399, 116400].flatMap((x) => [51622, 51623, 51624].map((y) => tileKey(x, y))).sort(),
    )
  })

  it('タイルの外は、並べたタイルの端の値を延ばす（A の地形が範囲の外で段差を作らない）', () => {
    const x0 = 116398 * 256
    const y = range.originY + 10
    expect(scene.sample(x0 - 50, y)).toBe(scene.sample(x0, y))
  })

  it('02 の assembleGrid で組んだグリッドは、A の地形に使うサンプラーと全セルで一致する', () => {
    let mismatches = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const value = scene.sample(range.originX + col, range.originY + row)
        const i = row * n + col
        const valid = scene.validMask[i] === 1
        if (valid !== (value !== null)) mismatches++
        else if (valid && scene.elevation[i] !== Math.fround(value ?? 0)) mismatches++
      }
    }
    expect(mismatches).toBe(0)
  })

  it('有効セルの水深は 1cm 以上、無効セルは 0', () => {
    let bad = 0
    let invalid = 0
    for (let i = 0; i < n * n; i++) {
      if (scene.validMask[i] === 1) {
        if ((scene.depth[i] ?? 0) < Math.fround(FILM_DEPTH_M)) bad++
      } else {
        invalid++
        if (scene.depth[i] !== 0) bad++
      }
    }
    expect(invalid).toBeGreaterThan(0)
    expect(bad).toBe(0)
  })
})
```

- [ ] **Step 9: 失敗することを確かめる**

Run: `pnpm vitest run spike/src/scenes.test.ts`
Expected: FAIL（`Failed to resolve import "./scenes"`）

- [ ] **Step 10: 場面を書く**

`spike/src/scenes.ts`:

```ts
import { assembleGrid, type DemTileData } from '../../src/dem/DemGrid.ts'
import { tileKey } from '../../src/dem/demSelection.ts'
import { computeGridRange, type GridRange, rangePixelRect } from '../../src/dem/gridRange.ts'
import { TILE_SIZE, tilesInPixelRect } from '../../src/dem/tileMath.ts'
import { analyzeTerrain } from '../../src/simulation/terrain/analyzeTerrain.ts'
import type { ElevationSampler, Scene } from './types'

/** E2E と同じ渋谷の地点。500m の範囲は DEM1A の z17 の x 116398〜116400・y 51622〜51624 の 9 枚にかかる（中央が 02 のフィクスチャ） */
export const SHIBUYA = { lon: 139.7016, lat: 35.658 } as const
export const RANGE_M = 500
export const DEM_Z = 17

export const POND_DEPTHS_M = [0.05, 0.5, 2] as const
export const FILM_DEPTH_M = 0.01
/** 1cm の判定。Float32 の 0.01 の丸めで膜が捨てられないよう、0.1mm 小さくする（計画 D8） */
export const MIN_DEPTH_M = 0.0099

// 合成の場面の寸法（計画 D4）。位置は範囲の一辺 L に対する割合
const LOW_M = 20
const SLOPE_GRADE = 0.1
const SLOPE_NORTH = 0.55
const SLOPE_SOUTH = 0.95
const BOWL_RADIUS_M = 60
const BOWL_DEPTH_M = 3
const BOWL_CENTERS = [
  [0.2, 0.25],
  [0.5, 0.25],
  [0.8, 0.25],
] as const
const FILM = { x0: 0.1, x1: 0.9, y0: 0.6, y1: 0.9 } as const

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const sideM = (range: GridRange): number => range.size * range.cellSizeM

/** 斜面の北端の高さ。北側の台地はこの高さで、斜面とつながる */
const plateauM = (range: GridRange): number =>
  LOW_M + SLOPE_GRADE * (SLOPE_SOUTH - SLOPE_NORTH) * sideM(range)

/** 合成と実データで共通の範囲（渋谷の 500m 四方、z17） */
export function shibuyaRange(): GridRange {
  return computeGridRange(SHIBUYA.lon, SHIBUYA.lat, RANGE_M, DEM_Z)
}

/** 北の台地に 3 つのすり鉢、南に北へ上る斜面。範囲の外は縁の値を延ばす */
export function syntheticSampler(range: GridRange): ElevationSampler {
  const side = sideM(range)
  const plateau = plateauM(range)
  return (gx, gy) => {
    const x = clamp((gx - range.originX + 0.5) * range.cellSizeM, 0, side)
    const y = clamp((gy - range.originY + 0.5) * range.cellSizeM, 0, side)
    if (y >= SLOPE_SOUTH * side) return LOW_M
    if (y >= SLOPE_NORTH * side) return LOW_M + SLOPE_GRADE * (SLOPE_SOUTH * side - y)
    for (const [cx, cy] of BOWL_CENTERS) {
      const r2 = (x - cx * side) ** 2 + (y - cy * side) ** 2
      if (r2 < BOWL_RADIUS_M ** 2) return plateau - BOWL_DEPTH_M * (1 - r2 / BOWL_RADIUS_M ** 2)
    }
    return plateau
  }
}

/** 斜面の 1cm の膜のセルか（セルの中心で判定） */
export function isFilmCell(range: GridRange, col: number, row: number): boolean {
  const side = sideM(range)
  const x = (col + 0.5) * range.cellSizeM
  const y = (row + 0.5) * range.cellSizeM
  return x >= FILM.x0 * side && x < FILM.x1 * side && y >= FILM.y0 * side && y < FILM.y1 * side
}

function minValid(elevation: Float32Array, validMask: Uint8Array): number {
  let min = Number.POSITIVE_INFINITY
  for (let i = 0; i < elevation.length; i++) {
    if (validMask[i] === 1) min = Math.min(min, elevation[i] ?? min)
  }
  return Number.isFinite(min) ? min : 0
}

export function buildSyntheticScene(water: 'fixed' | 'film'): Scene {
  const range = shibuyaRange()
  const sample = syntheticSampler(range)
  const n = range.size
  const side = sideM(range)
  const plateau = plateauM(range)
  const elevation = new Float32Array(n * n)
  const validMask = new Uint8Array(n * n).fill(1)
  const depth = new Float32Array(n * n)
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col
      elevation[i] = sample(range.originX + col, range.originY + row) ?? 0
      if (isFilmCell(range, col, row)) {
        depth[i] = FILM_DEPTH_M
        continue
      }
      if (water === 'film') continue
      const x = (col + 0.5) * range.cellSizeM
      const y = (row + 0.5) * range.cellSizeM
      BOWL_CENTERS.forEach(([cx, cy], k) => {
        if ((x - cx * side) ** 2 + (y - cy * side) ** 2 >= BOWL_RADIUS_M ** 2) return
        const level = plateau - BOWL_DEPTH_M + (POND_DEPTHS_M[k] ?? 0)
        depth[i] = Math.max(0, level - (elevation[i] ?? 0))
      })
    }
  }
  return {
    name: 'synthetic',
    center: SHIBUYA,
    range,
    elevation,
    validMask,
    depth,
    sample,
    minElevation: minValid(elevation, validMask),
  }
}

/** 範囲にかかるタイルを並べたブロックの、z17 の画素の矩形（両端を含む） */
function tileBlock(range: GridRange): { x0: number; y0: number; x1: number; y1: number } {
  const tiles = tilesInPixelRect(rangePixelRect(range), range.z)
  const xs = tiles.map((t) => t.x)
  const ys = tiles.map((t) => t.y)
  return {
    x0: Math.min(...xs) * TILE_SIZE,
    y0: Math.min(...ys) * TILE_SIZE,
    x1: (Math.max(...xs) + 1) * TILE_SIZE - 1,
    y1: (Math.max(...ys) + 1) * TILE_SIZE - 1,
  }
}

/**
 * 実タイルのサンプラー（計画 D5）。ブロックの外は端の値を延ばす（A の地形が範囲の外で 0m に落ちて
 * 段差を作らないように）。無いタイル（404）と無効値は null
 */
export function tileBlockSampler(
  range: GridRange,
  tiles: ReadonlyMap<string, DemTileData>,
): ElevationSampler {
  const block = tileBlock(range)
  return (gx, gy) => {
    const x = clamp(gx, block.x0, block.x1)
    const y = clamp(gy, block.y0, block.y1)
    const tx = Math.floor(x / TILE_SIZE)
    const ty = Math.floor(y / TILE_SIZE)
    const tile = tiles.get(tileKey(tx, ty))
    if (tile === undefined) return null
    const p = (y - ty * TILE_SIZE) * TILE_SIZE + (x - tx * TILE_SIZE)
    return tile.validMask[p] === 1 ? (tile.elevation[p] ?? 0) : null
  }
}

/** 02 の部品で実タイルからグリッドを組み、水深は満水（fill − 標高）と 1cm の大きい方にする（計画 D4） */
export function buildRealScene(range: GridRange, tiles: ReadonlyMap<string, DemTileData>): Scene {
  const grid = assembleGrid(range, (tx, ty) => tiles.get(tileKey(tx, ty)))
  const { fill } = analyzeTerrain(grid)
  const depth = new Float32Array(grid.elevation.length)
  for (let i = 0; i < depth.length; i++) {
    if (grid.validMask[i] !== 1) continue
    depth[i] = Math.max(FILM_DEPTH_M, (fill[i] ?? 0) - (grid.elevation[i] ?? 0))
  }
  return {
    name: 'real',
    center: SHIBUYA,
    range,
    elevation: grid.elevation,
    validMask: grid.validMask,
    depth,
    sample: tileBlockSampler(range, tiles),
    minElevation: minValid(grid.elevation, grid.validMask),
  }
}
```

Run: `pnpm vitest run spike/src/scenes.test.ts`
Expected: PASS（9 件）。池の最大の水深が 1mm の許容に入らなければ、池の中心に最も近いセルの中心とすり鉢の中心のずれ（最大で半セルの対角 約 0.69m、深さの差 約 0.4mm）を確かめ、許容を変えずに原因を調べる

- [ ] **Step 10b: 実データのタイルを一度だけ取得し、ブランチに置く（着手前の検査 G2）**

範囲にかかるタイルを 02 の計算（`gridRange.ts`・`tileMath.ts`）で求め、本番と同じ URL（`src/dem/demSources.ts` の `demTileUrl`）を curl で取得する。取得はこの 1 回だけで、以後の自動の実行は `spike/fixtures/gsi/` のファイルで応答する（Step 12 の `routeSpikeDem`）。

`spike/scripts/dem-tiles.ts`:

```ts
/**
 * スパイクの実データの範囲にかかる DEM1A のタイルを 02 の計算で求め、取得の curl のコマンドを出す（一度だけ使う。G2）。
 * Node 24 はこの .ts を直接実行できる（計画 03 の scripts/bench-engine.ts と同じ）
 */
import { demTileUrl } from '../../src/dem/demSources.ts'
import { rangePixelRect } from '../../src/dem/gridRange.ts'
import { tilesInPixelRect } from '../../src/dem/tileMath.ts'
import { shibuyaRange } from '../src/scenes.ts'

const range = shibuyaRange()
for (const tile of tilesInPixelRect(rangePixelRect(range), range.z)) {
  const file = `spike/fixtures/gsi/dem1a-17-${tile.x}-${tile.y}.png`
  console.log(`curl -fsS -o ${file} ${demTileUrl('dem1a', tile)} || echo "取得できない: ${tile.x}/${tile.y}"`)
}
```

```bash
mkdir -p spike/fixtures/gsi spike/out
node spike/scripts/dem-tiles.ts > spike/out/dem-tiles.sh
cat spike/out/dem-tiles.sh
sh spike/out/dem-tiles.sh
ls -l spike/fixtures/gsi/*.png
sha256sum spike/fixtures/gsi/*.png
grep SHA-256 tests/fixtures/gsi/README.md
```

Expected: `dem-tiles.sh` は 9 行で、x 116398〜116400・y 51622〜51624（計画の作成時に 02 の式で求めた値）。9 枚の PNG ができる。中央の `dem1a-17-116399-51623.png` の SHA-256 は、`tests/fixtures/gsi/README.md` の `5ef12f36…` と同じ（違えば地理院がタイルを更新している。両方の値を README に書き、新しい方を使う）。「取得できない」と出たタイルは 404（データなし）で、ファイルを置かない（ページは 404 を全画素無効として扱う）。`node` が `../src/scenes.ts` を読み込めない場合は、`shibuyaRange()` の代わりに `computeGridRange(139.7016, 35.658, 500, 17)`（`src/dem/gridRange.ts`）を使う

`spike/fixtures/gsi/README.md` を書く（取得日と SHA-256 の欄は、上のコマンドの実行の日付と出力で埋める）:

```markdown
# スパイク S の実データ（DEM1A、渋谷駅付近）

- 出典: 国土地理院「地理院タイル」標高タイル（DEM1A）。出典: 国土地理院
- URL: `https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/17/{x}/{y}.png`（`src/dem/demSources.ts` の `demTileUrl('dem1a', tile)` と同じ）
- 範囲: 北緯 35.658°・東経 139.7016° を中心とする 500m 四方（z17、N = 516。R02-7 の渋谷駅付近）にかかる x 116398〜116400・y 51622〜51624 の 9 枚
- 取得: `node spike/scripts/dem-tiles.ts > spike/out/dem-tiles.sh && sh spike/out/dem-tiles.sh`（取得日: YYYY-MM-DD の形で書く）
- 使い方: 自動の実行では `spike/e2e/support/views.ts` の `routeSpikeDem` がこのファイルで応答する。手動の計測（Task 8）では地理院から取得する
- 404 だったタイル: （無ければ「なし」）
- SHA-256（`sha256sum spike/fixtures/gsi/*.png` の出力）:
```

- [ ] **Step 11: ページ・実タイルの取得と復号・待ち合わせ・入口を書く**
`spike/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>raintrace spike S: 3D 描画方式の比較</title>
    <style>
      html, body, #map { margin: 0; width: 100%; height: 100%; }
      #status {
        position: absolute; top: 8px; left: 8px; z-index: 1; max-width: 60%;
        padding: 4px 8px; background: #ffffffd0; font: 12px/1.4 monospace; white-space: pre-wrap;
      }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <div id="status">読み込み中</div>
    <script type="module" src="./src/main.ts"></script>
  </body>
</html>
```

`spike/src/demTiles.ts`:

```ts
import type { DemTileData } from '../../src/dem/DemGrid.ts'
import { tileKey } from '../../src/dem/demSelection.ts'
import { demTileUrl } from '../../src/dem/demSources.ts'
import { type GridRange, rangePixelRect } from '../../src/dem/gridRange.ts'
import { decodeGsiDem } from '../../src/dem/GsiDemDecoder.ts'
import { TILE_SIZE, tilesInPixelRect } from '../../src/dem/tileMath.ts'

/**
 * 範囲にかかる DEM1A のタイルを本番と同じ URL で取得し、02 の Worker と同じ手順で復号する
 * （色空間の変換とアルファの乗算をさせない）。404 のタイルは入れない（全画素無効）。
 * 自動の実行では Playwright が spike/fixtures/gsi/ の PNG で応答する（計画 D4）
 */
export async function loadDemTiles(range: GridRange): Promise<Map<string, DemTileData>> {
  const context = new OffscreenCanvas(TILE_SIZE, TILE_SIZE).getContext('2d', {
    willReadFrequently: true,
  })
  if (context === null) throw new Error('OffscreenCanvas の 2D コンテキストを得られません')
  context.globalCompositeOperation = 'copy'
  const tiles = new Map<string, DemTileData>()
  for (const tile of tilesInPixelRect(rangePixelRect(range), range.z)) {
    const response = await fetch(demTileUrl('dem1a', tile))
    if (response.status === 404) continue
    if (!response.ok) throw new Error(`DEM1A ${tile.x}/${tile.y}: HTTP ${response.status}`)
    const bitmap = await createImageBitmap(await response.blob(), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    tiles.set(
      tileKey(tile.x, tile.y),
      decodeGsiDem(context.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data),
    )
  }
  return tiles
}
```

`spike/src/waitIdle.ts`:

```ts
import type { Map as MapLibreMap } from 'maplibre-gl'

/**
 * 1 枚描かせ、地図が idle（タイルの読み込みと描画が済んだ）になるまで待つ。
 * すでに idle だと idle は来ないので、先に購読してから triggerRepaint で描かせる
 */
export async function waitIdle(map: MapLibreMap): Promise<void> {
  const idle = map.once('idle')
  map.triggerRepaint()
  await idle
}
```

`spike/src/main.ts`:

```ts
import 'maplibre-gl/dist/maplibre-gl.css'
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { createGsiPaleStyle } from '../../src/map/gsiStyle'
import { loadDemTiles } from './demTiles'
import { parseParams, type SpikeParams } from './params'
import { buildRealScene, buildSyntheticScene, shibuyaRange } from './scenes'
import type { CandidateHandle, CandidateId, MountCandidate, Scene, SpikeGlobal, View } from './types'
import { waitIdle } from './waitIdle'

setWorkerUrl(workerUrl)

/** 候補は動的 import で読み、候補ごとのチャンクにする（計画 D3、Task 9 で大きさを測る） */
const candidates: Partial<Record<CandidateId, () => Promise<{ mount: MountCandidate }>>> = {}

const status = document.getElementById('status')
const show = (text: string): void => {
  if (status !== null) status.textContent = text
}

async function buildScene(params: SpikeParams): Promise<Scene> {
  if (params.scene === 'real') {
    const range = shibuyaRange()
    return buildRealScene(range, await loadDemTiles(range))
  }
  return buildSyntheticScene(params.water === 'film' ? 'film' : 'fixed')
}

function rendererName(map: MapLibreMap): string {
  const gl = map.painter.context.gl
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info === null ? '不明' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
}

async function start(): Promise<void> {
  const cspViolations: string[] = []
  document.addEventListener('securitypolicyviolation', (event) => {
    cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`)
  })
  const params = parseParams(location.search)
  const scene = await buildScene(params)
  const map = new MapLibreMap({
    container: 'map',
    style: createGsiPaleStyle({
      text: '国土地理院',
      url: 'https://maps.gsi.go.jp/development/ichiran.html',
    }),
    center: [scene.center.lon, scene.center.lat],
    zoom: params.zoom,
    pitch: params.pitch,
    bearing: 0,
    maxZoom: 18,
    maxPitch: 85,
    fadeDuration: 0,
    attributionControl: { compact: false },
    // capture=1 のときだけ画面を読み取れるようにする。fps の計測では切る（計画 D9・D15）
    canvasContextAttributes: { antialias: true, preserveDrawingBuffer: params.capture },
  })
  map.on('error', (event) => console.error(event.error))
  await map.once('load')

  let candidate: CandidateHandle | null = null
  if (params.candidate !== null) {
    const load = candidates[params.candidate]
    if (load === undefined) throw new Error(`候補 ${params.candidate} はまだありません`)
    candidate = await (await load()).mount(map, scene, params)
    candidate.setExaggeration(params.exaggeration)
  }
  const spike: SpikeGlobal = {
    map,
    scene,
    params,
    candidate,
    cspViolations,
    async setView(view: View) {
      map.jumpTo({
        center: [scene.center.lon, scene.center.lat],
        zoom: view.zoom,
        pitch: view.pitch,
        bearing: 0,
      })
      candidate?.setExaggeration(view.exaggeration)
      await (candidate === null ? waitIdle(map) : candidate.whenIdle())
    },
  }
  window.spike = spike
  await (candidate === null ? waitIdle(map) : candidate.whenIdle())
  show(`${params.candidate ?? '候補なし'} / ${scene.name} / N=${scene.range.size} / ${rendererName(map)}`)
  document.documentElement.dataset.spikeReady = 'true'
}

start().catch((error: unknown) => {
  console.error(error)
  show(`失敗: ${String(error)}`)
  document.documentElement.dataset.spikeError = String(error)
})
```

`map.painter` は maplibre-gl.d.ts（12587 行）で公開されている（`painter: Painter`）。`painter.context.gl` の型が合わなければ、`map.getCanvas().getContext('webgl2')`（MapLibre が作った同じコンテキストが返る）に置き換える。

- [ ] **Step 12: Playwright の補助と、ページが開くことの E2E を書く**

`spike/e2e/support/views.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { type BrowserContext, expect, type Page } from '@playwright/test'
import { routeGsi } from '../../../tests/e2e/support/gsi'
import type { View } from '../../src/types'

export const EXAGGERATIONS = [1, 2, 5, 10] as const
export const PITCHES = [0, 45, 60, 85] as const
export const ZOOMS = [15, 16, 17, 18] as const

/** 64 通りの視点（計画 D10）。ズーム → 垂直強調 → pitch の順（コンタクトシートの行と列の順） */
export function allViews(): View[] {
  return ZOOMS.flatMap((zoom) =>
    EXAGGERATIONS.flatMap((exaggeration) => PITCHES.map((pitch) => ({ zoom, exaggeration, pitch }))),
  )
}

export function spikeQuery(query: Record<string, string | number>): string {
  return `/?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}`
}

const demDir = new URL('../../fixtures/gsi/', import.meta.url)

/**
 * DEM1A の要求に spike/fixtures/gsi/ の実タイル（Task 1 Step 10b で一度だけ取得）で応答する。無いタイルは 404。
 * routeGsi の後に登録するので、DEM1A ではこちらが先に効く（計画 D4）
 */
export async function routeSpikeDem(context: BrowserContext): Promise<void> {
  const cors = { 'access-control-allow-origin': '*' }
  await context.route('https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/17/**', (route) => {
    const match = /\/(\d+)\/(\d+)\.png$/.exec(new URL(route.request().url()).pathname)
    const file = match === null ? null : new URL(`dem1a-17-${match[1]}-${match[2]}.png`, demDir)
    if (file === null || !existsSync(file)) {
      return route.fulfill({ status: 404, headers: cors, body: 'not found' })
    }
    return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: readFileSync(file) })
  })
}

/**
 * 地理院への要求を差し替えてページを開き、準備ができるまで待つ。ページのエラーを集める配列を返す。
 * 配列は後のエラーも受け取り続けるので、呼び出し側は参照を持ち、最後に確かめる（1 回だけ展開して写さない。P20）
 */
export async function openSpike(
  page: Page,
  context: BrowserContext,
  query: Record<string, string | number>,
): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await routeGsi(context)
  await routeSpikeDem(context)
  await page.goto(spikeQuery(query))
  await expect(page.locator('html[data-spike-ready="true"]')).toBeAttached({ timeout: 120_000 })
  return errors
}

export async function setView(page: Page, view: View): Promise<void> {
  await page.evaluate(async (v) => {
    await window.spike?.setView(v)
  }, view)
}
```

`spike/e2e/smoke.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { openSpike } from './support/views'

const results = new URL('../results/', import.meta.url)

for (const scene of ['synthetic', 'real'] as const) {
  test(`候補なしの ${scene} の場面が開き、エラーと CSP 違反が無い`, async ({ page, context }) => {
    const errors = await openSpike(page, context, { scene })
    const info = await page.evaluate(() => ({
      size: window.spike?.scene.range.size,
      csp: window.spike?.cspViolations,
    }))
    expect(info.size).toBe(516)
    expect(info.csp).toEqual([])
    if (scene === 'real') {
      // 実データの範囲の値は決め打ちせず、実行時に求めて記録する（着手前の検査 G2）
      const stats = await page.evaluate(() => {
        const s = window.spike?.scene
        if (s === undefined) return null
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        let invalid = 0
        let maxDepth = 0
        for (let i = 0; i < s.elevation.length; i++) {
          if (s.validMask[i] !== 1) {
            invalid++
            continue
          }
          const e = s.elevation[i] ?? 0
          min = Math.min(min, e)
          max = Math.max(max, e)
          maxDepth = Math.max(maxDepth, s.depth[i] ?? 0)
        }
        return { min, max, invalidRatio: invalid / s.elevation.length, maxDepth }
      })
      expect(stats).not.toBeNull()
      if (stats !== null) {
        mkdirSync(results, { recursive: true })
        writeFileSync(
          new URL('real-scene.md', results),
          [
            '# 実データの場面（渋谷駅付近、DEM1A の実タイル 9 枚、500m）',
            '',
            '| 最低の標高 | 最高の標高 | 無効セル | 満水の最大の水深 |',
            '|---:|---:|---:|---:|',
            `| ${stats.min.toFixed(2)} m | ${stats.max.toFixed(2)} m | ${(stats.invalidRatio * 100).toFixed(2)}% | ${stats.maxDepth.toFixed(2)} m |`,
            '',
            '参考: 02 の手動確認（渋谷駅付近、500m）は 8.78〜33.06 m、無効セル 0.2%、最大の窪地の深さ 2.80 m。',
            '',
          ].join('\n'),
        )
      }
    }
    expect(errors).toEqual([])
  })
}
```

- [ ] **Step 13: 報告の下書きの骨組みを作る**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md`:

```markdown
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
| three | 0.185.1（@types/three 0.185.4、推移的依存 （Task 1 Step 1 の数） 個。開発時のみ） |
| three の扱い | スパイクのブランチ（`spike/3d-rendering`）だけの依存。`main` には入っていない |
| 自動の計測 | Playwright 1.62.1 の Chromium、`--enable-unsafe-swiftshader`、960 × 600、deviceScaleFactor 1 |
| 本番のバンドル（スパイクの前） | 初期ロード （Step 0 の値） KB / 総量 （Step 0 の値） KB |

## 3. 判定の方法

- 入力: 合成の場面（計画 D4）と、実データの場面（渋谷駅付近の DEM1A の実タイル 9 枚。`spike/fixtures/gsi/`、取得日と出典は同じ場所の README。範囲の最低・最高の標高、無効セル、満水の最大の水深は `spike/results/real-scene.md` の値を Task 1 Step 14 で写す）

（Task 3 で書く: 可視率・ちらつきの定義と閾値、計画 D9）

## 4. 候補ごとの結果

| 観点 | A | A' | B | B-raw |
|---|---|---|---|---|
| 合格基準 1（1cm の膜: 可視率の最小・ちらつきの最大） | | | | |
| 合格基準 2（倍率の一致） | | | | |
| 合格基準 3（fps、自動は参考・実 GPU は手動） | | | | |
| バンドル（gzip） | | | | |
| 複雑さ（行数・回避策の数） | | | | |
| 継ぎ目 | — | — | | |
| z-fighting の対策の効果 | | | | |
| Custom Layer の API | | | | |
| 流れの矢印（symbol レイヤー） | | | — | — |

## 5. Custom Layer の API（MapLibre 6.6.0）

（Task 2 で書く）

## 6. 1 日目の中間の判定

（Task 4 で書く）

## 7. スクリーンショット

（Task 3・5・6・7 で足す）

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
```

表の「（…の値）」は、この Step で Step 0 と Step 1 のメモから実際の値を書き入れる（空欄のままコミットしない）。

- [ ] **Step 14: 全体の検査とスパイクの E2E**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて成功（既存のテストに加え、spike の 12 件）

Run: `pnpm spike:e2e spike/e2e/smoke.spec.ts`
Expected: PASS（2 件）。`spike/results/real-scene.md` ができる。その値を報告の §3 の「入力」の行に写す（02 の手動確認の 8.78〜33.06 m・無効 0.2%・最大の窪地の深さ 2.80 m と大きく違えば、地点の中心の違いか取得の誤りかを確かめて書く）。CSP 違反が出たら、違反の文字列を報告の「11. 未確認の事項」の前に「CSP」として書き、CSP は緩めずに原因（どの資源が塞がれたか）を調べる

Run: `pnpm build && pnpm size`
Expected: 初期ロードと総量が Step 0 と同じ（本番のビルドが変わらない）

- [ ] **Step 15: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts .gitignore spike docs/superpowers/spikes
git commit -m "スパイク S の土台: 専用の Vite と Playwright（4174）、場面（合成・実データ）、three 0.185.1"
```

---
### Task 2: 候補 A の地形と、判定 (1)（Custom Layer の行列に地形の高さが反映されるか）

**1 日目の午前（約 2 時間）。D1 の 1 つ目の分かれ目。**

**Files:**
- Create: `spike/src/mat4.ts`、`spike/src/mat4.test.ts`、`spike/src/candidates/terrarium.ts`、`spike/src/candidates/terrarium.test.ts`、`spike/src/candidates/a.ts`
- Create: `spike/e2e/apiProbe.spec.ts`、`spike/results/api-probe.json`（実行の結果）
- Modify: `spike/src/types.ts`（`ApiProbeResult` と `CandidateHandle.apiProbe?`）、`spike/src/main.ts`（候補 `a` の読み込み）、`docs/superpowers/spikes/2026-09-12-3d-rendering.md`（§5）

**Interfaces:**
- Consumes: Task 1 の `Scene`・`ElevationSampler`・`CandidateHandle`・`MountCandidate`・`SpikeParams`・`waitIdle`・`openSpike`・`setView`・`ZOOMS`、`pixelToLonLat(x, y, z): LonLat`・`worldSizePx(z): number`（`src/dem/tileMath.ts`）、MapLibre の `addProtocol`・`MercatorCoordinate.fromLngLat(lngLat, altitude?)`・`meterInMercatorCoordinateUnits()`・`Map.setTerrain`・`Map.queryTerrainElevation`・`Map.project`・`Map.getCenterElevation`
- Produces（`mat4.ts`）: `multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array`（列優先、a × b）、`gridModelMatrix(range: Pick<GridRange, 'originX' | 'originY' | 'z'>, metersToMercator: number): Float64Array`（局所座標（格子の u = 列 + 0.5、v = 行 + 0.5、h = m）→ メルカトル）、`projectToScreen(matrix: ArrayLike<number>, point: readonly [number, number, number], width: number, height: number): { x: number; y: number } | null`
- Produces（`terrarium.ts`）: `encodeTerrarium(h: number, out: Uint8ClampedArray, offset: number): void`、`decodeTerrarium(r: number, g: number, b: number): number`、`terrariumTile(sample: ElevationSampler, z: number, x: number, y: number): Uint8ClampedArray<ArrayBuffer>`
- Produces（`a.ts`）: `mount: MountCandidate`（Task 3・5 で置き換える）。ソースの id `spike-dem`（地形）・`spike-dem-hs`（陰影）、レイヤーの id `spike-hillshade`・`spike-probe`、プロトコル `spikedem://{z}/{x}/{y}`
- Produces（`types.ts`）: `interface ProbePoint { label: string; lngLat: [number, number]; simElevation: number; terrainElevation: number | null; projected: { x: number; y: number }; viaMatrixZ0: { x: number; y: number } | null; viaMatrixTerrain: { x: number; y: number } | null; viaMatrixSim: { x: number; y: number } | null }`、`interface ApiProbeResult { optionKeys: string[]; nearZ: number; farZ: number; fovRad: number; mvpEqualsMain: boolean; centerElevation: number; exaggeration: number; points: ProbePoint[] }`、`CandidateHandle.apiProbe?(): ApiProbeResult | null`

- [ ] **Step 1: 行列の失敗するテストを書く**

`spike/src/mat4.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { gridModelMatrix, multiply, projectToScreen } from './mat4'

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
const at = (m: ArrayLike<number>, i: number): number => m[i] ?? Number.NaN

describe('mat4（列優先）', () => {
  it('単位行列を掛けても変わらない', () => {
    const m = Array.from({ length: 16 }, (_, i) => i + 1)
    expect(Array.from(multiply(identity, m))).toEqual(m)
    expect(Array.from(multiply(m, identity))).toEqual(m)
  })

  it('平行移動の後に拡大すると、拡大してから移動した点になる', () => {
    const translate = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1]
    const scale = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1]
    const m = multiply(translate, scale)
    // 点 (1, 1, 1) → 拡大 (2, 3, 4) → 移動 (7, 9, 11)
    expect([at(m, 0) + at(m, 12), at(m, 5) + at(m, 13), at(m, 10) + at(m, 14)]).toEqual([7, 9, 11])
  })

  it('グリッドのモデル行列は、セルの中心をメルカトルへ、高さを倍率で写す', () => {
    const range = { originX: 1000, originY: 2000, z: 17 }
    const world = 256 * 2 ** 17
    const m = gridModelMatrix(range, 0.5)
    const x = at(m, 0) * 0.5 + at(m, 12)
    const y = at(m, 5) * 0.5 + at(m, 13)
    expect(x).toBeCloseTo((1000 + 0.5) / world, 15)
    expect(y).toBeCloseTo((2000 + 0.5) / world, 15)
    expect(m[10]).toBe(0.5)
  })

  it('単位行列で投影すると、クリップ空間の中央が画面の中央になる', () => {
    expect(projectToScreen(identity, [0, 0, 0], 960, 600)).toEqual({ x: 480, y: 300 })
    expect(projectToScreen(identity, [1, 1, 0], 960, 600)).toEqual({ x: 960, y: 0 })
  })
})
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run spike/src/mat4.test.ts`
Expected: FAIL（`Failed to resolve import "./mat4"`）

- [ ] **Step 3: 行列を書く**

`spike/src/mat4.ts`:

```ts
import type { GridRange } from '../../src/dem/gridRange.ts'
import { worldSizePx } from '../../src/dem/tileMath.ts'

/** 4 × 4 の行列の積 a × b（列優先。MapLibre の mainMatrix と同じ並び）。倍精度で計算する（計画 D7） */
export function multiply(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0)
      out[col * 4 + row] = sum
    }
  }
  return out
}

/**
 * 格子の局所座標（u = 列 + 0.5、v = 行 + 0.5、h = m）→ メルカトル（0〜1、z は等角の単位）。
 * x = (originX + u) / W、y = (originY + v) / W、z = h × metersToMercator（W は z のワールドの画素数）
 */
export function gridModelMatrix(
  range: Pick<GridRange, 'originX' | 'originY' | 'z'>,
  metersToMercator: number,
): Float64Array {
  const world = worldSizePx(range.z)
  const m = new Float64Array(16)
  m[0] = 1 / world
  m[5] = 1 / world
  m[10] = metersToMercator
  m[12] = range.originX / world
  m[13] = range.originY / world
  m[15] = 1
  return m
}

/** 点を行列で投影し、CSS 画素の位置を返す。カメラの後ろ（w ≤ 0）は null */
export function projectToScreen(
  matrix: ArrayLike<number>,
  point: readonly [number, number, number],
  width: number,
  height: number,
): { x: number; y: number } | null {
  const [x, y, z] = point
  const at = (row: number): number =>
    (matrix[row] ?? 0) * x + (matrix[4 + row] ?? 0) * y + (matrix[8 + row] ?? 0) * z + (matrix[12 + row] ?? 0)
  const w = at(3)
  if (w <= 0) return null
  return { x: ((at(0) / w + 1) / 2) * width, y: ((1 - at(1) / w) / 2) * height }
}
```

Run: `pnpm vitest run spike/src/mat4.test.ts`
Expected: PASS（4 件）

- [ ] **Step 4: Terrarium の失敗するテストを書く**

`spike/src/candidates/terrarium.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ElevationSampler } from '../types'
import { decodeTerrarium, encodeTerrarium, terrariumTile } from './terrarium'

const decodeAt = (rgba: Uint8ClampedArray, px: number, py: number): number => {
  const o = (py * 256 + px) * 4
  return decodeTerrarium(rgba[o] ?? 0, rgba[o + 1] ?? 0, rgba[o + 2] ?? 0)
}

describe('Terrarium（計画 D6）', () => {
  it('符号化して戻すと、誤差は 0 以上 1/256 m 未満（切り捨て）', () => {
    const out = new Uint8ClampedArray(4)
    for (const h of [-12.34, 0, 0.01, 11.08, 23.08, 40.028, 3776.24]) {
      encodeTerrarium(h, out, 0)
      const error = h - decodeTerrarium(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)
      expect(error).toBeGreaterThanOrEqual(0)
      expect(error).toBeLessThan(1 / 256)
      expect(out[3]).toBe(255)
    }
  })

  it('z17 のタイルの画素は、同じ z17 のグローバルピクセルのサンプラーの値', () => {
    const sample: ElevationSampler = (gx, gy) => 10 + (gx % 13) * 0.25 + (gy % 11) * 0.5
    const rgba = terrariumTile(sample, 17, 116399, 51623)
    for (const [px, py] of [[0, 0], [128, 64], [255, 255]] as const) {
      const expected = sample(116399 * 256 + px, 51623 * 256 + py) ?? 0
      expect(expected - decodeAt(rgba, px, py)).toBeLessThan(1 / 256)
    }
  })

  it('z16 のタイルは、画素の中心に当たる z17 の画素を 1 点で取る。無効値は 0m', () => {
    const sample: ElevationSampler = (gx, gy) => (gx === 7 * 512 + 1 ? null : gx * 0.001 + gy)
    const rgba = terrariumTile(sample, 16, 7, 3)
    expect(decodeAt(rgba, 0, 0)).toBeCloseTo(0, 2)
    const expected = (7 * 512 + 3) * 0.001 + (3 * 512 + 1)
    expect(expected - decodeAt(rgba, 1, 0)).toBeLessThan(1 / 256)
  })
})
```

- [ ] **Step 5: 失敗することを確かめる**

Run: `pnpm vitest run spike/src/candidates/terrarium.test.ts`
Expected: FAIL（`Failed to resolve import "./terrarium"`）

- [ ] **Step 6: Terrarium を書く**

`spike/src/candidates/terrarium.ts`:

```ts
import type { ElevationSampler } from '../types'

const SIZE = 256
const OFFSET_M = 32768
const DEM_Z = 17

/** 高さ（m）を Terrarium（(R × 256 + G + B / 256) − 32768）の RGBA に書く。刻みは 1/256 m で切り捨て */
export function encodeTerrarium(h: number, out: Uint8ClampedArray, offset: number): void {
  const v = Math.min(65535.99, Math.max(0, h + OFFSET_M))
  const whole = Math.floor(v)
  out[offset] = Math.floor(whole / 256)
  out[offset + 1] = whole % 256
  out[offset + 2] = Math.floor((v - whole) * 256)
  out[offset + 3] = 255
}

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - OFFSET_M
}

/**
 * ズーム z（17 以下）のタイルを、z17 のサンプラーから作る。画素の中心に当たる z17 の画素を 1 点で取る
 * （計画 D5。本番の A は z15 以下で粗い DEM を使うので、これは A の最良の場合）。無効値は 0m（spec 05 §4）
 */
export function terrariumTile(
  sample: ElevationSampler,
  z: number,
  x: number,
  y: number,
): Uint8ClampedArray<ArrayBuffer> {
  if (z > DEM_Z) throw new RangeError(`ズーム ${z} は ${DEM_Z} を超えています`)
  const scale = 2 ** (DEM_Z - z)
  const rgba = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let py = 0; py < SIZE; py++) {
    const gy = Math.floor((y * SIZE + py + 0.5) * scale)
    for (let px = 0; px < SIZE; px++) {
      const gx = Math.floor((x * SIZE + px + 0.5) * scale)
      encodeTerrarium(sample(gx, gy) ?? 0, rgba, (py * SIZE + px) * 4)
    }
  }
  return rgba
}
```

Run: `pnpm vitest run spike/src/candidates/terrarium.test.ts`
Expected: PASS（3 件）

- [ ] **Step 7: 型に行列の検査の結果を足す**

`spike/src/types.ts` の `CandidateHandle` の直前に足す:

```ts
/** 判定 (1) の 1 地点の記録（Task 2）。位置は CSS 画素、標高は m */
export interface ProbePoint {
  label: string
  lngLat: [number, number]
  simElevation: number // シミュレーションのグリッドの標高（倍率なし）
  terrainElevation: number | null // queryTerrainElevation（倍率込み）
  projected: { x: number; y: number } // map.project（地形を考慮する）
  viaMatrixZ0: { x: number; y: number } | null // mainMatrix、z = 0
  viaMatrixTerrain: { x: number; y: number } | null // z = queryTerrainElevation
  viaMatrixSim: { x: number; y: number } | null // z = シミュレーションの標高 × 倍率
}

export interface ApiProbeResult {
  optionKeys: string[] // CustomRenderMethodInput の実際のキー
  nearZ: number
  farZ: number
  fovRad: number
  mvpEqualsMain: boolean // modelViewProjectionMatrix と defaultProjectionData.mainMatrix が同じか
  centerElevation: number // map.getCenterElevation()
  exaggeration: number
  points: ProbePoint[]
}
```

`CandidateHandle` の `renderTimes` の次に足す:

```ts
  /** A・A' だけ。直近の render の引数から判定 (1) の記録を作る。まだ描いていなければ null */
  apiProbe?(): ApiProbeResult | null
```

- [ ] **Step 8: 候補 A の地形と行列の検査を書く**

`spike/src/candidates/a.ts`:

```ts
import { addProtocol, type CustomRenderMethodInput, MercatorCoordinate } from 'maplibre-gl'
import { pixelToLonLat } from '../../../src/dem/tileMath.ts'
import { projectToScreen } from '../mat4'
import type { ApiProbeResult, CandidateHandle, ElevationSampler, MountCandidate, ProbePoint, Scene } from '../types'
import { waitIdle } from '../waitIdle'
import { terrariumTile } from './terrarium'

const PROTOCOL = 'spikedem'
const DEM_SOURCE = 'spike-dem'
const HILLSHADE_SOURCE = 'spike-dem-hs'

// addProtocol はページで 1 回だけ登録する。サンプラーは場面ごとに差し替える
let activeSampler: ElevationSampler | null = null
let protocolRegistered = false

function registerProtocol(sample: ElevationSampler): void {
  activeSampler = sample
  if (protocolRegistered) return
  protocolRegistered = true
  // 返すのは ImageBitmap。MapLibre 6.6.0 の画像の要求はそのまま受け取る（計画 D6）
  addProtocol(PROTOCOL, async (request) => {
    const match = /^spikedem:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url)
    if (match === null || activeSampler === null) throw new Error(`不正な URL: ${request.url}`)
    const rgba = terrariumTile(activeSampler, Number(match[1]), Number(match[2]), Number(match[3]))
    const data = await createImageBitmap(new ImageData(rgba, 256, 256), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    })
    return { data }
  })
}

/** 範囲の中の検査の地点。合成は台地（平ら）・すり鉢の中心・斜面の中ほど、実データは中心と北西寄り */
function probeCells(scene: Scene): { label: string; col: number; row: number }[] {
  const n = scene.range.size
  const at = (fx: number, fy: number) => ({ col: Math.floor(n * fx), row: Math.floor(n * fy) })
  return scene.name === 'synthetic'
    ? [
        { label: 'flat', ...at(0.5, 0.45) },
        { label: 'bowl', ...at(0.5, 0.25) },
        { label: 'slope', ...at(0.5, 0.75) },
      ]
    : [
        { label: 'center', ...at(0.5, 0.5) },
        { label: 'northwest', ...at(0.25, 0.25) },
      ]
}

export const mount: MountCandidate = async (map, scene) => {
  registerProtocol(scene.sample)
  const dem = {
    type: 'raster-dem' as const,
    tiles: [`${PROTOCOL}://{z}/{x}/{y}`],
    tileSize: 256,
    maxzoom: 17,
    encoding: 'terrarium' as const,
  }
  map.addSource(DEM_SOURCE, dem)
  // 陰影は地形と別のソースにする（同じソースだと MapLibre が警告を出す。計画 D18）
  map.addSource(HILLSHADE_SOURCE, dem)
  map.addLayer({
    id: 'spike-hillshade',
    type: 'hillshade',
    source: HILLSHADE_SOURCE,
    paint: { 'hillshade-exaggeration': 0.5 },
  })
  let exaggeration = 1
  map.setTerrain({ source: DEM_SOURCE, exaggeration })

  // 何も描かず、render の引数だけを覚えるレイヤー（判定 (1) の材料）
  let last: CustomRenderMethodInput | null = null
  map.addLayer({
    id: 'spike-probe',
    type: 'custom',
    renderingMode: '3d',
    render(_gl, options) {
      last = options
    },
  })

  const cells = probeCells(scene)
  const metersToMercator = MercatorCoordinate.fromLngLat([
    scene.center.lon,
    scene.center.lat,
  ]).meterInMercatorCoordinateUnits()

  const apiProbe = (): ApiProbeResult | null => {
    const options = last as CustomRenderMethodInput | null
    if (options === null) return null
    const canvas = map.getCanvas()
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const matrix = options.defaultProjectionData.mainMatrix
    const points: ProbePoint[] = cells.map(({ label, col, row }) => {
      const { range } = scene
      const ll = pixelToLonLat(range.originX + col + 0.5, range.originY + row + 0.5, range.z)
      const lngLat: [number, number] = [ll.lon, ll.lat]
      const merc = MercatorCoordinate.fromLngLat(lngLat)
      const simElevation = scene.elevation[row * range.size + col] ?? 0
      const terrainElevation = map.queryTerrainElevation(lngLat)
      const via = (meters: number) =>
        projectToScreen(matrix, [merc.x, merc.y, meters * metersToMercator], width, height)
      const projected = map.project(lngLat)
      return {
        label,
        lngLat,
        simElevation,
        terrainElevation,
        projected: { x: projected.x, y: projected.y },
        viaMatrixZ0: via(0),
        viaMatrixTerrain: terrainElevation === null ? null : via(terrainElevation),
        viaMatrixSim: via(simElevation * exaggeration),
      }
    })
    const mvp = Array.from(options.modelViewProjectionMatrix)
    return {
      optionKeys: Object.keys(options).sort(),
      nearZ: options.nearZ,
      farZ: options.farZ,
      fovRad: options.fov,
      mvpEqualsMain: mvp.every((v, i) => v === matrix[i]),
      centerElevation: map.getCenterElevation(),
      exaggeration,
      points,
    }
  }

  return {
    renderTimes: [],
    setExaggeration(value) {
      exaggeration = value
      map.setTerrain({ source: DEM_SOURCE, exaggeration: value })
    },
    // 水面は Task 3 で足す（この Task では地形と行列だけを見る）
    setDepth() {},
    setDebug() {},
    whenIdle: () => waitIdle(map),
    apiProbe,
  } satisfies CandidateHandle
}
```

`spike/src/main.ts` の `const candidates … = {}` を次にする:

```ts
const candidates: Partial<Record<CandidateId, () => Promise<{ mount: MountCandidate }>>> = {
  a: () => import('./candidates/a'),
}
```

`map.addSource` の型が `tiles` に独自のプロトコルを受けない、などで型エラーが出たら、`as const` を外して `RasterDEMSourceSpecification` の型注釈（`import type { RasterDEMSourceSpecification } from 'maplibre-gl'`）に置き換える。

- [ ] **Step 9: 判定 (1) の E2E を書く**

`spike/e2e/apiProbe.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ApiProbeResult, View } from '../src/types'
import { openSpike, setView, ZOOMS } from './support/views'

const resultsDir = new URL('../results/', import.meta.url)
const distance = (
  a: { x: number; y: number } | null,
  b: { x: number; y: number },
): number => (a === null ? Number.POSITIVE_INFINITY : Math.hypot(a.x - b.x, a.y - b.y))

test('A: Custom Layer の行列に地形の高さが反映されるか（判定 (1)）', async ({ page, context }) => {
  const errors = await openSpike(page, context, { candidate: 'a', scene: 'synthetic' })
  const rows: { view: View; probe: ApiProbeResult }[] = []
  for (const zoom of ZOOMS) {
    for (const exaggeration of [1, 10]) {
      for (const pitch of [0, 60]) {
        const view = { zoom, exaggeration, pitch }
        await setView(page, view)
        const probe = await page.evaluate(() => window.spike?.candidate?.apiProbe?.() ?? null)
        expect(probe).not.toBeNull()
        if (probe !== null) rows.push({ view, probe })
      }
    }
  }
  mkdirSync(resultsDir, { recursive: true })
  writeFileSync(new URL('api-probe.json', resultsDir), `${JSON.stringify(rows, null, 2)}\n`)

  // 台地（平ら）では地形の LOD によらず高さが一致するので、行列の意味だけを取り出せる
  console.log('zoom exag pitch | z=0 | 地形 | シミュ | bowl の 地形−シミュ×倍率 (m)')
  for (const { view, probe } of rows) {
    const flat = probe.points.find((p) => p.label === 'flat')
    const bowl = probe.points.find((p) => p.label === 'bowl')
    if (flat === undefined || bowl === undefined) continue
    const lod = (bowl.terrainElevation ?? Number.NaN) - bowl.simElevation * view.exaggeration
    console.log(
      `${view.zoom} ${view.exaggeration} ${view.pitch} | ${distance(flat.viaMatrixZ0, flat.projected).toFixed(1)} | ${distance(flat.viaMatrixTerrain, flat.projected).toFixed(1)} | ${distance(flat.viaMatrixSim, flat.projected).toFixed(1)} | ${lod.toFixed(3)}`,
    )
  }
  expect(errors).toEqual([])
})
```

- [ ] **Step 10: 検査を通し、判定 (1) を行う**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm spike:e2e spike/e2e/apiProbe.spec.ts`
Expected: PASS。16 行の表が出て、`spike/results/api-probe.json` ができる。

判定 (1) の規則（D1。表の「台地」の列で判定する）:

| 観測 | 意味 | 判定 |
|---|---|---|
| 16 通りすべてで「シミュ」の列が 1px 以下 | 行列は絶対の標高（メルカトルの等角の z）で、地形の高さは入っていない。シミュレーションの標高 × 倍率で水面を置けば、MapLibre の地形と同じ位置に出る | **合格。A を A 系の本線にする** |
| 「z=0」の列が 1px 以下 | 行列に地形の高さが含まれる。水面をシミュレーションの標高で置くと二重に高くなり、地形に合わせるには MapLibre の地形の高さに頼るしかない | **不合格。A' を A 系の本線にする** |
| どちらも 1px を超える | 行列の意味を特定できない（例: 視点の中心の標高で平行移動されている）。`centerElevation` との関係を 1 時間まで調べ、式が分かればその式を報告に書いて「合格（補正つき）」、分からなければ不合格 | 上の 2 つのどちらか |

表の最後の列（すり鉢の中心での、MapLibre の地形とシミュレーションの標高 × 倍率の差、m）は、LOD によるずれの大きさとして報告に写す（判定 (2) の予想にも使う）。

- [ ] **Step 11: 報告の §5 を書く**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` の「## 5. Custom Layer の API（MapLibre 6.6.0）」の本文を、次の内容で置き換える（「…」の箇所は、この Step で `spike/results/api-probe.json` と Step 10 の表から実際の値を書き入れる）:

- 型（maplibre-gl.d.ts）: 本計画の「事前に確かめた事実」の `CustomLayerInterface`・`CustomRenderMethod`・`CustomRenderMethodInput`・`setTerrain`・`queryTerrainElevation`・`addProtocol` の行を、そのまま箇条書きで写す
- 実測した `optionKeys` の一覧、`nearZ`・`farZ`・`fov` の範囲（16 通りの最小〜最大）、`mvpEqualsMain`
- Step 10 の 16 行の表（Markdown の表にする）と、判定 (1) の結果（上の規則のどの行に当たったか）
- すり鉢の中心での LOD のずれ（ズームごとの最大の絶対値、m）
- Terrarium の刻み（1/256 m ≈ 3.9mm、切り捨て）は 1cm の膜より小さいこと

§4 の表の「Custom Layer の API」の行の A と A' の欄に、判定 (1) の結果を一言で書く（例: 「絶対標高。地形の高さは自前で与える（台地で誤差 0.3px 以下）」）。

- [ ] **Step 12: Commit**

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 候補 A の地形（addProtocol で Terrarium に変換）と、Custom Layer の行列の検査（判定 (1)）"
```

---
### Task 3: 候補 A の水面と、判定 (2)（1cm の水面の z-fighting と polygonOffset）

**1 日目の午後（約 3 時間）。D1 の 2 つ目の分かれ目。** ここで作るメッシュ・シェーダ・画面の測り方・コンタクトシートは、Task 5〜7 でもそのまま使う。

**Files:**
- Create: `spike/src/gridMesh.ts`、`spike/src/gridMesh.test.ts`、`spike/src/shaders.ts`、`spike/src/candidates/threeWater.ts`、`spike/src/capture.ts`
- Create: `spike/e2e/support/contactSheet.ts`、`spike/e2e/matrix.spec.ts`
- Modify: `spike/src/candidates/a.ts`（水面を足す）、`spike/src/types.ts`（`WaterMeasure`・`SpikeGlobal.measure`）、`spike/src/main.ts`（`measure`）
- Create（実行の結果）: `spike/results/water-a.json`、`spike/results/water-a.md`、`spike/results/sheets/a-synthetic.jpg`、`spike/results/sheets/a-real.jpg`
- Modify: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`（§3・§4・§7）

**Interfaces:**
- Consumes: Task 1 の `Scene`・`CandidateHandle`・`WaterDebug`・`ZFix`・`MIN_DEPTH_M`・`waitIdle`・`openSpike`・`setView`・`allViews`、Task 2 の `multiply`・`gridModelMatrix`・`a.ts` の地形と `apiProbe`
- Produces（`gridMesh.ts`）: `gridVertices(n: number, ring: boolean): Float32Array`（頂点ごとの（列, 行）。`ring` なら −1〜n の (n + 2)² 個）、`gridIndices(verticesPerSide: number, start: number, count: number): Uint32Array`（頂点の行・列が start〜start + count − 1 の四角形を 2 枚の三角形に）
- Produces（`shaders.ts`）: `WATER_VERTEX`・`WATER_FRAGMENT`・`TERRAIN_VERTEX`・`TERRAIN_FRAGMENT`（`#version` を含まない GLSL ES 3.00。three の `RawShaderMaterial` は `glslVersion: GLSL3` で `#version 300 es` を前に付ける。B-raw は自分で付ける）。uniform: `u_matrix`（mat4）、`u_elevation`・`u_depth`（R32F）、`u_size`（int）、`u_baseM`、`u_elevScale`、`u_depthScale`、`u_minDepth`、`u_debug`（int）、`u_cellM`、`u_basemap`
- Produces（`threeWater.ts`）: `interface ThreeWaterOptions { id: string; scene: Scene; elevation: Float32Array; elevScale: 'exaggeration' | 'one'; zfix: ZFix; renderTimes: number[] }`、`interface ThreeWater { layer: CustomLayerInterface; setExaggeration(value: number): void; setDepth(depth: Float32Array): void; setElevation(elevation: Float32Array): void; setDebug(mode: WaterDebug): void }`、`createThreeWater(map: MapLibreMap, options: ThreeWaterOptions): ThreeWater`
- Produces（`capture.ts`・`types.ts`）: `interface WaterMeasure { footprintPx: number; visibleRatio: number; flickerRatio: number; interiorPx: number }`、`measureWater(map: MapLibreMap, candidate: CandidateHandle): Promise<WaterMeasure>`、`SpikeGlobal.measure(): Promise<WaterMeasure>`
- Produces（`contactSheet.ts`）: `interface Shot { label: string; png: Buffer }`、`writeContactSheet(context: BrowserContext, shots: Shot[], columns: number, title: string, path: string): Promise<void>`
- Produces（`matrix.spec.ts`）: 候補の一覧 `MATRIX_CANDIDATES`（この Task では `['a']`。Task 5〜7 で足す）、数値の計測の視点 `MEASURE_VIEWS`（16 通り。R1）。テスト名 `matrix: <候補>`（`-g "matrix: a$"` で 1 候補だけ回せる）

- [ ] **Step 1: メッシュの失敗するテストを書く**

`spike/src/gridMesh.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { gridIndices, gridVertices } from './gridMesh'

describe('格子のメッシュ', () => {
  it('縁なしの頂点は (列, 行) = (0, 0)〜(n − 1, n − 1) を行優先で並べる', () => {
    expect(Array.from(gridVertices(2, false))).toEqual([0, 0, 1, 0, 0, 1, 1, 1])
  })

  it('縁ありの頂点は −1〜n で、(n + 2)² 個', () => {
    const v = gridVertices(2, true)
    expect(v.length).toBe(4 * 4 * 2)
    expect([v[0], v[1]]).toEqual([-1, -1])
    expect([v[v.length - 2], v[v.length - 1]]).toEqual([2, 2])
  })

  it('3 × 3 の頂点の全体は 4 つの四角形・8 枚の三角形', () => {
    const index = gridIndices(3, 0, 3)
    expect(index.length).toBe(8 * 3)
    expect(Array.from(index.slice(0, 6))).toEqual([0, 3, 1, 1, 3, 4])
    expect(Math.max(...index)).toBe(8)
  })

  it('縁ありの配置で内側だけを選ぶと、縁の頂点を使わない', () => {
    const n = 4
    const m = n + 2
    const index = gridIndices(m, 1, n)
    expect(index.length).toBe((n - 1) * (n - 1) * 6)
    for (const i of index) {
      const col = i % m
      const row = Math.floor(i / m)
      expect(col >= 1 && col <= n && row >= 1 && row <= n).toBe(true)
    }
  })
})
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run spike/src/gridMesh.test.ts`
Expected: FAIL（`Failed to resolve import "./gridMesh"`）

- [ ] **Step 3: メッシュとシェーダを書く**

`spike/src/gridMesh.ts`:

```ts
/**
 * 格子の頂点（列, 行）。ring なら外周に 1 列ずつ足し、−1〜n にする（B の縁。計画 D17）。
 * 頂点の位置と高さはシェーダが texelFetch で求めるので、頂点はセル番号だけを持つ（spec 05 §3.1）
 */
export function gridVertices(n: number, ring: boolean): Float32Array {
  const offset = ring ? 1 : 0
  const m = n + 2 * offset
  const out = new Float32Array(m * m * 2)
  for (let row = 0; row < m; row++) {
    for (let col = 0; col < m; col++) {
      const i = (row * m + col) * 2
      out[i] = col - offset
      out[i + 1] = row - offset
    }
  }
  return out
}

/** 一辺 verticesPerSide 個の頂点の配置のうち、行・列が start〜start + count − 1 の頂点で張る三角形 */
export function gridIndices(verticesPerSide: number, start: number, count: number): Uint32Array {
  const quads = (count - 1) * (count - 1)
  const out = new Uint32Array(quads * 6)
  let k = 0
  for (let row = start; row < start + count - 1; row++) {
    for (let col = start; col < start + count - 1; col++) {
      const a = row * verticesPerSide + col
      const b = a + 1
      const d = a + verticesPerSide
      const e = d + 1
      out.set([a, d, b, b, d, e], k)
      k += 6
    }
  }
  return out
}
```

`spike/src/shaders.ts`:

```ts
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
```

Run: `pnpm vitest run spike/src/gridMesh.test.ts`
Expected: PASS（4 件）

- [ ] **Step 4: three の水面のレイヤーを書く**

`spike/src/candidates/threeWater.ts`:

```ts
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
```

`renderer.setViewport` は pixelRatio（既定 1）を掛けるので、drawingBuffer の画素数をそのまま渡してよい。

- [ ] **Step 5: 候補 A に水面を足す**

`spike/src/candidates/a.ts` を次の差分で変える。

import に足す:

```ts
import { createThreeWater } from './threeWater'
```

`mount` の引数を `async (map, scene, params) =>` にする。`map.addLayer({ id: 'spike-probe', … })` の直後に足す:

```ts
  const renderTimes: number[] = []
  // A: 水面の高さはシミュレーションの標高から（spec S §2）。地形（MapLibre の 3D terrain）の後に描く
  const water = createThreeWater(map, {
    id: 'spike-water',
    scene,
    elevation: scene.elevation,
    elevScale: 'exaggeration',
    zfix: params.zfix,
    renderTimes,
  })
  map.addLayer(water.layer)
```

末尾の `return { … } satisfies CandidateHandle` を次にする:

```ts
  return {
    renderTimes,
    setExaggeration(value) {
      exaggeration = value
      // 合格基準 2: 地形と水面に同じ倍率を掛ける
      map.setTerrain({ source: DEM_SOURCE, exaggeration: value })
      water.setExaggeration(value)
    },
    setDepth: (depth) => water.setDepth(depth),
    setDebug: (mode) => water.setDebug(mode),
    whenIdle: () => waitIdle(map),
    apiProbe,
  } satisfies CandidateHandle
```

- [ ] **Step 6: 画面の測り方を書く**

`spike/src/types.ts` の `SpikeGlobal` の前に足す:

```ts
/** 水面の見え方の数値（計画 D9）。画素は drawingBuffer の画素 */
export interface WaterMeasure {
  footprintPx: number // 深度テストなしで描いた水面の画素数
  visibleRatio: number // 深度テストありで見えた画素数 ÷ footprintPx
  interiorPx: number // footprint を 2 画素削った内側の画素数
  flickerRatio: number // 内側のうち、視点をわずかに動かした 3 枚で見え方が変わった画素の割合
}
```

`SpikeGlobal` の `setView` の次に足す:

```ts
  /** 候補の水面の見え方を測る（capture=1 のときだけ使える） */
  measure(): Promise<WaterMeasure>
```

`spike/src/capture.ts`:

```ts
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CandidateHandle, WaterMeasure } from './types'

// bearing をわずかに動かす量（度）と、内側を削る画素数。遠くの画素の移動をちらつきと取り違えないため（計画 D9）
const JITTER_DEG = [0, 0.002, -0.002] as const
const ERODE_PX = 2

/** 画面を読み取り、マゼンタ（水面の判定用の色）の画素を 1 にしたマスクを返す。preserveDrawingBuffer が要る */
function readMask(map: MapLibreMap): { mask: Uint8Array; width: number; height: number } {
  const canvas = map.getCanvas()
  const { width, height } = canvas
  const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })
  if (context === null) throw new Error('2D コンテキストを得られません')
  context.drawImage(canvas, 0, 0)
  const { data } = context.getImageData(0, 0, width, height)
  const mask = new Uint8Array(width * height)
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4
    mask[i] = (data[o] ?? 0) > 200 && (data[o + 1] ?? 255) < 80 && (data[o + 2] ?? 0) > 200 ? 1 : 0
  }
  return { mask, width, height }
}

function erode(mask: Uint8Array, width: number, height: number, times: number): Uint8Array {
  let current = mask
  for (let t = 0; t < times; t++) {
    const next = new Uint8Array(current.length)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        next[i] =
          current[i] === 1 &&
          current[i - 1] === 1 &&
          current[i + 1] === 1 &&
          current[i - width] === 1 &&
          current[i + width] === 1
            ? 1
            : 0
      }
    }
    current = next
  }
  return current
}

const count = (mask: Uint8Array): number => mask.reduce((sum, v) => sum + v, 0)

/** 深度テストなしの水面（全体）と、深度テストありで見えた水面を比べる。終わったら元の表示に戻す */
export async function measureWater(
  map: MapLibreMap,
  candidate: CandidateHandle,
): Promise<WaterMeasure> {
  const bearing = map.getBearing()
  candidate.setDebug('mask-nodepth')
  await candidate.whenIdle()
  const footprint = readMask(map)
  candidate.setDebug('mask')
  const visible: Uint8Array[] = []
  for (const delta of JITTER_DEG) {
    map.jumpTo({ bearing: bearing + delta })
    await candidate.whenIdle()
    visible.push(readMask(map).mask)
  }
  map.jumpTo({ bearing })
  candidate.setDebug('off')
  await candidate.whenIdle()

  const footprintPx = count(footprint.mask)
  const first = visible[0] ?? new Uint8Array(0)
  const interior = erode(footprint.mask, footprint.width, footprint.height, ERODE_PX)
  let interiorPx = 0
  let changed = 0
  for (let i = 0; i < interior.length; i++) {
    if (interior[i] !== 1) continue
    interiorPx++
    if (visible.some((mask) => mask[i] !== first[i])) changed++
  }
  return {
    footprintPx,
    visibleRatio: footprintPx === 0 ? 1 : Math.min(1, count(first) / footprintPx),
    interiorPx,
    flickerRatio: interiorPx === 0 ? 0 : changed / interiorPx,
  }
}
```

`spike/src/main.ts` に `import { measureWater } from './capture'` を足し、`spike` のオブジェクトの `setView` の次に足す:

```ts
    async measure() {
      if (candidate === null) throw new Error('候補がありません')
      if (!params.capture) throw new Error('capture=1 で開いてください')
      return measureWater(map, candidate)
    },
```

- [ ] **Step 7: コンタクトシートと、視点の組み合わせの E2E を書く**

`spike/e2e/support/contactSheet.ts`:

```ts
import type { BrowserContext } from '@playwright/test'

export interface Shot {
  label: string
  png: Buffer
}

/** スクリーンショットを 1 枚の JPEG に並べる（計画 D10）。1 コマ 240 × 150、品質 70 */
export async function writeContactSheet(
  context: BrowserContext,
  shots: Shot[],
  columns: number,
  title: string,
  path: string,
): Promise<void> {
  const page = await context.newPage()
  await page.setViewportSize({ width: columns * 240 + 16, height: 600 })
  const cells = shots
    .map(
      (shot) =>
        `<figure><img src="data:image/png;base64,${shot.png.toString('base64')}"><figcaption>${shot.label}</figcaption></figure>`,
    )
    .join('')
  await page.setContent(`<style>
    body { margin: 8px; font: 11px sans-serif; }
    h1 { margin: 0 0 4px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(${columns}, 240px); }
    figure { position: relative; margin: 0; }
    img { display: block; width: 240px; height: 150px; }
    figcaption { position: absolute; top: 2px; left: 2px; padding: 0 3px; background: #ffffffcc; }
  </style><h1>${title}</h1><div class="grid">${cells}</div>`)
  await page.screenshot({ path, type: 'jpeg', quality: 70, fullPage: true })
  await page.close()
}
```

コンタクトシートの `setContent` が重い場合の代わり（R5。まず上の `writeContactSheet` で試し、1 枚に 1 分以上かかったときだけ使う）: `spike/e2e/support/contactSheet.ts` の先頭に `import { writeFileSync } from 'node:fs'` を足し、末尾に足す:

```ts
/**
 * 代わりの経路（計画 D10）: data URI の HTML（20〜30 MB）を使わず、HTML を out/ に書いて file:// で開き、
 * out/shots/ の PNG を相対パスで読ませる
 */
export async function writeContactSheetFromFiles(
  context: BrowserContext,
  shots: { label: string; file: string }[], // file は out/shots/ の中のファイル名
  columns: number,
  title: string,
  outDir: URL, // spike/out/
  path: string,
): Promise<void> {
  const html = new URL('contact.html', outDir)
  const cells = shots
    .map(
      (shot) =>
        `<figure><img src="shots/${encodeURIComponent(shot.file)}"><figcaption>${shot.label}</figcaption></figure>`,
    )
    .join('')
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>
    body { margin: 8px; font: 11px sans-serif; }
    h1 { margin: 0 0 4px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(${columns}, 240px); }
    figure { position: relative; margin: 0; }
    img { display: block; width: 240px; height: 150px; }
    figcaption { position: absolute; top: 2px; left: 2px; padding: 0 3px; background: #ffffffcc; }
  </style><h1>${title}</h1><div class="grid">${cells}</div>`,
  )
  const page = await context.newPage()
  await page.setViewportSize({ width: columns * 240 + 16, height: 600 })
  await page.goto(html.href)
  await page.screenshot({ path, type: 'jpeg', quality: 70, fullPage: true })
  await page.close()
}
```

切り替えるときは、下の `matrix.spec.ts` の「1. スクリーンショット」のループと `writeContactSheet` の呼び出しを次にする（import に `writeContactSheetFromFiles` を足す）:

```ts
      const files: { label: string; file: string }[] = []
      for (const view of allViews()) {
        await setView(page, view)
        const file = `${candidate}-${scene}-${label(view).replaceAll(' ', '_')}.png`
        writeFileSync(new URL(file, shotsDir), await page.screenshot())
        files.push({ label: label(view), file })
      }
      await writeContactSheetFromFiles(
        context,
        files,
        4,
        `${candidate} / ${scene}（行: ズーム × 垂直強調、列: pitch 0・45・60・85）`,
        new URL('../out/', import.meta.url),
        fileURLToPath(new URL(`sheets/${candidate}-${scene}.jpg`, results)),
      )
```

切り替えたら、そのことを報告の §3 に書く。

`spike/e2e/matrix.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'
import type { View, WaterMeasure, ZFix } from '../src/types'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { allViews, openSpike, setView } from './support/views'

// Task 5〜7 で候補を足す
const MATRIX_CANDIDATES = ['a'] as const

// 判定の閾値（計画 D9）
const MIN_VISIBLE = 0.98
const MAX_FLICKER = 0.01
// 数値の計測の視点（16 通り）: ズーム 15〜18 × 倍率 1・10 × pitch 60・85。スクリーンショットは 64 通りのまま（R1）
const MEASURE_VIEWS: View[] = allViews().filter(
  (v) => (v.exaggeration === 1 || v.exaggeration === 10) && (v.pitch === 60 || v.pitch === 85),
)

const results = new URL('../results/', import.meta.url)
const shotsDir = new URL('../out/shots/', import.meta.url)

interface MeasureRow {
  scene: string
  zfix: ZFix
  view: View
  measure: WaterMeasure
}

const label = (v: View): string => `z${v.zoom} ×${v.exaggeration} p${v.pitch}`

async function measure(page: Page): Promise<WaterMeasure> {
  return page.evaluate(async () => {
    if (window.spike === undefined) throw new Error('window.spike がありません')
    return window.spike.measure()
  })
}

/** 視点ごとの最小の可視率と最大のちらつきの表（ズーム × 垂直強調、pitch の 4 通りをまとめる） */
function summarize(rows: MeasureRow[], scene: string, zfix: ZFix): string {
  const lines = [`### ${scene} / zfix=${zfix}`, '', '| ズーム | 強調 | 可視率の最小 | ちらつきの最大 | 判定 |', '|---|---|---:|---:|:---:|']
  for (const zoom of [15, 16, 17, 18]) {
    for (const exaggeration of [1, 2, 5, 10]) {
      const group = rows.filter(
        (r) => r.scene === scene && r.zfix === zfix && r.view.zoom === zoom && r.view.exaggeration === exaggeration,
      )
      if (group.length === 0) continue
      const visible = Math.min(...group.map((r) => r.measure.visibleRatio))
      const flicker = Math.max(...group.map((r) => r.measure.flickerRatio))
      const ok = visible >= MIN_VISIBLE && flicker <= MAX_FLICKER
      lines.push(`| ${zoom} | ${exaggeration} | ${visible.toFixed(4)} | ${(flicker * 100).toFixed(2)}% | ${ok ? '○' : '×'} |`)
    }
  }
  return `${lines.join('\n')}\n`
}

for (const candidate of MATRIX_CANDIDATES) {
  test(`matrix: ${candidate}`, async ({ page, context }) => {
    mkdirSync(shotsDir, { recursive: true })
    mkdirSync(new URL('sheets/', results), { recursive: true })
    // openSpike の配列は後のエラーも受け取り続けるので、参照を持って最後に確かめる（P20）
    const lists: string[][] = []
    const rows: MeasureRow[] = []

    // 1. スクリーンショット（固定の水、対策あり）。場面ごとに 1 枚のコンタクトシート
    for (const scene of ['synthetic', 'real'] as const) {
      lists.push(await openSpike(page, context, { candidate, scene, water: 'fixed' }))
      const shots: Shot[] = []
      for (const view of allViews()) {
        await setView(page, view)
        const png = await page.screenshot()
        writeFileSync(new URL(`${candidate}-${scene}-${label(view).replaceAll(' ', '_')}.png`, shotsDir), png)
        shots.push({ label: label(view), png })
      }
      await writeContactSheet(
        context,
        shots,
        4,
        `${candidate} / ${scene}（行: ズーム × 垂直強調、列: pitch 0・45・60・85）`,
        fileURLToPath(new URL(`sheets/${candidate}-${scene}.jpg`, results)),
      )
    }

    // 2. 判定 (2): 合成の斜面の 1cm の膜だけを、対策なし・ありで測る。実データは対策ありの参考値（16 視点。R1）
    const plans = [
      { scene: 'synthetic', water: 'film', zfix: 'none' },
      { scene: 'synthetic', water: 'film', zfix: 'offset' },
      { scene: 'synthetic', water: 'film', zfix: 'offset2' },
      { scene: 'real', water: 'fixed', zfix: 'offset' },
    ] as const
    for (const plan of plans) {
      lists.push(
        await openSpike(page, context, {
          candidate,
          scene: plan.scene,
          water: plan.water,
          zfix: plan.zfix,
          capture: 1,
        }),
      )
      for (const view of MEASURE_VIEWS) {
        await setView(page, view)
        rows.push({ scene: plan.scene, zfix: plan.zfix, view, measure: await measure(page) })
      }
    }
    writeFileSync(new URL(`water-${candidate}.json`, results), `${JSON.stringify(rows, null, 2)}\n`)
    const summary = plans.map((p) => summarize(rows, p.scene, p.zfix)).join('\n')
    writeFileSync(new URL(`water-${candidate}.md`, results), `# ${candidate} の水面の見え方\n\n${summary}`)
    console.log(summary)
    expect(lists.flat()).toEqual([])
  })
}
```

- [ ] **Step 8: 検査を通し、A の組み合わせを回す**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて成功

Run: `pnpm spike:e2e spike/e2e/matrix.spec.ts -g "matrix: a$"`
Expected: PASS（ページのエラーが無い）。`spike/results/water-a.{json,md}` と `spike/results/sheets/a-{synthetic,real}.jpg` ができる。所要時間をメモする（報告の「方法」に書く）。見積もり（R1）: スクリーンショット 128 視点 × idle 1 回と、数値の計測 4 通り × 16 視点 × idle 約 6 回で、計 約 510 回の idle。SwiftShader で idle が 0.5〜2 秒なら 5〜17 分。20 分を超えそうなら、`plans` から実データの行（参考値）を外して回し直し、外したことを報告に書く

コンタクトシートを開き（`spike/results/sheets/a-synthetic.jpg`）、目で次を確かめてメモする: 3 つの池の縁が地形に沈んでいないか、斜面の膜がまだらになっていないか、垂直強調 10x で水面と地形がずれていないか（合格基準 2）。

- [ ] **Step 9: 判定 (2) を行い、報告に書く**

判定 (2) の規則（D1・D9。`water-a.md` の「synthetic / zfix=…」の表で判定する）:

| 観測 | 判定 |
|---|---|
| zfix=offset か offset2 の 8 行（ズーム 4 × 倍率 1・10）がすべて ○ | **合格**（対策で足りる）。zfix=none との差と、どちらの係数で足りたかを報告に書く |
| offset・offset2 のどちらにも × があるが、× の行が「ズーム 15・16 だけ」など LOD で説明できる（Task 2 の表のすり鉢の差が 1cm × 倍率を超えるズーム） | **不合格（LOD による沈み込み）**。深度の精度ではなく高さの食い違いが原因。A' で改善する見込みがある |
| offset・offset2 のどちらにも × があり、LOD の差が小さいズーム（17・18）でも起きる | **不合格（深度の精度）**。A 系の対策（polygonOffset）では足りない |

× の原因を分ける 2 つ目の規則（R3。上の表の 2 行目と 3 行目のどちらに当たるかを、次の 2 つで確かめる）:

1. **倍率への依存:** LOD による食い違いは「高さの差 × 倍率」で大きくなる。同じズームで、× が倍率 1 では出ず倍率 10 で出る（または可視率が倍率 1 より 10 で明らかに下がる）なら **LOD による沈み込み**。倍率 1 と 10 で同じように × なら **深度の精度**
2. **Task 2 との照合:** 水面は（シミュレーションの標高 + 0.01）× 倍率、地形は シミュレーションの標高 × 倍率 + d の高さに描かれる（d は Task 2 の表の最後の列「地形 − シミュ × 倍率」、倍率込みの m）。したがって d > 0.01 × 倍率（倍率 1 に直した差が 1cm を超える）のズームと倍率では、LOD だけで膜が沈む。× の出た（ズーム, 倍率）ごとに、`api-probe.json` の同じズーム・倍率の d と 0.01 × 倍率を比べ、超えていれば LOD、超えていなければ深度の精度とみなす（すり鉢の点の値なので斜面より大きめに出る。LOD 側に寄った見積もりであることを報告に書く）

1 と 2 の見方が食い違ったら、両方の数値を報告に書き、判定は「深度の精度」（A 系にとって悪い方）にする。

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` を書き足す:
- §3 に「可視率・ちらつきの定義（`WaterMeasure` の 4 項目の説明をそのまま）、閾値（可視率 0.98 以上・ちらつき 1% 以下）、判定に使う場面（合成の斜面の 1cm の膜。遮るものが無い）、実データの値は手前の地形が正当に隠す分を含む参考値であること、所要時間」
- §4 の「合格基準 1」の行の A の欄: zfix=offset の可視率の最小・ちらつきの最大と判定 (2) の結果。「z-fighting の対策の効果」の行の A の欄: zfix=none と offset の比較（× の行の数）
- §4 の「合格基準 2」の行の A の欄: Step 8 の目視と、Task 2 のすり鉢の差（倍率 1 と 10 で、LOD の差が倍率に比例して大きくなるか）
- §7 に `spike/results/sheets/a-synthetic.jpg`・`a-real.jpg` への参照（パスのみ。URL は Task 10 で付ける）

- [ ] **Step 10: Commit**

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 候補 A の水面（three）、1cm の膜の可視率とちらつきの計測、コンタクトシート（判定 (2)）"
```

---
### Task 4: 1 日目の中間の判定と、2 日目以降の配分（D1）

**1 日目の終わり（約 30 分）。コードは書かない。**

**Files:**
- Modify: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`（§6）、この計画のファイルの「日程」（配分を変えた場合だけ）

**Interfaces:**
- Consumes: Task 2 の判定 (1)（`spike/results/api-probe.json` と Step 10 の表）、Task 3 の判定 (2)（`spike/results/water-a.md`）
- Produces: 2 日目以降の配分（下の表のどの行か）。Task 5〜7 はこの結果を読む

- [ ] **Step 1: 表に当てはめて配分を決める**

| 判定 (1) | 判定 (2)（A、zfix=offset・offset2 の良い方） | 2 日目以降 |
|---|---|---|
| 合格 | 合格 | A を A 系の本線にする。Task 5（A'）は「最小」（Step 1〜7。高さの差と取り直しの時間を記録し、matrix と流れの矢印を回す）。Task 6・7 は予定どおり |
| 合格 | 不合格（LOD による沈み込み） | Task 5 を「全部」（Step 1〜9）行い、A' で判定 (2) が直るかを確かめる。A' でも不合格なら、A 系は「基準 1 を満たさない」として報告に書き、Task 6・7 に残りの時間を回す |
| 合格 | 不合格（深度の精度） | A 系の対策（polygonOffset）では足りない。Task 5 は「最小」。浮いた時間で、Task 6 の Step 9（B の 1cm の膜の対策の比較: 頂点の共有 + 描画順だけ、+ offset、+ offset2）を丁寧に行う |
| 不合格 | どれでも | A' を A 系の本線にする。Task 5 を「全部」行う。A は「行列に地形の高さが入るので、シミュレーションの標高で置けない」として報告に残す |

- [ ] **Step 2: 報告の §6 を書く**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` の「## 6. 1 日目の中間の判定」の本文に、次を書く（値は Task 2・3 の結果から）:
- 判定 (1) の結果と根拠（台地の点での 3 つの列の最大の誤差、px）
- 判定 (2) の結果と根拠（zfix=none・offset・offset2 の、判定の表の × の行の数と、× の出たズーム）
- 上の表のどの行に当たったか、2 日目以降の配分
- 1 日目にかかった時間と、日程の見直し（遅れていれば、「日程」の打ち切りの規則をどう使うか）

配分を変えた場合は、この計画の「日程」の表も同じ内容に直す。

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/spikes docs/superpowers/plans
git commit -m "スパイク S: 1 日目の中間の判定（行列と地形の高さ、1cm の水面の z-fighting）と 2 日目以降の配分"
```

（この計画のファイルをまだリポジトリに置いていなければ、`docs/superpowers/plans` は add から外す）

- [ ] **Step 4: コーディネーターに中間の判定を知らせる**

実行役の途中の報告として、判定 (1)・(2) の結果、当てはまった表の行、2 日目の予定を 5 行以内で送る。ユーザーやレビュー役が配分を変えるよう求めたら、それに従って「日程」を直してから Task 5 に進む。

---
### Task 5: 候補 A'（水面の高さを MapLibre の地形に合わせる）

**2 日目の午前。Task 4 の配分で「最小」なら Step 1〜7 と Step 10・11（約 4 時間 15 分）、「全部」なら Step 1〜11（約半日強）。Step 7 の流れの矢印（D20）、Step 10 の曲面の膜（M1）、Step 11 の針状ノイズの切り分け（M2、30 分の時間箱）はどちらでも行う。Task 4 の裁定は「最小」。**

**Files:**
- Modify: `spike/src/types.ts`（`ResampleInfo`・`ArrowPlacement`・`CandidateHandle.lastResample?`・`freezeElevation?`・`showArrows?`）、`spike/src/candidates/a.ts`（A' の分岐、矢印）、`spike/src/capture.ts`（計測の間は高さを固定。R2）、`spike/src/main.ts`（候補 `a2`）、`spike/e2e/matrix.spec.ts`（`MATRIX_CANDIDATES`）
- Modify（Step 10・11）: `spike/src/types.ts`（`WaterMode` に `bowlFilm`）、`spike/src/params.ts`・`spike/src/params.test.ts`（`water=bowlFilm`、`demFill`）、`spike/src/scenes.ts`・`spike/src/scenes.test.ts`（`isBowlCell`・`bowlFilm`・`fillInvalidNearest`・`buildRealScene` の 3 つ目の引数）、`spike/src/main.ts`（`buildScene`）、`spike/e2e/matrix.spec.ts`（計測の補助を `support/measure.ts` へ移す）
- Create: `spike/e2e/resample.spec.ts`、`spike/src/candidates/arrows.ts`、`spike/e2e/arrows.spec.ts`、`spike/e2e/support/measure.ts`・`spike/e2e/bowl.spec.ts`（Step 10）、`spike/e2e/needles.spec.ts`（Step 11）、（全部のとき）`spike/e2e/stale.spec.ts`
- Create（実行の結果）: `spike/results/water-a2.{json,md}`、`spike/results/sheets/a2-{synthetic,real}.jpg`、`spike/results/a2-resample.{json,md}`、`spike/results/a-arrows.md`、`spike/results/sheets/a-arrows.jpg`、`spike/results/bowl-film.{json,md}`（Step 10）、`spike/results/sheets/a-real-needles.jpg`・`spike/results/a-real-needles.md`（Step 11）、（全部のとき）`spike/results/a2-stale.md`
- Modify: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`

**Interfaces:**
- Consumes: Task 3 の `createThreeWater`（`elevScale: 'one'`・`setElevation`）、`measureWater`、`MIN_DEPTH_M`、MapLibre の `Map.terrain: Terrain`（maplibre-gl.d.ts 12585 行、公開）の `getElevationForLngLatZoom(lnglat: LngLat, zoom: number): number`（5726 行。垂直強調を掛けた値）、`Map.queryTerrainElevation`、`Map.getTerrain(): TerrainSpecification | null`、`LngLat`
- Produces（`types.ts`）: `interface ResampleInfo { ms: number; zoom: number | null; fallback: boolean; wetCells: number; maxDiffM: number }`、`CandidateHandle.lastResample?(): ResampleInfo | null`、`CandidateHandle.freezeElevation?(frozen: boolean): void`
- Produces（`a.ts`）: 候補 `a2` のとき、`whenIdle()` が地図の idle の後に全セルの高さを取り直す。`showArrows(placement, pitchAlignment)`（A・A'）
- Produces（`arrows.ts`・`types.ts`）: `type ArrowPlacement = 'none' | 'above' | 'below'`、`CandidateHandle.showArrows?(placement: ArrowPlacement, pitchAlignment: 'map' | 'viewport'): Promise<void>`、`arrowFeatures(scene: Scene): ArrowCollection`、`setArrowLayer(map: MapLibreMap, scene: Scene, placement: ArrowPlacement, pitchAlignment: 'map' | 'viewport'): void`（レイヤーの id `spike-arrows`。below は `spike-water` の前に入れる）
- Produces（Step 10）: `WaterMode = 'fixed' | 'film' | 'bowlFilm' | 'dynamic'`、`isBowlCell(range: GridRange, col: number, row: number): boolean`、`buildSyntheticScene(water: 'fixed' | 'film' | 'bowlFilm'): Scene`。`spike/e2e/support/measure.ts`: `MIN_VISIBLE = 0.98`、`MAX_FLICKER = 0.01`、`MEASURE_VIEWS: View[]`（16 通り）、`interface MeasureRow { scene: string; zfix: ZFix; view: View; measure: WaterMeasure }`、`measure(page: Page): Promise<WaterMeasure>`、`summarize(rows: MeasureRow[], scene: string, zfix: ZFix): string`（`matrix.spec.ts` から移す。中身は変えない）
- Produces（Step 11）: `SpikeParams.demFill: 'zero' | 'nearest'`（URL の `demFill`）、`fillInvalidNearest(tile: DemTileData): DemTileData`、`buildRealScene(range: GridRange, tiles: ReadonlyMap<string, DemTileData>, fillInvalid = false): Scene`（`fillInvalid` は A の地形のサンプラーだけに効き、グリッドは変えない）

- [ ] **Step 1: 型に取り直しの記録を足す**

`spike/src/types.ts` の `ApiProbeResult` の次に足す:

```ts
/**
 * A' の高さの取り直しの記録（Task 5）。ms はメインスレッドを止めた時間（tech-spec §14.1 の 50ms と比べる）。
 * 視点が変わったとき（setView）の取り直しだけを記録する（R2）
 */
export interface ResampleInfo {
  ms: number
  zoom: number | null // queryTerrainElevation と同じ値を返す DEM のズーム。見つからなければ null
  fallback: boolean // true なら全セルで queryTerrainElevation を呼んだ
  wetCells: number
  maxDiffM: number // 水のあるセルでの |地形の高さ ÷ 倍率 − シミュレーションの標高| の最大（m）
}
```

`CandidateHandle` の `apiProbe?` の次に足す:

```ts
  /** A' だけ。直近の高さの取り直しの記録 */
  lastResample?(): ResampleInfo | null
  /** A' だけ。true の間は whenIdle で高さを取り直さない（視点を動かしている間の見え方を測る。Task 5 Step 8） */
  freezeElevation?(frozen: boolean): void
```

- [ ] **Step 2: A に A' の分岐を足す**

`spike/src/candidates/a.ts` の import を次にする（`LngLat`、`type Map as MapLibreMap`（Task 2 では使わないので外していた。P3）、`MIN_DEPTH_M`・`ResampleInfo` を足す）:

```ts
import {
  addProtocol,
  type CustomRenderMethodInput,
  LngLat,
  type Map as MapLibreMap,
  MercatorCoordinate,
} from 'maplibre-gl'
import { pixelToLonLat } from '../../../src/dem/tileMath.ts'
import { projectToScreen } from '../mat4'
import { MIN_DEPTH_M } from '../scenes'
import type {
  ApiProbeResult,
  CandidateHandle,
  ElevationSampler,
  MountCandidate,
  ProbePoint,
  ResampleInfo,
  Scene,
} from '../types'
import { waitIdle } from '../waitIdle'
import { terrariumTile } from './terrarium'
import { createThreeWater } from './threeWater'
```

`probeCells` の関数の次に、高さの取り直しを足す:

```ts
/**
 * A': 全セルの中心で MapLibre の地形の高さ（倍率込み）を読む。queryTerrainElevation は呼ぶたびに
 * 視点の覆うタイルを数え直すので、同じ値を返すズームを 3 点で探し、そのズームで Terrain を直接読む。
 * 見つからなければ全セルで queryTerrainElevation を呼ぶ（遅いが正しい）
 */
function resampleHeights(
  map: MapLibreMap,
  scene: Scene,
  exaggeration: number,
): { heights: Float32Array; info: ResampleInfo } {
  const start = performance.now()
  const { range } = scene
  const n = range.size
  const lons = new Float64Array(n)
  const lats = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    lons[i] = pixelToLonLat(range.originX + i + 0.5, range.originY, range.z).lon
    lats[i] = pixelToLonLat(range.originX, range.originY + i + 0.5, range.z).lat
  }
  const at = (col: number, row: number): LngLat => new LngLat(lons[col] ?? 0, lats[row] ?? 0)
  const checks = [
    at(n >> 1, n >> 1),
    at(n >> 2, n >> 2),
    at((3 * n) >> 2, (3 * n) >> 2),
  ]
  const terrain = map.getTerrain() === null ? null : map.terrain
  let zoom: number | null = null
  if (terrain !== null) {
    for (let z = 17; z >= 0 && zoom === null; z--) {
      const same = checks.every((ll) => {
        const q = map.queryTerrainElevation(ll)
        return q !== null && Math.abs(terrain.getElevationForLngLatZoom(ll, z) - q) < 1e-6
      })
      if (same) zoom = z
    }
  }
  const heights = new Float32Array(n * n)
  let wetCells = 0
  let maxDiffM = 0
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col
      const ll = at(col, row)
      const h =
        terrain !== null && zoom !== null
          ? terrain.getElevationForLngLatZoom(ll, zoom)
          : (map.queryTerrainElevation(ll) ?? 0)
      heights[i] = h
      if ((scene.depth[i] ?? 0) >= MIN_DEPTH_M) {
        wetCells++
        maxDiffM = Math.max(maxDiffM, Math.abs(h / exaggeration - (scene.elevation[i] ?? 0)))
      }
    }
  }
  return {
    heights,
    info: { ms: performance.now() - start, zoom, fallback: zoom === null, wetCells, maxDiffM },
  }
}
```

`mount` の中の `const water = createThreeWater(map, { … })` を次にする:

```ts
  const variant = params.candidate === 'a2' ? 'a2' : 'a'
  // A: 水面の高さはシミュレーションの標高から。A': MapLibre の地形の高さ（倍率込み）に水深 × 倍率を足す（spec S §2）
  const water = createThreeWater(map, {
    id: 'spike-water',
    scene,
    elevation: scene.elevation,
    elevScale: variant === 'a2' ? 'one' : 'exaggeration',
    zfix: params.zfix,
    renderTimes,
  })
```

末尾の `return { … } satisfies CandidateHandle` を次にする:

```ts
  let lastResample: ResampleInfo | null = null
  let frozen = false
  // 取り直しは視点（中心・ズーム・pitch・bearing・倍率）が変わったときだけ行い、そのときだけ記録する。
  // measure の中の idle（同じ視点、または固定中）では取り直さないので、記録は setView の時の値になる（R2）
  let resampledView = ''
  const viewKey = (): string => {
    const c = map.getCenter()
    return [c.lng, c.lat, map.getZoom(), map.getPitch(), map.getBearing(), exaggeration].join(',')
  }
  const whenIdle = async (): Promise<void> => {
    await waitIdle(map)
    if (variant !== 'a2' || frozen) return
    const key = viewKey()
    if (key === resampledView) return
    resampledView = key
    const { heights, info } = resampleHeights(map, scene, exaggeration)
    lastResample = info
    water.setElevation(heights)
    await waitIdle(map)
  }

  return {
    renderTimes,
    setExaggeration(value) {
      exaggeration = value
      // 合格基準 2: 地形と水面に同じ倍率を掛ける（A' の水面の地形の分は、次の whenIdle で取り直す）
      map.setTerrain({ source: DEM_SOURCE, exaggeration: value })
      water.setExaggeration(value)
    },
    setDepth: (depth) => water.setDepth(depth),
    setDebug: (mode) => water.setDebug(mode),
    whenIdle,
    apiProbe,
    lastResample: () => lastResample,
    freezeElevation(value) {
      frozen = value
    },
  } satisfies CandidateHandle
```

`spike/src/main.ts` の `candidates` に足す:

```ts
  a2: () => import('./candidates/a'),
```

`spike/e2e/matrix.spec.ts` の一覧を次にする:

```ts
const MATRIX_CANDIDATES = ['a', 'a2'] as const
```

`spike/src/capture.ts` の `measureWater` を、次の 2 か所で変える（R2。A' のちらつきの 3 枚を同じ高さで比べる。A・B 系には `freezeElevation` が無いので何もしない）。

最初の idle の直後:

```ts
  candidate.setDebug('mask-nodepth')
  await candidate.whenIdle()
  // A' は、ここから終わりまで高さを取り直さない（bearing を ±0.002° 動かしても同じ高さで比べる）
  candidate.freezeElevation?.(true)
  const footprint = readMask(map)
```

最後（元の表示に戻した後）:

```ts
  candidate.setDebug('off')
  await candidate.whenIdle()
  candidate.freezeElevation?.(false)
```

`stale.spec.ts`（Step 8）は、計測の前に自分で固定し、計測の後に自分で外すので、意味は変わらない（計測の中で固定しても、最後に外しても、stale.spec の次の手順が外してから視点を戻す）。

- [ ] **Step 3: 取り直しの時間と高さの差の E2E を書く**

`spike/e2e/resample.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ResampleInfo, View } from '../src/types'
import { allViews, openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)

test("A': 高さの取り直しの時間と、シミュレーションの標高との差", async ({ page, context }) => {
  const errors = await openSpike(page, context, { candidate: 'a2', scene: 'synthetic', water: 'fixed' })
  const rows: { view: View; info: ResampleInfo }[] = []
  for (const view of allViews()) {
    await setView(page, view)
    const info = await page.evaluate(() => window.spike?.candidate?.lastResample?.() ?? null)
    expect(info).not.toBeNull()
    if (info !== null) rows.push({ view, info })
  }
  mkdirSync(results, { recursive: true })
  writeFileSync(new URL('a2-resample.json', results), `${JSON.stringify(rows, null, 2)}\n`)
  const lines = ['| ズーム | 取り直し ms（平均） | ms（最大） | 差の最大 (m) | 全セルで query | DEM のズーム |', '|---|---:|---:|---:|---:|---|']
  for (const zoom of [15, 16, 17, 18]) {
    const group = rows.filter((r) => r.view.zoom === zoom)
    const ms = group.map((r) => r.info.ms)
    lines.push(
      `| ${zoom} | ${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(1)} | ${Math.max(...ms).toFixed(1)} | ${Math.max(...group.map((r) => r.info.maxDiffM)).toFixed(3)} | ${group.filter((r) => r.info.fallback).length} | ${[...new Set(group.map((r) => r.info.zoom))].join('・')} |`,
    )
  }
  const table = `${lines.join('\n')}\n`
  writeFileSync(new URL('a2-resample.md', results), `# A' の高さの取り直し（合成、固定の水）\n\n${table}`)
  console.log(table)
  expect(errors).toEqual([])
})
```

- [ ] **Step 4: 検査を通し、取り直しを測る**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm spike:e2e spike/e2e/resample.spec.ts`
Expected: PASS。表が出る。「全セルで query」が 0 でなければ（同じ値を返すズームが見つからない視点がある）、その視点の数と取り直しの時間をそのまま記録する（遅い経路の時間が A' の実際の費用になる）

- [ ] **Step 5: A' の組み合わせを回す**

Run: `pnpm spike:e2e spike/e2e/matrix.spec.ts -g "matrix: a2$"`
Expected: PASS。`spike/results/water-a2.{json,md}` と `spike/results/sheets/a2-{synthetic,real}.jpg` ができる。判定 (2) を Task 3 Step 9 の規則で A' について行う

- [ ] **Step 6: 報告に書き、コミットする**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` の §4 の A' の欄を書く:
- 合格基準 1: `water-a2.md` の zfix=offset・offset2 の可視率の最小・ちらつきの最大と判定
- 合格基準 2: 地形（`setTerrain`）と水深（シェーダの `u_depthScale`）に同じ倍率。ただし水面の基準の高さは MapLibre の地形で、シミュレーションの標高との差は最大 （`a2-resample.md` の値） m（tech-spec §5.5 の「表示される水面の高さがシミュレーションの標高と食い違う」の実測）
- 複雑さ・回避策: 高さの取り直し（`resampleHeights`、ズームの探索という回避策 1 つ）。取り直しの時間の最大が tech-spec §14.1 の「メインスレッドの最長ブロック 50ms」を超えるかどうか
- §7 に `a2-synthetic.jpg`・`a2-real.jpg` への参照

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 候補 A'（水面の高さを MapLibre の地形に合わせる）と、高さの取り直しの時間・食い違いの計測"
```

- [ ] **Step 7: A の流れの矢印を symbol レイヤーで地形に載せて比べる（spec 05 §3.3、D20。「最小」「全部」とも、約 30〜45 分）**

04 の `arrows` は使わない。範囲に 20m おきの固定の点（向きは南で一定）と、ImageData から `addImage` した矢印の画像だけで描く（`text-field` は使わない。CSP がグリフのサーバーを許していないため）。B・B-raw のインスタンス描画の矢印は 05 で作るので、ここでは扱わない。

`spike/src/types.ts` の `CandidateHandle` の前に足す:

```ts
/** A の流れの矢印の置き方（Task 5 Step 7）。above: 水面のレイヤーの後、below: 水面のレイヤーの前 */
export type ArrowPlacement = 'none' | 'above' | 'below'
```

`CandidateHandle` の `freezeElevation?` の次に足す:

```ts
  /** A・A' だけ。流れの矢印の symbol レイヤーを置き直し、描き終えるまで待つ */
  showArrows?(placement: ArrowPlacement, pitchAlignment: 'map' | 'viewport'): Promise<void>
```

`spike/src/candidates/arrows.ts`:

```ts
import type { Map as MapLibreMap } from 'maplibre-gl'
import { pixelToLonLat } from '../../../src/dem/tileMath.ts'
import type { ArrowPlacement, Scene } from '../types'

const LAYER = 'spike-arrows'
const IMAGE = 'spike-arrow'
const WATER_LAYER = 'spike-water'
const SPACING_M = 20
const BEARING_DEG = 180 // 合成の斜面の下り（南）。すり鉢の上も同じ向きで一定にする

/** GeoJSON の点の集まり（src/map/terrainFeatures.ts と同じく、必要な形だけを型にする） */
interface ArrowCollection {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { bearing: number }
  }[]
}

/** 範囲に 20m おきの固定の点（04 の出力に依らない。計画 D20） */
export function arrowFeatures(scene: Scene): ArrowCollection {
  const { range } = scene
  const step = Math.max(1, Math.round(SPACING_M / range.cellSizeM))
  const features: ArrowCollection['features'] = []
  for (let row = step >> 1; row < range.size; row += step) {
    for (let col = step >> 1; col < range.size; col += step) {
      const ll = pixelToLonLat(range.originX + col + 0.5, range.originY + row + 0.5, range.z)
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [ll.lon, ll.lat] },
        properties: { bearing: BEARING_DEG },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/** 北向きの矢印（白の縁取り）。外部の画像とグリフを読まない（CSP） */
function arrowImage(): ImageData {
  const size = 24
  const context = new OffscreenCanvas(size, size).getContext('2d')
  if (context === null) throw new Error('2D コンテキストを得られません')
  context.beginPath()
  context.moveTo(size / 2, 2)
  context.lineTo(size - 5, size - 4)
  context.lineTo(size / 2, size - 9)
  context.lineTo(5, size - 4)
  context.closePath()
  context.fillStyle = '#263238'
  context.fill()
  context.strokeStyle = '#ffffff'
  context.lineWidth = 2
  context.stroke()
  return context.getImageData(0, 0, size, size)
}

/** 矢印のレイヤーを置き直す。below は水面の Custom Layer の前（先に描く）、above は最後に足す */
export function setArrowLayer(
  map: MapLibreMap,
  scene: Scene,
  placement: ArrowPlacement,
  pitchAlignment: 'map' | 'viewport',
): void {
  if (map.getLayer(LAYER) !== undefined) map.removeLayer(LAYER)
  if (map.getSource(LAYER) !== undefined) map.removeSource(LAYER)
  if (placement === 'none') return
  if (!map.hasImage(IMAGE)) map.addImage(IMAGE, arrowImage())
  map.addSource(LAYER, { type: 'geojson', data: arrowFeatures(scene) })
  map.addLayer(
    {
      id: LAYER,
      type: 'symbol',
      source: LAYER,
      layout: {
        'icon-image': IMAGE,
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': pitchAlignment,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': 0.8,
      },
    },
    placement === 'below' ? WATER_LAYER : undefined,
  )
}
```

`spike/src/candidates/a.ts` の import に `import { setArrowLayer } from './arrows'` を足し、末尾の `return { … } satisfies CandidateHandle` の `freezeElevation(value) { … },` の次に足す:

```ts
    async showArrows(placement, pitchAlignment) {
      setArrowLayer(map, scene, placement, pitchAlignment)
      await whenIdle()
    },
```

`spike/e2e/arrows.spec.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { ArrowPlacement, View } from '../src/types'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)
// 垂直強調 1・5・10 × pitch 0・60、ズーム 17（D20）
const VIEWS: View[] = [1, 5, 10].flatMap((exaggeration) =>
  [0, 60].map((pitch) => ({ zoom: 17, exaggeration, pitch })),
)

test('A: 流れの矢印（symbol レイヤー）と地形・水面の重なり（spec 05 §3.3）', async ({ page, context }) => {
  const errors = await openSpike(page, context, { candidate: 'a', scene: 'synthetic', water: 'fixed' })
  const cases: { placement: ArrowPlacement; pitchAlignment: 'map' | 'viewport'; views: View[] }[] = [
    { placement: 'above', pitchAlignment: 'map', views: VIEWS },
    { placement: 'below', pitchAlignment: 'map', views: VIEWS },
    // (c) の確かめ: 向きの揃え方を変えても高さは変わらないか
    { placement: 'above', pitchAlignment: 'viewport', views: VIEWS.filter((v) => v.pitch === 60) },
  ]
  const shots: Shot[] = []
  for (const c of cases) {
    await page.evaluate(async ({ placement, pitchAlignment }) => {
      await window.spike?.candidate?.showArrows?.(placement, pitchAlignment)
    }, c)
    for (const view of c.views) {
      await setView(page, view)
      shots.push({
        label: `${c.placement}/${c.pitchAlignment} ×${view.exaggeration} p${view.pitch}`,
        png: await page.screenshot(),
      })
    }
  }
  await writeContactSheet(
    context,
    shots,
    6,
    'A の流れの矢印（ズーム 17。1 行目: 水面の後、2 行目: 水面の前、3 行目: viewport 揃え）',
    fileURLToPath(new URL('sheets/a-arrows.jpg', results)),
  )
  expect(errors).toEqual([])
})
```

Run: `pnpm lint && pnpm typecheck && pnpm spike:e2e spike/e2e/arrows.spec.ts`
Expected: PASS。`spike/results/sheets/a-arrows.jpg` ができる（3 行: 6・6・3 コマ）

コンタクトシートを見て、`spike/results/a-arrows.md` を次の形で書く（観察と根拠のコマの欄は、この Step でシートから書き入れる。空欄のままコミットしない）:

```markdown
# A の流れの矢印（symbol レイヤー、spec 05 §3.3）

シート: `sheets/a-arrows.jpg`（合成の場面、固定の水、ズーム 17）

| 問い | 観察 | 根拠のコマ |
|---|---|---|
| (a) 矢印は地形の面に載り、垂直強調（1・5・10）に従って高さが変わるか | | |
| (b) 水面の Custom Layer の後（above）・前（below）に置いたとき、池（水深 2m）と膜（1cm）の上で水面に隠れるか、水面の上に描かれるか | | |
| (c) 水面の高さへ上げる手段 | MapLibre 6.6.0 の style spec（@maplibre/maplibre-gl-style-spec 26.4.1）の symbol に `symbol-z-elevate` は無い。高さに効く設定は無く、`icon-pitch-alignment`（map・viewport・auto）は向き、`icon-translate`（paint）は画面か地図の平面での 2 次元のずれだけ。3 行目の viewport 揃えのコマで高さが変わらないことを確かめた（または違った点を書く） | 3 行目 |
```

報告の §4 の「流れの矢印（symbol レイヤー）」の行の A と A' の欄に (a)・(b) を一言で書く（A' は水面が MapLibre の地形に合うので、(b) の関係は A と同じかどうかを 2 行目・1 行目のコマから推して書き、推測であることを明記する）。§10 の申し送りの材料として、「05 で A 系の矢印を symbol レイヤーで描けるか、Custom Layer で水面の高さに描く必要があるか」の見立てをメモする。

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 候補 A の流れの矢印（symbol レイヤー）と地形・水面の重なり（spec 05 §3.3）"
```

- [ ] **Step 8:（「全部」のときだけ）視点を動かしている間の見え方を測る**

A' の高さは idle のときにしか取り直せないので、視点を動かしている間は前の視点の高さのままになる。その間の沈み込みを測る。

`spike/e2e/stale.spec.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { WaterMeasure } from '../src/types'
import { openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)

test("A': 高さを取り直す前（視点を動かしている間）の 1cm の膜の見え方", async ({ page, context }) => {
  const errors = await openSpike(page, context, {
    candidate: 'a2',
    scene: 'synthetic',
    water: 'film',
    zfix: 'offset',
    capture: 1,
  })
  const lines = ['| 前 → 後のズーム | 強調 | 取り直し前の可視率 | 取り直し後の可視率 |', '|---|---|---:|---:|']
  for (const [from, to] of [[17, 15], [15, 17], [16, 18]] as const) {
    for (const exaggeration of [1, 10]) {
      await setView(page, { zoom: from, exaggeration, pitch: 60 })
      await page.evaluate(() => window.spike?.candidate?.freezeElevation?.(true))
      await setView(page, { zoom: to, exaggeration, pitch: 60 })
      const stale = await page.evaluate(() => window.spike?.measure() as Promise<WaterMeasure>)
      await page.evaluate(() => window.spike?.candidate?.freezeElevation?.(false))
      await setView(page, { zoom: to, exaggeration, pitch: 60 })
      const fresh = await page.evaluate(() => window.spike?.measure() as Promise<WaterMeasure>)
      lines.push(`| ${from} → ${to} | ${exaggeration} | ${stale.visibleRatio.toFixed(4)} | ${fresh.visibleRatio.toFixed(4)} |`)
    }
  }
  const table = `${lines.join('\n')}\n`
  writeFileSync(new URL('a2-stale.md', results), `# A' の取り直しの前後（合成の 1cm の膜、pitch 60）\n\n${table}`)
  console.log(table)
  expect(errors).toEqual([])
})
```

Run: `pnpm lint && pnpm typecheck && pnpm spike:e2e spike/e2e/stale.spec.ts`
Expected: PASS。取り直し前の可視率が 0.98 を下回る組み合わせがあれば、「A' は地図を動かしている間に水面が沈む（idle で直る）」として報告の A' の合格基準 1 の欄に書き足す

- [ ] **Step 9:（「全部」のときだけ）Commit**

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 候補 A' の、視点を動かしている間の水面の見え方"
```

- [ ] **Step 10: 曲面（すり鉢）の 1cm の膜で A と A' を比べる（中間の判定の反映 M1。「最小」「全部」とも、約 1 時間）**

判定 (2) の合格は平面（斜面）の膜に限られる（報告の §6 の射程の注意）。すり鉢の面（曲面）だけに 1cm の膜を置き、A と A' を同じ方法（`measureWater`、16 視点、zfix=offset(−1, −4)）で測る。A' は Step 2 のとおり、計測の間は高さを取り直さない（`freezeElevation`）。

`spike/src/scenes.test.ts` の import に `isBowlCell` を足し、`describe('合成の場面（計画 D4）'` の中の最後（`film の水は膜だけで、池が無い` の it の後）に足す:

```ts
  it('bowlFilm の水はすり鉢の中の 1cm の膜だけで、斜面の膜と池が無い', () => {
    const bowl = buildSyntheticScene('bowlFilm')
    let wet = 0
    let bad = 0
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const d = bowl.depth[row * n + col] ?? 0
        if (isBowlCell(range, col, row)) {
          wet++
          if (d !== Math.fround(FILM_DEPTH_M)) bad++
        } else if (d !== 0) {
          bad++
        }
      }
    }
    // 3 つのすり鉢（半径 60m）の面積は 約 3 × π × 60² ≈ 33,900 m²（約 36,000 セル）
    expect(wet).toBeGreaterThan(30_000)
    expect(bad).toBe(0)
  })
```

`spike/src/params.test.ts` の `describe` の最後に足す:

```ts
  it('曲面の膜の水（bowlFilm）を読む', () => {
    expect(parseParams('?water=bowlFilm').water).toBe('bowlFilm')
  })
```

Run: `pnpm vitest run spike/src/scenes.test.ts spike/src/params.test.ts`
Expected: FAIL（`isBowlCell` が export されていない、`bowlFilm` が `'fixed'` になる）

`spike/src/types.ts` の `WaterMode` を次にする:

```ts
/** bowlFilm: すり鉢の面（曲面）だけに 1cm の膜（中間の判定の反映 M1） */
export type WaterMode = 'fixed' | 'film' | 'bowlFilm' | 'dynamic'
```

`spike/src/params.ts` の `water` の行を次にする:

```ts
    water: pick(query.get('water'), ['fixed', 'film', 'bowlFilm', 'dynamic'], 'fixed'),
```

`spike/src/scenes.ts` の `isFilmCell` の関数の次に足す:

```ts
/** すり鉢（半径 60m）の中のセルか（セルの中心で判定。M1 の曲面の膜） */
export function isBowlCell(range: GridRange, col: number, row: number): boolean {
  const side = sideM(range)
  const x = (col + 0.5) * range.cellSizeM
  const y = (row + 0.5) * range.cellSizeM
  return BOWL_CENTERS.some(
    ([cx, cy]) => (x - cx * side) ** 2 + (y - cy * side) ** 2 < BOWL_RADIUS_M ** 2,
  )
}
```

`spike/src/scenes.ts` の `export function buildSyntheticScene(water: 'fixed' | 'film'): Scene {` を `export function buildSyntheticScene(water: 'fixed' | 'film' | 'bowlFilm'): Scene {` にし、ループの中の `elevation[i] = sample(range.originX + col, range.originY + row) ?? 0` の直後（`if (isFilmCell(range, col, row)) {` の前）に足す:

```ts
      if (water === 'bowlFilm') {
        // 曲面（すり鉢の面）に一様な 1cm の膜。斜面の膜と池は置かない（M1）
        if (isBowlCell(range, col, row)) depth[i] = FILM_DEPTH_M
        continue
      }
```

`spike/src/main.ts` の `buildScene` の最後の行 `return buildSyntheticScene(params.water === 'film' ? 'film' : 'fixed')` を次にする:

```ts
  const water = params.water === 'film' || params.water === 'bowlFilm' ? params.water : 'fixed'
  return buildSyntheticScene(water)
```

Run: `pnpm vitest run spike/src/scenes.test.ts spike/src/params.test.ts`
Expected: PASS

計測の補助を、`matrix.spec.ts` と共有できるように `spike/e2e/support/measure.ts` へ移す（中身は変えない）:

```ts
import type { Page } from '@playwright/test'
import type { View, WaterMeasure, ZFix } from '../../src/types'
import { allViews } from './views'

// 判定の閾値（計画 D9）
export const MIN_VISIBLE = 0.98
export const MAX_FLICKER = 0.01
// 数値の計測の視点（16 通り）: ズーム 15〜18 × 倍率 1・10 × pitch 60・85。スクリーンショットは 64 通りのまま（R1）
export const MEASURE_VIEWS: View[] = allViews().filter(
  (v) => (v.exaggeration === 1 || v.exaggeration === 10) && (v.pitch === 60 || v.pitch === 85),
)

export interface MeasureRow {
  scene: string
  zfix: ZFix
  view: View
  measure: WaterMeasure
}

export async function measure(page: Page): Promise<WaterMeasure> {
  return page.evaluate(async () => {
    if (window.spike === undefined) throw new Error('window.spike がありません')
    return window.spike.measure()
  })
}

/** 視点ごとの最小の可視率と最大のちらつきの表(ズーム × 垂直強調、pitch の 4 通りをまとめる) */
export function summarize(rows: MeasureRow[], scene: string, zfix: ZFix): string {
  const lines = [
    `### ${scene} / zfix=${zfix}`,
    '',
    '| ズーム | 強調 | 可視率の最小 | ちらつきの最大 | 判定 |',
    '|---|---|---:|---:|:---:|',
  ]
  for (const zoom of [15, 16, 17, 18]) {
    for (const exaggeration of [1, 2, 5, 10]) {
      const group = rows.filter(
        (r) =>
          r.scene === scene &&
          r.zfix === zfix &&
          r.view.zoom === zoom &&
          r.view.exaggeration === exaggeration,
      )
      if (group.length === 0) continue
      const visible = Math.min(...group.map((r) => r.measure.visibleRatio))
      const flicker = Math.max(...group.map((r) => r.measure.flickerRatio))
      const ok = visible >= MIN_VISIBLE && flicker <= MAX_FLICKER
      lines.push(
        `| ${zoom} | ${exaggeration} | ${visible.toFixed(4)} | ${(flicker * 100).toFixed(2)}% | ${ok ? '○' : '×'} |`,
      )
    }
  }
  return `${lines.join('\n')}\n`
}
```

`spike/e2e/matrix.spec.ts` の `for (const candidate of MATRIX_CANDIDATES) {` より前を、次に置き換える（テストの本体は変えない。`MATRIX_CANDIDATES` はこの時点の値のまま）:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { View } from '../src/types'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { MEASURE_VIEWS, type MeasureRow, measure, summarize } from './support/measure'
import { allViews, openSpike, setView } from './support/views'

// Task 5〜7 で候補を足す
const MATRIX_CANDIDATES = ['a', 'a2'] as const

const results = new URL('../results/', import.meta.url)
const shotsDir = new URL('../out/shots/', import.meta.url)

const label = (v: View): string => `z${v.zoom} ×${v.exaggeration} p${v.pitch}`
```

`spike/e2e/bowl.spec.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { ApiProbeResult, View } from '../src/types'
import {
  MAX_FLICKER,
  MEASURE_VIEWS,
  MIN_VISIBLE,
  type MeasureRow,
  measure,
  summarize,
} from './support/measure'
import { openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)
const BOWL_CANDIDATES = ['a', 'a2'] as const

/** Task 2 の api-probe.json から、すり鉢の中心の d（地形 − シミュレーションの標高 × 倍率、倍率込みの m。pitch 60） */
function bowlD(zoom: number, exaggeration: number): number | null {
  const rows = JSON.parse(readFileSync(new URL('api-probe.json', results), 'utf8')) as {
    view: View
    probe: ApiProbeResult
  }[]
  const row = rows.find(
    (r) => r.view.zoom === zoom && r.view.exaggeration === exaggeration && r.view.pitch === 60,
  )
  const bowl = row?.probe.points.find((point) => point.label === 'bowl')
  if (bowl === undefined || bowl.terrainElevation === null) return null
  return bowl.terrainElevation - bowl.simElevation * exaggeration
}

test("曲面（すり鉢）の 1cm の膜: A と A'（zfix=offset、16 視点。M1）", async ({ page, context }) => {
  const lists: string[][] = [] // P20
  const rows: MeasureRow[] = []
  for (const candidate of BOWL_CANDIDATES) {
    lists.push(
      await openSpike(page, context, {
        candidate,
        scene: 'synthetic',
        water: 'bowlFilm',
        zfix: 'offset',
        capture: 1,
      }),
    )
    for (const view of MEASURE_VIEWS) {
      await setView(page, view)
      rows.push({ scene: candidate, zfix: 'offset', view, measure: await measure(page) })
    }
  }
  mkdirSync(results, { recursive: true })
  writeFileSync(new URL('bowl-film.json', results), `${JSON.stringify(rows, null, 2)}\n`)
  const judge = (candidate: string, zoom: number, exaggeration: number): string => {
    const group = rows.filter(
      (r) => r.scene === candidate && r.view.zoom === zoom && r.view.exaggeration === exaggeration,
    )
    const visible = Math.min(...group.map((r) => r.measure.visibleRatio))
    const flicker = Math.max(...group.map((r) => r.measure.flickerRatio))
    return visible >= MIN_VISIBLE && flicker <= MAX_FLICKER ? '○' : '×'
  }
  const lines = [
    "| ズーム | 強調 | A | A' | すり鉢の d (m) | 0.01 × 倍率 (m) | d が膜を超える |",
    '|---|---|:---:|:---:|---:|---:|:---:|',
  ]
  for (const zoom of [15, 16, 17, 18]) {
    for (const exaggeration of [1, 10]) {
      const d = bowlD(zoom, exaggeration)
      const over = d !== null && d > 0.01 * exaggeration
      lines.push(
        `| ${zoom} | ${exaggeration} | ${judge('a', zoom, exaggeration)} | ${judge('a2', zoom, exaggeration)} | ${d === null ? '—' : d.toFixed(4)} | ${(0.01 * exaggeration).toFixed(2)} | ${over ? '○' : ''} |`,
      )
    }
  }
  const body = [
    summarize(rows, 'a', 'offset'),
    summarize(rows, 'a2', 'offset'),
    '### 比較（Task 2 のすり鉢の d と）',
    '',
    ...lines,
    '',
  ].join('\n')
  writeFileSync(new URL('bowl-film.md', results), `# 曲面（すり鉢）の 1cm の膜の見え方（M1）\n\n${body}`)
  console.log(body)
  expect(lists.flat()).toEqual([])
})
```

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm exec playwright test --config spike/playwright.config.ts --list && pnpm spike:e2e spike/e2e/bowl.spec.ts && pnpm exec biome format --write spike/results`
Expected: すべて成功。`--list` に `matrix: a`・`matrix: a2` が出る（`matrix.spec.ts` の移し替えで壊れていない）。`spike/results/bowl-film.{json,md}` ができる。所要の見積もり: 2 候補 × 16 視点 × idle 約 6 回 ≈ 190 回（SwiftShader で 2〜6 分）

判定（`bowl-film.md` の「比較」の表で）:

| 観測 | 結論（`bowl-film.md` の最後と報告に書く文） |
|---|---|
| A の列が 8 行すべて ○ | 「A は曲面でも合格基準 1 を満たす（すり鉢の d が膜を超えるズームでも沈まない）」 |
| A に × があり、A' の列はその行がすべて ○ | 「A は曲面の（× の出た）ズームで沈む（LOD）。A' で直る」 |
| A と A' の両方に × がある | 「A 系は曲面で合格基準 1 を満たさない（A' でも直らない）」 |

あわせて、A の × の行が「d が膜を超える」の ○ の行と一致するかを書く（一致すれば LOD による沈み込み。一致しなければ、その行の数値を並べて原因は未確定と書く）。すり鉢の d は中心の 1 点の値で、膜はすり鉢の面全体に乗っていることも書く。

報告（`docs/superpowers/spikes/2026-09-12-3d-rendering.md`）に書く:
- §4 の「合格基準 1」の行の A の欄の最後に「**曲面（M1、`bowl-film.md`）**: 」に続けて上の結論の文と A の × の行の数、A' の欄の最後に同じく A' の結論と × の行の数
- §10 の申し送りに、結論に応じて次の 1 つ: 「A は曲面でも沈まないので、A 系の水面はシミュレーションの標高のままでよい」／「A 系を採るなら、水面の高さは A'（MapLibre の地形）に合わせる。その代わり表示の高さはシミュレーションと食い違う（`a2-resample.md` の差）」／「A 系は曲面で合格基準 1 を満たさないので、B 系を優先する根拠になる」

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 曲面（すり鉢）の 1cm の膜で A と A' を比べる（中間の判定の反映 M1）"
```

- [ ] **Step 11: 実データの針状ノイズの切り分け（中間の判定の反映 M2。30 分の時間箱。「最小」「全部」とも）**

**時間箱: 30 分。** 始めた時刻を控える。30 分を超えたら、その時点で下の「打ち切り」へ進む（途中の結果は使わない）。

A の地形（`scene.sample` → `terrariumTile`）だけ、無効画素を最も近い有効画素の標高で埋めた実データの場面を描く。グリッド（`elevation`・`validMask`・`depth`）と水面は変えない。針が消えれば地形の穴（報告の §7 の候補 (1) `terrarium.ts` の `?? 0` と (2) `tileBlockSampler` の端の clamp）が原因、消えなければ水面のスライバー（候補 (3)）が原因。

`spike/src/scenes.test.ts` の import に `fillInvalidNearest` を足し、末尾に足す:

```ts
describe('無効画素の穴埋め（M2 の切り分け用）', () => {
  it('無効画素は最も近い有効画素の標高になり、元の配列は変えない', () => {
    const elevation = new Float32Array(256 * 256).fill(20)
    const validMask = new Uint8Array(256 * 256).fill(1)
    elevation[1000] = 0 // (232, 3) の 1 画素の穴
    validMask[1000] = 0
    elevation[1001] = 25
    const filled = fillInvalidNearest({ elevation, validMask })
    expect(filled.validMask.every((v) => v === 1)).toBe(true)
    expect([20, 25]).toContain(filled.elevation[1000])
    expect(validMask[1000]).toBe(0)
  })

  it('全画素が無効のタイルは、そのまま無効', () => {
    const filled = fillInvalidNearest({
      elevation: new Float32Array(256 * 256),
      validMask: new Uint8Array(256 * 256),
    })
    expect(filled.validMask.every((v) => v === 0)).toBe(true)
  })
})
```

同じファイルの `describe('実データの場面（計画 D4・D5）'` の中の最後に足す:

```ts
  it('fillInvalid のときは A の地形のサンプラーだけが無効画素を埋め、グリッドは変えない', () => {
    const filledScene = buildRealScene(shibuyaRange(), tiles, true)
    const i = scene.validMask.findIndex((v) => v === 0)
    const col = i % n
    const row = Math.floor(i / n)
    expect(scene.sample(range.originX + col, range.originY + row)).toBeNull()
    expect(filledScene.sample(range.originX + col, range.originY + row)).not.toBeNull()
    expect(filledScene.validMask[i]).toBe(0)
    expect(filledScene.depth[i]).toBe(0)
  })
```

`spike/src/params.test.ts` の最初の 2 つの `toEqual` の期待値の `probe` の行の次に、それぞれ `demFill: 'zero',` を足し、`describe` の最後に足す:

```ts
  it('無効画素の扱い（demFill）を読む', () => {
    expect(parseParams('?demFill=nearest').demFill).toBe('nearest')
    expect(parseParams('?demFill=x').demFill).toBe('zero')
  })
```

Run: `pnpm vitest run spike/src/scenes.test.ts spike/src/params.test.ts`
Expected: FAIL（`fillInvalidNearest` が無い、`demFill` が無い）

`spike/src/params.ts` の `SpikeParams` の `probe` の次に `demFill: 'zero' | 'nearest' // 実データの A の地形の無効画素（M2 の切り分け用）` を、`parseParams` の戻り値の `probe` の次に `demFill: query.get('demFill') === 'nearest' ? 'nearest' : 'zero',` を足す。

`spike/src/scenes.ts` の `tileBlockSampler` の関数の前に足す:

```ts
/**
 * 無効画素を、4 近傍で段数が最も少ない有効画素の標高で埋めた写し（M2 の切り分け用）。
 * 有効画素から幅優先で広げる。全画素が無効のタイルはそのまま
 */
export function fillInvalidNearest(tile: DemTileData): DemTileData {
  const elevation = tile.elevation.slice()
  const validMask = tile.validMask.slice()
  const queue = new Int32Array(elevation.length)
  let head = 0
  let tail = 0
  for (let p = 0; p < elevation.length; p++) {
    if (validMask[p] === 1) queue[tail++] = p
  }
  while (head < tail) {
    const p = queue[head++] ?? 0
    const x = p % TILE_SIZE
    const y = (p - x) / TILE_SIZE
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= TILE_SIZE || ny >= TILE_SIZE) continue
      const q = ny * TILE_SIZE + nx
      if (validMask[q] === 1) continue
      validMask[q] = 1
      elevation[q] = elevation[p] ?? 0
      queue[tail++] = q
    }
  }
  return { elevation, validMask }
}
```

`spike/src/scenes.ts` の `buildRealScene` を次にする（3 つ目の引数を足し、サンプラーにだけ効かせる）:

```ts
/**
 * 02 の部品で実タイルからグリッドを組み、水深は満水（fill − 標高）と 1cm の大きい方にする（計画 D4）。
 * fillInvalid は A の地形のサンプラーだけに効く（M2 の切り分け用。グリッドと水面は変えない）
 */
export function buildRealScene(
  range: GridRange,
  tiles: ReadonlyMap<string, DemTileData>,
  fillInvalid = false,
): Scene {
  const grid = assembleGrid(range, (tx, ty) => tiles.get(tileKey(tx, ty)))
  const { fill } = analyzeTerrain(grid)
  const depth = new Float32Array(grid.elevation.length)
  for (let i = 0; i < depth.length; i++) {
    if (grid.validMask[i] !== 1) continue
    depth[i] = Math.max(FILM_DEPTH_M, (fill[i] ?? 0) - (grid.elevation[i] ?? 0))
  }
  const sampled = fillInvalid
    ? new Map([...tiles].map(([key, tile]) => [key, fillInvalidNearest(tile)]))
    : tiles
  return {
    name: 'real',
    center: SHIBUYA,
    range,
    elevation: grid.elevation,
    validMask: grid.validMask,
    depth,
    sample: tileBlockSampler(range, sampled),
    minElevation: minValid(grid.elevation, grid.validMask),
  }
}
```

`spike/src/main.ts` の `buildScene` の `return buildRealScene(range, await loadDemTiles(range))` を `return buildRealScene(range, await loadDemTiles(range), params.demFill === 'nearest')` にする。

Run: `pnpm vitest run spike/src/scenes.test.ts spike/src/params.test.ts`
Expected: PASS

`spike/e2e/needles.spec.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { View } from '../src/types'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { openSpike, setView } from './support/views'

const results = new URL('../results/', import.meta.url)
// a-real.jpg で針状のノイズが目立ったコマ（M2）
const VIEWS: View[] = [
  { zoom: 15, exaggeration: 1, pitch: 0 },
  { zoom: 16, exaggeration: 1, pitch: 45 },
  { zoom: 16, exaggeration: 10, pitch: 45 },
]

test('A の実データ: 無効画素を 0m にした地形と、最も近い有効画素で埋めた地形（M2）', async ({
  page,
  context,
}) => {
  const lists: string[][] = [] // P20
  const shots: Shot[] = []
  for (const demFill of ['zero', 'nearest'] as const) {
    lists.push(
      await openSpike(page, context, { candidate: 'a', scene: 'real', water: 'fixed', demFill }),
    )
    for (const view of VIEWS) {
      await setView(page, view)
      shots.push({
        label: `${demFill} z${view.zoom} ×${view.exaggeration} p${view.pitch}`,
        png: await page.screenshot(),
      })
    }
  }
  await writeContactSheet(
    context,
    shots,
    3,
    'A の実データの針状ノイズ（上: 無効画素 0m、下: 最も近い有効画素で埋める。水面は同じ）',
    fileURLToPath(new URL('sheets/a-real-needles.jpg', results)),
  )
  expect(lists.flat()).toEqual([])
})
```

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm spike:e2e spike/e2e/needles.spec.ts`
Expected: PASS。`spike/results/sheets/a-real-needles.jpg`（2 段 × 3 コマ）ができる

シートを見て `spike/results/a-real-needles.md` を書く（「結果」の欄はこの Step でシートから書く。空欄のままコミットしない）:

```markdown
# A の実データの針状ノイズの切り分け（M2、30 分の時間箱）

シート: `sheets/a-real-needles.jpg`（上: 無効画素 0m、下: 最も近い有効画素で埋めた地形。水面とグリッドは同じ）

| 問い | 結果 |
|---|---|
| 下の段（埋めた地形）で針が消えたか（コマごと） | |
| 原因 | 消えた → 地形の穴（候補 (1) `?? 0`・(2) 端の clamp）。残った → 水面のスライバー（候補 (3)）。一部残った → 両方（残ったコマを書く） |
```

報告に書く: §7 に `sheets/a-real-needles.jpg` への参照と結論の 1 行。§11 の「無効セルを含む DEM」の項目を、結論に合わせて「原因は（地形の穴／水面のスライバー／両方）と確かめた（M2）。05 では（地形: 無効セルを隣の有効セルの値で埋める／水面: 無効セルに触れる三角形を捨てるか、無効の頂点を隣の有効セルに寄せる）」に書き直す（R4 の項目と統合する）。

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 実データの針状ノイズの切り分け（無効画素の穴埋めで比べる。中間の判定の反映 M2）"
```

**打ち切り（30 分を超えたとき）:** この Step のコードの変更を捨て（`git restore spike/src spike/e2e` と、作った `spike/e2e/needles.spec.ts` の削除。Step 10 はコミット済みなので影響しない）、報告の §11 の「無効セルを含む DEM」の項目を次の文に置き換える（R4 の項目と統合）:

```markdown
- 無効セルを含む DEM（R4・M2。30 分の時間箱の中で切り分けられなかった）: 無効セルを 0 m にすると A の地形に穴が開く。05 では隣の有効セルの値で埋めるか、無効セルの周りの三角形を捨てる。`a-real.jpg`（§7）の針状のノイズの原因の候補は (1) `terrarium.ts` の `sampleZ17Corner` の `?? 0`（地形の穴）、(2) `scenes.ts` の `tileBlockSampler` の端の clamp（穴が範囲の外まで溝状に延びる）、(3) 水面の `v_depth` の補間のスライバー（無効の頂点が標高 0・水深 0）で、どれが原因かは確かめていない
```

```bash
git add docs/superpowers/spikes
git commit -m "スパイク S: 実データの針状ノイズの切り分けは時間箱の中で終わらず、§11 に記録する（M2）"
```

打ち切った場合は、Task 8 Step 3 の `main.ts` の最終形から `, params.demFill === 'nearest'` を消す（`demFill` が無いため）。

---
### Task 6: 候補 B（範囲の中は three で地形と水面を描く）

**2 日目の午後（約半日）。**

**Files:**
- Create: `spike/src/candidates/basemap.ts`、`spike/src/candidates/b.ts`、`spike/e2e/seam.spec.ts`
- Modify: `spike/src/scenes.ts`・`spike/src/scenes.test.ts`（`boundaryStepM`）、`spike/src/types.ts`・`spike/src/main.ts`（候補 `b`、`boundaryStep`）、`spike/e2e/matrix.spec.ts`（`MATRIX_CANDIDATES`）
- Create（実行の結果）: `spike/results/water-b.{json,md}`、`spike/results/sheets/b-{synthetic,real,seam}.jpg`、`spike/results/seam.md`
- Modify: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`

**Interfaces:**
- Consumes: Task 3 の `gridVertices`・`gridIndices`・`TERRAIN_VERTEX`・`TERRAIN_FRAGMENT`・`WATER_VERTEX`・`WATER_FRAGMENT`・`gridModelMatrix`・`multiply`・`MIN_DEPTH_M`・`writeContactSheet`・`openSpike`・`setView`、`tilesInPixelRect(rect, z)`・`TILE_SIZE`（`src/dem/tileMath.ts`）、`rangePixelRect(range)`（`src/dem/gridRange.ts`）、`GSI_PALE_TILE_URL`（`src/map/gsiStyle.ts`）
- Produces（`basemap.ts`）: `composeBasemap(range: GridRange): Promise<OffscreenCanvas>`（N × N、画素 = セル。B-raw も使う）
- Produces（`scenes.ts`）: `boundaryStepM(scene: Scene): { max: number; mean: number }`（範囲の外周のセルの、基準（最低の標高）からの高さ。倍率 1 のときの平面の地図との段差）
- Produces（`b.ts`）: `mount: MountCandidate`。レイヤーの id `spike-b`
- Produces（`types.ts`・`main.ts`）: `SpikeGlobal.boundaryStep(): { max: number; mean: number }`

- [ ] **Step 1: 境界の段差の失敗するテストを書く**

`spike/src/scenes.test.ts` の import に `boundaryStepM` を足し、末尾に足す:

```ts
describe('境界の段差（計画 D17）', () => {
  it('合成の場面: 北の縁は台地（基準 20m から約 20m）、南の縁は 0、東西の縁は両方を含む', () => {
    const scene = buildSyntheticScene('fixed')
    const step = boundaryStepM(scene)
    expect(scene.minElevation).toBeCloseTo(20, 3)
    expect(step.max).toBeCloseTo(0.1 * 0.4 * scene.range.size * scene.range.cellSizeM, 2)
    expect(step.mean).toBeGreaterThan(0)
    expect(step.mean).toBeLessThan(step.max)
  })
})
```

Run: `pnpm vitest run spike/src/scenes.test.ts`
Expected: FAIL（`boundaryStepM` が export されていない）

- [ ] **Step 2: 境界の段差を書く**

`spike/src/scenes.ts` の末尾に足す:

```ts
/** 範囲の外周の有効セルの、基準（最低の標高）からの高さ（m、倍率 1）。B の縁と平面の地図の段差の目安 */
export function boundaryStepM(scene: Scene): { max: number; mean: number } {
  const n = scene.range.size
  let max = 0
  let sum = 0
  let count = 0
  for (let k = 0; k < n; k++) {
    for (const i of [k, (n - 1) * n + k, k * n, k * n + n - 1]) {
      if (scene.validMask[i] !== 1) continue
      const h = (scene.elevation[i] ?? 0) - scene.minElevation
      max = Math.max(max, h)
      sum += h
      count++
    }
  }
  return { max, mean: count === 0 ? 0 : sum / count }
}
```

Run: `pnpm vitest run spike/src/scenes.test.ts`
Expected: PASS

`spike/src/types.ts` の `SpikeGlobal` の `measure` の次に足す:

```ts
  /** 範囲の外周の段差（m、倍率 1）。継ぎ目の記録に使う（Task 6） */
  boundaryStep(): { max: number; mean: number }
```

`spike/src/main.ts` の `import { buildRealScene, buildSyntheticScene, shibuyaRange } from './scenes'` を `import { boundaryStepM, buildRealScene, buildSyntheticScene, shibuyaRange } from './scenes'` にし、`spike` のオブジェクトの `measure` の次に足す:

```ts
    boundaryStep: () => boundaryStepM(scene),
```

- [ ] **Step 3: ベースマップの合成を書く**

`spike/src/candidates/basemap.ts`:

```ts
import { type GridRange, rangePixelRect } from '../../../src/dem/gridRange.ts'
import { TILE_SIZE, tilesInPixelRect } from '../../../src/dem/tileMath.ts'
import { GSI_PALE_TILE_URL } from '../../../src/map/gsiStyle'

/**
 * 淡色地図の z17 のタイルを、範囲の画素（= セル）にそろえて 1 枚に合成する（計画 D17、spec 05 §4 の方式 B）。
 * 取れなかったタイルは灰色のまま（スパイクでは再試行しない）
 */
export async function composeBasemap(range: GridRange): Promise<OffscreenCanvas> {
  const canvas = new OffscreenCanvas(range.size, range.size)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D コンテキストを得られません')
  context.fillStyle = '#d8d8d8'
  context.fillRect(0, 0, range.size, range.size)
  const tiles = tilesInPixelRect(rangePixelRect(range), range.z)
  await Promise.all(
    tiles.map(async (tile) => {
      const url = GSI_PALE_TILE_URL.replace('{z}', String(tile.z))
        .replace('{x}', String(tile.x))
        .replace('{y}', String(tile.y))
      const response = await fetch(url)
      if (!response.ok) return
      const bitmap = await createImageBitmap(await response.blob())
      context.drawImage(bitmap, tile.x * TILE_SIZE - range.originX, tile.y * TILE_SIZE - range.originY)
      bitmap.close()
    }),
  )
  return canvas
}
```

- [ ] **Step 4: 候補 B を書く**

`spike/src/candidates/b.ts`:

```ts
import { type CustomLayerInterface, MercatorCoordinate } from 'maplibre-gl'
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  CanvasTexture,
  CustomBlending,
  DataTexture,
  FloatType,
  GLSL3,
  LessEqualDepth,
  LinearFilter,
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
import { TERRAIN_FRAGMENT, TERRAIN_VERTEX, WATER_FRAGMENT, WATER_VERTEX } from '../shaders'
import type { CandidateHandle, MountCandidate, WaterDebug } from '../types'
import { waitIdle } from '../waitIdle'
import { composeBasemap } from './basemap'

function floatTexture(data: Float32Array, n: number): DataTexture {
  const texture = new DataTexture(data, n, n, RedFormat, FloatType)
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

/**
 * B: 範囲の中の地形と水面を 1 つの Custom Layer で描く。範囲の外は MapLibre の平面の地図（地形なし）。
 * 地形と水面は同じ頂点（セル番号）と同じ標高のテクスチャを使い、水面を後に描く（spec S §3 の B の対策）
 */
export const mount: MountCandidate = async (map, scene, params) => {
  const { range } = scene
  const n = range.size
  const m = n + 2 // 縁つきの頂点の一辺（計画 D17）
  const renderTimes: number[] = []

  const basemap = new CanvasTexture(await composeBasemap(range))
  basemap.flipY = false // canvas の 1 行目（北）を v = 0 に置く（シェーダの v_uv と同じ向き）
  basemap.minFilter = LinearFilter
  basemap.generateMipmaps = false
  const elevationTexture = floatTexture(scene.elevation.slice(), n)
  const depthData = scene.depth.slice()
  const depthTexture = floatTexture(depthData, n)

  // 頂点は地形と水面で共有する。水面は内側の n × n だけ、地形は縁を含めるかを skirt で選ぶ
  const cells = new BufferAttribute(gridVertices(n, true), 2)
  const terrainGeometry = new BufferGeometry()
  terrainGeometry.setAttribute('a_cell', cells)
  terrainGeometry.setIndex(
    new BufferAttribute(params.skirt ? gridIndices(m, 0, m) : gridIndices(m, 1, n), 1),
  )
  const waterGeometry = new BufferGeometry()
  waterGeometry.setAttribute('a_cell', cells)
  waterGeometry.setIndex(new BufferAttribute(gridIndices(m, 1, n), 1))

  const metersToMercator = MercatorCoordinate.fromLngLat([
    scene.center.lon,
    scene.center.lat,
  ]).meterInMercatorCoordinateUnits()
  const model = gridModelMatrix(range, metersToMercator)
  const matrix = { value: new Matrix4() }
  const elevScale = { value: 1 }
  const common = {
    u_matrix: matrix,
    u_elevation: { value: elevationTexture },
    u_size: { value: n },
    // 最低の標高を高さ 0（平面の地図の高さ）にする（計画 D17）
    u_baseM: { value: scene.minElevation },
    u_elevScale: elevScale,
  }
  const terrainMaterial = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: TERRAIN_VERTEX,
    fragmentShader: TERRAIN_FRAGMENT,
    uniforms: { ...common, u_cellM: { value: range.cellSizeM }, u_basemap: { value: basemap } },
    depthFunc: LessEqualDepth,
  })
  const waterUniforms = {
    ...common,
    u_depth: { value: depthTexture },
    u_depthScale: { value: 1 },
    u_minDepth: { value: MIN_DEPTH_M },
    u_debug: { value: 0 },
  }
  const waterMaterial = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: waterUniforms,
    depthFunc: LessEqualDepth,
  })
  waterMaterial.polygonOffset = params.zfix !== 'none'
  waterMaterial.polygonOffsetFactor = params.zfix === 'offset2' ? -2 : -1
  waterMaterial.polygonOffsetUnits = params.zfix === 'offset2' ? -8 : -4

  const setDebug = (mode: WaterDebug): void => {
    waterUniforms.u_debug.value = mode === 'off' ? 0 : 1
    if (mode === 'off') {
      waterMaterial.transparent = true
      waterMaterial.blending = CustomBlending
      waterMaterial.blendSrc = OneFactor
      waterMaterial.blendDst = OneMinusSrcAlphaFactor
    } else {
      waterMaterial.transparent = false
      waterMaterial.blending = NoBlending
    }
    waterMaterial.depthTest = mode !== 'mask-nodepth'
    waterMaterial.depthWrite = mode !== 'mask-nodepth'
    waterMaterial.needsUpdate = true
    map.triggerRepaint()
  }
  setDebug('off')

  const terrainMesh = new Mesh(terrainGeometry, terrainMaterial)
  const waterMesh = new Mesh(waterGeometry, waterMaterial)
  for (const mesh of [terrainMesh, waterMesh]) mesh.frustumCulled = false
  terrainMesh.renderOrder = 0
  waterMesh.renderOrder = 1 // 水面を地形の後に描く
  const threeScene = new ThreeScene()
  threeScene.add(terrainMesh, waterMesh)
  const camera = new Camera()
  let renderer: WebGLRenderer | null = null

  const layer: CustomLayerInterface = {
    id: 'spike-b',
    type: 'custom',
    renderingMode: '3d',
    onAdd(targetMap, gl) {
      renderer = new WebGLRenderer({ canvas: targetMap.getCanvas(), context: gl, antialias: true })
      renderer.autoClear = false
    },
    render(gl, input) {
      if (renderer === null) return
      const start = performance.now()
      matrix.value.fromArray(multiply(input.defaultProjectionData.mainMatrix, model))
      renderer.resetState()
      renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
      renderer.render(threeScene, camera)
      renderTimes.push(performance.now() - start)
    },
  }
  map.addLayer(layer)

  return {
    renderTimes,
    setExaggeration(value) {
      // 合格基準 2: 地形と水面が同じ uniform（u_elevScale）を読むので、倍率は構造上一致する
      elevScale.value = value
      waterUniforms.u_depthScale.value = value
      map.triggerRepaint()
    },
    setDepth(depth) {
      depthData.set(depth)
      depthTexture.needsUpdate = true
      map.triggerRepaint()
    },
    setDebug,
    whenIdle: () => waitIdle(map),
  } satisfies CandidateHandle
}
```

`spike/src/main.ts` の `candidates` に足す:

```ts
  b: () => import('./candidates/b'),
```

`spike/e2e/matrix.spec.ts` の一覧を次にする:

```ts
const MATRIX_CANDIDATES = ['a', 'a2', 'b'] as const
```

- [ ] **Step 5: 継ぎ目の E2E を書く**

`spike/e2e/seam.spec.ts`（Task 7 で `braw` を足す）:

```ts
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { type Shot, writeContactSheet } from './support/contactSheet'
import { openSpike, setView } from './support/views'

const SEAM_CANDIDATES = ['b'] as const
const results = new URL('../results/', import.meta.url)

for (const candidate of SEAM_CANDIDATES) {
  test(`seam: ${candidate}`, async ({ page, context }) => {
    const lists: string[][] = [] // P20
    const shots: Shot[] = []
    // 範囲の中心から北を向くと、北の縁（台地、段差が最大）が見える
    for (const skirt of [1, 0]) {
      lists.push(await openSpike(page, context, { candidate, scene: 'synthetic', skirt }))
      for (const exaggeration of [1, 10]) {
        for (const pitch of [60, 85]) {
          await setView(page, { zoom: 16, exaggeration, pitch })
          shots.push({ label: `縁${skirt === 1 ? 'あり' : 'なし'} ×${exaggeration} p${pitch}`, png: await page.screenshot() })
        }
      }
    }
    await writeContactSheet(
      context,
      shots,
      4,
      `${candidate} の範囲の境界（ズーム 16、上: 縁あり、下: 縁なし）`,
      fileURLToPath(new URL(`sheets/${candidate}-seam.jpg`, results)),
    )
    expect(lists.flat()).toEqual([])
  })
}

test('境界の段差の表（倍率ごと、合成と実データ）', async ({ page, context }) => {
  const lines = ['| 場面 | 倍率 | 段差の最大 (m) | 段差の平均 (m) |', '|---|---|---:|---:|']
  for (const scene of ['synthetic', 'real'] as const) {
    // 実データはタイルの取得と復号にブラウザが要るので、候補なしのページを開いて測る
    const errors = await openSpike(page, context, { scene })
    const step = await page.evaluate(() => window.spike?.boundaryStep() ?? null)
    expect(step).not.toBeNull()
    expect(errors).toEqual([])
    if (step === null) continue
    for (const exaggeration of [1, 2, 5, 10]) {
      lines.push(
        `| ${scene} | ${exaggeration} | ${(step.max * exaggeration).toFixed(1)} | ${(step.mean * exaggeration).toFixed(1)} |`,
      )
    }
  }
  writeFileSync(new URL('seam.md', results), `# B の範囲の境界の段差\n\n${lines.join('\n')}\n`)
})
```


- [ ] **Step 6: 検査を通し、B の組み合わせと継ぎ目を回す**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて成功

Run: `pnpm spike:e2e spike/e2e/matrix.spec.ts -g "matrix: b$" && pnpm spike:e2e spike/e2e/seam.spec.ts`
Expected: PASS。`water-b.{json,md}`、`sheets/b-{synthetic,real,seam}.jpg`、`seam.md` ができる。コンタクトシートで、ベースマップが範囲の画素にそろっているか（淡色地図の道路が範囲の外の平面の地図と境界でつながるか）を目で確かめる。ずれていれば `composeBasemap` の原点（`originX`・`originY`）と `flipY` を確かめる

- [ ] **Step 7: B の判定を行う**

判定 (2) を Task 3 Step 9 の規則で B について行う。合格基準 2 は、地形と水面が同じ `u_elevScale` を読むことと、コンタクトシートで 10x のときに水面が地形からずれないことで判定する。

- [ ] **Step 8: 報告に書き、コミットする**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` の §4 の B の欄を書く:
- 合格基準 1: `water-b.md` の zfix=none・offset・offset2 の可視率の最小・ちらつきの最大と判定（「頂点の共有 + 描画順だけ（none）で足りるか」を明記）
- 合格基準 2: 構造上一致（同じ uniform）と目視の結果
- 継ぎ目: `seam.md` の表、`b-seam.jpg` の縁あり・なしの見え方（一言）
- 複雑さ・回避策: ベースマップの合成、縁、基準の標高、CanvasTexture の flipY、GL の状態の受け渡し（`resetState`・`setViewport`）など、実装で要った回避策を列挙する
- §7 に `b-synthetic.jpg`・`b-real.jpg`・`b-seam.jpg` への参照

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 候補 B（範囲の中は three で地形と水面、ベースマップのテクスチャ、縁）と継ぎ目の記録"
```

- [ ] **Step 9: B の 1cm の膜の対策を比べる（必須。中間の判定の反映 M3）**

matrix は zfix の 3 通り（none・offset・offset2）をすでに回しているので、この Step は表を読んで書くだけ。A の zfix=none が深度の精度で不合格だったので、B の「頂点の共有と描画順だけ」で足りるかが 05 の対策を直接決める。

`water-b.md` の synthetic の 3 つの表（zfix=none・offset・offset2）を、× の行の数とズームで比べ、pitch 85° のコマをコンタクトシート（`spike/out/shots/b-synthetic-*_p85.png`）で目で確かめる。「頂点の共有と描画順だけで足りる／polygonOffset が要る／どれでも足りない」のどれかを、根拠の数値つきで報告の §4 の「z-fighting の対策の効果」の B の欄に書く。コードは変えない。

```bash
git add docs/superpowers/spikes
git commit -m "スパイク S: B の 1cm の膜の対策の比較（none・offset・offset2。中間の判定の反映 M3）"
```

---
### Task 7: 候補 B-raw（B を three なしの生の WebGL2 で書く、RS-2）

**3 日目の午前（約 3 時間）。** シェーダ・メッシュ・ベースマップは B と同じものを使い、違いを three の有無だけにする。

**Files:**
- Create: `spike/src/candidates/glProgram.ts`、`spike/src/candidates/braw.ts`
- Modify: `spike/src/main.ts`（候補 `braw`）、`spike/e2e/matrix.spec.ts`（`MATRIX_CANDIDATES`）、`spike/e2e/seam.spec.ts`（`SEAM_CANDIDATES`）
- Create（実行の結果）: `spike/results/water-braw.{json,md}`、`spike/results/sheets/braw-{synthetic,real,seam}.jpg`
- Modify: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`

**Interfaces:**
- Consumes: Task 3 の `gridVertices`・`gridIndices`・4 つのシェーダ・`gridModelMatrix`・`multiply`・`MIN_DEPTH_M`、Task 6 の `composeBasemap`
- Produces（`glProgram.ts`）: `compileProgram(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram`（`#version 300 es` を前に付ける）、`uniformLocations<T extends string>(gl, program, names: readonly T[]): Record<T, WebGLUniformLocation | null>`、`createFloatTexture(gl, n: number, data: Float32Array): WebGLTexture`（R32F、NEAREST）
- Produces（`braw.ts`）: `mount: MountCandidate`。レイヤーの id `spike-braw`。`three` を import しない

- [ ] **Step 1: GL の補助を書く**

`spike/src/candidates/glProgram.ts`:

```ts
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
```

`gl.createProgram()` の戻り値の型が `WebGLProgram | null` になる環境（TypeScript の DOM の型の版による）では、`if (program === null) throw new Error('プログラムを作れません')` を足す。

- [ ] **Step 2: 候補 B-raw を書く**

`spike/src/candidates/braw.ts`:

```ts
import { type CustomLayerInterface, MercatorCoordinate } from 'maplibre-gl'
import { gridIndices, gridVertices } from '../gridMesh'
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

/** B と同じ描き方を three なしで（RS-2）。頂点を共有し、水面を後に描く */
export const mount: MountCandidate = async (map, scene, params) => {
  const { range } = scene
  const n = range.size
  const m = n + 2
  const renderTimes: number[] = []
  const basemapCanvas = await composeBasemap(range)
  const depthData = scene.depth.slice()
  let depthDirty = false
  let exaggeration = 1
  let debug: WaterDebug = 'off'
  const metersToMercator = MercatorCoordinate.fromLngLat([
    scene.center.lon,
    scene.center.lat,
  ]).meterInMercatorCoordinateUnits()
  const model = gridModelMatrix(range, metersToMercator)
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
      const terrainIndices = params.skirt ? gridIndices(m, 0, m) : gridIndices(m, 1, n)
      const waterIndices = gridIndices(m, 1, n)
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
        elevation: createFloatTexture(gl, n, scene.elevation),
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
      gl.bindVertexArray(s.vao)
      gl.disable(gl.CULL_FACE)
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LEQUAL)
      gl.depthMask(true)
      gl.disable(gl.BLEND)

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
      // 合格基準 2: 地形と水面の描画に同じ変数を渡す
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
```

`gl.createVertexArray()`・`gl.createBuffer()`・`gl.createTexture()` の戻り値の型が `| null` を含む場合は、`GlState` の作成の前で null を確かめて例外を投げる。

`spike/src/main.ts` の `candidates` に足す:

```ts
  braw: () => import('./candidates/braw'),
```

`spike/e2e/matrix.spec.ts` と `spike/e2e/seam.spec.ts` の一覧を次にする:

```ts
const MATRIX_CANDIDATES = ['a', 'a2', 'b', 'braw'] as const
```

```ts
const SEAM_CANDIDATES = ['b', 'braw'] as const
```

- [ ] **Step 3: three を import していないことを確かめる**

Run: `grep -n "from 'three'" spike/src/candidates/braw.ts spike/src/candidates/glProgram.ts spike/src/candidates/basemap.ts spike/src/gridMesh.ts spike/src/shaders.ts spike/src/mat4.ts`
Expected: 何も出ない（B-raw の読み込む範囲に three が無い。チャンクでの確認は Task 9）

- [ ] **Step 4: 検査を通し、B-raw の組み合わせと継ぎ目を回す**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: すべて成功

Run: `pnpm spike:e2e spike/e2e/matrix.spec.ts -g "matrix: braw$" && pnpm spike:e2e spike/e2e/seam.spec.ts -g "seam: braw"`
Expected: PASS。`water-braw.{json,md}`、`sheets/braw-{synthetic,real,seam}.jpg` ができる。B のコンタクトシートと並べ、見た目が同じであること（違えば、GL の状態の設定の漏れ。どの状態だったかを回避策として記録する）を確かめる。判定 (2) を Task 3 Step 9 の規則で行う

- [ ] **Step 5: 報告に書き、コミットする**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` の §4 の B-raw の欄を書く（合格基準 1・2、継ぎ目は「B と同じ」かどうか、複雑さ・回避策: GL の状態を毎回すべて設定する、R32F のテクスチャの作り方、VAO の後始末など）。§7 に `braw-*.jpg` への参照を足す。

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 候補 B-raw（three を使わない生の WebGL2。シェーダとメッシュは B と共通）"
```

---
### Task 8: 速度（水深を毎フレーム更新しながら地図を動かしたときの fps）

**3 日目の午後（約 2 時間）。合格基準 3。** 自動の計測（ヘッドレス、SwiftShader）は参考値で、合否は **【手動・ユーザー】** の実 GPU の計測で決める（D15）。

**Files:**
- Create: `spike/src/water/dynamicWater.worker.ts`、`spike/src/water/dynamicWater.ts`、`spike/src/fps.ts`、`spike/e2e/fps.spec.ts`
- Modify: `spike/src/types.ts`（`FpsResult`・`SpikeGlobal.runFps`）、`spike/src/main.ts`（`water=dynamic`・`probe=fps`、`rendererName` を `fps.ts` へ移す）
- Create（実行の結果）: `spike/results/fps-auto.{json,md}`、（ユーザーの計測の後）`spike/results/fps-manual.md`
- Modify: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`

**Interfaces:**
- Consumes: `Scene`・`CandidateHandle`（`renderTimes`・`setDepth`）、`openSpike`
- Produces（`dynamicWater.ts`）: `class DynamicWater { constructor(scene: Scene, onFrame: (depth: Float32Array) => void); request(elapsedMs: number): void; readonly roundTripMs: number[]; dispose(): void }`
- Produces（`fps.ts`）: `rendererName(gl: WebGL2RenderingContext): string`、`runFpsProbe(map: MapLibreMap, candidate: CandidateHandle, water: DynamicWater | null, durationMs: number): Promise<FpsResult>`
- Produces（`types.ts`）: `interface FpsResult { renderer: string; durationMs: number; frames: number; meanFps: number; p50Ms: number; p95Ms: number; maxMs: number; longFrameRatio: number; renderCpuMeanMs: number; renderCpuP95Ms: number; waterFrames: number; roundTripMeanMs: number; devicePixelRatio: number; canvas: [number, number]; pass: boolean }`、`SpikeGlobal.runFps(durationMs: number): Promise<FpsResult>`

- [ ] **Step 1: 毎フレーム変わる水深の Worker を書く**

`spike/src/water/dynamicWater.worker.ts`:

```ts
/**
 * 毎フレーム変わる水深（計画 D16）。固定の水のあるセルに、2〜4cm の波を足して返す。
 * 受け取ったバッファに書いて転送で返す（1 回に N² × 4 バイト、N = 516 で約 1.07MB）。
 * DOM と WebWorker の lib を同じプロジェクトに置かないため、self の型は必要な分だけ書く（tech-spec §10.3）
 */
interface InitMessage {
  type: 'init'
  base: Float32Array
  n: number
}
interface FrameMessage {
  type: 'frame'
  buffer: Float32Array
  elapsedMs: number
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InitMessage | FrameMessage>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

// 型を明示する。TS 6 では new Float32Array(0) が Float32Array<ArrayBuffer> と推論され、受け取った配列を代入できない（P17）
let base: Float32Array = new Float32Array(0)
let n = 0

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'init') {
    base = message.base
    n = message.n
    return
  }
  const out = message.buffer
  const phase = message.elapsedMs * 0.002
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col
      const b = base[i] ?? 0
      out[i] = b > 0 ? b + 0.02 * (2 + Math.sin(col * 0.05 + phase) * Math.cos(row * 0.05 - phase)) : 0
    }
  }
  scope.postMessage({ type: 'frame', buffer: out }, [out.buffer])
}
```

`spike/src/water/dynamicWater.ts`:

```ts
import type { Scene } from '../types'

/** Worker に水深を作らせ、転送で受け取る。バッファ 2 枚を往復させ、前の要求が戻るまで次を出さない */
export class DynamicWater {
  readonly roundTripMs: number[] = []
  private readonly worker: Worker
  private readonly spare: Float32Array[]
  private pending = false
  private sentAt = 0

  constructor(scene: Scene, onFrame: (depth: Float32Array) => void) {
    const n = scene.range.size
    this.worker = new Worker(new URL('./dynamicWater.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.postMessage({ type: 'init', base: scene.depth.slice(), n })
    this.spare = [new Float32Array(n * n), new Float32Array(n * n)]
    this.worker.onmessage = (event: MessageEvent<{ buffer: Float32Array }>) => {
      this.roundTripMs.push(performance.now() - this.sentAt)
      this.pending = false
      // setDepth はテクスチャ用の配列へ写すので、受け取ったバッファはすぐ使い回せる
      onFrame(event.data.buffer)
      this.spare.push(event.data.buffer)
    }
  }

  request(elapsedMs: number): void {
    if (this.pending) return
    const buffer = this.spare.pop()
    if (buffer === undefined) return
    this.pending = true
    this.sentAt = performance.now()
    this.worker.postMessage({ type: 'frame', buffer, elapsedMs }, [buffer.buffer])
  }

  dispose(): void {
    this.worker.terminate()
  }
}
```

- [ ] **Step 2: fps の計測を書く**

`spike/src/types.ts` の `WaterMeasure` の次に足す:

```ts
/** fps の計測（Task 8）。frame の間隔は requestAnimationFrame の時刻の差 */
export interface FpsResult {
  renderer: string // WEBGL_debug_renderer_info の UNMASKED_RENDERER（SwiftShader か実 GPU か）
  durationMs: number
  frames: number
  meanFps: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  longFrameRatio: number // 33.4ms（2 フレーム分）を超えた間隔の割合
  renderCpuMeanMs: number // 候補の Custom Layer の render の CPU 時間（アップロードを含む）
  renderCpuP95Ms: number
  waterFrames: number // 計測中に届いた水深の数
  roundTripMeanMs: number // 水深の要求から受け取りまで（Worker の計算と転送 2 回）
  devicePixelRatio: number
  canvas: [number, number] // drawingBuffer の画素数
  pass: boolean // 平均 57fps 以上かつ長いフレーム 1% 以下（計画 D15）
}
```

`SpikeGlobal` の `boundaryStep` の次に足す:

```ts
  /** 地図を動かし、water=dynamic なら水深を毎フレーム更新しながら fps を測る */
  runFps(durationMs: number): Promise<FpsResult>
```

`spike/src/fps.ts`:

```ts
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CandidateHandle, FpsResult } from './types'
import type { DynamicWater } from './water/dynamicWater'

const LONG_FRAME_MS = 33.4
const PASS_FPS = 57
const PASS_LONG_RATIO = 0.01

export function rendererName(gl: WebGL2RenderingContext): string {
  const info = gl.getExtension('WEBGL_debug_renderer_info')
  return info === null ? '不明' : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
}

const percentile = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length

/**
 * 地図を毎フレーム動かし（中心を小さく回しながら bearing を回す）、水深を毎フレーム要求する。
 * パン・回転の操作の代わり（tech-spec §14.1 の「地図操作時」）
 */
export async function runFpsProbe(
  map: MapLibreMap,
  candidate: CandidateHandle,
  water: DynamicWater | null,
  durationMs: number,
): Promise<FpsResult> {
  const center = map.getCenter()
  const bearing = map.getBearing()
  const renderStart = candidate.renderTimes.length
  const waterStart = water?.roundTripMs.length ?? 0
  const deltas: number[] = []
  await new Promise<void>((resolve) => {
    let start = 0
    let last = 0
    const tick = (now: number): void => {
      deltas.push(now - last)
      last = now
      const elapsed = now - start
      map.jumpTo({
        bearing: bearing + elapsed * 0.02,
        center: [
          center.lng + 0.0005 * Math.sin(elapsed / 1000),
          center.lat + 0.0003 * Math.cos(elapsed / 1000),
        ],
      })
      water?.request(elapsed)
      if (elapsed < durationMs) requestAnimationFrame(tick)
      else resolve()
    }
    requestAnimationFrame((now) => {
      start = now
      last = now
      requestAnimationFrame(tick)
    })
  })
  map.jumpTo({ center, bearing })
  const sorted = [...deltas].sort((a, b) => a - b)
  const total = deltas.reduce((a, b) => a + b, 0)
  const cpu = candidate.renderTimes.slice(renderStart).sort((a, b) => a - b)
  const meanFps = deltas.length / (total / 1000)
  const longFrameRatio = deltas.filter((d) => d > LONG_FRAME_MS).length / deltas.length
  const gl = map.painter.context.gl
  return {
    renderer: rendererName(gl),
    durationMs: total,
    frames: deltas.length,
    meanFps,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    longFrameRatio,
    renderCpuMeanMs: mean(cpu),
    renderCpuP95Ms: percentile(cpu, 0.95),
    waterFrames: (water?.roundTripMs.length ?? 0) - waterStart,
    roundTripMeanMs: mean(water?.roundTripMs.slice(waterStart) ?? []),
    devicePixelRatio: window.devicePixelRatio,
    canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    pass: meanFps >= PASS_FPS && longFrameRatio <= PASS_LONG_RATIO,
  }
}
```

- [ ] **Step 3: ページに水深の更新と fps の計測をつなぐ（main.ts の最終形）**

`spike/src/main.ts` を次の内容に置き換える（Task 1〜7 で足した候補の読み込み・`measure`・`boundaryStep`、Task 5 Step 10・11 の `bowlFilm`・`demFill` を含む最終形。`rendererName` は `fps.ts` へ移した。Task 5 Step 11 を打ち切った場合は `, params.demFill === 'nearest'` を消す）:

```ts
import 'maplibre-gl/dist/maplibre-gl.css'
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { createGsiPaleStyle } from '../../src/map/gsiStyle'
import { measureWater } from './capture'
import { loadDemTiles } from './demTiles'
import { rendererName, runFpsProbe } from './fps'
import { parseParams, type SpikeParams } from './params'
import { boundaryStepM, buildRealScene, buildSyntheticScene, shibuyaRange } from './scenes'
import type { CandidateHandle, CandidateId, MountCandidate, Scene, SpikeGlobal, View } from './types'
import { waitIdle } from './waitIdle'
import { DynamicWater } from './water/dynamicWater'

setWorkerUrl(workerUrl)

/** 候補は動的 import で読み、候補ごとのチャンクにする（計画 D3、Task 9 で大きさを測る） */
// 打ち切り（「日程」）で候補を外したときは、その行を消せば build と typecheck が通る（P15）
const candidates: Partial<Record<CandidateId, () => Promise<{ mount: MountCandidate }>>> = {
  a: () => import('./candidates/a'),
  a2: () => import('./candidates/a'),
  b: () => import('./candidates/b'),
  braw: () => import('./candidates/braw'),
}

const status = document.getElementById('status')
const show = (text: string): void => {
  if (status !== null) status.textContent = text
}

async function buildScene(params: SpikeParams): Promise<Scene> {
  if (params.scene === 'real') {
    const range = shibuyaRange()
    return buildRealScene(range, await loadDemTiles(range), params.demFill === 'nearest')
  }
  const water = params.water === 'film' || params.water === 'bowlFilm' ? params.water : 'fixed'
  return buildSyntheticScene(water)
}

async function start(): Promise<void> {
  const cspViolations: string[] = []
  document.addEventListener('securitypolicyviolation', (event) => {
    cspViolations.push(`${event.violatedDirective} ${event.blockedURI}`)
  })
  const params = parseParams(location.search)
  const scene = await buildScene(params)
  const map = new MapLibreMap({
    container: 'map',
    style: createGsiPaleStyle({
      text: '国土地理院',
      url: 'https://maps.gsi.go.jp/development/ichiran.html',
    }),
    center: [scene.center.lon, scene.center.lat],
    zoom: params.zoom,
    pitch: params.pitch,
    bearing: 0,
    maxZoom: 18,
    maxPitch: 85,
    fadeDuration: 0,
    attributionControl: { compact: false },
    // capture=1 のときだけ画面を読み取れるようにする。fps の計測では切る（計画 D9・D15）
    canvasContextAttributes: { antialias: true, preserveDrawingBuffer: params.capture },
  })
  map.on('error', (event) => console.error(event.error))
  await map.once('load')

  let candidate: CandidateHandle | null = null
  if (params.candidate !== null) {
    const load = candidates[params.candidate]
    if (load === undefined) throw new Error(`候補 ${params.candidate} はありません`)
    candidate = await (await load()).mount(map, scene, params)
    candidate.setExaggeration(params.exaggeration)
  }
  // 毎フレーム変わる水深（計画 D16）。候補があるときだけ
  const mounted = candidate
  const water =
    mounted !== null && params.water === 'dynamic'
      ? new DynamicWater(scene, (depth) => mounted.setDepth(depth))
      : null

  const spike: SpikeGlobal = {
    map,
    scene,
    params,
    candidate,
    cspViolations,
    async setView(view: View) {
      map.jumpTo({
        center: [scene.center.lon, scene.center.lat],
        zoom: view.zoom,
        pitch: view.pitch,
        bearing: 0,
      })
      candidate?.setExaggeration(view.exaggeration)
      await (candidate === null ? waitIdle(map) : candidate.whenIdle())
    },
    async measure() {
      if (candidate === null) throw new Error('候補がありません')
      if (!params.capture) throw new Error('capture=1 で開いてください')
      return measureWater(map, candidate)
    },
    boundaryStep: () => boundaryStepM(scene),
    async runFps(durationMs: number) {
      if (candidate === null) throw new Error('候補がありません')
      return runFpsProbe(map, candidate, water, durationMs)
    },
  }
  window.spike = spike
  await (candidate === null ? waitIdle(map) : candidate.whenIdle())
  show(
    `${params.candidate ?? '候補なし'} / ${scene.name} / N=${scene.range.size} / ${rendererName(map.painter.context.gl)}`,
  )
  document.documentElement.dataset.spikeReady = 'true'

  if (params.probe === 'fps') {
    // 手動の計測（【手動・ユーザー】）: 10 秒測って、結果を左上に出す。マウスを動かさない
    show('fps を計測中（10 秒。マウスを動かさないでください）')
    const result = await spike.runFps(10_000)
    show(JSON.stringify(result, null, 2))
    document.documentElement.dataset.fpsDone = 'true'
  }
}

start().catch((error: unknown) => {
  console.error(error)
  show(`失敗: ${String(error)}`)
  document.documentElement.dataset.spikeError = String(error)
})
```

- [ ] **Step 4: 自動の計測（参考値）の E2E を書く**

`spike/e2e/fps.spec.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { FpsResult, View } from '../src/types'
import { openSpike, setView } from './support/views'

const FPS_CANDIDATES = ['a', 'a2', 'b', 'braw'] as const
// 手動の計測と同じ 2 つの視点
const FPS_VIEWS: View[] = [
  { zoom: 17, exaggeration: 5, pitch: 60 },
  { zoom: 16, exaggeration: 10, pitch: 85 },
]
const results = new URL('../results/', import.meta.url)

test('fps（自動、ヘッドレスの Chromium。参考値）', async ({ page, context }) => {
  const rows: { candidate: string; view: View; result: FpsResult }[] = []
  const lists: string[][] = [] // P20
  for (const candidate of FPS_CANDIDATES) {
    lists.push(await openSpike(page, context, { candidate, scene: 'real', water: 'dynamic' }))
    for (const view of FPS_VIEWS) {
      await setView(page, view)
      const result = await page.evaluate(async () => {
        if (window.spike === undefined) throw new Error('window.spike がありません')
        return window.spike.runFps(5_000)
      })
      rows.push({ candidate, view, result })
    }
  }
  mkdirSync(results, { recursive: true })
  writeFileSync(new URL('fps-auto.json', results), `${JSON.stringify(rows, null, 2)}\n`)
  const lines = [
    `描画: ${rows[0]?.result.renderer ?? '不明'}（ソフトウェア描画なら参考値。計画 D15）`,
    '',
    '| 候補 | 視点 | 平均 fps | p95 (ms) | 長いフレーム | render の CPU 平均 (ms) | 水深の往復 (ms) | 水深の数 |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      ({ candidate, view, result: r }) =>
        `| ${candidate} | z${view.zoom} ×${view.exaggeration} p${view.pitch} | ${r.meanFps.toFixed(1)} | ${r.p95Ms.toFixed(1)} | ${(r.longFrameRatio * 100).toFixed(1)}% | ${r.renderCpuMeanMs.toFixed(2)} | ${r.roundTripMeanMs.toFixed(1)} | ${r.waterFrames} |`,
    ),
  ]
  const table = `${lines.join('\n')}\n`
  writeFileSync(new URL('fps-auto.md', results), `# fps（自動）\n\n${table}`)
  console.log(table)
  expect(lists.flat()).toEqual([])
})
```

- [ ] **Step 5: 検査を通し、自動の計測を回す**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm spike:e2e spike/e2e/fps.spec.ts`
Expected: PASS。`fps-auto.{json,md}` ができる。「水深の数」が 0 なら Worker が動いていない（CSP の `worker-src 'self'` とチャンクの URL を確かめる）。描画の名前に SwiftShader が含まれることを確かめ、表の上に「参考値」と書いたまま残す

- [ ] **Step 6: 【手動・ユーザー】実 GPU で fps を測ってもらう**

実行役は、次の手順をそのまま（コマンドと URL を含めて）コーディネーターに送り、ユーザーの計測を依頼する。結果が届くまで、報告の「合格基準 3」の行の各欄は「ユーザーの計測待ち」と書いて先へ進む（Task 9・10 はこれを待たない）。

```text
【手動・ユーザー】スパイク S の fps の計測（所要 約 10 分）

1. 開発機（GPU のある機械）で、次を実行する（ポート 4174 を使う。04 の E2E の 4173 とはぶつからない）
   cd /home/terapyon/dev/terapyon/raintrace/.claude/worktrees/spike-3d-rendering
   pnpm spike:build && pnpm spike:preview
2. Chrome を最大化し、次の 8 つの URL を 1 つずつ開く。開いたら 10 秒間マウスとキーボードに触れない。
   左上に JSON が出たら、その全文を控える（"pass" が合否。"renderer" に GPU の名前が出る）
   http://localhost:4174/?candidate=a&scene=real&water=dynamic&zoom=17&exaggeration=5&pitch=60&probe=fps
   http://localhost:4174/?candidate=a&scene=real&water=dynamic&zoom=16&exaggeration=10&pitch=85&probe=fps
   http://localhost:4174/?candidate=a2&scene=real&water=dynamic&zoom=17&exaggeration=5&pitch=60&probe=fps
   http://localhost:4174/?candidate=a2&scene=real&water=dynamic&zoom=16&exaggeration=10&pitch=85&probe=fps
   http://localhost:4174/?candidate=b&scene=real&water=dynamic&zoom=17&exaggeration=5&pitch=60&probe=fps
   http://localhost:4174/?candidate=b&scene=real&water=dynamic&zoom=16&exaggeration=10&pitch=85&probe=fps
   http://localhost:4174/?candidate=braw&scene=real&water=dynamic&zoom=17&exaggeration=5&pitch=60&probe=fps
   http://localhost:4174/?candidate=braw&scene=real&water=dynamic&zoom=16&exaggeration=10&pitch=85&probe=fps
3. あわせて控えるもの: chrome://gpu の「GL_RENDERER」、Chrome の版（chrome://version）、画面のリフレッシュレート（Hz）、
   ウィンドウの大きさ（JSON の "canvas" と "devicePixelRatio" で足りる）
4. 終わったら、ターミナルで Ctrl+C を押して preview を止める
5.（任意）性能の低いもう 1 台で測る場合: 1 の代わりに
   pnpm spike:build && pnpm exec vite preview --config spike/vite.config.ts --port 4174 --strictPort --host
   を実行し、その機械のブラウザで http://<開発機の LAN の IP>:4174/?… を開く（同じ 8 つの URL の localhost を置き換える）
```

届いた結果は、実行役が `spike/results/fps-manual.md` に表（候補・視点・平均 fps・p95・長いフレーム・render の CPU 平均・pass、機械と GPU と Chrome の版とリフレッシュレート）として書き、コミットする（コミットメッセージ: `スパイク S: 実 GPU での fps（ユーザーの計測）`）。

- [ ] **Step 7: 報告に書き、コミットする**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` の §4 の「合格基準 3」の行に、各候補の自動の平均 fps（「参考、SwiftShader」と明記）と、手動の結果（届いていなければ「ユーザーの計測待ち」）を書く。あわせて、水深の 1 回のアップロードを含む render の CPU 時間（自動の値）を、spec 05 §3.1 の「CPU の負担は 1MB のアップロードだけ」の裏付けとして §10 の申し送りの材料にメモする。

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 水深を毎フレーム更新しながらの fps の計測（自動の参考値と、手動の手順）"
```

---

### Task 9: バンドルの差・複雑さ・CSP の確認

**3 日目の午後（約 1 時間）。**

**Files:**
- Create: `spike/scripts/bundle-size.mjs`
- Modify: `spike/e2e/smoke.spec.ts`（候補ごとの CSP の確認）
- Create（実行の結果）: `spike/results/bundle.md`、`spike/results/complexity.md`
- Modify: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`

**Interfaces:**
- Consumes: `initialFiles(manifest, entryKey): Set<string>`・`kb(bytes): string`（`scripts/lib/bundleBudget.mjs`）、`dist-spike/.vite/manifest.json`（キーは `spike/` からの相対パス。例 `src/candidates/b.ts`）、Task 1 の `openSpike`
- Produces: `spike/results/bundle.md`（候補ごとのチャンクの gzip の合計、three のチャンク、B − B-raw）、`spike/results/complexity.md`（行数と回避策の数）

- [ ] **Step 1: 候補ごとのチャンクの大きさを求めるスクリプトを書く**

`spike/scripts/bundle-size.mjs`:

```js
/**
 * スパイクのビルド（dist-spike）で、候補ごとに読み込まれる JS の gzip の合計を求める（spec S §3 の「バンドル」）。
 * 候補の分 = 候補のモジュールから静的な import をたどったチャンクのうち、ページの入口（index.html）が読むもの以外
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { initialFiles, kb } from '../../scripts/lib/bundleBudget.mjs'

const dist = 'dist-spike'
const manifest = JSON.parse(readFileSync(join(dist, '.vite/manifest.json'), 'utf8'))
const gzip = (file) => gzipSync(readFileSync(join(dist, file)), { level: 9 }).length
const entry = initialFiles(manifest, 'index.html')
const threeFiles = [...new Set(Object.values(manifest).map((chunk) => chunk.file))].filter((file) =>
  /(^|\/)three-[^/]+\.js$/.test(file),
)
const candidates = [
  ["A・A'", 'src/candidates/a.ts'],
  ['B', 'src/candidates/b.ts'],
  ['B-raw', 'src/candidates/braw.ts'],
]

console.log('| 候補 | チャンク | gzip (KB) | three を含む |')
console.log('|---|---|---:|:---:|')
const sizes = {}
for (const [name, key] of candidates) {
  const files = [...initialFiles(manifest, key)].filter((file) => !entry.has(file))
  const bytes = files.reduce((sum, file) => sum + gzip(file), 0)
  sizes[name] = bytes
  const hasThree = files.some((file) => threeFiles.includes(file))
  console.log(`| ${name} | ${files.join('<br>')} | ${kb(bytes)} | ${hasThree ? '○' : ''} |`)
}
const entryBytes = [...entry].reduce((sum, file) => sum + gzip(file), 0)
console.log(`\nページの入口（地図を含み、全候補で共通）: ${kb(entryBytes)} KB`)
console.log(
  `three のチャンク: ${threeFiles.map((file) => `${file} ${kb(gzip(file))} KB`).join('、') || 'なし'}`,
)
console.log(`B − B-raw: ${kb(sizes.B - sizes['B-raw'])} KB`)
```

- [ ] **Step 2: 測る**

Run: `pnpm spike:build && node spike/scripts/bundle-size.mjs | tee spike/results/bundle.md`
Expected: 表が出る。B の行に ○、B-raw の行は空欄（three を含まない）。three のチャンクが 1 つある。`initialFiles` が「マニフェストにエントリ … がありません」で失敗したら、`dist-spike/.vite/manifest.json` のキーを見て `candidates` のキーを合わせる

`spike/results/bundle.md` の先頭に、`# バンドル（gzip level 9、1KB = 1000 バイト）` と、本番の総量（Task 1 Step 0 の値）に three のチャンクを足すと tech-spec §14.2 の総量の上限 1.2MB に対してどうなるか（例: 525.0 + X = Y KB）を 1 行で書き足す。

- [ ] **Step 3: 行数と回避策を数える**

Run: `wc -l spike/src/candidates/a.ts spike/src/candidates/terrarium.ts spike/src/candidates/threeWater.ts spike/src/candidates/b.ts spike/src/candidates/basemap.ts spike/src/candidates/braw.ts spike/src/candidates/glProgram.ts spike/src/shaders.ts spike/src/gridMesh.ts spike/src/mat4.ts`
Run: `grep -n "^function resampleHeights" -A 200 spike/src/candidates/a.ts | grep -m1 -n "^[0-9]*-}"`（A' の分の関数の行数）

`spike/results/complexity.md` に次の表を書く（行数は上の出力から。テストを含めない）:

| 候補 | ファイル | 行数 | 回避策の数 | 回避策 |
|---|---|---:|---:|---|
| A | a.ts（`resampleHeights` を除く）、terrarium.ts、threeWater.ts | | | 報告の §4 に書いてきたものを列挙 |
| A' | A ＋ `resampleHeights` | | | |
| B | b.ts、basemap.ts | | | |
| B-raw | braw.ts、glProgram.ts、basemap.ts | | | |
| 共通 | shaders.ts、gridMesh.ts、mat4.ts | | — | — |

空欄は、この Step で上の出力と報告の §4 の回避策の一覧から埋める（空欄のままコミットしない）。

- [ ] **Step 4: 候補ごとに CSP 違反が無いことを確かめる**

`spike/e2e/smoke.spec.ts` の末尾に足す:

```ts
for (const candidate of ['a', 'a2', 'b', 'braw'] as const) {
  test(`候補 ${candidate} の読み込みで CSP 違反とエラーが無い`, async ({ page, context }) => {
    const errors = await openSpike(page, context, { candidate, scene: 'real' })
    expect(await page.evaluate(() => window.spike?.cspViolations)).toEqual([])
    expect(errors).toEqual([])
  })
}
```

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm spike:e2e spike/e2e/smoke.spec.ts`
Expected: PASS（6 件）。違反が出たら、違反の文字列と、どの候補のどの資源かを報告の §11 に書く（CSP は緩めない。本番で要る CSP の変更として 05 への申し送りにする）

- [ ] **Step 5: 本番のビルドが変わっていないことを確かめる**

Run: `pnpm build && pnpm size`
Expected: 初期ロードと総量が Task 1 Step 0 と同じ

- [ ] **Step 6: 報告に書き、コミットする**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` の §4 の「バンドル」の行（候補ごとの KB、three のチャンクの KB、B − B-raw）と「複雑さ」の行（行数・回避策の数）を書く。§2 の「本番のバンドル」の行に「スパイクの後も同じ」を足す。

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 候補ごとのバンドルの差（three の有無）、行数と回避策、候補ごとの CSP の確認"
```

---

### Task 10: 報告の仕上げ、報告のブランチ、引き継ぎ

**3 日目の終わり（約 2 時間）。削らない。**

**Files:**
- Create: `spike/e2e/pick.spec.ts`、`docs/superpowers/spikes/2026-09-12-3d-rendering/*.jpg`（6 枚）
- Modify: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`（全節）
- 報告のブランチ `docs/S-3d-rendering-report`（`main` から、worktree `/home/terapyon/dev/terapyon/raintrace/.claude/worktrees/S-report`）: `docs/superpowers/spikes/2026-09-12-3d-rendering.md`、`docs/superpowers/spikes/2026-09-12-3d-rendering/*.jpg`、`docs/superpowers/plans/2026-09-12-S-3d-rendering-spike.md`
- Create（git 管理外）: `/home/terapyon/dev/terapyon/raintrace/.handoff/S-3d-rendering.md`、`/home/terapyon/dev/terapyon/raintrace/.handoff/S-3d-rendering-pr.md`。worktree の外で書いてよいのはこの 2 つだけ。`.handoff/README.md` はコーディネーターが管理するので変えない

**Interfaces:**
- Consumes: Task 2〜9 の `spike/results/*`、報告の §2〜§7、`openSpike`・`setView`
- Produces: 報告（`main` への PR の中身）、報告のブランチのコミット、PR 本文、push の手順

- [ ] **Step 1: 報告に載せる 6 枚を撮る**

`spike/e2e/pick.spec.ts`:

```ts
import { mkdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { View } from '../src/types'
import { openSpike, setView } from './support/views'

// 報告に載せる 6 枚（計画 D11）。候補ごとに同じ視点 1 枚、A の LOD、B の境界
const PICKS: { name: string; query: Record<string, string | number>; view: View }[] = [
  { name: 'a-synthetic-z17-x10-p60', query: { candidate: 'a', scene: 'synthetic' }, view: { zoom: 17, exaggeration: 10, pitch: 60 } },
  { name: 'a2-synthetic-z17-x10-p60', query: { candidate: 'a2', scene: 'synthetic' }, view: { zoom: 17, exaggeration: 10, pitch: 60 } },
  { name: 'b-synthetic-z17-x10-p60', query: { candidate: 'b', scene: 'synthetic' }, view: { zoom: 17, exaggeration: 10, pitch: 60 } },
  { name: 'braw-synthetic-z17-x10-p60', query: { candidate: 'braw', scene: 'synthetic' }, view: { zoom: 17, exaggeration: 10, pitch: 60 } },
  { name: 'a-real-z15-x5-p60', query: { candidate: 'a', scene: 'real' }, view: { zoom: 15, exaggeration: 5, pitch: 60 } },
  { name: 'b-seam-z16-x10-p60', query: { candidate: 'b', scene: 'synthetic', skirt: 1 }, view: { zoom: 16, exaggeration: 10, pitch: 60 } },
]
const dir = new URL('../../docs/superpowers/spikes/2026-09-12-3d-rendering/', import.meta.url)

test('報告に載せる画像', async ({ page, context }) => {
  mkdirSync(dir, { recursive: true })
  for (const pick of PICKS) {
    const errors = await openSpike(page, context, { ...pick.query, water: 'fixed' })
    await setView(page, pick.view)
    const path = fileURLToPath(new URL(`${pick.name}.jpg`, dir))
    await page.screenshot({ path, type: 'jpeg', quality: 80 })
    // 1 枚 200KB 以下（計画 D11）
    expect(statSync(path).size).toBeLessThanOrEqual(200_000)
    expect(errors).toEqual([])
  }
})
```

Run: `pnpm lint && pnpm typecheck && pnpm spike:e2e spike/e2e/pick.spec.ts`
Expected: PASS。6 枚ができる。200KB を超えたら、`quality` を 60 にして撮り直す

- [ ] **Step 2: 結果をコミットし、参照に使うハッシュを控える**

```bash
git add spike docs/superpowers/spikes
git commit -m "スパイク S: 報告に載せる画像"
git rev-parse HEAD
```

出力のハッシュ（以下 H）を、報告から結果とコードを参照する URL に使う: `https://github.com/terapyon/raintrace/blob/<H>/spike/results/…`、`https://github.com/terapyon/raintrace/tree/<H>/spike`（D11。push はユーザーが行う）。

- [ ] **Step 3: 推奨を決める**

§4 の表から、次の順で推奨を決める。

1. 合格基準 1〜3 をすべて満たす候補だけを推奨の候補にする。基準 3 の手動の結果が届いていなければ、自動の値と render の CPU 時間から見込みを書き、推奨に「実 GPU の fps で確定」と条件を付ける
2. A 系と B 系がともに合格なら、継ぎ目が無く自前の地形のコードが要らない A 系を優先する。A 系の水面を three なしで書けることは、B-raw の水面の部分（`braw.ts` の水面の描画）で示せる
3. A と A' がともに合格なら、水面の高さがシミュレーションの標高と一致する A を優先する（A' は tech-spec §5.5 の「表示される水面の高さがシミュレーションの標高と食い違う」を実測した差を持つ）
4. three の要否（RS-2）: B と B-raw がともに合格で、B-raw の行数が B の 2 倍以下かつ回避策の数の差が 3 以下なら、three を採らない（tech-spec §2 原則 3。削れる量は `bundle.md` の B − B-raw）
5. どの候補も基準を満たさなければ、spec S §5 の代わりの方針をユーザーの裁定に出す。案 1: PoC の 3D は地形のみ（A の地形）とし、水深は 2D 表示で見せる。案 2: 3D を 05 から外し、2D の表示で PoC を終える。どちらの場合も、満たさなかった基準と数値を並べる

- [ ] **Step 4: 報告を仕上げる**

`docs/superpowers/spikes/2026-09-12-3d-rendering.md` を、次のとおり仕上げる。
- 冒頭の Status を「確定待ち（ユーザーの裁定）」にし、日付の行に完了の日を足す
- §1 結論: 推奨の候補（または代わりの方針）、理由の 3 行、ユーザーに裁定してほしいこと（T9 の案、代わりの方針の場合はその選択）
- §4: 空欄が無いこと。評価できなかった観点は「未評価（理由）」と書く（spec S §5 の終了条件）
- §7: 6 枚の画像を相対パス（`2026-09-12-3d-rendering/<名前>.jpg`）で載せ、コンタクトシート（最大 8 枚＋継ぎ目 2 枚）と `spike/results/` の各ファイルを H の URL で参照する
- §8 推奨と理由: Step 3 の順のどこで決まったかを書く
- §9 tech-spec §5.5 の改訂案（T9）: 次の表を、推奨に合わせて埋めた文面にする（D14 のとおり、tech-spec 自体はこの PR で変えない）

```markdown
## 5.5 地形の描画方式（決定。スパイク S の結論、ユーザーの裁定の日を記す）

| 項目 | 決定 | 根拠（`docs/superpowers/spikes/2026-09-12-3d-rendering.md`） |
|---|---|---|
| 地形 | （A 系: MapLibre の 3D terrain、`addProtocol` で Terrarium に変換。B 系: 範囲の中は自前のメッシュ） | §4 |
| 水面 | Custom Layer。標高と水深を R32F のテクスチャで渡し、頂点シェーダで高さを付ける | spec 05 §3.1、§4 の fps |
| 水面の高さの基準 | （シミュレーションの標高 / MapLibre の地形） | §5、A' の差 |
| 垂直強調 | （`setTerrain({ exaggeration })` とシェーダに同じ値 / 同じ uniform） | §4 の合格基準 2 |
| z-fighting の対策 | （水面を後に描く＋polygonOffset(−1, −4) / (−2, −8) / 頂点の共有と描画順） | §4、`water-*.md` |
| 範囲の境界 | （A 系: なし / B 系: 最低の標高を基準にし、縁を付ける） | `seam.md` |
| 3D 描画のライブラリ | （Three.js / なし（WebGL2 を直接使う）） | `bundle.md`、`complexity.md` |
```

  あわせて、three を採らない場合に変わる tech-spec の箇所（§1 の表の「3D 描画 | Three.js」の行、§1.1 の react-three-fiber の理由、§14.2 の「Three.js」の記述、`vite.config.ts` のコメントの「05 で動的 import する Three.js」）を、改訂案の一覧として書く
- §10 05 への申し送り: spec 05 §4 のどの列に絞るか、A 系を採る場合の流れの矢印の描き方（Task 5 Step 7 の `a-arrows.md` の (a)〜(c) から、symbol レイヤーで足りるか、Custom Layer で水面の高さに描く必要があるか）、採る z-fighting の対策と係数、水深のアップロードを含む render の CPU 時間（Task 8）、A' を採る場合は高さの取り直しの時間と 50ms の上限、B 系を採る場合はベースマップの合成と縁
- §11 未確認の事項: 次を必ず含める。(a) raster-dem の `encoding: 'custom'` で変換を省く方法、(b) 本番の A は z15 以下で DEM5・DEM10B を使うので、このスパイクの A（z17 からの 1 点の取得）より LOD のずれが大きくなりうること（D5）、(c) B・B-raw の流れの矢印（インスタンス描画）は比べていないこと（05 で作る。D20）、(d) Firefox・Safari、WebGL のコンテキストの喪失、クリックからセルを求める方法（spec 05 の範囲）、(e) 実 GPU の fps が届いていなければそのこと、(f) 無効セルを含む DEM で無効の頂点が z = 0 へ落ちる細い三角形（骨組みの §11 の項目。R4。実データのコンタクトシートで現れたかを書く）

```bash
git add docs/superpowers/spikes
git commit -m "スパイク S の報告: 候補ごとの結果、推奨、tech-spec §5.5 の改訂案（T9）"
```

- [ ] **Step 5: 報告のブランチを作り、報告・画像・計画を入れる**

```bash
git -C /home/terapyon/dev/terapyon/raintrace worktree add /home/terapyon/dev/terapyon/raintrace/.claude/worktrees/S-report -b docs/S-3d-rendering-report main
cd /home/terapyon/dev/terapyon/raintrace/.claude/worktrees/S-report
mkdir -p docs/superpowers/spikes docs/superpowers/plans
cp ../spike-3d-rendering/docs/superpowers/spikes/2026-09-12-3d-rendering.md docs/superpowers/spikes/
cp -r ../spike-3d-rendering/docs/superpowers/spikes/2026-09-12-3d-rendering docs/superpowers/spikes/
cp ../spike-3d-rendering/docs/superpowers/plans/2026-09-12-S-3d-rendering-spike.md docs/superpowers/plans/
git add docs/superpowers
git commit -m "Spike S の報告: 3D 描画方式の比較の結論と tech-spec §5.5 の改訂案（T9）"
git diff --stat main
```

Expected: 差分は `docs/superpowers/` の下の報告 1・画像 6・計画 1 だけ（コードを含まない）。報告の中の相対パスの画像が、このブランチでも同じ位置にあることを `ls docs/superpowers/spikes/2026-09-12-3d-rendering/` で確かめる

- [ ] **Step 6: PR 本文と push の手順を書く（引き継ぎ）**

superpowers の writing-pr-descriptions のスキルで、`/home/terapyon/dev/terapyon/raintrace/.handoff/S-3d-rendering-pr.md` に PR 本文を書く。少なくとも次を含め、末尾を `🤖 Generated with [Claude Code](https://claude.com/claude-code)` で終える:
- 何のための PR か（spec S の報告だけで、コードを含まない。コードは `spike/3d-rendering` に残し、マージしない）
- 推奨（または代わりの方針）と理由の 3 行、ユーザーに裁定してほしいこと（T9 の案。裁定の後に tech-spec §5.5 と spec 05 §4 を改訂する。R05-3）
- 合格基準 1〜3 の結果の要約表（§4 の抜粋）と、実 GPU の fps の状況
- 報告のファイルと画像のパス、スパイクのコードの URL（H）

`/home/terapyon/dev/terapyon/raintrace/.handoff/S-3d-rendering.md` に、次の順の手順を書く:

````markdown
# Spike S（3D 描画方式の比較）の push と PR

| 順 | ブランチ | base | PR | 備考 |
|---|---|---|---|---|
| 1 | `spike/3d-rendering` | — | 作らない | 報告がコミットのハッシュ（H）で参照するので push だけする。マージしない |
| 2 | `docs/S-3d-rendering-report` | `main` | [S-3d-rendering-pr.md](S-3d-rendering-pr.md) | 報告・画像・計画だけ（コードなし） |

```sh
cd /home/terapyon/dev/terapyon/raintrace
git push -u origin spike/3d-rendering
git push -u origin docs/S-3d-rendering-report
gh pr create --base main --head docs/S-3d-rendering-report \
  --title "Spike S: 3D 描画方式の比較の報告（tech-spec §5.5 の改訂案 T9）" \
  --body-file .handoff/S-3d-rendering-pr.md
```

## マージの前に
- 報告の §1 の裁定（T9 の案、または代わりの方針）をお願いします。裁定の後、05 の改訂（R05-3）で tech-spec §5.5 と spec 05 §4 を直します
-（実 GPU の fps がまだなら）Task 8 Step 6 の手順での計測をお願いします

## 後片付け（マージの後、任意）
- `git worktree remove .claude/worktrees/S-report`
- スパイクの worktree は、05 の計画が済むまで残す（コードを参照するため）
````

（実 GPU の fps が届いていれば、「マージの前に」の 2 つ目の項目は消す）

- [ ] **Step 7: コーディネーターに知らせる**

実行役の最終報告に、推奨（または代わりの方針）と理由、合格基準 1〜3 の結果の要約、ユーザーの手動の計測の状況、報告のブランチのコミットのハッシュ、`.handoff/S-3d-rendering.md` のパスを書く。

---

## spec S との対応

| spec S | 内容 | 満たす Task |
|---|---|---|
| §1 合格基準 1 | 1x〜10x で 1cm 以上の水面が沈まず、ちらつかない | 3（A）・5（A'）・6（B）・7（B-raw）の可視率・ちらつきとコンタクトシート、5 Step 10（曲面の 1cm の膜、A と A'。M1） |
| §1 合格基準 2 | 地形と水面に同じ倍率 | 2（台地での一致）、3・5・6・7（目視と、同じ値・同じ uniform を渡す構造） |
| §1 合格基準 3 | 水深を毎フレーム更新しながら 60fps | 8（自動の参考値と、【手動・ユーザー】の実 GPU） |
| §2 候補 | A・A'・B・B-raw | 2・3（A）、5（A'）、6（B）、7（B-raw） |
| §3 方法 | 使い捨てのブランチ、実データのグリッド、合成の固定の場、毎フレーム変わる場 | 1（ブランチ・場面）、8（毎フレーム変わる場） |
| §3 観点: 沈み込みとちらつき | 1・2・5・10x × 0・45・60・85° × ズーム 15〜18 のスクリーンショット | 3・5・6・7（`matrix.spec.ts`、コンタクトシート） |
| §3 観点: 倍率の一致 | | 2・3・6 |
| §3 観点: 速度 | 開発機の fps、可能なら低性能の機器 | 8（Step 6 の 5 は任意） |
| §3 観点: バンドル | Three.js の有無の gzip の差 | 9 |
| §3 観点: 複雑さ | 行数、回避策の数 | 9（回避策は 3・5・6・7 で報告に書き溜める） |
| §3 観点: 継ぎ目 | B の範囲の境界の段差 | 6・7（`seam.spec.ts`） |
| §3 観点: z-fighting | 1cm 差の深度の精度と対策（polygonOffset、頂点の共有と描画順） | 3（A、none・offset・offset2）、6・7（B 系の同じ比較、Step 9） |
| §3 観点: Custom Layer の API | 受け取る行列と引数、`setTerrain` 併用時の地形の高さ | 2（型の記録と判定 (1)） |
| spec 05 §3.3（S での比較の依頼） | 方式 A の流れの矢印を MapLibre の symbol レイヤーで地形に載せる | 5（Step 7、D20） |
| §4 成果物 | 報告（結果の表・スクリーンショット・推奨）、tech-spec §5.5 の改訂案、コードはブランチに残す | 10 |
| §5 終了条件 | すべての候補を評価または根拠つきで除外、推奨か代わりの方針 | 「日程」の打ち切りの規則、10 の Step 3・4 |
| RS-1 | 3 日 | 「日程」 |
| RS-2 | 生の WebGL2 と比べる | 7、9 |
| レビュー役の提案（D1） | 1 日目に A で 2 つの分かれ目を確かめ、残りを絞る | 2・3・4 |

## 自己レビュー（計画の作成時）

- **spec の網羅:** 上の表のとおり、spec S の §1〜§5 と RS-1・RS-2、レビュー役の提案に対応する Task がある。spec 05 §3.3 の「方式 A の場合は MapLibre の symbol レイヤーの矢印も S で比べる」は、Task 5 Step 7 で最小の形（04 の `arrows` を使わない固定の点、ImageData の画像、グリフなし）で比べる（D20）。B・B-raw のインスタンス描画の矢印は 05 で作るので比べず、報告の §11 に書く。`ArrowPlacement`・`showArrows?`・`setArrowLayer` の名前も照合した
- **プレースホルダ:** 報告の下書きの「（… の値）」は、同じ Step の中で実測値を書き入れる指示つきの欄である。コードの Step に TBD・TODO は無い
- **型と名前の一致:** `Scene`・`ElevationSampler`・`CandidateHandle`（`setExaggeration`・`setDepth`・`setDebug`・`whenIdle`・`renderTimes`・`apiProbe?`・`lastResample?`・`freezeElevation?`）・`SpikeGlobal`（`setView`・`measure`・`boundaryStep`・`runFps`）・`WaterMeasure`・`FpsResult`・`ZFix`（`none`・`offset`・`offset2`）を、定義した Task と使う Task で照合した。`MATRIX_CANDIDATES` と `SEAM_CANDIDATES` は Task 5〜7 で候補を足す。`main.ts` の最終形は Task 8 Step 3 にまとめてある
- **未検証の前提（実行の最初に確かめる）:** three 0.185.1 の `WebGLRenderer({ canvas, context })` と `RawShaderMaterial({ glslVersion: GLSL3 })` が MapLibre 6.6.0 の WebGL2 のコンテキストを共有できること（Task 3 Step 8 で分かる。だめなら、three の水面の代わりに B-raw の水面の描画を A に使い、そのことを A の回避策として報告に書く）。`map.painter.context.gl` の型（Task 1 Step 11 に代わりの書き方）。`addProtocol` の関数が `ImageBitmap` を返せること（D6。dist のコードで確認済み）
- **時間（R1 の後）:** 数値の計測を 16 視点に絞ったので、1 候補の `matrix.spec.ts` は 約 510 回の idle（SwiftShader で 5〜17 分）。4 候補で 20〜70 分を、次の Task の作業と並行して回す。A' は計測の中で高さを取り直さない（R2）ので、A と同程度
- **中間の判定の反映（M1〜M3）の後:** Task 5 は「最小」でも Step 10（曲面の膜。2 候補 × 16 視点で idle 約 190 回、2〜6 分）と Step 11（30 分の時間箱）を足して約 4 時間 15 分。2 日目の午前に収まらなければ午後の Task 6 の matrix の実行と並行させる。名前（`bowlFilm`・`isBowlCell`・`fillInvalidNearest`・`demFill`・`support/measure.ts` の `MEASURE_VIEWS`・`MeasureRow`・`measure`・`summarize`）を、定義した Step と使う Step（`bowl.spec.ts`・`needles.spec.ts`・`matrix.spec.ts`・Task 8 の `main.ts`）で照合した
