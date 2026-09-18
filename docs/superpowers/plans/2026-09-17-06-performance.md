# Spec 06 性能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tech-spec §14 の性能目標を実際のアプリで測り、原因を切り分け、安価で局所的な項目は 06 の中で直して前後を測り、構造に関わる項目（WASM・fill-spill-merge・遠景の LOD・IndexedDB）を起こすかどうかを数字で決める。あわせて `probe=water` で境界 15・16 の可視率とちらつき率の表を作る（R06-4〜R06-7）。

**Architecture:** 05 の計測の道具（`perfParams`・`perfHook`・`fpsProbe`・`fpsStats`・`tests/perf/`・`playwright.perf.config.ts`）を広げる。計測のコードは `pnpm build:perf` のときだけ入り、通常のビルドでは `__RAINTRACE_PERF__` が false になって分岐ごと消える（R06-5）。1 step の所要時間は Worker の `PlaybackScheduler` がすでに読んでいる `now()` の差から求め、計測用のビルドの Worker だけが BroadcastChannel でメインの計測用のフックへ送る（`src/shared/protocol.ts` のメッセージの形は変えない）。CPU で決まる計測は Playwright の `context.route` で固定の DEM を返し、fps とクリックから表示までは地理院に実際に接続する。M4 の改善は M2・M3 の判定を条件に、1 項目ずつ前後を測る。

**Tech Stack:** spec 01〜05 の構成（Vite 8.2.2、React 19、MUI 9、zustand 5、MapLibre GL 6.6.0、three 0.185.1、TypeScript 6、Vitest 4、Playwright 1.62、Biome）。**依存は足さない**

**Spec:** `docs/superpowers/specs/2026-09-10-06-performance-design.md`（d812551 で改訂、88112cc で M0 のレビューを反映。M0〜M6・§5 の判定の表・§5.1 の 51 fps の切り分け・R06-4〜R06-10 を含む。これが正）。あわせて `docs/superpowers/specs/2026-09-10-00-overview.md` §6 の R06 の行、`specs/tech-spec.md` §6.3・§14。前の計画の書式と慣習は `docs/superpowers/plans/2026-09-13-05-3d-rendering.md`（以下「05 の計画」）。準備のメモ `.handoff/06-spec-revision-prep.md` は、spec と食い違うところは spec を正とする

**前提:** ブランチ `feat/06-performance`（88112cc。M0 は済み、レビュー役 raintrace-b5 の承認済み）。本計画の Task 1 はその次のコミットから。計画そのものはコーディネーターがコミットする。**ブランチは 1 本、PR は最後に 1 つ**（R06-9）。マイルストーン（M1〜M6）はブランチの中の区切りで、**各マイルストーンの最後の Task の後にレビュー役のレビューを受け、承認されてから次のマイルストーンに進む**。性能以外の項目（spec 06 §2.3）は後回しで、この計画に Task を持たない（R06-10）

**M2 の準備での改訂（2026-09-17）:** 05 の 51.0 fps は c25be04（Task 9、矢印の既定 10 m・10,000 本）の値で、05 の最終 b3a8916 と 06 の e95b9c1 では同じ条件で 60.0 だった（`.handoff/06-perf/baseline-check.md`。A/B で原因は矢印の本数）。これに合わせて Task 8・11・12・13・20・22・29 を直した。M3 の対象は「1000 m で矢印の間隔に 5 m を選んだとき（実効 10 m・10,000 本）」で、計測だけの `arrowsM`（5・10・20）と `isolate` の組の 2 変種はコミット済み

**M4 の裁定での改訂（2026-09-17）:** Task 13 の M3 の結果（矢印 5 m は 1000 m で D15 を外し、500 m は中央値では保つ）を受けてユーザーが裁定した（R06-11、`.superpowers/sdd/2026-09-17-06-performance/arrow-ruling-request.md`）: (a2) すべての範囲で矢印の 1 辺の本数の上限を 50 にする。UI の形は「5 m の選択肢を外す」（`ARROW_SPACINGS` を `[10, 20]` にし、保存済み・計測だけの URL の 5 は 10 へ移行する）。これを実装する **Task 13b** を Task 13a と Task 14 の間に足した（番号は既存を保つ）。spec 06 §5.1・§5.2、overview §6（R06-11）は裁定を反映済み

## Global Constraints

- Node 24、pnpm 12.1.0。**依存を足さない**（R06-4 の「安価」= 新しい依存・新しい Worker を足さない、`SimulationEngine` とメッセージ〈`src/shared/protocol.ts`〉の形を変えない）。`pnpm-workspace.yaml` の `minimumReleaseAge: 14400`・`minimumReleaseAgeStrict: true`（10 日のクールダウン）は変えない。`pnpm install` が lockfile を書き換えたら止めて知らせる
- **計測のコードは計測用のビルド（`pnpm build:perf`）だけに入れる**（R06-5）。通常のビルドでは `__RAINTRACE_PERF__` が false に置き換わり、計測用のフック（`src/ui/perf*.ts`）と Worker の計測（`src/workers/stepTiming.ts`・BroadcastChannel）が出力に残らない。M1 の完了時と、実行時のコードを変える各 Task の終わりに、次の 3 つで確かめる:
  - `pnpm build && (grep -c perfHook build-info/manifest.json || true)` → `0`
  - `grep -l raintrace-perf dist/assets/*.js || true` → 何も出ない
  - `pnpm size` の初期ロードが **427.5 KB** のまま（M4 の `ui` のチャンクの Task だけは減ってよい）
- 書式と lint は Biome（2 スペース、シングルクォート、セミコロンなし、行幅 100）。画面に出す文字列は `src/ui/strings.ts` にだけ置く（tech-spec §9.4）。例外は計測用のフック（`src/ui/perf*.ts`）の JSON の表示だけ（利用者の画面ではない）。コメントとテスト名は日本語
- 層の規則（tech-spec §4.2、`.dependency-cruiser.mjs`）:
  - `src/simulation/`・`src/dem/`・`src/shared/` は相対 import に `.ts` を付ける。simulation・dem は純粋（`console`・`performance` も使えない）
  - `src/renderer/`・`src/state/`・`src/shared/` は simulation・dem から型だけを import する
  - `src/map/`（テストを除く）は simulation・shared から型だけを import する
  - renderer は map・ui・state を import しない
  - Worker（`src/workers/`）は simulation・dem・shared と `src/workers/` 以外を import しない
  - 循環 import を作らない（`no-circular`）。エントリから届かないモジュールを作らない（`not-reachable-from-entry`）
- 大きな配列を React の state・props・context、zustand のストアに載せない（tech-spec §2 原則 2）。転送した ArrayBuffer には転送の後に触れない（tech-spec §5.2）
- **各 Task の終わりのゲート**: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`。実行時のコード（`src/` の本番の経路、または E2E の support）を変えた Task では E2E: `pnpm build && pnpm exec playwright test --project=chromium`（ポート 4173。M0 の時点で 41 件。ブランチ全体の最終は 43 件〈D の SPA のテストと 06 の追加を含む。`docs/perf/2026-09-17-fixes.md` Task 19 のゲートで確認〉）。バンドル: `pnpm build && pnpm size`。M0 の時点のユニットテストは 651 件（Task ごとに増える。全件成功）
- カバレッジの閾値（`vitest.config.ts`）: `src/simulation/**` 90%、`src/dem/**` 85%、`src/state/**` 80%
- **計測の実行**: `pnpm build:perf` の後に `pnpm perf:fps …`（`playwright.perf.config.ts`、ポート 4175、実 GPU の headless Chrome〈`--use-gl=angle --use-angle=gl-egl`〉、workers 1）。E2E（4173）と同時に回さない。計測どうしも同時に回さない（CPU・GPU を取り合う）。**10 分を超える計測はバックグラウンドで回して終わりを待つ**（Bash の上限は 10 分）。計測の後は `pnpm build` で `dist` を通常のビルドに戻す
- **計測の記録**: 要約（表）は `docs/perf/<実行日>*.md` にコミットする（spec 06 §4.2）。`<実行日>` は計測を回した日（`date +%F`）。生の JSON（`deltas`・時系列を含む）は gitignore の `.handoff/06-perf/` に置く。機器の仕様を必ず添える
- **基準の機械**は自動化を回す開発機（05 の headless と同じ。32 コア・GeForce GTX 1080 Ti）。ユーザーの手動の計測は参考値で、判定には使わない（spec 06 §4.2・§5）
- **視点の揃え方**（05 の計画で決めたこと 20 の慣習を保つ）: fps・視点の計測は 1 回ずつ新しい browser context（HTTP の cache が空）、条件の順をランごとに入れ替える、3D の視点は `placeViewOnLoadedTerrain`（タイルが揃ってから同じ視点をもう一度置く）、`fallback=0`、同じ条件を `RAINTRACE_FPS_REPEAT`（既定 3）回測ってセルごとの中央値で判定する、JSON に全ランを残す。実測の視点（`mapZoom`・`mapPitch`・`drawnTileZoom`）を結果に入れ、要求と照合する
- fps の判定は D15（spec 05 §4.4、R05-6）: 平均 57 fps 以上かつ長いフレーム（そのランの中央値の 2.5 倍を超えた間隔）1% 以下、先頭 1 秒を除く。**g2（2 フレーム分の間隔）の本数もあわせて報告する**（spec 06 §5）
- MapLibre 6.6.0 の内部に新しく頼るときは、ファイルと行（`node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs`）をコメントに書き、M6 の一覧（tech-spec に移す）に足す
- 1 Task 1 コミット。コミットメッセージは日本語で、末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける（下の各 Task のコミット例では省略しているが、必ず付ける）。push はしない（ユーザーがまとめて行う）
- 【手動・ユーザー】の手順は、実装役がユーザーに直接送らない。コントローラーに渡し、コントローラーがユーザーに送る。届いた結果はコントローラーが実装役に渡す

## 計画で決めたこと（spec と指示に無い細部）

レビュー役とコーディネーターが確かめられるよう、ここにまとめる。

1. **1 step の所要時間の取り方**（spec 06 §3「Worker からメインへ渡す方法は計画で決める」）:
   - `PlaybackScheduler` の `SchedulerPorts` と `SimulationRunner` の `RunnerPorts` に、**省略できる** `onStepTime?: (ms: number) => void` を足す。`tick` の中で、step の前に読む `now()`（予算の判定に今も読んでいる値）と、step の後に最初に読む `now()`（次の予算の判定、または `measure` の値）の差を 1 step の時間として渡す。**`now()` の呼び出し回数は変えない**（テストで固定する）。Step ボタンの 1 step（`stepOnce`）は数えない
   - 直近 300 step の持ち方と 1 秒ごとの要約は `src/workers/stepTiming.ts`、送り先の名前と形は `src/shared/perfProtocol.ts`。`simulation.worker.ts` は `__RAINTRACE_PERF__` が真のときだけリングを作り、`onStepTime` を渡し、`setInterval` で要約を `BroadcastChannel('raintrace-perf')` に送る。**`src/shared/protocol.ts` と SimulationClient は変えない**
   - 通常のビルドの Worker に残るのは、`onStepTime` が無いときに何もしない 2 か所の分岐だけ（計測の値を作るコードと送るコードは消える）。これを「計測のコードが入っていない」とみなす根拠は、送り先の名前 `raintrace-perf` とリングの定数が通常のビルドの出力に無いこと（Global Constraints の grep）
   - 採らなかった案: `now` と `step` のポートを Worker の側で包む案（スケジューラを変えない）は、`stepOnce` の前に `now()` を読まないため、前の `now()` からの経過（止まっていた時間）を 1 step と数えてしまう
   - `__RAINTRACE_PERF__` が Worker のビルドに届くこと: Vite 8.2.2 は Worker のビルドの設定を `{ ...workerConfig, ...resolved, isWorker: true }` で作り（`node_modules/vite/dist/node/chunks/node.js` 36733〜36752 行）、`definePlugin` は `environment.config.define` を使う（同 25287 行〜）ので、`define` は Worker にも効くはずである。**Task 2 のビルドの grep で確かめる**（通常のビルドで 0 件、計測用のビルドで 1 件以上）。効かなければ Task 2 の分岐（`import.meta.env.MODE === 'perf'`）に替える
2. **1 step の所要時間の判定の値**: Worker は 1 秒ごとに「直近 300 step」の中央値・p95・最大を送る。フックは時系列を残し、**新しい step を含む要約（`total` が増えたもの）だけ**を使って、§5 の中央値の判定には「各要約の中央値の中央値」、p95 の判定には「各要約の p95 の 95 パーセンタイル」を使う（1 秒の中の最後の 300 step の標本であることを記録に書く）。時系列は JSON に残す（spec 06 §5「平均だけでなく時系列で見る」）
3. **降雨の条件**（spec 06 §4.1「雨量は計画で決める」）: 3 つの雨はどれも **100 mm** で、半径だけを 10 m・100 m・範囲の半分（500 m の範囲で 250 m、1000 m で 500 m。R04-6 の上限）にする
4. **平衡の打ち切り**（spec 06 §4.1「打ち切りの上限を計画で決める」）: **300 秒**（5 分の目標と同じ）。3 つの雨とも同じ上限にし、届かなければ「届かず」と、その時点の step 数・時間を記録する。**平衡の計測は 2D だけで行う**（18 ラン、最悪 約 100 分）。3D ありでは平衡を待たず、**60 秒の窓**で 1 step の所要時間・長いタスクを測る（18 ラン、約 25 分）。3D の描画は平衡の step 数を変えず（エンジンは決定的）、36 ランの 300 秒は 3 時間を超えるため
5. **DEM の用意**（spec 06 §4.1「リポジトリに置くか、SHA-256 で固定した取得のスクリプトか」）: **取得して固定する方にする**。3 地点 × 1000 m の DEM1A は 1 地点 25〜36 枚（1 枚 30〜100 KB）で、全部で 3〜10 MB になり、リポジトリに置くには大きい
   - `tests/perf/demFixtures.ts` が、E2E の `routeGsi`（`tests/e2e/support/gsi.ts`）と同じく **`context.route`** で地理院の DEM の要求だけを差し替える（DEM の取得は Worker の中で行うので `page.route` では捕まらない。レビュー役 b5 の指摘）
   - `RAINTRACE_DEM=record` は地理院から取り、本体を gitignore の `.cache/perf-dem/<SHA-256>.png` に、パスごとの状態（200 と SHA-256・大きさ、または 404）を **`tests/perf/fixtures/dem-manifest.json`（コミットする）** に書く。`replay`（既定）は manifest の本体を返し、SHA-256 が合わない・本体が無いときは失敗として数える。`live` は差し替えない
   - 記録は 2D の読み込みだけで行う（3 地点 × 500 m・1000 m）。3D の範囲の外のタイルは manifest に無いので地理院にそのまま流し、その数を結果に書く（地形の描画にだけ使われ、シミュレーションの入力ではない）
   - 背景地図のタイルは差し替えない
6. **`depthEvery=N`**（spec 06 §3・§5.1）: `View3dOptions` に**省略できる** `depthUploadEvery?: number` を足し、`View3d` が水面の Custom Layer に渡す。`waterLayer.setWater` は水深の配列の参照を毎回差し替え、`needsUpdate`（`texSubImage2D`）だけを N 回に 1 回にする。null（水を消す）は必ず転送する。`DEFAULT_VIEW3D_OPTIONS` には足さない（初期ロードの `index` を変えない）
7. **止めた水面**（spec 06 §5.1「新しいパラメータ 1 つ」）は `pause=1`: 降雨を始めてタイルが揃い、落ち着かせた後、fps の窓の直前に `SimulationSession.pause()` を呼ぶ（以後 frame が来ず、転送は 0、水面の描画はそのまま）
8. **`arrows=0`** は設定のストアの `setDisplay({ showFlowVectors: false })` で行う（新しい経路を作らない。Worker は `flowVectors()` を呼ばなくなり、メインは `setData` しない）
9. **クリックから 2D の地形の表示まで**（`probe=load`）: URL に `lat`・`lon` を付けず（起動時に地点を選ばせない）、`at=緯度,経度` を付ける。フックは地図の読み込みを待ってから `TerrainSession.select(lon, lat)`（地図のクリックと同じ経路）を呼び、`data-range-shown` が立って 2 フレーム描くまでを測る（MutationObserver で待ち、polling の粒度を入れない）。`mode=3d` なら続けて 3D を押し、`view3dStatus` が `3d` になるまで（View3d のチャンク）、`data-water-builds` が 1 になるまで（three のチャンクと水面の作成）、`areTilesLoaded()` が真になって 2 フレーム描くまで（= 最初の 3D のフレーム）を分けて測る。地理院に実際に接続する（spec 06 §4.1）
10. **長いタスク**は、フックの読み込みの直後に `PerformanceObserver({ type: 'longtask', buffered: true })` を張り、probe ごとの窓で数と最大を出す。`longtask` を使えないブラウザでは `supported: false` を書く
11. **計測の実行ファイル**: `tests/perf/support.ts`（fps・steps・water で共有する道具。05 の `fps.perf.ts` から移す）、`tests/perf/steps.perf.ts`（spec 06 §4.2 の「1 つ足す」）、`tests/perf/demFixtures.ts`（DEM の記録と差し替え）、`tests/perf/water.perf.ts`（M5）。`probe=load` は地理院に接続する計測なので `fps.perf.ts` の中の `RAINTRACE_LOAD=1` のテストにする（05 の `RAINTRACE_DRAWN_ZOOM=1` と同じ形）。新しい Playwright の設定のファイルは作らない
12. **vsync を外す起動の引数**は `RAINTRACE_UNCAPPED=1` のときだけ `playwright.perf.config.ts` が足す（`--disable-gpu-vsync --disable-frame-rate-limit`）。効くか（60.0 fps を超えるか）は M3 で確かめる
13. **GPU の時間**（`EXT_disjoint_timer_query_webgl2`）は、fps の結果に「使えるか」（`gpuTimerQuery`）だけを入れる。使える場合だけ M3 で計画し直す（Task 12）。使える前提で他の Task を書かない（spec 06 §4.2）
14. **report の型**は `src/ui/perfReports.ts` に置き、`tests/perf/` からは型だけを import する。`tests/perf/` の型検査（`tsconfig.node.json`）は `vite/client` の型を持たないので、`TerrainSession`・`MapController`（css の副作用 import を持つ）に届く import を `tests/perf/` から張らないため
15. **`probe=water` の可視率**（M5、R06-7）: spec 06 §3 の「深度テストなしと ありで描いて画素を数える」をそのまま実データで使うと、地形が正当に隠す分（尾根の向こうの池）も「沈み込み」に数える（S の報告 §2「実データの `real` の行は参考値」）。そこで 3 つ目の描き方として、**深度テストありで水面を 0.10 m（垂直強調の前）持ち上げた描き方**を足し、`持ち上げ比 = 見えた画素 / 持ち上げたときに見えた画素` を判定に使う。spec の定義の `可視率 = 見えた画素 / footprint` も表に残す。判定の閾値は S と同じ（持ち上げ比の最小 0.98 以上、ちらつき率 1% 以下）。シェーダの計測用の uniform は `vec2 u_debug`（x: 0=通常・1=判定用の色、y: 持ち上げ〈m〉）の 1 つ。画素は MapLibre の `render` イベントの中で `gl.readPixels` で読む（`preserveDrawingBuffer` を変えない。既定のフレームバッファへの切り替えは `map.painter.context.bindFramebuffer.set(null)` で MapLibre の状態の cache を通す。MapLibre の内部なので M6 の一覧に足す）。footprint が 500 px 未満、またはカメラと地面の差が 1 m 未満の視点は「評価不能」にし、不合格と読まない（05 の Task 13 の落とし穴）
16. **M4 の改善の形**（spec 06 §5.2 の候補を「安価」に収める形）:
    - `elevationRgba`・`depressionRgba`: メインスレッドのまま、セルごとの配列（`[r, g, b]` の戻り値と `rgba.set([...])`）を作らない版にする。出力はビット単位で同じ（テストで旧版と突き合わせる）。Worker に移す案は地形のメッセージに RGBA を足すので安価の外（spec 06 §5.2）。軽くしても 50 ms を超えるときの分割は計画し直す（Task 17）
    - 水深の canvas ソース: `animate: false` で足し、`draw` で描いた直後に `play()`・`pause()` を続けて呼ぶ（`pause()` は `_playing` のときに `prepare()`〈`texture.update`〉を呼んでから止める。`maplibre-gl-dev.mjs` 4601〜4609・4649 行）。止まっている間は再描画を頼まない。ソースは作り直さない
    - `flowVectors()`: エンジンが 2 × N² の配列を持ち、呼ぶたびに 0 で埋めて書き直す。`SimulationEngine` の型は変えず、「戻り値は次の呼び出しで上書きされる」を型のコメントに書く。呼び出し元は Worker の `SimulationRunner.arrowsFor` の 1 か所で、すぐに `thinFlowArrows` で読み切る
    - 1 step の軽い改善（03 の軽微 8）: `FlowSolver` の近傍の判定を、上下左右の端でないセルでは添字の足し算（幅ごとに作る 8 個の差）にする。演算の順は同じなのでビット単位で同じ（テストで端の版と突き合わせる）
    - DEM1A の 404: `RangeElevation` に省略できる `level`（範囲の DEM の段）を足し、段 2 なら z17 の外のタイルで DEM1A を、段 3 なら DEM1A と DEM5 を試さない。範囲の外の遠いタイルも同じ段とみなすので、段の境目の近くでは外の地形が 1 段粗くなりうる（3D の見た目だけ。シミュレーションの入力ではない）
    - 51 fps の転送側: `depthUploadEvery` の既定を、1000 m（一辺 768 セルを超える範囲）だけ 2 にする。変わった行だけの転送・Float16 は計画し直す（Task 23）。**M2 の準備での改訂**: 既定の矢印の本数では `depthEvery=1・2・4` がどれも 59.9〜60.0 で、転送は主因でない（`.handoff/06-perf/baseline-check.md`）。Task 13 の結論が変わらなければ行わない
    - `ui` のチャンク: `RainfallControls` の `TextField` を `FormControl`・`InputLabel`・`OutlinedInput`・`FormHelperText` に置き換える（ラベルの関連づけと説明文の `aria-describedby` は `useId` で作る）
17. **M4 の各項目の前後の計測**は、同じ Task の中で「前」を測ってから直し、「後」を同じコマンドで測る。数字は `docs/perf/<実行日>-fixes.md` の項目ごとの節に足す
18. **Worker のチャンクの `maplibre-gl-shared` の複製**（spec 06 §5.2 の最後の段落）: 計画の作成時に `dist/.vite/chunk-modules.json`（spec D の後は `build-info/chunk-modules.json`）を読んだ。複製があるのは MapLibre 自身の Worker（`maplibre-gl-worker-*.js` が `maplibre-gl-shared.mjs` と `maplibre-gl-worker.mjs` を持つ）で、シミュレーションの Worker ではない。Vite の Worker のビルドはメインのチャンクを共有できないので、ビルドの設定では消せない。M2 で記録だけする（Task 9）
19. **矢印の 1 辺の本数の上限（R06-11 の裁定 (a2)。Task 13b）**: `src/state/persistedSettings.ts` の `ARROW_SPACINGS` を `[5, 10, 20]` から `[10, 20]` にする。保存値・計測だけの URL（`arrowsM`）から届く 5 は `clampArrowSpacing(value: 5 | 10 | 20): 10 | 20`（新規、同ファイル）で 10 に丸める。`parsePersistedSettings` は「5 は移行、5 でも候補でもなければ不正（既定値に戻す。他の項目と同じ扱い）」に分ける（5 だけを特別扱いし、`parsePersistedSettings` の「マイグレーションはしない」という既存の方針は他の項目では変えない）。`src/ui/perfParams.ts` の `arrowsM` は表示の設定の `ARROW_SPACINGS` とは別に、計測だけが使う `PERF_ARROW_SPACINGS = [5, ...ARROW_SPACINGS]` を持ち、5 を受け続ける（既存の `perfParams.test.ts` の 4 つの期待は変えない）。`src/ui/perfHook.ts` は `settings.getState().setDisplay({ flowVectorSpacingM: clampArrowSpacing(params.arrowsM) })` で丸めてから渡す（`arrowsM=5` の URL で「5 m を選んだときと同じ 10,000 本」を測り続けることはできなくなり、「クランプ後の 2,500 本」を測ることになる。これは裁定の効果を数字で確かめるための意図した挙動）。`src/ui/components/DisplaySettings.tsx` は `ARROW_SPACINGS` を map するだけなので変更なし（5 m のボタンは自然に消える）。`src/state/urlState.ts`（共有できる URL）は `flowVectorSpacingM` を扱っていないので変更なし（「URL」の移行は `arrowsM` の計測用 URL だけを指す）

## ファイル構成

| ファイル | 責務 | Task |
|---|---|---|
| `docs/superpowers/specs/2026-09-10-06-performance-design.md` | §4.1・§4.2 の `page.route` → `context.route`（M1）、§5.1 の結果（M3）、§5 の判定（M2・M4）、§6 の完了（M6） | 1・10・13・13b・25・29 |
| `src/shared/perfProtocol.ts` | 計測の BroadcastChannel の名前と、1 step の所要時間の要約の型 | 2 |
| `src/workers/stepTiming.ts`（+ test） | 直近 300 step のリングと要約 | 2 |
| `src/workers/playbackScheduler.ts`（+ test）、`src/workers/simulationRunner.ts`（+ test） | `onStepTime` のポート | 2 |
| `src/workers/simulation.worker.ts`、`tsconfig.worker.json` | 計測用のビルドだけのリングと送信 | 2 |
| `src/renderer/waterLayer.ts`（+ test）、`src/map/view3d/options.ts`、`src/map/view3d/View3d.ts` | `depthUploadEvery`（M1）、計測用の `setDebug`（M5）、既定の間引き（M4 条件つき） | 3・22・26 |
| `src/renderer/waterShaders.ts`（+ test） | 計測用の uniform `u_debug`（M5） | 26 |
| `src/ui/perfParams.ts`（+ test） | URL の新しい項目、`PERF_ARROW_SPACINGS`（M4） | 4・13b・27 |
| `src/ui/perfWait.ts`（+ test。`perfHook.test.ts` を改名） | 待ちと表示の道具、`placeViewOnLoadedTerrain` | 4 |
| `src/ui/perfCollectors.ts`（+ test） | 長いタスクと 1 step の所要時間の収集と要約 | 4 |
| `src/ui/perfReports.ts` | 計測の結果の型（`tests/perf/` が型だけを読む） | 5・13a・27 |
| `src/ui/perfSteps.ts`（+ test）、`src/ui/perfLoad.ts` | `probe=steps`・`probe=load` | 5・13a |
| `src/ui/perfWaterStats.ts`（+ test）、`src/ui/perfWater.ts` | `probe=water`（M5） | 27 |
| `src/ui/perfHook.ts` | probe の振り分けと fps の追加の値、`clampArrowSpacing`（M4） | 4・5・13b・27 |
| `src/map/fpsProbe.ts` | fps の結果に `gpuTimerQuery` | 5 |
| `tests/e2e/support/gsi.ts` | 差し替えの道具の export（計測と共有） | 6 |
| `tests/perf/support.ts`、`tests/perf/demFixtures.ts`、`tests/perf/steps.perf.ts`、`tests/perf/fps.perf.ts`、`tests/perf/water.perf.ts` | 計測の実行、`isolate`・`isolate-500` の「矢印 5 m」のラベル（M4） | 6・13b・27 |
| `playwright.perf.config.ts` | `RAINTRACE_UNCAPPED=1` | 6 |
| `tests/perf/fixtures/dem-manifest.json`・`README.md`、`.gitignore` | DEM の固定 | 6・7 |
| `src/simulation/FlowSolver.ts`（+ test）、`src/simulation/TsSimulationEngine.ts`（+ test）、`src/simulation/types.ts` | 近傍の添字、`flowVectors` の使い回し（M4） | 14・15 |
| `src/map/colormap.ts`（+ test）、`src/map/WaterOverlay.ts`（+ test） | 地形の RGBA、水深の canvas の転送（M4） | 16・18 |
| `src/state/persistedSettings.ts`（+ test 新規）、`src/state/settingsStore.test.ts`、`src/state/arrowSpacing.ts`、`src/ui/simulationSession.test.ts` | 矢印の間隔の選べる値を `[10, 20]` にし、5 を 10 へ移行する（`clampArrowSpacing`、R06-11、M4） | 13b |
| `tests/e2e/dem.spec.ts` | 矢印の間隔の E2E から `'5 m'` を外す（M4） | 13b |
| `src/ui/components/RainfallControls.tsx` | `ui` のチャンク（M4） | 19 |
| `src/dem/terrainTiles.ts`（+ test）、`src/map/view3d/View3d.ts` | DEM の段の手がかり（M4 条件つき） | 20 |
| `docs/perf/*.md` | 計測の要約 | 8〜11・13〜25・28 |
| `specs/tech-spec.md` | §14 の実測、MapLibre 6.6.0 の内部への依存の一覧、§14.1 の矢印の行（R06-11、M4） | 10・13b・25・29 |
| `docs/superpowers/specs/2026-09-10-00-overview.md` | R05-4 の再裁定（M5 で要れば）・§6 の R06 の結果 | 28・29 |
| `docs/superpowers/specs/2026-09-10-05-3d-rendering-design.md` | §3.3 の「選べる間隔（今は 5・10・20 m）」を 10・20 m に直す（R06-11、M4） | 13b |

## spec 06 との対応（再同期用。spec の文面が変わったら、この表の節から該当 Task を直す）

| spec 06 | Task |
|---|---|
| §1.2 M1（計測の道具） | 1〜7 |
| §1.2 M2（計測・判定、平衡は暫定） | 8〜10 |
| §1.2 M3（51 fps の切り分け。M2 の準備で、矢印の本数と fps の関係の確かめに改めた） | 11〜13 |
| §1.2 M4（安価な改善、平衡の確定） | 13a・13b・14〜25（17a を含む） |
| §1.2 M5（`probe=water`） | 26〜28 |
| §1.2 M6（締め） | 29・30 |
| §3 計測の道具の表 | 2（step の所要時間）、3（`depthEvery`）、4（長いタスク・`arrows=0`・`pause=1`）、5（平衡・クリックから表示・3D の最初のフレーム・質量誤差の表示）、26・27（`probe=water`） |
| §4.1 シナリオ・DEM の用意 | 5・6・7（道具）、8（実行） |
| §4.2 自動・手動・基準の機械・記録 | 6（道具）、8・9（実行） |
| §5 判定の表 | 10（M2 の判定）、25（平衡の確定と M4 の後の表） |
| §5.1 51 fps の切り分け | 6（組）、11〜13・13b |
| §5.2 安価な改善の候補 | 13b・14〜24（17a を含む） |
| §6 完了条件 | 29（照合）・30（最終の確認） |

## マイルストーンの区切り（各マイルストーンの最後に行う）

1. その Task までのゲートがすべて通り、`git status --short` が空
2. 実装役はマイルストーンの報告（コミット、数字、spec と違えたこと、未解決）を `.superpowers/sdd/2026-09-17-06-performance/` に書き、コントローラーがレビュー役に送る
3. レビュー役の承認（要修正は同じマイルストーンの中の追加のコミットで直す）を待ってから、次のマイルストーンの最初の Task に進む
4. M3 は M1 だけに依存するので M2 と並べて進めてよいが、**計測の実行は時間を分ける**（同時に回さない）

---

# M1: 計測の道具

M1 の完了条件（spec 06 §1.2）: ゲートが通り、`pnpm size` の初期ロードが変わらず、1 シナリオを試しに回せる。通常のビルドの挙動を変えない。

### Task 1: spec 06 §4.1・§4.2 の `page.route` を `context.route` に直す（レビュー役 b5 の指摘）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-06-performance-design.md:119`・`:126`

**Interfaces:**
- Consumes: なし
- Produces: Task 6 の `tests/perf/demFixtures.ts` が従う文面（`context.route`）

- [ ] **Step 1: 119 行を直す**

`Playwright の \`page.route\` で固定のタイル（フィクスチャ）を返し、アプリの取得の経路は変えない（§4.2）。` を次に置き換える:

```markdown
Playwright の `context.route` で固定のタイル（フィクスチャ）を返し、アプリの取得の経路は変えない（§4.2）。DEM の取得は Worker の中で行うので、`page.route` では捕まらない。E2E の `routeGsi`（`tests/e2e/support/gsi.ts`）と同じく browser context で差し替える。
```

同じ行の `（\`page.route\` が返すフィクスチャの保存方法だけの問題になる）` を `（\`context.route\` が返すフィクスチャの保存方法だけの問題になる）` に置き換える。

- [ ] **Step 2: 126 行を直す**

`DEM は §4.1 のとおり \`page.route\` で固定のタイルを返し、アプリは変えない` を `DEM は §4.1 のとおり \`context.route\` で固定のタイルを返し、アプリは変えない` に置き換える。

- [ ] **Step 3: 残りが無いことを確かめる**

Run: `grep -n "page\.route" docs/superpowers/specs/2026-09-10-06-performance-design.md || echo none`
Expected: `none`

- [ ] **Step 4: コミットする**

文書だけなのでゲートは `pnpm format && pnpm lint` だけでよい（Biome は `docs` を見ない。何も変わらないことを確かめる）。

```bash
git add docs/superpowers/specs/2026-09-10-06-performance-design.md
git commit -m "spec 06 §4.1・§4.2: 固定の DEM は context.route で返す（DEM の取得は Worker の中。E2E の routeGsi と同じ。M0 のレビューの軽微）"
```

---

### Task 2: 1 step の所要時間を Worker で測り、計測用のビルドだけが送る（spec 06 §3、計画で決めたこと 1・2）

**Files:**
- Create: `src/shared/perfProtocol.ts`
- Create: `src/workers/stepTiming.ts`、`src/workers/stepTiming.test.ts`
- Modify: `src/workers/playbackScheduler.ts`（`SchedulerPorts`、`tick`、`measure`）
- Modify: `src/workers/playbackScheduler.test.ts`（末尾に describe を足す）
- Modify: `src/workers/simulationRunner.ts`（`RunnerPorts`、コンストラクタ）
- Modify: `src/workers/simulationRunner.test.ts`（末尾に describe を足す）
- Modify: `src/workers/simulation.worker.ts`（`runner` の生成）
- Modify: `tsconfig.worker.json`（`include`）

**Interfaces:**
- Consumes: なし
- Produces:
  - `src/shared/perfProtocol.ts`: `export const PERF_CHANNEL = 'raintrace-perf'`、`export interface StepTimeSnapshot { type: 'stepTimes'; total: number; samples: number; medianMs: number; p95Ms: number; maxMs: number }`
  - `src/workers/stepTiming.ts`: `STEP_TIME_CAPACITY = 300`、`STEP_TIME_PUBLISH_MS = 1000`、`percentileSorted(sorted: ArrayLike<number>, p: number): number`、`interface StepTimeRing { record(ms: number): void; snapshot(): StepTimeSnapshot | null }`、`createStepTimeRing(capacity?: number): StepTimeRing`
  - `SchedulerPorts.onStepTime?: (ms: number) => void`、`RunnerPorts.onStepTime?: (ms: number) => void`
  - Task 4 の `listenStepTimes` が `PERF_CHANNEL` で `StepTimeSnapshot` を受ける

- [ ] **Step 1: リングの失敗するテストを書く**

`src/workers/stepTiming.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createStepTimeRing, percentileSorted, STEP_TIME_CAPACITY } from './stepTiming'

describe('percentileSorted（fpsStats.percentile と同じ定義）', () => {
  it('空なら 0、それ以外は ceil(p × 個数) 番目', () => {
    expect(percentileSorted([], 0.5)).toBe(0)
    expect(percentileSorted([1, 2, 3, 4], 0.5)).toBe(2)
    expect(percentileSorted([1, 2, 3, 4], 0.95)).toBe(4)
    expect(percentileSorted(Float64Array.of(5), 0.95)).toBe(5)
  })
})

describe('createStepTimeRing（直近 300 step の所要時間。spec 06 §3）', () => {
  it('何も記録していなければ null', () => {
    expect(createStepTimeRing().snapshot()).toBeNull()
  })

  it('記録した値の中央値・p95・最大と、通算の数を返す', () => {
    const ring = createStepTimeRing()
    for (const ms of [4, 1, 3, 2]) ring.record(ms)
    expect(ring.snapshot()).toEqual({
      type: 'stepTimes',
      total: 4,
      samples: 4,
      medianMs: 2,
      p95Ms: 4,
      maxMs: 4,
    })
  })

  it('容量を超えたら古い値から上書きし、要約は直近の容量ぶんだけで作る', () => {
    const ring = createStepTimeRing(3)
    for (const ms of [100, 1, 2, 3]) ring.record(ms)
    expect(ring.snapshot()).toMatchObject({ total: 4, samples: 3, medianMs: 2, maxMs: 3 })
  })

  it('record は切り離して渡しても動く（Worker は onStepTime: ring.record で渡す）', () => {
    const ring = createStepTimeRing()
    const { record } = ring
    record(7)
    expect(ring.snapshot()?.maxMs).toBe(7)
  })

  it('既定の容量は 300', () => {
    expect(STEP_TIME_CAPACITY).toBe(300)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm vitest run src/workers/stepTiming.test.ts`
Expected: FAIL（`Cannot find module './stepTiming'` などの解決の失敗）

- [ ] **Step 3: 送り先の型とリングを書く**

`src/shared/perfProtocol.ts`:

```ts
/**
 * 計測用のビルド（pnpm build:perf）だけで使う、Worker から計測用のフックへの知らせ（spec 06 §3、R06-5）。
 * SimulationClient のメッセージ（protocol.ts）とは別の BroadcastChannel で送り、通常のメッセージの形を変えない。
 * 通常のビルドでは、送る側（simulation.worker.ts）も受ける側（ui/perfCollectors.ts）も __RAINTRACE_PERF__ の
 * 分岐ごと消える（この名前が通常のビルドの出力に無いことを grep で確かめる。計画で決めたこと 1）
 */
export const PERF_CHANNEL = 'raintrace-perf'

/** 直近の step の所要時間の要約（Worker が 1 秒ごとに送る） */
export interface StepTimeSnapshot {
  type: 'stepTimes'
  /** これまでに記録した step の数（再生をまたいで数える。Worker を作り直すと 0 から） */
  total: number
  /** 要約に使った step の数（直近の容量ぶんまで） */
  samples: number
  medianMs: number
  p95Ms: number
  maxMs: number
}
```

`src/workers/stepTiming.ts`:

```ts
import type { StepTimeSnapshot } from '../shared/perfProtocol'

/** 所要時間を持つ step の数（spec 06 §3 の「直近 300 step」） */
export const STEP_TIME_CAPACITY = 300
/** Worker が要約を送る間隔（ms） */
export const STEP_TIME_PUBLISH_MS = 1000

/** 並べ替え済みの値の p 分位（map/fpsStats.ts の percentile と同じ定義。Worker は map を import できないので写す） */
export function percentileSorted(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? 0
}

export interface StepTimeRing {
  record(ms: number): void
  /** 1 つも記録していなければ null */
  snapshot(): StepTimeSnapshot | null
}

/**
 * 1 step の所要時間の輪（計測用のビルドの Worker だけが作る。計画で決めたこと 1）。
 * record は PlaybackScheduler の onStepTime に切り離して渡すので、this を使わない
 */
export function createStepTimeRing(capacity = STEP_TIME_CAPACITY): StepTimeRing {
  const values = new Float64Array(capacity)
  let total = 0
  return {
    record(ms) {
      values[total % capacity] = ms
      total++
    },
    snapshot() {
      if (total === 0) return null
      const samples = Math.min(total, capacity)
      // Float64Array の sort は数値の順に並べる
      const sorted = values.slice(0, samples).sort()
      return {
        type: 'stepTimes',
        total,
        samples,
        medianMs: percentileSorted(sorted, 0.5),
        p95Ms: percentileSorted(sorted, 0.95),
        maxMs: sorted[samples - 1] ?? 0,
      }
    },
  }
}
```

- [ ] **Step 4: リングのテストが通ることを確かめる**

Run: `pnpm vitest run src/workers/stepTiming.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: スケジューラの失敗するテストを書く**

`src/workers/playbackScheduler.test.ts` の末尾に足す（上の `stats` を使う。`harness` は使わず、`now()` の呼び出しを数える偽物をここで作る）:

```ts
describe('PlaybackScheduler: 1 step の所要時間（計測用の onStepTime。spec 06 §3、計画で決めたこと 1）', () => {
  /**
   * step ごとに時計を stepMs[k] 進める。onStepTime を渡すかを選べる。play の直後の tick を 1 回だけ回す。
   * settleAt 回目の step で settled を返す
   */
  function timed(
    stepMs: readonly number[],
    speed: PlaybackSpeed,
    withTiming: boolean,
    settleAt = Number.POSITIVE_INFINITY,
  ) {
    const clock = { now: 0 }
    let nowCalls = 0
    let k = 0
    const times: number[] = []
    const timers: (() => void)[] = []
    const scheduler = new PlaybackScheduler({
      now: () => {
        nowCalls++
        return clock.now
      },
      setTimer: (run) => {
        timers.push(run)
        return timers.length
      },
      clearTimer: () => {},
      step: () => {
        clock.now += stepMs[k % stepMs.length] ?? 1
        k++
        return stats(k, k >= settleAt)
      },
      sendFrame: () => true,
      ...(withTiming ? { onStepTime: (ms: number) => times.push(ms) } : {}),
    })
    scheduler.setSpeed(speed)
    scheduler.play()
    timers.shift()?.()
    return { scheduler, times, nowCalls: () => nowCalls, steps: () => k }
  }

  it('「最速」: 予算の判定で読む now() の差を 1 step の時間として渡す（最後の step は予算の判定の値で閉じる）', () => {
    const t = timed([5, 3, 4], 'max', true)
    expect(t.steps()).toBe(3)
    expect(t.times).toEqual([5, 3, 4])
  })

  it('速度 1: ループを上限で抜けた最後の step は、実行速度の窓の now() で閉じる', () => {
    const t = timed([7], 1, true)
    expect(t.steps()).toBe(1)
    expect(t.times).toEqual([7])
  })

  it('平衡で止まった tick の最後の step も数える', () => {
    const t = timed([2, 6], 'max', true, 2)
    expect(t.steps()).toBe(2)
    expect(t.times).toEqual([2, 6])
  })

  it('now() の呼び出し回数は onStepTime の有無で変わらない（タイマーの呼び出しを増やさない）', () => {
    // play 1 + tick の開始 1 + 予算の判定 4 + 実行速度の窓 1 + 次の tick の予約 1 = 8（「最速」・5・3・4 ms）
    expect(timed([5, 3, 4], 'max', true).nowCalls()).toBe(8)
    expect(timed([5, 3, 4], 'max', false).nowCalls()).toBe(8)
    // play 1 + tick の開始 1 + 予算の判定 1 + 実行速度の窓 1 + 次の tick の予約 1 = 5（速度 1）
    expect(timed([7], 1, true).nowCalls()).toBe(5)
    expect(timed([7], 1, false).nowCalls()).toBe(5)
  })

  it('Step ボタンの 1 step（stepOnce）は数えない', () => {
    const t = timed([5, 3, 4], 'max', true)
    t.scheduler.pause()
    t.scheduler.stepOnce()
    expect(t.times).toEqual([5, 3, 4])
  })
})
```

- [ ] **Step 6: 失敗を確かめる**

Run: `pnpm vitest run src/workers/playbackScheduler.test.ts`
Expected: FAIL（`onStepTime` が型に無い〈Vitest は型を見ないので実行時の失敗〉: 「最速」のテストで `times` が `[]`）。`now() の呼び出し回数` のテストは今の実装でも通る（これが変えないことの基準）

- [ ] **Step 7: スケジューラを直す**

`src/workers/playbackScheduler.ts` の `SchedulerPorts` の `sendFrame` の後に足す:

```ts
  /**
   * 計測用（spec 06 §3。計測用のビルドの Worker だけが渡す。計画で決めたこと 1）。tick の中の 1 step の所要時間（ms）。
   * 時間は tick がすでに読んでいる now() の差で求め、now() の呼び出し回数を増やさない。stepOnce の 1 step は数えない
   */
  onStepTime?: (ms: number) => void
```

`tick` を次に置き換える:

```ts
  private tick(): void {
    this.timer = null
    if (!this.running) return
    const start = this.ports.now()
    const cap = this.cap()
    const onStepTime = this.ports.onStepTime
    let steps = 0
    let last: StepStats | null = null
    // 計測中の step の始まり（その直前に読んだ now()）。step の後に最初に読む now() で閉じる。NaN は計測中でない
    let stepStart = Number.NaN
    // 先に予算を調べるので、1 step が予算を超えても 1 tick に 1 step は回る。
    // now() を読むのは steps < cap のときだけ（書き換える前の `steps < cap && now() - start < 予算` と同じ回数）
    while (steps < cap) {
      const now = this.ports.now()
      if (onStepTime !== undefined && !Number.isNaN(stepStart)) onStepTime(now - stepStart)
      stepStart = Number.NaN
      if (now - start >= TICK_BUDGET_MS) break
      stepStart = now
      last = this.ports.step()
      steps++
      if (last.settled) {
        // 平衡の後に回しても何も変わらないので、自動で止める（R04-5）
        this.running = false
        break
      }
    }
    const measuredAt = this.measure(steps)
    // 上限か平衡でループを抜けた最後の step は、実行速度の窓で読んだ now() で閉じる
    if (onStepTime !== undefined && !Number.isNaN(stepStart)) onStepTime(measuredAt - stepStart)
    // 平衡で止まったら実行速度は 0（平衡の frame と、その後の表示に再生中の値を載せない）
    if (!this.running) this.rate = 0
    if (last !== null) this.offer(last)
    if (this.running) {
      this.schedule(Math.max(0, TICK_INTERVAL_MS - (this.ports.now() - start)))
    }
  }
```

`measure` を、読んだ時刻を返すように置き換える:

```ts
  /** 実行速度の窓を進める。読んだ now() を返す（tick が最後の step の時間を閉じるのに使う） */
  private measure(steps: number): number {
    this.windowSteps += steps
    const now = this.ports.now()
    const elapsed = now - this.windowStart
    if (elapsed >= RATE_WINDOW_MS) {
      this.rate = (this.windowSteps * 1000) / elapsed
      this.windowStart = now
      this.windowSteps = 0
    }
    return now
  }
```

- [ ] **Step 8: スケジューラのテストが通ることを確かめる**

Run: `pnpm vitest run src/workers/playbackScheduler.test.ts`
Expected: PASS（既存のテストもすべて通る。step 数・予算・実行速度は変わらない）

- [ ] **Step 9: Runner の失敗するテストを書く**

`src/workers/simulationRunner.test.ts` の末尾に足す（上の `basin`・`RAIN` を使う）:

```ts
describe('SimulationRunner: onStepTime（計測用。spec 06 §3）', () => {
  it('ポートの onStepTime をスケジューラに渡し、再生中の step ごとに呼ぶ', () => {
    const clock = { now: 0 }
    const timers: (() => void)[] = []
    const times: number[] = []
    const runner = new SimulationRunner({
      post: () => {},
      now: () => clock.now,
      setTimer: (run) => {
        timers.push(run)
        return timers.length
      },
      clearTimer: () => {},
      onStepTime: (ms) => times.push(ms),
    })
    const grid = basin()
    runner.loadTerrain(1, grid, [makeDepression({ id: 1, significant: true })])
    runner.handle({ type: 'setSpeed', speed: 1 })
    runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    timers.shift()?.()
    expect(times.length).toBe(1)
  })

  it('onStepTime を渡さなければ、今までどおり動く（呼ぶ先が無い）', () => {
    const { runner, run, frames } = setup()
    runner.loadTerrain(1, basin(), [])
    runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    run(3)
    expect(frames().length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 10: 失敗を確かめる**

Run: `pnpm vitest run src/workers/simulationRunner.test.ts`
Expected: FAIL（1 件目: `times.length` が 0）

- [ ] **Step 11: Runner を直す**

`src/workers/simulationRunner.ts` の `RunnerPorts` の `clearTimer` の後に足す:

```ts
  /** 計測用（spec 06 §3）。PlaybackScheduler にそのまま渡す。計測用のビルドの Worker だけが渡す */
  onStepTime?: (ms: number) => void
```

コンストラクタの `new PlaybackScheduler({ … })` の最後の要素（`sendFrame`）の後に足す:

```ts
      // exactOptionalPropertyTypes のため、無いときは項目ごと渡さない
      ...(ports.onStepTime === undefined ? {} : { onStepTime: ports.onStepTime }),
```

- [ ] **Step 12: Runner のテストが通ることを確かめる**

Run: `pnpm vitest run src/workers/`
Expected: PASS

- [ ] **Step 13: Worker に計測用のビルドだけの送信を足す**

`tsconfig.worker.json` の `include` を `["src/workers", "src/perf-env.d.ts"]` にする（Worker の型検査に `__RAINTRACE_PERF__` の宣言を入れる）。

`src/workers/simulation.worker.ts` の import に足す:

```ts
import { PERF_CHANNEL } from '../shared/perfProtocol'
import { createStepTimeRing, STEP_TIME_PUBLISH_MS } from './stepTiming'
```

`const runner = new SimulationRunner({ … })` を次に置き換える:

```ts
// 計測用のビルドだけ、1 step の所要時間を直近 300 step 持ち、1 秒ごとに BroadcastChannel で計測用のフックへ送る
// （spec 06 §3、計画で決めたこと 1）。通常のビルドでは __RAINTRACE_PERF__ が false に置き換わり、リング・送信・
// 上の 2 つの import が出力から消える（Task 2 の grep で確かめる）
const stepTimes = __RAINTRACE_PERF__ ? createStepTimeRing() : null

// 再生（spec 04 §5）。地形の真の状態はエンジンだけが持つ（Worker は grid を保持しない）
const runner = new SimulationRunner({
  post,
  now: () => performance.now(),
  setTimer: (run, delayMs) => setTimeout(run, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  ...(stepTimes === null ? {} : { onStepTime: stepTimes.record }),
})

if (stepTimes !== null) {
  // 送るのは tick の外（タイマーの間）。step の計測の途中に postMessage を挟まない
  const channel = new BroadcastChannel(PERF_CHANNEL)
  setInterval(() => {
    const snapshot = stepTimes.snapshot()
    if (snapshot !== null) channel.postMessage(snapshot)
  }, STEP_TIME_PUBLISH_MS)
}
```

- [ ] **Step 14: `__RAINTRACE_PERF__` が Worker に届き、通常のビルドから消えることを確かめる（計画で決めたこと 1）**

Run: `pnpm build && (grep -c raintrace-perf dist/assets/simulation.worker-*.js || true) && (grep -l raintrace-perf dist/assets/*.js || true)`
Expected: 1 つ目の数が `0`、2 つ目は何も出ない

Run: `pnpm build:perf && (grep -c raintrace-perf dist/assets/simulation.worker-*.js || true)`
Expected: `1` 以上

分岐:
- 計測用のビルドで `0`（`define` が Worker に届いていない）: `simulation.worker.ts` の `__RAINTRACE_PERF__` を `import.meta.env.MODE === 'perf'` に替え、`src/workers/vite-env.d.ts` に `interface ImportMetaEnv { readonly MODE: string }` と `interface ImportMeta { readonly env: ImportMetaEnv }` を置いて、同じ 2 つを確かめ直す。`tsconfig.worker.json` の `src/perf-env.d.ts` は外す。どちらにしたかを報告に書く
- 通常のビルドで `1` 以上: import が消えていない。`stepTimes` の条件を `if (__RAINTRACE_PERF__)` のブロックに入れた形に直して確かめ直す。それでも残るなら止めてコントローラーに知らせる

終わったら `pnpm build` で通常のビルドに戻す。

- [ ] **Step 15: ゲートとバンドルを通す**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（`src/shared/perfProtocol.ts` は Worker（計測用の分岐）から届くので `not-reachable-from-entry` に掛からない。掛かったら、depcheck が型だけの import を辿るかを確かめ、Task 4 の `perfCollectors.ts` が値を import するまで待つのではなく、`simulation.worker.ts` の値の import（`PERF_CHANNEL`）があることを確かめる）

Run: `pnpm build && pnpm size`
Expected: 初期ロード **427.5 KB**（変わらない）。総量は 702.2 KB から ±0.2 KB 以内（Worker の分岐の分）

Run: `pnpm exec playwright test --project=chromium`
Expected: 41 件すべて成功（再生の挙動は変わらない）

- [ ] **Step 16: コミットする**

```bash
git add src/shared/perfProtocol.ts src/workers/stepTiming.ts src/workers/stepTiming.test.ts src/workers/playbackScheduler.ts src/workers/playbackScheduler.test.ts src/workers/simulationRunner.ts src/workers/simulationRunner.test.ts src/workers/simulation.worker.ts tsconfig.worker.json
git commit -m "1 step の所要時間を Worker の既存の now() の差で測り、計測用のビルドだけが直近 300 step の要約を BroadcastChannel で送る（spec 06 §3。protocol の形と now() の回数は変えない）"
```

---

### Task 3: 水深のテクスチャの転送を N 回に 1 回にできるようにする（`depthUploadEvery`。spec 06 §3・§5.1、計画で決めたこと 6）

**Files:**
- Modify: `src/renderer/waterLayer.ts`（`WaterLayerOptions`、`setWater`、純粋な関数 `shouldUploadDepth`）
- Modify: `src/renderer/waterLayer.test.ts`（describe を足す）
- Modify: `src/map/view3d/options.ts`（`View3dOptions` に省略できる項目）
- Modify: `src/map/view3d/View3d.ts`（`addWater`）

**Interfaces:**
- Consumes: なし
- Produces:
  - `export function shouldUploadDepth(updates: number, every: number): boolean`（`src/renderer/waterLayer.ts`）
  - `WaterLayerOptions.depthUploadEvery: number`（必須。1 は毎回）
  - `View3dOptions.depthUploadEvery?: number`（省略は 1。Task 4 の `perfHook` が `params.depthEvery` を渡す。Task 22 が既定を変えうる）

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/waterLayer.test.ts` の import に `shouldUploadDepth` を足し、末尾に足す:

```ts
describe('shouldUploadDepth（depthEvery=N。spec 06 §5.1）', () => {
  it('N が 1 以下なら毎回転送する', () => {
    expect([1, 2, 3].map((k) => shouldUploadDepth(k, 1))).toEqual([true, true, true])
    expect(shouldUploadDepth(5, 0)).toBe(true)
  })

  it('N = 2 なら 2 回目・4 回目、N = 4 なら 4 回目だけ転送する', () => {
    expect([1, 2, 3, 4].map((k) => shouldUploadDepth(k, 2))).toEqual([false, true, false, true])
    expect([1, 2, 3, 4, 8].map((k) => shouldUploadDepth(k, 4))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ])
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm vitest run src/renderer/waterLayer.test.ts`
Expected: FAIL（`shouldUploadDepth is not a function`）

- [ ] **Step 3: waterLayer を直す**

`src/renderer/waterLayer.ts` の `WaterLayerOptions` の `onRenderTime` の前に足す:

```ts
  /**
   * 水深のテクスチャを setWater の何回に 1 回転送するか（1 は毎回）。計測の depthEvery=N（spec 06 §5.1）で、
   * 転送（texSubImage2D。1000 m で 4.25 MB）が fps を落としているかを切り分ける
   */
  depthUploadEvery: number
```

`resolveDepthData` の後に足す:

```ts
/** setWater の updates 回目（1 から）で水深を転送するか（depthEvery=N。1 以下は毎回） */
export function shouldUploadDepth(updates: number, every: number): boolean {
  return every <= 1 || updates % every === 0
}
```

`createWaterLayer` の `let disposed = false` の後に `let depthUpdates = 0` を足し、`setWater` を次に置き換える:

```ts
    setWater(water) {
      // 破棄の後は終端（Task 8 の申し送りの反映）: ベースマップの切り替えの間の窓で呼ばれても、
      // 新しい DataTexture を確保して捨てられないまま残すことがない
      if (disposed) return
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
```

- [ ] **Step 4: 3D の選択肢と View3d を直す**

`src/map/view3d/options.ts` の `View3dOptions` の `boundaryFallback` の後に足す（`DEFAULT_VIEW3D_OPTIONS` には足さない。計画で決めたこと 6）:

```ts
  /**
   * 水深のテクスチャを何回の更新に 1 回転送するか。省略は 1（毎回）。計測の depthEvery=N（spec 06 §5.1）。
   * 既定の値に入れないのは、初期ロードのチャンク（index）を変えないため
   */
  depthUploadEvery?: number
```

`src/map/view3d/View3d.ts` の `addWater` の `create(map, { … })` の `onRenderTime` の前に足す:

```ts
      depthUploadEvery: this.options.depthUploadEvery ?? 1,
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `pnpm vitest run src/renderer/ src/map/view3d/`
Expected: PASS（`options.test.ts` の既定の値の期待は変わらない）

- [ ] **Step 6: ゲート・E2E・バンドルを通す**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

Run: `pnpm build && pnpm exec playwright test --project=chromium && pnpm size && (grep -c perfHook build-info/manifest.json || true)`
Expected: E2E 41 件成功（3D の水面の画素のテストを含む。既定は毎回転送）、初期ロード **427.5 KB**、grep は `0`

- [ ] **Step 7: コミットする**

```bash
git add src/renderer/waterLayer.ts src/renderer/waterLayer.test.ts src/map/view3d/options.ts src/map/view3d/View3d.ts
git commit -m "水深のテクスチャの転送を N 回に 1 回にできる選択肢（depthUploadEvery。既定は毎回）を足す（spec 06 §5.1 の depthEvery=N の切り分け用）"
```

---

### Task 4: URL の新しい項目、待ちの道具の切り出し、長いタスクと 1 step の所要時間の収集（spec 06 §3・§5.1、計画で決めたこと 2・7・8・10）

**Files:**
- Modify: `src/ui/perfParams.ts`、`src/ui/perfParams.test.ts`
- Create: `src/ui/perfWait.ts`
- Rename: `src/ui/perfHook.test.ts` → `src/ui/perfWait.test.ts`（`git mv`。import を直す）
- Create: `src/ui/perfCollectors.ts`、`src/ui/perfCollectors.test.ts`
- Modify: `src/ui/perfHook.ts`（道具を `perfWait` から読む、`arrows`・`depthEvery`・`pause`、fps の結果に長いタスクと step の所要時間）

**Interfaces:**
- Consumes: Task 2 の `PERF_CHANNEL`・`StepTimeSnapshot`（`src/shared/perfProtocol.ts`）、Task 3 の `View3dOptions.depthUploadEvery`
- Produces:
  - `PerfProbe = 'fps' | 'view' | 'steps' | 'load'`、`PerfParams` に `arrows: boolean`・`depthEvery: 1 | 2 | 4 | 8 | null`・`pauseBeforeRun: boolean`・`until: 'settle' | 'window'`・`capMs: number`・`at: { lat: number; lon: number } | null`、`parseAt(raw: string | null)`
  - `src/ui/perfWait.ts`: `WAIT_MS`・`TILE_WAIT_MS`、`waitFor(check, subscribe, timeoutMs?)`、`nextFrame()`、`sleep(ms)`、`pollUntil(check, timeoutMs, intervalMs?)`、`waitForDataset(element, check, timeoutMs?)`、`waitTilesLoaded(map)`、`show(value)`、`ProbeView`・`ProbeMap`・`placeViewOnLoadedTerrain`
  - `src/ui/perfCollectors.ts`: `LongTaskSample`・`LongTaskSummary`・`LongTaskCollector`・`summarizeLongTasks(entries, supported, fromMs?, toMs?)`・`observeLongTasks()`、`TimedStepSnapshot`・`StepTimeSummary`・`StepTimeListener`・`summarizeStepSeries(series, fromMs?, toMs?)`・`listenStepTimes()`

- [ ] **Step 1: URL の項目の失敗するテストを書く**

`src/ui/perfParams.test.ts` を次に置き換える（期待は 05 の慣習どおり「すべての項目」と「既定値」の 2 つ。F19）:

```ts
import { describe, expect, it } from 'vitest'
import { parseAt, parsePerfParams } from './perfParams'

describe('parsePerfParams（計測用のフックの URL。05 の計画で決めたこと 20、spec 06 §3）', () => {
  it('probe が無ければ null（通常の URL では何もしない）', () => {
    expect(parsePerfParams('?lat=35.658&lon=139.7016')).toBeNull()
    expect(parsePerfParams('?probe=other')).toBeNull()
  })

  it('すべての項目を読む', () => {
    expect(
      parsePerfParams(
        '?probe=steps&mode=3d&z=16&pitch=85&bearing=10&ex=10&water=0&hillshade=off&ms=5000&fallback=0&settle=20000' +
          '&arrows=0&depthEvery=4&pause=1&until=window&cap=120000&at=35.7623,139.8246',
      ),
    ).toEqual({
      probe: 'steps',
      mode: '3d',
      zoom: 16,
      pitch: 85,
      bearing: 10,
      exaggeration: 10,
      water: false,
      hillshade: 'off',
      durationMs: 5000,
      fallback: false,
      settleMs: 20_000,
      arrows: false,
      depthEvery: 4,
      pauseBeforeRun: true,
      until: 'window',
      capMs: 120_000,
      at: { lat: 35.7623, lon: 139.8246 },
    })
  })

  it('無い・不正な項目は既定値（3D・z16・pitch 60・倍率 1・水面あり・矢印あり・転送の間引きの指定なし・止めない・平衡まで 300 秒・地点なし）', () => {
    expect(parsePerfParams('?probe=load&z=99&pitch=-5&ex=3&hillshade=x&ms=1&cap=5&at=x')).toEqual({
      probe: 'load',
      mode: '3d',
      zoom: 16,
      pitch: 60,
      bearing: 0,
      exaggeration: 1,
      water: true,
      hillshade: 'auto',
      durationMs: 10_000,
      fallback: true,
      settleMs: 3000,
      arrows: true,
      depthEvery: null,
      pauseBeforeRun: false,
      until: 'settle',
      capMs: 300_000,
      at: null,
    })
  })
})

describe('depthEvery（spec 06 §5.1）', () => {
  it('1・2・4・8 以外の値は 1、省けば null（View3d の既定に任せる）', () => {
    expect(parsePerfParams('?probe=fps&depthEvery=3')?.depthEvery).toBe(1)
    expect(parsePerfParams('?probe=fps&depthEvery=2')?.depthEvery).toBe(2)
    expect(parsePerfParams('?probe=fps')?.depthEvery).toBeNull()
  })
})

describe('parseAt（probe=load の地点。at=緯度,経度）', () => {
  it('緯度・経度の組を読む', () => {
    expect(parseAt('35.4575,139.632')).toEqual({ lat: 35.4575, lon: 139.632 })
  })

  it('無い・数でない・範囲の外・数が違えば null', () => {
    expect(parseAt(null)).toBeNull()
    expect(parseAt('35.4575')).toBeNull()
    expect(parseAt('35.4575,')).toBeNull()
    expect(parseAt('a,b')).toBeNull()
    expect(parseAt('95,139')).toBeNull()
    expect(parseAt('35,181')).toBeNull()
    expect(parseAt('1,2,3')).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm vitest run src/ui/perfParams.test.ts`
Expected: FAIL（`parseAt` が無い、`probe=steps` で null）

- [ ] **Step 3: URL の項目を書く**

`src/ui/perfParams.ts` を次に置き換える:

```ts
import { PITCH_3D_DEG } from '../map/view3d/drawnZoom'
import { DEFAULT_VIEW3D_OPTIONS, type HillshadeOption } from '../map/view3d/options'
import { VERTICAL_EXAGGERATIONS } from '../state/persistedSettings'

/** fps・view（spec 05 §4.4）、steps・load（spec 06 §3・§4.2） */
export type PerfProbe = 'fps' | 'view' | 'steps' | 'load'

const PROBES: readonly PerfProbe[] = ['fps', 'view', 'steps', 'load']
const DEPTH_EVERY = [1, 2, 4, 8] as const
/** Web Mercator（MapLibre）が扱える緯度の範囲（urlState.ts と同じ） */
const MERCATOR_LAT_LIMIT = 85.051129

/** 計測用のフックの URL の項目（05 の計画で決めたこと 20、spec 06 §3）。地点と範囲・雨は 04 の lat・lon・size・mm・r を使う */
export interface PerfParams {
  probe: PerfProbe
  /** 3d: 3D に切り替えて置く。2d: 2D のまま同じ視点に置く（境界 16 の撮影の比較用。05 の Task 13） */
  mode: '2d' | '3d'
  zoom: number
  pitch: number
  bearing: number
  exaggeration: (typeof VERTICAL_EXAGGERATIONS)[number]
  /** 水面あり（降雨を「最速」で回し、水深を毎フレーム更新する）か、地形のみか */
  water: boolean
  hillshade: HillshadeOption
  /** fps の計測の窓。probe=steps の until=window の窓 */
  durationMs: number
  /** false は (c) の 2D への切り替えを止める（S の視点を 3D のまま測る） */
  fallback: boolean
  /** タイルが揃ってから撮る・測るまで待つ時間（ms） */
  settleMs: number
  /** false は水の流れの矢印を止める（arrows=0。spec 06 §5.1、計画で決めたこと 8） */
  arrows: boolean
  /**
   * 水深のテクスチャを N 回の更新に 1 回だけ転送する（depthEvery=N。spec 06 §5.1、計画で決めたこと 6）。
   * null は指定なし（View3d の既定に任せる。Task 22 で 1000 m の既定が変わりうる）
   */
  depthEvery: (typeof DEPTH_EVERY)[number] | null
  /** true は fps の窓の直前に再生を一時停止し、止めた水面を測る（pause=1。spec 06 §5.1、計画で決めたこと 7） */
  pauseBeforeRun: boolean
  /** probe=steps: settle は平衡か cap まで、window は durationMs だけ回す（計画で決めたこと 4） */
  until: 'settle' | 'window'
  /** probe=steps の平衡を待つ上限（ms。cap=） */
  capMs: number
  /** probe=load: 地図の読み込みの後に選ぶ地点（at=緯度,経度。計画で決めたこと 9） */
  at: { lat: number; lon: number } | null
}

const HILLSHADE_OPTIONS: readonly HillshadeOption[] = ['auto', 'on', 'off']

/** at=緯度,経度。形が違う・範囲の外なら null */
export function parseAt(raw: string | null): { lat: number; lon: number } | null {
  if (raw === null) return null
  const parts = raw.split(',')
  if (parts.length !== 2) return null
  const [lat, lon] = parts.map((part) => (part.trim() === '' ? Number.NaN : Number(part)))
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }
  if (Math.abs(lat) > MERCATOR_LAT_LIMIT || Math.abs(lon) > 180) return null
  return { lat, lon }
}

export function parsePerfParams(search: string): PerfParams | null {
  const params = new URLSearchParams(search)
  const rawProbe = params.get('probe')
  const probe = PROBES.find((p) => p === rawProbe)
  if (probe === undefined) return null
  const number = (key: string, fallback: number, min: number, max: number): number => {
    const raw = params.get(key)
    const value = raw === null ? Number.NaN : Number(raw)
    return Number.isFinite(value) && value >= min && value <= max ? value : fallback
  }
  const oneOf = <T extends string | number>(list: readonly T[], value: unknown, fallback: T): T =>
    list.includes(value as T) ? (value as T) : fallback
  return {
    probe,
    mode: params.get('mode') === '2d' ? '2d' : '3d',
    zoom: number('z', 16, 0, 18),
    // 既定は 3D の視点の pitch（View3d.frame と同じ値。横断レビュー m5）
    pitch: number('pitch', PITCH_3D_DEG, 0, 85),
    bearing: number('bearing', 0, -180, 180),
    exaggeration: oneOf(VERTICAL_EXAGGERATIONS, Number(params.get('ex')), 1),
    water: params.get('water') !== '0',
    // 省いたときは 3D の既定に従う。Task 9 の組は既定のまま測る
    hillshade: oneOf(HILLSHADE_OPTIONS, params.get('hillshade'), DEFAULT_VIEW3D_OPTIONS.hillshade),
    durationMs: number('ms', 10_000, 1000, 60_000),
    fallback: params.get('fallback') !== '0',
    settleMs: number('settle', 3000, 0, 120_000),
    arrows: params.get('arrows') !== '0',
    depthEvery:
      params.get('depthEvery') === null
        ? null
        : oneOf(DEPTH_EVERY, Number(params.get('depthEvery')), 1),
    pauseBeforeRun: params.get('pause') === '1',
    until: params.get('until') === 'window' ? 'window' : 'settle',
    capMs: number('cap', 300_000, 1000, 1_800_000),
    at: parseAt(params.get('at')),
  }
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `pnpm vitest run src/ui/perfParams.test.ts`
Expected: PASS（6 件）

- [ ] **Step 5: 収集の要約の失敗するテストを書く**

`src/ui/perfCollectors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { summarizeLongTasks, summarizeStepSeries, type TimedStepSnapshot } from './perfCollectors'

describe('summarizeLongTasks（spec 06 §3、計画で決めたこと 10）', () => {
  const entries = [
    { startMs: 100, durationMs: 60 },
    { startMs: 500, durationMs: 123 },
    { startMs: 900, durationMs: 51 },
  ]

  it('窓 [from, to) に始まったタスクの数・最大・合計', () => {
    expect(summarizeLongTasks(entries, true, 400, 1000)).toEqual({
      supported: true,
      count: 2,
      maxMs: 123,
      totalMs: 174,
    })
  })

  it('窓を省けば全部。無ければ数 0・最大 0', () => {
    expect(summarizeLongTasks(entries, true).count).toBe(3)
    expect(summarizeLongTasks([], false)).toEqual({
      supported: false,
      count: 0,
      maxMs: 0,
      totalMs: 0,
    })
  })
})

describe('summarizeStepSeries（計画で決めたこと 2）', () => {
  const snap = (atMs: number, total: number, medianMs: number, p95Ms: number, maxMs: number) =>
    ({ type: 'stepTimes', atMs, total, samples: 300, medianMs, p95Ms, maxMs }) as TimedStepSnapshot

  it('新しい step を含む要約（total が増えたもの）だけで、中央値の中央値・p95 の 95 パーセンタイル・最大', () => {
    const series = [
      snap(1000, 300, 1, 2, 3),
      snap(2000, 900, 3, 6, 9),
      snap(3000, 900, 3, 6, 9), // 止まった後の同じ要約（数えない）
      snap(4000, 1500, 2, 4, 20),
    ]
    expect(summarizeStepSeries(series)).toEqual({
      snapshots: 3,
      medianMs: 2,
      p95Ms: 6,
      maxMs: 20,
    })
  })

  it('窓で絞る。窓の前の要約と同じ total のものは新しい要約とみなさない', () => {
    const series = [snap(1000, 300, 1, 2, 3), snap(2000, 300, 1, 2, 3), snap(3000, 600, 5, 7, 8)]
    expect(summarizeStepSeries(series, 1500, 3500)).toEqual({
      snapshots: 1,
      medianMs: 5,
      p95Ms: 7,
      maxMs: 8,
    })
  })

  it('無ければ null', () => {
    expect(summarizeStepSeries([])).toEqual({
      snapshots: 0,
      medianMs: null,
      p95Ms: null,
      maxMs: null,
    })
  })
})
```

- [ ] **Step 6: 失敗を確かめる**

Run: `pnpm vitest run src/ui/perfCollectors.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 7: 収集を書く**

`src/ui/perfCollectors.ts`:

```ts
/**
 * 計測用のフックが最初から集める値（spec 06 §3、R06-5）。pnpm build:perf のときだけビルドに入る。
 * 要約は純粋な関数（perfCollectors.test.ts）、集める側はブラウザの API を使う
 */
import { percentile } from '../map/fpsStats'
import { PERF_CHANNEL, type StepTimeSnapshot } from '../shared/perfProtocol'

/** ブラウザの longtask（50 ms を超えたタスク）の 1 件 */
export interface LongTaskSample {
  startMs: number
  durationMs: number
}

export interface LongTaskSummary {
  /** ブラウザが longtask を出すか（false なら数 0 は「無かった」ではない） */
  supported: boolean
  count: number
  maxMs: number
  totalMs: number
}

/** [fromMs, toMs) に始まった長いタスクの要約 */
export function summarizeLongTasks(
  entries: readonly LongTaskSample[],
  supported: boolean,
  fromMs = Number.NEGATIVE_INFINITY,
  toMs = Number.POSITIVE_INFINITY,
): LongTaskSummary {
  const inWindow = entries.filter((entry) => entry.startMs >= fromMs && entry.startMs < toMs)
  return {
    supported,
    count: inWindow.length,
    maxMs: inWindow.reduce((max, entry) => Math.max(max, entry.durationMs), 0),
    totalMs: inWindow.reduce((sum, entry) => sum + entry.durationMs, 0),
  }
}

export interface LongTaskCollector {
  supported: boolean
  entries: LongTaskSample[]
}

/** 長いタスクを集め始める。buffered なので、フックの読み込みより前（起動・最初の読み込み）の分も拾う */
export function observeLongTasks(): LongTaskCollector {
  const entries: LongTaskSample[] = []
  const supported =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
  if (!supported) return { supported, entries }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      entries.push({ startMs: entry.startTime, durationMs: entry.duration })
    }
  }).observe({ type: 'longtask', buffered: true })
  return { supported, entries }
}

/** Worker の要約に、メインで受け取った時刻を付けたもの */
export interface TimedStepSnapshot extends StepTimeSnapshot {
  atMs: number
}

export interface StepTimeSummary {
  /** 窓の中で新しい step を含んだ要約の数 */
  snapshots: number
  /** 各要約の中央値の中央値（tech-spec §6.3 の中央値 8 ms と比べる） */
  medianMs: number | null
  /** 各要約の p95 の 95 パーセンタイル（tech-spec §6.3 の p95 16 ms と比べる） */
  p95Ms: number | null
  maxMs: number | null
}

/**
 * 1 秒ごとの要約の時系列をまとめる（計画で決めたこと 2）。Worker は止まっている間も同じ要約を送り続けるので、
 * total が前の要約より増えたものだけを使う（窓の前の要約も「前」に数える）
 */
export function summarizeStepSeries(
  series: readonly TimedStepSnapshot[],
  fromMs = Number.NEGATIVE_INFINITY,
  toMs = Number.POSITIVE_INFINITY,
): StepTimeSummary {
  const fresh: TimedStepSnapshot[] = []
  let lastTotal = Number.NEGATIVE_INFINITY
  for (const snapshot of series) {
    const isNew = snapshot.total > lastTotal
    lastTotal = Math.max(lastTotal, snapshot.total)
    if (isNew && snapshot.atMs >= fromMs && snapshot.atMs < toMs) fresh.push(snapshot)
  }
  if (fresh.length === 0) return { snapshots: 0, medianMs: null, p95Ms: null, maxMs: null }
  const medians = fresh.map((s) => s.medianMs).sort((a, b) => a - b)
  const p95s = fresh.map((s) => s.p95Ms).sort((a, b) => a - b)
  return {
    snapshots: fresh.length,
    medianMs: percentile(medians, 0.5),
    p95Ms: percentile(p95s, 0.95),
    maxMs: Math.max(...fresh.map((s) => s.maxMs)),
  }
}

export interface StepTimeListener {
  series: TimedStepSnapshot[]
}

/** 計測用のビルドの Worker が送る 1 step の所要時間の要約を受け始める（Task 2） */
export function listenStepTimes(): StepTimeListener {
  const series: TimedStepSnapshot[] = []
  const channel = new BroadcastChannel(PERF_CHANNEL)
  channel.onmessage = (event: MessageEvent<StepTimeSnapshot>) => {
    if (event.data?.type === 'stepTimes') series.push({ ...event.data, atMs: performance.now() })
  }
  return { series }
}
```

- [ ] **Step 8: 収集のテストが通ることを確かめる**

Run: `pnpm vitest run src/ui/perfCollectors.test.ts`
Expected: PASS（5 件）

- [ ] **Step 9: 待ちの道具を `perfWait.ts` に移す**

`git mv src/ui/perfHook.test.ts src/ui/perfWait.test.ts` を行い、1 行目の後の import を `import { placeViewOnLoadedTerrain } from './perfWait'` に直す（テストの中身は変えない）。

`src/ui/perfWait.ts` を作る。`perfHook.ts` の `WAIT_MS`・`TILE_WAIT_MS`・`waitFor`・`nextFrame`・`waitTilesLoaded`・`show`・`ProbeView`・`ProbeMap`・`placeViewOnLoadedTerrain` を、コメントごとこのファイルへ移して export し、`waitFor` に上限の引数と、新しい 3 つを足す。全文:

```ts
/**
 * 計測用のフックの待ちと表示の道具（spec 05 §4.4、spec 06 §3）。pnpm build:perf のときだけビルドに入る
 */
import type { Map as MapLibreMap } from 'maplibre-gl'

/** 地形の読み込み・3D の準備を待つ上限 */
export const WAIT_MS = 120_000
/** 視点を置いた後、タイルが揃うのを待つ上限 */
export const TILE_WAIT_MS = 60_000

export function waitFor(
  check: () => boolean,
  subscribe: (listener: () => void) => () => void,
  timeoutMs = WAIT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check()) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const off = subscribe(() => {
      if (!check()) return
      clearTimeout(timer)
      off()
      resolve()
    })
    timer = setTimeout(() => {
      off()
      reject(new Error('計測の準備が時間内に終わりませんでした'))
    }, timeoutMs)
  })
}

export const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** check が真になるまで intervalMs ごとに見る。timeoutMs を過ぎたら false */
export async function pollUntil(
  check: () => boolean,
  timeoutMs: number,
  intervalMs = 50,
): Promise<boolean> {
  const start = performance.now()
  while (!check()) {
    if (performance.now() - start > timeoutMs) return false
    await sleep(intervalMs)
  }
  return true
}

/**
 * 要素の data-* が条件を満たすまで待つ（MutationObserver。時刻を測るので polling の粒度を入れない。
 * 計画で決めたこと 9）
 */
export function waitForDataset(
  element: HTMLElement,
  check: (dataset: DOMStringMap) => boolean,
  timeoutMs = WAIT_MS,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (check(element.dataset)) {
      resolve()
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const observer = new MutationObserver(() => {
      if (!check(element.dataset)) return
      clearTimeout(timer)
      observer.disconnect()
      resolve()
    })
    observer.observe(element, { attributes: true })
    timer = setTimeout(() => {
      observer.disconnect()
      reject(new Error('計測の準備が時間内に終わりませんでした'))
    }, timeoutMs)
  })
}

/** 視点のタイル（地形・hillshade・背景）が揃うまで待つ。S は idle を待った（05 の計画で決めたこと 20） */
export async function waitTilesLoaded(
  map: MapLibreMap,
): Promise<{ loaded: boolean; waitMs: number }> {
  const start = performance.now()
  // jumpTo の後の描画でタイルの要求が始まるので、2 フレーム待ってから見る
  await nextFrame()
  await nextFrame()
  while (!map.areTilesLoaded()) {
    if (performance.now() - start > TILE_WAIT_MS) {
      return { loaded: false, waitMs: performance.now() - start }
    }
    await sleep(100)
  }
  return { loaded: true, waitMs: performance.now() - start }
}

export function show(value: unknown): void {
  const pre = document.createElement('pre')
  pre.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:10000;max-height:90vh;overflow:auto;' +
    'background:#fff;color:#000;font-size:11px;padding:8px;margin:0'
  pre.textContent = JSON.stringify(value, null, 2)
  document.body.append(pre)
}
```

その後に、`perfHook.ts` の `ProbeView`・`ProbeMap`・`placeViewOnLoadedTerrain`（JSDoc の「視点を置き、タイルが揃うのを待ってから、同じ視点をもう一度置く。…」の段落を含む）を**そのまま**貼り、`export` を付ける。

- [ ] **Step 10: `perfHook.ts` を直す**

1. `perfHook.ts` から、Step 9 で移した定義（`WAIT_MS`・`TILE_WAIT_MS`・`waitFor`・`nextFrame`・`waitTilesLoaded`・`show`・`ProbeView`・`ProbeMap`・`placeViewOnLoadedTerrain`）を消し、import を次にする:

```ts
import { runFpsProbe } from '../map/fpsProbe'
import type { TileTimeSample } from '../map/view3d/options'
import type { SettingsStore } from '../state/settingsStore'
import {
  listenStepTimes,
  observeLongTasks,
  summarizeLongTasks,
  summarizeStepSeries,
} from './perfCollectors'
import { parsePerfParams } from './perfParams'
import {
  nextFrame,
  type ProbeView,
  placeViewOnLoadedTerrain,
  show,
  waitFor,
  waitTilesLoaded,
} from './perfWait'
import type { TerrainSession } from './terrainSession'
```

2. 先頭の JSDoc の 1 行目を `計測用のフック（spec 05 §4.4、spec 06 §3、R05-6・R06-5）。pnpm build:perf のときだけビルドに入る。` にする。

3. `installPerfHook` の `const root = document.documentElement` の直後に足す:

```ts
  // 長いタスクと 1 step の所要時間は、どの probe でも最初から集める（spec 06 §3、計画で決めたこと 2・10）
  const longTasks = observeLongTasks()
  const stepTimes = listenStepTimes()
```

4. `session.view3d.setOptions({ … })` の `boundaryFallback: params.fallback,` の後に足す:

```ts
    // depthEvery=N の指定があるときだけ渡す（無ければ View3d の既定。spec 06 §5.1）
    ...(params.depthEvery === null ? {} : { depthUploadEvery: params.depthEvery }),
```

5. `settings.getState().setDisplay({ verticalExaggeration: params.exaggeration })` を次に置き換える:

```ts
  settings.getState().setDisplay({
    verticalExaggeration: params.exaggeration,
    // arrows=0: 水の流れの矢印を止める（spec 06 §5.1、計画で決めたこと 8）。Worker は flowVectors() を呼ばない
    ...(params.arrows ? {} : { showFlowVectors: false }),
  })
```

6. `const result = await runFpsProbe(map, params.durationMs, { renderTimes, tileTimes })` を次に置き換える:

```ts
    // pause=1: 止めた水面（転送 0・描画はそのまま）を測る（spec 06 §5.1、計画で決めたこと 7）
    if (params.water && params.pauseBeforeRun) {
      session.simulation.pause()
      await nextFrame()
      await nextFrame()
    }
    const runStart = performance.now()
    const result = await runFpsProbe(map, params.durationMs, { renderTimes, tileTimes })
    const runEnd = performance.now()
```

7. `const report = { … }` の `result,` の後に足す:

```ts
      // 計測の窓の長いタスクと、窓の間に Worker が送った 1 step の所要時間（要約は 1 秒遅れて届くので 1.5 秒延ばす）
      longTasks: summarizeLongTasks(longTasks.entries, longTasks.supported, runStart, runEnd),
      stepTimes: summarizeStepSeries(stepTimes.series, runStart, runEnd + 1500),
```

（`ProbeView` は `const camera: ProbeView = …` で使う。`MapLibreMap` の import は `perfHook.ts` で使わなくなるので消す。）

- [ ] **Step 11: テストとゲートを通す**

Run: `pnpm vitest run src/ui/`
Expected: PASS（`perfWait.test.ts` の 2 件を含む）

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

Run: `pnpm build && pnpm size && (grep -c perfHook build-info/manifest.json || true) && (grep -l raintrace-perf dist/assets/*.js || true)`
Expected: 初期ロード **427.5 KB**、`0`、何も出ない（計測用のフックの変更は通常のビルドに入らない。E2E は変わらないので回さなくてよい）

- [ ] **Step 12: コミットする**

```bash
git add src/ui/perfParams.ts src/ui/perfParams.test.ts src/ui/perfWait.ts src/ui/perfWait.test.ts src/ui/perfCollectors.ts src/ui/perfCollectors.test.ts src/ui/perfHook.ts
git commit -m "計測用のフック: URL に arrows・depthEvery・pause・until・cap・at、長いタスクと 1 step の所要時間の収集、待ちの道具を perfWait に切り出す（spec 06 §3・§5.1）"
```

---

### Task 5: `probe=steps`（平衡までの step 数と時間）と `probe=load`（クリックから 2D、3D を押してから最初の 3D のフレーム）（spec 06 §3・§4.2・§5、計画で決めたこと 3・4・9・13・14）

**Files:**
- Create: `src/ui/perfReports.ts`
- Create: `src/ui/perfSteps.ts`、`src/ui/perfSteps.test.ts`
- Create: `src/ui/perfLoad.ts`
- Modify: `src/ui/perfHook.ts`（probe の振り分け）
- Modify: `src/map/fpsProbe.ts`（`gpuTimerQuery`）

**Interfaces:**
- Consumes: Task 4 の `PerfParams`・`perfWait`・`perfCollectors`
- Produces:
  - `src/ui/perfReports.ts`: `StepsReport`・`LoadReport`・`To3dTiming`（`tests/perf/` が型だけを読む）
  - `src/ui/perfSteps.ts`: `IDLE_QUIET_MS = 1000`・`IDLE_WINDOW_MS = 2000`・`minutesAt1x(steps: number): number`・`runStepsProbe(session, settings, params, longTasks, stepTimes): Promise<StepsReport>`
  - `src/ui/perfLoad.ts`: `runLoadProbe(session, params, longTasks, samples): Promise<LoadReport>`
  - `<html data-steps-result>`・`<html data-load-result>`（Task 6 の `readReport` が読む）
  - `FpsResult.gpuTimerQuery: boolean`

- [ ] **Step 1: 失敗するテストを書く**

`src/ui/perfSteps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { minutesAt1x } from './perfSteps'

describe('minutesAt1x（1x は毎秒 60 step。R04-5・R06-6 の報告用）', () => {
  it('step 数 ÷ 60 を分にする（04 の綾瀬 267,379 step は約 74 分）', () => {
    expect(minutesAt1x(3600)).toBe(1)
    expect(minutesAt1x(267_379)).toBeCloseTo(74.27, 2)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm vitest run src/ui/perfSteps.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 結果の型を書く**

`src/ui/perfReports.ts`:

```ts
/**
 * 計測の結果の形（spec 06 §3）。tests/perf/ は型だけを import する（tsconfig.node.json は vite/client の型を
 * 持たないので、TerrainSession などに届く import を tests から張らない。計画で決めたこと 14）
 */
import type { DisplayStats } from '../state/simulationStore'
import type {
  LongTaskSample,
  LongTaskSummary,
  StepTimeSummary,
  TimedStepSnapshot,
} from './perfCollectors'
import type { PerfParams } from './perfParams'

export interface StepsReport {
  params: PerfParams
  /** 測ったときの 3D の状態（data-view3d。2D なら off） */
  view3d: string
  sizeM: number
  rain: { amountMm: number; radiusM: number }
  terrain: { demLevel: number; cellSizeM: number; invalidRatio: number } | null
  /** 平衡に届いたか（until=settle で cap に届いた、または until=window で窓が終わったら false） */
  settled: boolean
  /** 平衡（または打ち切り・窓の終わり）の時点の step 数。打ち切りは統計の 10Hz の遅れぶん少ないことがある */
  steps: number
  elapsedMs: number
  /** steps ÷ 60 を分にした値（1x なら何分か。報告するだけで目標にはしない。R06-6） */
  minutesAt1x: number
  stepsPerSecond: number
  final: DisplayStats | null
  stepTimes: StepTimeSummary & { series: TimedStepSnapshot[] }
  longTasks: LongTaskSummary
  /** 止めた後 IDLE_WINDOW_MS の間の地図の render の回数（spec 06 §5「止まっている間の再描画」） */
  idleRenders: number
  idleWindowMs: number
}

export interface To3dTiming {
  /** 3D を押してから 3D の状態になるまで（View3d のチャンクの読み込みと地形の設定） */
  statusMs: number
  /** 水面を作り終えるまで（three のチャンクと水面の作成）。水面なしなら null */
  waterBuiltMs: number | null
  tilesLoaded: boolean
  /** タイルが揃って 2 フレーム描くまで（spec 06 §5「3D を押してから最初の 3D のフレーム」） */
  firstFrameMs: number
}

export interface LoadReport {
  params: PerfParams
  sizeM: number
  /** 地点を選んでから、Worker の地形が届いてストアが ready になるまで */
  selectToReadyMs: number
  /** 地点を選んでから、2D の地形のレイヤーが出て 2 フレーム描くまで（spec 06 §5「クリックから 2D の地形の表示」） */
  selectTo2dMs: number
  to3d: To3dTiming | null
  prepareMs: number[]
  waterBuildMs: number[]
  longTasks: { load: LongTaskSummary; to3d: LongTaskSummary | null; entries: LongTaskSample[] }
}
```

- [ ] **Step 4: `probe=steps` を書く**

`src/ui/perfSteps.ts`:

```ts
/**
 * probe=steps（spec 06 §4.2）: 降雨を「最速」で回し、平衡（または cap・窓の終わり）までの step 数・時間と、
 * 1 step の所要時間・長いタスク・止まっている間の再描画を測る。pnpm build:perf のときだけビルドに入る
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { SettingsStore } from '../state/settingsStore'
import type { SimulationStore } from '../state/simulationStore'
import {
  type LongTaskCollector,
  type StepTimeListener,
  summarizeLongTasks,
  summarizeStepSeries,
} from './perfCollectors'
import type { PerfParams } from './perfParams'
import type { StepsReport } from './perfReports'
import { sleep, waitFor } from './perfWait'
import type { TerrainSession } from './terrainSession'

/** 止めた後、再描画を数える前に待つ時間（最後の frame・矢印の反映を流す） */
export const IDLE_QUIET_MS = 1000
/** 止まっている間の再描画を数える時間 */
export const IDLE_WINDOW_MS = 2000
/** 1x の再生速度（R04-5） */
const STEPS_PER_SECOND_AT_1X = 60
/** Worker の要約は 1 秒ごとに届くので、窓の終わりを延ばす */
const SNAPSHOT_LAG_MS = 1500

export function minutesAt1x(steps: number): number {
  return steps / STEPS_PER_SECOND_AT_1X / 60
}

/** 平衡になったら true、limitMs を過ぎたら false。再生が失敗したら reject */
function waitSettled(sim: SimulationStore, limitMs: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const decided = (): boolean | null => {
      const { status, error } = sim.getState()
      if (error !== null) throw new Error(`再生が失敗しました: ${error}`)
      return status === 'settled' ? true : null
    }
    try {
      if (decided() === true) {
        resolve(true)
        return
      }
    } catch (error) {
      reject(error)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const off = sim.subscribe(() => {
      try {
        if (decided() !== true) return
        clearTimeout(timer)
        off()
        resolve(true)
      } catch (error) {
        clearTimeout(timer)
        off()
        reject(error)
      }
    })
    timer = setTimeout(() => {
      off()
      resolve(false)
    }, limitMs)
  })
}

function countRenders(map: MapLibreMap, windowMs: number): Promise<number> {
  return new Promise((resolve) => {
    let count = 0
    const onRender = (): void => {
      count++
    }
    map.on('render', onRender)
    setTimeout(() => {
      map.off('render', onRender)
      resolve(count)
    }, windowMs)
  })
}

export async function runStepsProbe(
  session: TerrainSession,
  settings: SettingsStore,
  params: PerfParams,
  longTasks: LongTaskCollector,
  stepTimes: StepTimeListener,
): Promise<StepsReport> {
  const { store, simulation } = session
  await waitFor(
    () => store.getState().load.status === 'ready',
    (listener) => store.subscribe(listener),
  )
  if (params.mode === '3d') {
    store.getState().setViewMode('3d')
    await waitFor(
      () => store.getState().view3dStatus === '3d',
      (listener) => store.subscribe(listener),
    )
  }
  const controller = session.view3d.mapController()
  if (controller === null) throw new Error('地図がありません')
  const { map } = controller
  const { rainfall, area } = settings.getState()
  simulation.setSpeed('max')
  const limitMs = params.until === 'settle' ? params.capMs : params.durationMs
  const start = performance.now()
  simulation.start(rainfall.amountMm, rainfall.radiusM)
  const settled = await waitSettled(simulation.store, limitMs)
  const elapsedMs = performance.now() - start
  if (!settled) simulation.pause()
  const end = performance.now()
  await sleep(IDLE_QUIET_MS)
  const idleRenders = await countRenders(map, IDLE_WINDOW_MS)
  const final = simulation.store.getState().stats
  const steps = final?.step ?? 0
  const summary = store.getState().summary
  return {
    params,
    view3d: map.getContainer().dataset.view3d ?? 'off',
    sizeM: area.sizeM,
    rain: { amountMm: rainfall.amountMm, radiusM: rainfall.radiusM },
    terrain:
      summary === null
        ? null
        : {
            demLevel: summary.demLevel,
            cellSizeM: summary.cellSizeM,
            invalidRatio: summary.invalidRatio,
          },
    settled,
    steps,
    elapsedMs,
    minutesAt1x: minutesAt1x(steps),
    stepsPerSecond: elapsedMs > 0 ? steps / (elapsedMs / 1000) : 0,
    final,
    stepTimes: {
      ...summarizeStepSeries(stepTimes.series, start, end + SNAPSHOT_LAG_MS),
      series: stepTimes.series.filter((s) => s.atMs >= start && s.atMs < end + SNAPSHOT_LAG_MS),
    },
    longTasks: summarizeLongTasks(longTasks.entries, longTasks.supported, start, end),
    idleRenders,
    idleWindowMs: IDLE_WINDOW_MS,
  }
}
```

- [ ] **Step 5: `probe=load` を書く**

`src/ui/perfLoad.ts`:

```ts
/**
 * probe=load（spec 06 §3・§5、計画で決めたこと 9）: at= の地点を地図のクリックと同じ経路（TerrainSession.select）で
 * 選び、2D の地形が出るまでと、mode=3d なら続けて 3D を押してから最初の 3D のフレームまでを測る。
 * 地理院に実際に接続する（本番のタイルの経路）。pnpm build:perf のときだけビルドに入る
 */
import { type LongTaskCollector, summarizeLongTasks } from './perfCollectors'
import type { PerfParams } from './perfParams'
import type { LoadReport, To3dTiming } from './perfReports'
import { nextFrame, pollUntil, WAIT_MS, waitFor, waitForDataset, waitTilesLoaded } from './perfWait'
import type { TerrainSession } from './terrainSession'

export async function runLoadProbe(
  session: TerrainSession,
  params: PerfParams,
  longTasks: LongTaskCollector,
  samples: { prepareMs: number[]; waterBuildMs: number[] },
): Promise<LoadReport> {
  const at = params.at
  if (at === null) throw new Error('probe=load には at=緯度,経度 が要ります（lat・lon は付けない）')
  const { store } = session
  const loaded = await pollUntil(() => session.view3d.mapController()?.isLoaded() === true, WAIT_MS)
  const controller = session.view3d.mapController()
  if (!loaded || controller === null) throw new Error('地図の読み込みが時間内に終わりませんでした')
  const { map } = controller
  const container = map.getContainer()
  if (store.getState().selected !== null) {
    throw new Error('起動時に地点が選ばれています。URL から lat・lon を外してください')
  }
  await nextFrame()
  const start = performance.now()
  const ready = waitFor(
    () => store.getState().load.status === 'ready',
    (listener) => store.subscribe(listener),
  ).then(() => performance.now())
  session.select(at.lon, at.lat)
  await waitForDataset(container, (dataset) => dataset.rangeShown === 'true')
  await nextFrame()
  await nextFrame()
  const shown = performance.now()
  const readyAt = await ready

  let to3d: To3dTiming | null = null
  let to3dWindow: [number, number] | null = null
  if (params.mode === '3d') {
    const pressed = performance.now()
    store.getState().setViewMode('3d')
    await waitFor(
      () => store.getState().view3dStatus === '3d',
      (listener) => store.subscribe(listener),
    )
    const status = performance.now()
    let waterBuilt: number | null = null
    if (params.water) {
      await waitForDataset(container, (dataset) => Number(dataset.waterBuilds ?? '0') >= 1)
      waterBuilt = performance.now()
    }
    const tiles = await waitTilesLoaded(map)
    await nextFrame()
    await nextFrame()
    const first = performance.now()
    to3d = {
      statusMs: status - pressed,
      waterBuiltMs: waterBuilt === null ? null : waterBuilt - pressed,
      tilesLoaded: tiles.loaded,
      firstFrameMs: first - pressed,
    }
    to3dWindow = [pressed, first]
  }
  return {
    params,
    sizeM: Number(new URLSearchParams(window.location.search).get('size') ?? '500'),
    selectToReadyMs: readyAt - start,
    selectTo2dMs: shown - start,
    to3d,
    prepareMs: samples.prepareMs,
    waterBuildMs: samples.waterBuildMs,
    longTasks: {
      load: summarizeLongTasks(longTasks.entries, longTasks.supported, start, shown),
      to3d:
        to3dWindow === null
          ? null
          : summarizeLongTasks(
              longTasks.entries,
              longTasks.supported,
              to3dWindow[0],
              to3dWindow[1],
            ),
      entries: longTasks.entries.filter((entry) => entry.startMs >= start),
    },
  }
}
```

- [ ] **Step 6: フックで振り分け、fps の結果に GPU のタイマーの有無を足す**

`src/ui/perfHook.ts` の import に足す:

```ts
import { runLoadProbe } from './perfLoad'
import { runStepsProbe } from './perfSteps'
```

`installPerfHook` の `const { store } = session` の前に足す:

```ts
  /** 結果を <html data-*> と画面に出す */
  const publish = (key: 'stepsResult' | 'loadResult', report: unknown): void => {
    root.dataset[key] = JSON.stringify(report)
    show(report)
  }
```

`try {` の直後に足す:

```ts
    if (params.probe === 'steps') {
      publish('stepsResult', await runStepsProbe(session, settings, params, longTasks, stepTimes))
      return
    }
    if (params.probe === 'load') {
      publish('loadResult', await runLoadProbe(session, params, longTasks, { prepareMs, waterBuildMs }))
      return
    }
```

`src/map/fpsProbe.ts` の `FpsResult` の `canvas` の後に足す:

```ts
  /**
   * GPU の時間を測る拡張（EXT_disjoint_timer_query_webgl2）を使えるか（spec 06 §4.2・§5.1。計画で決めたこと 13）。
   * 使えるかだけを記録し、使う計測は M3 で使えると分かった場合に計画し直す
   */
  gpuTimerQuery: boolean
```

`runFpsProbe` の戻り値の `canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],` の後に足す:

```ts
    gpuTimerQuery: gl.getExtension('EXT_disjoint_timer_query_webgl2') !== null,
```

- [ ] **Step 7: テストとゲートを通す**

Run: `pnpm vitest run src/ui/`
Expected: PASS

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（`perfReports.ts` は型だけのモジュールで、`perfSteps.ts`・`perfLoad.ts` から型で届く。depcheck が `not-reachable-from-entry` で落とすなら、`.dependency-cruiser.mjs` の `options.tsPreCompilationDeps` を確かめ、落ちる理由を報告に書いてコントローラーに相談する）

Run: `pnpm build && pnpm size && (grep -c perfHook build-info/manifest.json || true) && (grep -l raintrace-perf dist/assets/*.js || true)`
Expected: 初期ロード **427.5 KB**、`0`、何も出ない

- [ ] **Step 8: コミットする**

```bash
git add src/ui/perfReports.ts src/ui/perfSteps.ts src/ui/perfSteps.test.ts src/ui/perfLoad.ts src/ui/perfHook.ts src/map/fpsProbe.ts
git commit -m "計測用のフック: probe=steps（平衡までの step 数・時間、1 step の所要時間、止まっている間の再描画）と probe=load（クリックから 2D、3D を押してから最初の 3D のフレーム）、fps の結果に GPU のタイマーの有無（spec 06 §3・§4.2）"
```

---

### Task 6: 計測の実行ファイル（共有の道具、固定の DEM、`steps.perf.ts`、3 地点と切り分けの組、`probe=load` のテスト、vsync を外す引数）（spec 06 §4.1・§4.2・§5.1、計画で決めたこと 5・11・12）

**Files:**
- Modify: `tests/e2e/support/gsi.ts`（`GSI_TILE_URL`・`fulfillPng`・`fulfillNotFound` を export）
- Create: `tests/perf/support.ts`
- Create: `tests/perf/demFixtures.ts`
- Create: `tests/perf/steps.perf.ts`
- Modify: `tests/perf/fps.perf.ts`（全体を置き換える）
- Modify: `playwright.perf.config.ts`
- Modify: `.gitignore`（`.cache/`）
- Create: `tests/perf/fixtures/README.md`

**Interfaces:**
- Consumes: Task 5 の `StepsReport`・`LoadReport`（型だけ）、Task 4 の `LongTaskSummary`・`StepTimeSummary`（型だけ）
- Produces:
  - `tests/perf/support.ts`: `VIEWPORT`、`SITES`・`SiteName`、`listFromEnv(value, allowed, fallback)`、`sitesFromEnv(value, fallback)`、`outDirFromEnv(value, fallback): URL`、`assertPerfBuild()`、`query(params)`、`withFreshPage(browser, baseURL, run, prepare?)`、`ReportAttribute`、`readReport<T>(page, attribute, timeoutMs)`、`median(values)`
  - `tests/perf/demFixtures.ts`: `DemMode`、`DemManifest`、`DEM_PATH`、`sha256(body)`、`readManifest()`、`writeManifest(manifest)`、`demModeFromEnv(value)`、`DemRouteCounts`、`routeDem(context, mode, manifest)`
  - 環境変数: `RAINTRACE_FPS_SITES`（fps・load の地点。既定 `shibuya`）、`RAINTRACE_LOAD=1`、`RAINTRACE_STEPS_*`（下の `steps.perf.ts` の冒頭）、`RAINTRACE_DEM=record|replay|live`、`RAINTRACE_UNCAPPED=1`
  - fps の組 `isolate`（Task 11 が使う）

- [ ] **Step 1: E2E の差し替えの道具を export する**

`tests/e2e/support/gsi.ts` の `const naTile = solidPng(128, 0, 0)` の後に足す:

```ts
/** 地理院のタイルの URL（E2E の routeGsi と計測の routeDem〈tests/perf/demFixtures.ts〉が共有する） */
export const GSI_TILE_URL = 'https://cyberjapandata.gsi.go.jp/**'
```

`const fulfillPng = (route: Route, body: Buffer) =>` を `export const fulfillPng = (route: Route, body: Buffer) =>` にし、その後に足す:

```ts
export const fulfillNotFound = (route: Route) =>
  route.fulfill({
    status: 404,
    headers: { 'access-control-allow-origin': '*' },
    body: 'not found',
  })
```

`routeGsi` の中の `context.route('https://cyberjapandata.gsi.go.jp/**', …)` を `context.route(GSI_TILE_URL, …)` にし、`if (outcome === 'missing') { return route.fulfill({ … }) }` を `if (outcome === 'missing') return fulfillNotFound(route)` にする（振る舞いは変えない）。

- [ ] **Step 2: 共有の道具を書く**

`tests/perf/support.ts`:

```ts
/**
 * 計測（tests/perf）で共有する道具（spec 05 §4.4、spec 06 §4.2）。05 の fps.perf.ts から移した
 * （assertPerfBuild・query・withFreshPage・readReport・median）
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { type Browser, type BrowserContext, expect, type Page } from '@playwright/test'
import { percentile } from '../../src/map/fpsStats'
import { acknowledgeDisclaimer, collectErrors } from '../e2e/support/app'

/** S と同じ画面（spec 05 §4.4） */
export const VIEWPORT = { width: 960, height: 600 }

/** R06-1 の 3 地点（R02-7。04 の手動確認と同じ座標） */
export const SITES = {
  ayase: { label: '綾瀬', lat: '35.762300', lon: '139.824600' },
  shibuya: { label: '渋谷', lat: '35.658000', lon: '139.701600' },
  minatomirai: { label: 'みなとみらい', lat: '35.457500', lon: '139.632000' },
} as const
export type SiteName = keyof typeof SITES
const SITE_NAMES = Object.keys(SITES) as SiteName[]

/** カンマ区切りの環境変数を、許す値の一覧で確かめて読む。空なら fallback */
export function listFromEnv<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: readonly T[],
): T[] {
  if (value === undefined || value.trim() === '') return [...fallback]
  const items = value.split(',').map((item) => item.trim())
  for (const item of items) {
    if (!allowed.includes(item as T)) {
      throw new Error(`「${item}」は使えません（${allowed.join('・')}）`)
    }
  }
  return items as T[]
}

export const sitesFromEnv = (value: string | undefined, fallback: readonly SiteName[]): SiteName[] =>
  listFromEnv(value, SITE_NAMES, fallback)

/** 結果の書き先。リポジトリの根からの相対（または絶対）のパス */
export function outDirFromEnv(value: string | undefined, fallback: string): URL {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
  return pathToFileURL(`${resolve(repoRoot, value ?? fallback)}/`)
}

/**
 * 計測用のビルド（pnpm build:perf）でなければフックが入らず、印は一生付かない。そのまま回すと timeout まで
 * 待たされ、「固まった」のか「ビルドし忘れた」のか分からない。先にビルドの情報（build-info/）を見て区別する
 */
export function assertPerfBuild(): void {
  const manifest = new URL('../../build-info/manifest.json', import.meta.url)
  if (!existsSync(manifest)) {
    throw new Error('build-info/manifest.json がありません。先に pnpm build:perf を実行してください')
  }
  if (!readFileSync(manifest, 'utf8').includes('perfHook')) {
    throw new Error(
      'dist が計測用のビルドではありません（manifest に perfHook が無い）。先に pnpm build:perf を実行してください',
    )
  }
}

export function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  )
  return `/?${new URLSearchParams(entries).toString()}`
}

/**
 * 1 回ずつ新しい context（HTTP の cache が空）で開く。同じページで続けると、後の条件ほど地理院のタイルが
 * cache から来て有利になる（05 の計画で決めたこと 20）。prepare は context の差し替え（context.route）を
 * ページを開く前に張るために使う
 */
export async function withFreshPage<T>(
  browser: Browser,
  baseURL: string,
  run: (page: Page) => Promise<T>,
  prepare?: (context: BrowserContext) => Promise<void>,
): Promise<T> {
  const context = await browser.newContext({ baseURL, viewport: VIEWPORT, deviceScaleFactor: 1 })
  let closed = false
  try {
    await acknowledgeDisclaimer(context)
    if (prepare !== undefined) await prepare(context)
    const page = await context.newPage()
    const errors = collectErrors(page)
    const value = await run(page)
    expect(errors).toEqual([])
    // 報告を読んだ後（閉じるまでの間）に出たコンソールのエラーも見る。1 回目の確認だけだと取り逃す
    await context.close()
    closed = true
    expect(errors).toEqual([])
    return value
  } finally {
    if (!closed) await context.close()
  }
}

export type ReportAttribute =
  | 'data-fps-result'
  | 'data-steps-result'
  | 'data-load-result'
  | 'data-water-result'

/** 結果か失敗の印が付くまで待ち、結果を読む */
export async function readReport<T>(
  page: Page,
  attribute: ReportAttribute,
  timeoutMs: number,
): Promise<T> {
  await expect(page.locator(`html[${attribute}], html[data-perf-error]`)).toBeAttached({
    timeout: timeoutMs,
  })
  const failure = await page.locator('html').getAttribute('data-perf-error')
  if (failure !== null) throw new Error(`計測の失敗: ${failure}`)
  return JSON.parse((await page.locator('html').getAttribute(attribute)) ?? 'null') as T
}

/** 中央値（回数が偶数なら上側。percentile と同じ） */
export const median = (values: readonly number[]): number =>
  percentile([...values].sort((a, b) => a - b), 0.5)
```

- [ ] **Step 3: 固定の DEM を書く**

`tests/perf/demFixtures.ts`:

```ts
/**
 * CPU で決まる計測（1 step の所要時間・平衡）の DEM を毎回同じにする（spec 06 §4.1、計画で決めたこと 5）。
 * E2E の routeGsi（tests/e2e/support/gsi.ts）と同じく browser context で差し替える（DEM の取得は Worker の中で
 * 行うので page.route では捕まらない）。
 * - record: 地理院から取り、本体を .cache/perf-dem/<SHA-256>.png に、パスごとの状態を
 *   tests/perf/fixtures/dem-manifest.json に書く（404 も覚える）
 * - replay: manifest の本体を返す。本体が無い・SHA-256 が合わなければ要求を止めて missing に数える。
 *   manifest に無い DEM の要求（3D の範囲の外のタイル）は地理院にそのまま流し、passthrough に数える
 * - live: 差し替えない
 * 背景地図のタイルは差し替えない
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { BrowserContext } from '@playwright/test'
import { fulfillNotFound, fulfillPng, GSI_TILE_URL } from '../e2e/support/gsi'

export type DemMode = 'record' | 'replay' | 'live'
export type DemManifestEntry = { status: 200; sha256: string; bytes: number } | { status: 404 }
/** キーは URL のパス（/xyz/<DEM>/<z>/<x>/<y>.png） */
export type DemManifest = Record<string, DemManifestEntry>

const manifestUrl = new URL('./fixtures/dem-manifest.json', import.meta.url)
const cacheDir = new URL('../../.cache/perf-dem/', import.meta.url)

/** 標高タイルのパス（src/dem/demSources.ts の PATHS と同じ 5 種） */
export const DEM_PATH = /^\/xyz\/(dem1a_png|dem5a_png|dem5b_png|dem5c_png|dem_png)\/\d+\/\d+\/\d+\.png$/

export const sha256 = (body: Buffer): string => createHash('sha256').update(body).digest('hex')

export function readManifest(): DemManifest {
  return existsSync(manifestUrl) ? (JSON.parse(readFileSync(manifestUrl, 'utf8')) as DemManifest) : {}
}

/** パスの順に並べて書く（差分を読みやすくする） */
export function writeManifest(manifest: DemManifest): void {
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)),
  )
  writeFileSync(manifestUrl, `${JSON.stringify(sorted, null, 2)}\n`)
}

export function demModeFromEnv(value: string | undefined): DemMode {
  if (value === undefined || value === '' || value === 'replay') return 'replay'
  if (value === 'record' || value === 'live') return value
  throw new Error(`RAINTRACE_DEM は record・replay・live のどれか: ${value}`)
}

export interface DemRouteCounts {
  fixture: number
  recorded: number
  passthrough: number
  missing: number
}

export async function routeDem(
  context: BrowserContext,
  mode: DemMode,
  manifest: DemManifest,
): Promise<DemRouteCounts> {
  const counts: DemRouteCounts = { fixture: 0, recorded: 0, passthrough: 0, missing: 0 }
  if (mode === 'live') return counts
  await context.route(GSI_TILE_URL, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (!DEM_PATH.test(path)) return route.fallback()
    if (mode === 'record') {
      const response = await route.fetch()
      const body = await response.body()
      if (response.status() === 404) {
        manifest[path] = { status: 404 }
      } else if (response.ok()) {
        const hash = sha256(body)
        mkdirSync(cacheDir, { recursive: true })
        writeFileSync(new URL(`${hash}.png`, cacheDir), body)
        manifest[path] = { status: 200, sha256: hash, bytes: body.length }
      }
      counts.recorded++
      return route.fulfill({ response, body })
    }
    const entry = manifest[path]
    if (entry === undefined) {
      counts.passthrough++
      return route.fallback()
    }
    if (entry.status === 404) {
      counts.fixture++
      return fulfillNotFound(route)
    }
    const file = new URL(`${entry.sha256}.png`, cacheDir)
    const body = existsSync(file) ? readFileSync(file) : null
    if (body === null || sha256(body) !== entry.sha256) {
      counts.missing++
      return route.abort()
    }
    counts.fixture++
    return fulfillPng(route, body)
  })
  return counts
}
```

- [ ] **Step 4: `steps.perf.ts` を書く**

`tests/perf/steps.perf.ts`:

```ts
/**
 * 1 step の所要時間と平衡までの時間（spec 06 §4.1・§4.2・§5、計画で決めたこと 3〜5）。pnpm build:perf の後に回す。
 *
 * 最初に 1 回だけ DEM を記録する（地理院に接続する）:
 *   RAINTRACE_DEM=record pnpm perf:fps tests/perf/steps.perf.ts -g 記録
 * 平衡（2D、既定。3 地点 × 500・1000 m × 3 つの雨、各 300 秒まで）:
 *   pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間
 * 3D ありの窓（60 秒）:
 *   RAINTRACE_STEPS_MODE=3d pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間
 *
 * 環境変数: RAINTRACE_STEPS_SITES（ayase,shibuya,minatomirai）・RAINTRACE_STEPS_SIZES（500,1000）・
 * RAINTRACE_STEPS_RAINS（r10,r100,full）・RAINTRACE_STEPS_MODE（2d|3d）・RAINTRACE_STEPS_UNTIL（settle|window。
 * 既定は 2d なら settle、3d なら window）・RAINTRACE_STEPS_CAP_MS（300000）・RAINTRACE_STEPS_WINDOW_MS（60000）・
 * RAINTRACE_STEPS_OUT_DIR（.handoff/06-perf）・RAINTRACE_DEM（replay|record|live）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { StepsReport } from '../../src/ui/perfReports'
import {
  type DemRouteCounts,
  demModeFromEnv,
  readManifest,
  routeDem,
  writeManifest,
} from './demFixtures'
import {
  assertPerfBuild,
  listFromEnv,
  outDirFromEnv,
  query,
  readReport,
  SITES,
  type SiteName,
  sitesFromEnv,
  withFreshPage,
} from './support'

const SIZES = ['500', '1000'] as const
type Size = (typeof SIZES)[number]
/** 降雨（計画で決めたこと 3）。full は半径を範囲の半分（R04-6 の上限）にして、外接矩形を範囲全体にする */
const RAINS = {
  r10: { label: '半径 10 m・100 mm', mm: '100', radius: (_size: Size): string => '10' },
  r100: { label: '半径 100 m・100 mm', mm: '100', radius: (_size: Size): string => '100' },
  full: {
    label: '全面を濡らす雨（半径 = 範囲の半分・100 mm）',
    mm: '100',
    radius: (size: Size): string => String(Number(size) / 2),
  },
} as const
type RainName = keyof typeof RAINS
const RAIN_NAMES = Object.keys(RAINS) as RainName[]
const ALL_SITES = Object.keys(SITES) as SiteName[]

const mode = process.env.RAINTRACE_STEPS_MODE === '3d' ? '3d' : '2d'
const until = listFromEnv(
  process.env.RAINTRACE_STEPS_UNTIL,
  ['settle', 'window'] as const,
  [mode === '2d' ? 'settle' : 'window'],
)[0] ?? (mode === '2d' ? 'settle' : 'window')
const capMs = Number(process.env.RAINTRACE_STEPS_CAP_MS ?? '300000')
const windowMs = Number(process.env.RAINTRACE_STEPS_WINDOW_MS ?? '60000')
const outDir = outDirFromEnv(process.env.RAINTRACE_STEPS_OUT_DIR, '.handoff/06-perf')
/** 読み込み・3D の準備・止まっている間の再描画の数え・報告の書き出しの余裕 */
const OVERHEAD_MS = 180_000

interface Row {
  site: SiteName
  size: Size
  rain: RainName
  dem: DemRouteCounts
  report: StepsReport
}

const fixed = (value: number | null, digits: number): string =>
  value === null ? '—' : value.toFixed(digits)

function formatTable(rows: readonly Row[]): string {
  const lines = [
    `mode=${mode}・until=${until}（cap ${capMs / 1000} 秒・窓 ${windowMs / 1000} 秒）。1 step の値は 1 秒ごとの直近 300 step の要約の、中央値の中央値と p95 の 95 パーセンタイル（計画で決めたこと 2）`,
    '',
    '| 地点 | 範囲 | 雨 | 3D | 平衡 | step | 所要 (s) | 1x 換算 (分) | step／秒 | 1 step 中央値 (ms) | 1 step p95 (ms) | 1 step 最大 (ms) | 長いタスク（数・最大 ms） | 止まっている間の render（2 秒） | 質量誤差 (m³) | DEM（固定・素通し・欠け） |',
    '|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|',
  ]
  for (const { site, size, rain, dem, report: r } of rows) {
    lines.push(
      `| ${SITES[site].label} | ${size} m | ${RAINS[rain].label} | ${r.view3d} | ${r.settled ? '平衡' : '届かず'} | ${r.steps} | ${(r.elapsedMs / 1000).toFixed(1)} | ${r.minutesAt1x.toFixed(1)} | ${r.stepsPerSecond.toFixed(0)} | ${fixed(r.stepTimes.medianMs, 2)} | ${fixed(r.stepTimes.p95Ms, 2)} | ${fixed(r.stepTimes.maxMs, 2)} | ${r.longTasks.supported ? `${r.longTasks.count}・${r.longTasks.maxMs.toFixed(0)}` : '未対応'} | ${r.idleRenders} | ${fixed(r.final?.massError ?? null, 6)} | ${dem.fixture}・${dem.passthrough}・${dem.missing} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

test('1 step の所要時間と平衡までの時間（spec 06 §4.2）', async ({ browser }, testInfo) => {
  test.skip(process.env.RAINTRACE_DEM === 'record', 'DEM の記録のときは回さない')
  assertPerfBuild()
  const demMode = demModeFromEnv(process.env.RAINTRACE_DEM)
  const manifest = readManifest()
  if (demMode === 'replay' && Object.keys(manifest).length === 0) {
    throw new Error(
      'tests/perf/fixtures/dem-manifest.json がありません。RAINTRACE_DEM=record で先に記録する',
    )
  }
  const sites = sitesFromEnv(process.env.RAINTRACE_STEPS_SITES, ALL_SITES)
  const sizes = listFromEnv(process.env.RAINTRACE_STEPS_SIZES, SIZES, SIZES)
  const rains = listFromEnv(process.env.RAINTRACE_STEPS_RAINS, RAIN_NAMES, RAIN_NAMES)
  const perRunMs = (until === 'settle' ? capMs : windowMs) + OVERHEAD_MS
  test.setTimeout(sites.length * sizes.length * rains.length * perRunMs)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const rows: Row[] = []
  for (const site of sites) {
    for (const size of sizes) {
      for (const rain of rains) {
        const url = query({
          lat: SITES[site].lat,
          lon: SITES[site].lon,
          size,
          mm: RAINS[rain].mm,
          r: RAINS[rain].radius(size),
          probe: 'steps',
          mode,
          until,
          cap: String(capMs),
          ms: String(windowMs),
          fallback: '0',
        })
        const holder: { dem: DemRouteCounts | null } = { dem: null }
        const report = await withFreshPage(
          browser,
          baseURL,
          async (page) => {
            await page.goto(url)
            return readReport<StepsReport>(page, 'data-steps-result', perRunMs)
          },
          async (context) => {
            holder.dem = await routeDem(context, demMode, manifest)
          },
        )
        const dem = holder.dem ?? { fixture: 0, recorded: 0, passthrough: 0, missing: 0 }
        if (demMode === 'replay') {
          // 固定の DEM が欠けていれば、同じ DEM で回したことにならない
          expect(dem.missing).toBe(0)
          // 2D の読み込みはすべて固定のタイルで賄う（素通しは 3D の範囲の外のタイルだけ）
          if (mode === '2d') expect(dem.passthrough).toBe(0)
        }
        // 雨の半径が URL のとおり（範囲の半分の上限で丸められていない）
        expect(report.rain.radiusM).toBe(Number(RAINS[rain].radius(size)))
        rows.push({ site, size, rain, dem, report })
      }
    }
  }
  mkdirSync(outDir, { recursive: true })
  const name = `steps-${mode}-${until}`
  writeFileSync(new URL(`${name}.json`, outDir), `${JSON.stringify(rows, null, 2)}\n`)
  const table = formatTable(rows)
  writeFileSync(new URL(`${name}.md`, outDir), table)
  console.log(table)
})

test('DEM のフィクスチャを記録する（RAINTRACE_DEM=record。計画で決めたこと 5）', async ({
  browser,
}, testInfo) => {
  test.skip(process.env.RAINTRACE_DEM !== 'record', 'RAINTRACE_DEM=record のときだけ回す')
  const sites = sitesFromEnv(process.env.RAINTRACE_STEPS_SITES, ALL_SITES)
  test.setTimeout(sites.length * SIZES.length * 180_000)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const manifest = readManifest()
  for (const site of sites) {
    for (const size of SIZES) {
      await withFreshPage(
        browser,
        baseURL,
        async (page) => {
          await page.goto(query({ lat: SITES[site].lat, lon: SITES[site].lon, size }))
          await expect(page.locator('[data-range-shown="true"]')).toBeAttached({
            timeout: 120_000,
          })
        },
        async (context) => {
          await routeDem(context, 'record', manifest)
        },
      )
    }
  }
  writeManifest(manifest)
  const entries = Object.values(manifest)
  const bytes = entries.reduce((sum, e) => sum + (e.status === 200 ? e.bytes : 0), 0)
  console.log(
    `manifest: ${entries.length} 件（200: ${entries.filter((e) => e.status === 200).length}、404: ${entries.filter((e) => e.status === 404).length}）、本体 ${(bytes / 1e6).toFixed(2)} MB`,
  )
})
```

- [ ] **Step 5: `fps.perf.ts` を置き換える**

`tests/perf/fps.perf.ts` を次に置き換える（05 の表の注意の段落は `NOTES` に移し、文字列は変えない）:

```ts
/**
 * fps の測り直し（spec 05 §4.4、spec 06 §4.1・§5・§5.1）と、クリックから表示まで（spec 06 §3・§5）。
 *
 * fallback=0: (c) の 2D への切り替えを止めて測る。z16 ×10 p85 は、pitch つきの見込みでは画面の中心のタイルが
 * 14 だが、実測は 16（05 の Task 6・9: pitch 78.6037°・zoom 15.9768 に落ち着く）。3D の間の (c) の判定は実測で
 * 行うので、この視点は 2D に落ちない。fallback=0 は、計測の途中で実測が境界を割って 2D に落ちることが
 * 絶対に起きないようにする保険である
 *
 * 環境変数: RAINTRACE_FPS_SET（terrain-main・terrain-tiles・water・isolate）・RAINTRACE_FPS_REPEAT（既定 3）・
 * RAINTRACE_FPS_SITES（既定 shibuya。06 の M2 は ayase,shibuya,minatomirai）・RAINTRACE_FPS_OUT_DIR
 * （既定 .handoff/05-fps）・RAINTRACE_LOAD=1（クリックから表示まで）・RAINTRACE_DRAWN_ZOOM=1
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { FpsResult } from '../../src/map/fpsProbe'
import { drawnTileZoomForView } from '../../src/map/view3d/drawnZoom'
import type { LongTaskSummary, StepTimeSummary } from '../../src/ui/perfCollectors'
import type { LoadReport } from '../../src/ui/perfReports'
import {
  assertPerfBuild,
  median,
  outDirFromEnv,
  query,
  readReport,
  SITES,
  type SiteName,
  sitesFromEnv,
  withFreshPage,
} from './support'

interface Variant {
  label: string
  hillshade?: string
  water: '0' | '1'
  /** URL に足す項目（depthEvery・pause・arrows。spec 06 §5.1） */
  extra?: Record<string, string>
}

/** 実際に置けた視点（要求どおりとは限らない。地形がカメラを持ち上げる） */
interface Achieved {
  mapZoom: number
  mapPitch: number
}

interface Report {
  /** 測った視点（フックが入れる。URL と照合する）。mapZoom・mapPitch は計測の後に読んだ値 */
  view3d: string
  mapZoom: number
  mapPitch: number
  /** タイルが揃ってからの 2 回目の jumpTo の直後（落ち着かせる前） */
  achievedBeforeSettle: Achieved
  /** 計測の窓を閉じた後。achievedBeforeSettle と一致すれば、窓の間ずっとこの視点だったと言える */
  achievedAfterRun: Achieved
  prepareMs: number[]
  waterBuildMs: number[]
  tiles: { loaded: boolean; waitMs: number }
  result: FpsResult
  /** 計測の窓の長いタスク（spec 06 §3） */
  longTasks: LongTaskSummary
  /** 計測の窓の 1 step の所要時間（水面ありのときだけ値がある） */
  stepTimes: StepTimeSummary
}

interface Row extends Report {
  site: SiteName
  variant: string
  size: string
  view: string
  /** URL で要求した視点。実測（mapZoom・mapPitch）と並べて、表にも JSON にも残す（コントローラーの裁定） */
  requested: { z: number; pitch: number }
  /** 同じ条件の何回目か（1 から） */
  run: number
}

// S と同じ 2 つの視点（spec 05 §4.4）
const VIEWS = [
  { name: 'z17 ×5 p60', z: '17', ex: '5', pitch: '60' },
  { name: 'z16 ×10 p85', z: '16', ex: '10', pitch: '85' },
] as const
type ViewName = (typeof VIEWS)[number]['name']
const SIZES = ['500', '1000'] as const
type Size = (typeof SIZES)[number]

interface SetDef {
  variants: readonly Variant[]
  /** 省けば SIZES と VIEWS のすべて */
  sizes?: readonly Size[]
  views?: readonly ViewName[]
}

/** 地形のみの 2 変種（05 の Task 5）。地形の生成場所は main のみ（05 の Task 6 で Worker を採らなかった） */
const TERRAIN_MAIN_ONLY: readonly Variant[] = [
  { label: 'main・hillshade あり・地形のみ', hillshade: 'on', water: '0' },
  { label: 'main・hillshade なし・地形のみ', hillshade: 'off', water: '0' },
]

/**
 * 計測の組（RAINTRACE_FPS_SET で選ぶ）。water の組は 05 の Task 9、isolate は 06 の §5.1。
 * terrain-main（05 の Task 5）・terrain-tiles（05 の Task 6）は同じ中身（既存の記録が両方の名を使うため）
 */
const SETS: Record<string, SetDef> = {
  'terrain-main': { variants: TERRAIN_MAIN_ONLY },
  'terrain-tiles': { variants: TERRAIN_MAIN_ONLY },
  water: {
    variants: [
      { label: '既定・地形のみ', water: '0' },
      { label: '既定・水面あり（最速で降雨、水深を毎フレーム更新）', water: '1' },
    ],
  },
  // 51 fps の切り分け（spec 06 §5.1）。05 と同じ 1000 m・z16 ×10 p85 だけ
  isolate: {
    sizes: ['1000'],
    views: ['z16 ×10 p85'],
    variants: [
      { label: '地形のみ（water=0）', water: '0' },
      { label: '水面あり・depthEvery=1', water: '1' },
      { label: '水面あり・depthEvery=2', water: '1', extra: { depthEvery: '2' } },
      { label: '水面あり・depthEvery=4', water: '1', extra: { depthEvery: '4' } },
      { label: '水面あり・止めた水面（pause=1）', water: '1', extra: { pause: '1' } },
      { label: '水面あり・矢印なし（arrows=0）', water: '1', extra: { arrows: '0' } },
    ],
  },
}

const DEFAULT_SET = 'terrain-main'
const setName = process.env.RAINTRACE_FPS_SET ?? DEFAULT_SET
/** 同じ条件を測る回数。判定はセルごとの中央値で行う */
const repeat = Number(process.env.RAINTRACE_FPS_REPEAT ?? '3')
/** 1 回の計測を待つ上限 */
const RUN_TIMEOUT_MS = 240_000
const outDir = outDirFromEnv(process.env.RAINTRACE_FPS_OUT_DIR, '.handoff/05-fps')
const sites = sitesFromEnv(process.env.RAINTRACE_FPS_SITES, ['shibuya'])

const tileCell = (t: FpsResult['tileGen']['terrain']): string =>
  `${t.count}・${t.cached}・${t.meanMs.toFixed(1)}・${t.maxMs.toFixed(1)}`

/** 05 の表の注意（置き換える前の formatTable の文字列のまま。Task 6 は 1 文字も変えない） */
const NOTES: readonly string[] = [
  '',
  '注意 1（「実測 pitch」「実測 zoom」の読み方）: この 2 列は、計測の窓を閉じた後に 1 回だけ読んだ値である。',
  'runFpsProbe は rAF の loop を抜けて map.jumpTo({ center, bearing }) で中心と bearing を戻し、その後に',
  'perfHook が getZoom()・getPitch() を読む。10 秒の計測の間ずっとこの角度だった、という意味ではない。',
  '',
  '注意 2（垂直強調 ×10 では pitch 85° に届かない）: MapLibre の _elevateCameraIfInsideTerrain',
  '（maplibre-gl-dev.mjs の 22431〜22443 行）が、カメラが持ち上がった地形の中に入るときカメラをその地形の',
  '高さまで持ち上げ、calculateCameraOptionsFromTo で pitch とズームを作り直す（transform の更新ごとの修飾。',
  '同 22454 行あたり）。渋谷の 8.8〜33 m は ×10 で 88〜330 m になり、z16・p85 でのカメラの高さを超える。',
  'つまり要求どおりの 85° には届かず、実測は 78.6° 付近に落ち着く。要求どおりの 85° になるのは垂直強調 ×1 の',
  'とき、pitch 0 は常に要求どおりになる（いずれも実測で確認）。加えて（Task 6 で入れた直しにより）タイルが',
  '揃った後に同じ jumpTo をもう一度発行してから計測しているので、到達する視点は条件・ラン共通で同一になる',
  '（下の表の z16 ×10 p85 の 12 行はすべて 78.6037°・幅 0.0000）。Task 5 の 1 回目の jumpTo（タイルが読める',
  '前）では、同じ「z16 ×10 p85」を要求した 4 セルで実測が 78.60° と 82.96° に割れたが、それはこの直しの',
  '前の挙動であり、今のデータには当てはまらない。',
  '',
  '注意 3（render CPU の列）: onRenderTime を呼ぶのは水面の Custom Layer で、呼び出し元は Task 8 で入った',
  '（Task 9 の実測は条件ごとの中央値で 0.149〜0.416 ms。ランごとの値は 0.137〜0.463 ms）。水面を描いていない条件ではこの列は「未計測」であって、0 ms という意味ではない。',
  '',
  '注意 4（タイルの待ちが短い理由）: 視点を置く前に data-view3d-framed（3D の視点へ動き終えたこと）を',
  '待っているので、areTilesLoaded() は 0.12〜0.51 秒で真になる。実際に落ち着かせている時間は、その後の',
  '3 秒と合わせて約 3.1〜3.5 秒で、S の固定 3 秒とほぼ同じ。areTilesLoaded() だけを根拠にしない。',
  '',
  '推定（未検証。事実としては扱わない）: S も同じ渋谷の地形に対し、同じ MapLibre 6.6.0 で同じ',
  'map.jumpTo({ zoom, pitch }) を使っており、実測の pitch・zoom を記録していなかった。したがって S の',
  '「z16 ×10 p85」も、おそらく 85° 未満で測られている。そうであれば比較は実質的に同じ条件どうしで、',
  'S の側でそれが記録されていなかっただけ、ということになる。',
  '',
  '合否（平均 57 fps 以上・長いフレーム 1% 以下）は、要求した視点を MapLibre が落ち着かせた先に対して',
  '判定する。それが利用者が実際に到達できる、いちばん厳しい視点だからである。',
]

function formatTable(rows: readonly Row[]): string {
  const lines = [
    `描画: ${rows[0]?.result.renderer ?? '不明'}（実 GPU・headless。rAF は 60Hz に刻まれるので 60 fps が上限。RAINTRACE_UNCAPPED=1 のときは外した起動）`,
    `GPU のタイマー（EXT_disjoint_timer_query_webgl2）: ${rows[0]?.result.gpuTimerQuery === true ? '使える' : '使えない'}`,
    '',
    'タイルの列は「組み立てた数・使い回した数・組み立ての平均・最大（ms）」。',
    '',
    '| 地点 | 条件 | 範囲 | 視点 | 要求 pitch | 実測 pitch | 要求 zoom | 実測 zoom | 平均 fps | 中央値 (ms) | 長いフレーム | ヒストグラム g1/g2/g3/g4/g5+ | render CPU 平均 (ms) | 地形のタイル | hillshade のタイル | 描かれるタイル | タイルの待ち (s) | 準備 (ms) | 水面の作成 (ms) | 長いタスク（数・最大 ms） | 1 step 中央値 (ms) | pass |',
    '|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|---|---|---:|---|---|---|---|---:|---|',
  ]
  for (const row of rows) {
    const { site, variant, run, size, view, requested, mapPitch, mapZoom, prepareMs } = row
    const { waterBuildMs, tiles, longTasks, stepTimes, result: r } = row
    const h = r.gapHistogram
    const wait = `${(tiles.waitMs / 1000).toFixed(1)}${tiles.loaded ? '' : '（揃わず）'}`
    lines.push(
      `| ${SITES[site].label} | ${variant} #${run} | ${size} m | ${view} | ${requested.pitch} | ${mapPitch.toFixed(1)} | ${requested.z} | ${mapZoom.toFixed(3)} | ${r.meanFps.toFixed(1)} | ${r.p50Ms.toFixed(1)} | ${r.longFrames}/${r.frames}（${(r.longFrameRatio * 100).toFixed(1)}%） | ${h.g1}/${h.g2}/${h.g3}/${h.g4}/${h.g5plus} | ${r.renderFrames === 0 || r.renderCpuMeanMs === null ? '未計測' : r.renderCpuMeanMs.toFixed(2)} | ${tileCell(r.tileGen.terrain)} | ${tileCell(r.tileGen.hillshade)} | ${r.drawnTileZoom} | ${wait} | ${prepareMs.map((ms) => ms.toFixed(0)).join('・')} | ${waterBuildMs.map((ms) => ms.toFixed(0)).join('・')} | ${longTasks.supported ? `${longTasks.count}・${longTasks.maxMs.toFixed(0)}` : '未対応'} | ${stepTimes.medianMs === null ? '—' : stepTimes.medianMs.toFixed(2)} | ${r.pass} |`,
    )
  }
  const warnings = comparabilityWarnings(rows)
  if (warnings.length > 0) {
    lines.push('', '**条件の比較に使えない組**（同じセルなのに実測の視点がそろっていない）:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  lines.push(...NOTES)
  return `${lines.join('\n')}\n`
}

/**
 * 同じセル（地点・範囲・視点）の中で、実測の視点がそろっていない組を探す。地形があると要求どおりの pitch に
 * ならず、しかもその角度は固定でない。実測の視点が違う行どうしを「条件の差」として読むと結論を取り違えるので、
 * 表の中で名指しする
 */
function comparabilityWarnings(rows: readonly Row[]): string[] {
  const cells = new Map<string, Row[]>()
  for (const row of rows) {
    const key = `${SITES[row.site].label}・${row.size} m・${row.view}`
    cells.set(key, [...(cells.get(key) ?? []), row])
  }
  const warnings: string[] = []
  for (const [key, runs] of cells) {
    const pitches = runs.map((r) => r.mapPitch)
    const drawn = [...new Set(runs.map((r) => r.result.drawnTileZoom))]
    if (Math.max(...pitches) - Math.min(...pitches) <= 0.5 && drawn.length <= 1) continue
    warnings.push(
      `${key}: 実測 pitch が ${pitches.map((p) => p.toFixed(2)).join(' / ')}、描かれるタイルが ${drawn.join(' / ')} とそろっていない。` +
        'この組は条件の比較には使えない。視点そのものが違う',
    )
  }
  return warnings
}

/** セル（地点・条件・範囲・視点）ごとの、ランの中央値と幅。判定はこの表で行う */
function formatSummary(rows: readonly Row[]): string {
  const cells = new Map<string, Row[]>()
  for (const row of rows) {
    const key = `${row.site}|${row.variant}|${row.size}|${row.view}`
    cells.set(key, [...(cells.get(key) ?? []), row])
  }
  const spread = (values: number[], digits: number): string =>
    `${median(values).toFixed(digits)}（${Math.min(...values).toFixed(digits)}〜${Math.max(...values).toFixed(digits)}）`
  const lines = [
    `セルごとの ${repeat} 回の中央値（括弧は最小〜最大）。組み立ての最大は地形と hillshade の大きい方。D15 = 平均 57 fps 以上かつ長いフレーム 1% 以下`,
    '',
    '| 地点 | 条件 | 範囲 | 視点 | 平均 fps | 長いフレーム | g2 | 長いタスクの最大 (ms) | 組み立ての最大 (ms) | 組み立てた数（地形・hillshade） |',
    '|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const runs of cells.values()) {
    const first = runs[0]
    if (first === undefined) continue
    const results = runs.map((r) => r.result)
    const fps = results.map((r) => r.meanFps)
    const long = results.map((r) => r.longFrames)
    const g2 = results.map((r) => r.gapHistogram.g2)
    const tasks = runs.map((r) => r.longTasks.maxMs)
    const build = results.map((r) => Math.max(r.tileGen.terrain.maxMs, r.tileGen.hillshade.maxMs))
    const terrainCount = median(results.map((r) => r.tileGen.terrain.count))
    const hillshadeCount = median(results.map((r) => r.tileGen.hillshade.count))
    lines.push(
      `| ${SITES[first.site].label} | ${first.variant} | ${first.size} m | ${first.view} | ${spread(fps, 1)} | ${spread(long, 0)} | ${spread(g2, 0)} | ${spread(tasks, 0)} | ${spread(build, 1)} | ${terrainCount}・${hillshadeCount} |`,
    )
  }
  return `${lines.join('\n')}\n`
}

test(`fps の測り直し（${setName}）`, async ({ browser }, testInfo) => {
  test.skip(
    process.env.RAINTRACE_LOAD === '1' || process.env.RAINTRACE_DRAWN_ZOOM === '1',
    '別のテストを回すとき',
  )
  assertPerfBuild()
  const set = SETS[setName]
  if (set === undefined) throw new Error(`計測の組がありません: ${setName}`)
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`RAINTRACE_FPS_REPEAT は 1 以上の整数: ${process.env.RAINTRACE_FPS_REPEAT}`)
  }
  const sizes = set.sizes ?? SIZES
  const views = VIEWS.filter((v) => set.views === undefined || set.views.includes(v.name))
  // 1 回の上限 × 回数（config の 90 分は、多い組の最悪に足りない）
  test.setTimeout(
    sites.length * set.variants.length * sizes.length * views.length * repeat * RUN_TIMEOUT_MS,
  )
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const rows: Row[] = []
  let turn = 0
  for (let run = 1; run <= repeat; run++) {
    for (const site of sites) {
      for (const size of sizes) {
        for (const view of views) {
          // 条件の順を 1 回ごと・ランごとに入れ替える（時間とともに変わる条件の偏りを減らす）
          const order = (turn++ + run) % 2 === 0 ? set.variants : [...set.variants].reverse()
          for (const variant of order) {
            const url = query({
              lat: SITES[site].lat,
              lon: SITES[site].lon,
              size,
              probe: 'fps',
              z: view.z,
              ex: view.ex,
              pitch: view.pitch,
              water: variant.water,
              hillshade: variant.hillshade,
              fallback: '0',
              ...variant.extra,
            })
            const report = await withFreshPage(browser, baseURL, async (page) => {
              await page.goto(url)
              return readReport<Report>(page, 'data-fps-result', RUN_TIMEOUT_MS)
            })
            // 3D のまま（(c) で 2D に落ちていない。フックも data-perf-error にする）
            expect(report.view3d).toBe('3d')
            // 視点は厳密な一致ではなく「幅」で照合する（05 のコントローラーの裁定）。地形があると MapLibre は
            // カメラを地形の上に保つので、pitch は要求より下がる。この照合は「フックが pitch を無視した」ような
            // 取り違えを捕まえるためのもので、角度そのものの検証ではない
            const requestedPitch = Number(view.pitch)
            expect(report.mapPitch).toBeLessThanOrEqual(requestedPitch + 0.05)
            expect(report.mapPitch).toBeGreaterThanOrEqual(requestedPitch - 10.0)
            expect(Math.abs(report.mapZoom - Number(view.z))).toBeLessThanOrEqual(0.05)
            rows.push({
              site,
              variant: variant.label,
              size,
              view: view.name,
              run,
              requested: { z: Number(view.z), pitch: requestedPitch },
              ...report,
            })
          }
        }
      }
    }
  }
  mkdirSync(outDir, { recursive: true })
  // JSON は全ラン（生のフレームの間隔 deltas を含む）を残す
  writeFileSync(new URL(`${setName}.json`, outDir), `${JSON.stringify(rows, null, 2)}\n`)
  const table = `${formatSummary(rows)}\n${formatTable(rows)}`
  writeFileSync(new URL(`${setName}.md`, outDir), table)
  console.log(table)
})

test('クリックから 2D の地形の表示まで・3D を押してから最初の 3D のフレームまで（spec 06 §3・§5）', async ({
  browser,
}, testInfo) => {
  test.skip(process.env.RAINTRACE_LOAD !== '1', 'RAINTRACE_LOAD=1 のときだけ回す')
  assertPerfBuild()
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('RAINTRACE_FPS_REPEAT は 1 以上の整数')
  test.setTimeout(sites.length * SIZES.length * repeat * RUN_TIMEOUT_MS)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const rows: { site: SiteName; size: Size; run: number; report: LoadReport }[] = []
  for (let run = 1; run <= repeat; run++) {
    for (const site of sites) {
      for (const size of SIZES) {
        // lat・lon を付けない（起動時に地点を選ばせない）。at= の地点をフックが選ぶ（計画で決めたこと 9）
        const url = query({
          size,
          probe: 'load',
          at: `${SITES[site].lat},${SITES[site].lon}`,
          mode: '3d',
          fallback: '0',
        })
        const report = await withFreshPage(browser, baseURL, async (page) => {
          await page.goto(url)
          return readReport<LoadReport>(page, 'data-load-result', RUN_TIMEOUT_MS)
        })
        expect(report.to3d).not.toBeNull()
        rows.push({ site, size, run, report })
      }
    }
  }
  const seconds = (ms: number | null | undefined): string =>
    ms === null || ms === undefined ? '—' : (ms / 1000).toFixed(2)
  const lines = [
    '地理院に実際に接続し、毎回新しい context（HTTP の cache が空）。「最初の 3D のフレーム」はタイルが揃って 2 フレーム描いた時刻',
    '',
    '| 地点 | 範囲 | # | 選んでから ready (s) | 2D の表示 (s) | 3D の状態 (s) | 水面 (s) | 最初の 3D のフレーム (s) | タイル | 長いタスク 読み込み（数・最大 ms） | 長いタスク 3D（数・最大 ms） | 準備 (ms) | 水面の作成 (ms) |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|---|---|---|---|',
  ]
  for (const { site, size, run, report: r } of rows) {
    const t = r.to3d
    const load = r.longTasks.load
    const to3d = r.longTasks.to3d
    lines.push(
      `| ${SITES[site].label} | ${size} m | ${run} | ${seconds(r.selectToReadyMs)} | ${seconds(r.selectTo2dMs)} | ${seconds(t?.statusMs)} | ${seconds(t?.waterBuiltMs)} | ${seconds(t?.firstFrameMs)} | ${t?.tilesLoaded === false ? '揃わず' : '揃った'} | ${load.count}・${load.maxMs.toFixed(0)} | ${to3d === null ? '—' : `${to3d.count}・${to3d.maxMs.toFixed(0)}`} | ${r.prepareMs.map((ms) => ms.toFixed(0)).join('・')} | ${r.waterBuildMs.map((ms) => ms.toFixed(0)).join('・')} |`,
    )
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL('load.json', outDir), `${JSON.stringify(rows, null, 2)}\n`)
  writeFileSync(new URL('load.md', outDir), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
})

test('描かれる地形タイルのズームの実測と、pitch つきの見込み（05 の計画で決めたこと 3）', async ({
  browser,
}, testInfo) => {
  test.skip(process.env.RAINTRACE_DRAWN_ZOOM !== '1', 'RAINTRACE_DRAWN_ZOOM=1 のときだけ回す')
  assertPerfBuild()
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const lines = ['| 地図のズーム | pitch | 見込み | 実測 |', '|---:|---:|---:|---:|']
  for (const z of [15.5, 16, 16.5, 17]) {
    for (const pitch of [0, 60, 85]) {
      const url = query({
        lat: SITES.shibuya.lat,
        lon: SITES.shibuya.lon,
        size: '500',
        probe: 'view',
        z: String(z),
        pitch: String(pitch),
        water: '0',
        fallback: '0',
      })
      const drawn = await withFreshPage(browser, baseURL, async (page) => {
        await page.goto(url)
        await expect(page.locator('html[data-perf-ready="true"]')).toBeAttached({
          timeout: 240_000,
        })
        return page.locator('[data-map-loaded="true"]').getAttribute('data-drawn-tile-zoom')
      })
      lines.push(`| ${z} | ${pitch} | ${drawnTileZoomForView(z, pitch)} | ${drawn ?? ''} |`)
    }
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL('drawn-zoom.md', outDir), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
})
```

`NOTES` の文字列は、置き換える前の `formatTable` の `lines.push(` の引数と同じ（計画の作成時に 88112cc のファイルから写した）。置き換えの後に `git diff tests/perf/fps.perf.ts` で、`注意` の段落の文字列の行に `-`／`+` の対が無い（字下げの違いだけ）ことを確かめる。

- [ ] **Step 6: 起動の引数・gitignore・README**

`playwright.perf.config.ts` の `const port = 4175` の後に足す:

```ts
// RAINTRACE_UNCAPPED=1: vsync と rAF の 60Hz の上限を外す起動の引数を足す（spec 06 §4.2・§5.1。ANGLE の gl-egl で
// 効くか〈60.0 fps を超えるか〉は M3 で確かめる。計画で決めたこと 12）
const uncapped =
  process.env.RAINTRACE_UNCAPPED === '1' ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []
```

`args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl'],` を `args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl-egl', ...uncapped],` にする。

`.gitignore` の `.handoff/` の後に足す:

```
# 計測の固定の DEM の本体（tests/perf/fixtures/dem-manifest.json の SHA-256 で固定する。spec 06 §4.1）
.cache/
```

`tests/perf/fixtures/README.md`:

````markdown
# 計測の固定の DEM（spec 06 §4.1）

CPU で決まる計測（1 step の所要時間・平衡までの時間。`tests/perf/steps.perf.ts`）は、毎回同じ DEM で回す。

- 出典: 国土地理院「地理院タイル」標高タイル（DEM1A・DEM5A〜C・DEM10B）。地図・標高データ：国土地理院（出典の明示で利用できる）
- 地点: 足立区 綾瀬駅付近（35.762300, 139.824600）、渋谷駅付近（35.658000, 139.701600）、横浜 みなとみらい（35.457500, 139.632000）。範囲 500 m・1000 m（R06-1、R02-7）
- `dem-manifest.json`: URL のパスごとに、200 なら本体の SHA-256 と大きさ、404 ならその旨。**コミットする**
- 本体: `.cache/perf-dem/<SHA-256>.png`（gitignore。全部で数 MB あり、リポジトリに置かない。計画で決めたこと 5）
- 取得日: manifest を記録したコミットの日付

## 記録する（地理院に接続する）

```sh
pnpm build:perf
RAINTRACE_DEM=record pnpm perf:fps tests/perf/steps.perf.ts -g 記録
pnpm build
```

manifest の差分が出たら、地理院のタイルが更新されたか、アプリの取得するタイルが変わった。どちらかを確かめてからコミットする。

## 使う

`RAINTRACE_DEM` を省く（replay）と、`steps.perf.ts` は manifest の本体を返す。本体が無い・SHA-256 が合わない要求は止め、表の「欠け」に数え、テストを失敗にする。manifest に無い DEM の要求（3D の範囲の外のタイル）は地理院にそのまま流し、「素通し」に数える（2D の計測では 0 でなければ失敗）。
````

- [ ] **Step 7: ゲートと E2E を通す**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（`tests/perf/` は `tsconfig.node.json` で型検査される）

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 41 件成功（`gsi.ts` の書き換えで E2E の DEM の差し替えは変わらない）

Run: `pnpm exec playwright test --config playwright.perf.config.ts --list`
Expected: `fps.perf.ts` の 3 件・`shots.perf.ts`・`steps.perf.ts` の 2 件が一覧に出る（実行はしない）

- [ ] **Step 8: コミットする**

```bash
git add tests/e2e/support/gsi.ts tests/perf/support.ts tests/perf/demFixtures.ts tests/perf/steps.perf.ts tests/perf/fps.perf.ts playwright.perf.config.ts .gitignore tests/perf/fixtures/README.md
git commit -m "計測の実行: 共有の道具、context.route で固定する DEM（SHA-256 の manifest）、steps.perf.ts、fps の 3 地点と切り分けの組（isolate）、クリックから表示までのテスト、vsync を外す引数（spec 06 §4.1・§4.2・§5.1）"
```

---

### Task 7: DEM を記録し、1 シナリオを試しに回し、通常のビルドに計測のコードが無いことを確かめ直す（M1 の完了。spec 06 §1.2）

**Files:**
- Create: `tests/perf/fixtures/dem-manifest.json`（記録で作る）
- Create: `.superpowers/sdd/2026-09-17-06-performance/m1-report.md`（gitignore。コミットしない）

**Interfaces:**
- Consumes: Task 2〜6 のすべて
- Produces: M2 の自動の計測が使う manifest と `.cache/perf-dem/`

- [ ] **Step 1: DEM を記録する（地理院に接続する）**

Run: `pnpm build:perf && RAINTRACE_DEM=record pnpm perf:fps tests/perf/steps.perf.ts -g 記録`
Expected:
- 1 件成功、コンソールのエラー 0 件
- `manifest: N 件（200: …、404: …）、本体 X MB` が出る。綾瀬・渋谷・みなとみらいは 04 の手動確認で DEM1A（段 1）だったので、DEM1A の 200 が大半で、みなとみらいは海の 404 と `dem_png`（z14）の海域判定が入る
- `tests/perf/fixtures/dem-manifest.json` と `.cache/perf-dem/*.png` ができる

本体が 20 MB を超えたら止めてコントローラーに知らせる（見込みの 3〜10 MB を大きく外れている）。

- [ ] **Step 2: 1 シナリオを試しに回す（固定の DEM・2D・平衡）**

Run: `RAINTRACE_STEPS_SITES=minatomirai RAINTRACE_STEPS_SIZES=500 RAINTRACE_STEPS_RAINS=r10 RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/dry-run pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected:
- 1 件成功
- `.handoff/06-perf/dry-run/steps-2d-settle.{json,md}` ができる
- 表の行: 平衡、step は **20,296**（04 の手動確認と同じ。エンジンは決定的で DEM が同じなら一致する。違えば DEM が 04 と違う〈地理院の更新〉可能性を報告に書く。止めなくてよい）、所要は数秒、1 step の中央値に数値が入る（`—` なら BroadcastChannel が届いていない。Task 2 の Step 14 の分岐を見直す）、長いタスクに数が入る（`未対応` でない）、DEM の「欠け」0・「素通し」0

- [ ] **Step 3: 1 シナリオを試しに回す（fps・切り分けの組の 1 変種・1 回）**

Run: `RAINTRACE_FPS_SET=isolate RAINTRACE_FPS_REPEAT=1 RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/dry-run pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し`
Expected:
- 1 件成功（6 変種 × 1 回。約 5 分）
- `isolate.md` の表の `描画` が GPU の名前（GeForce GTX 1080 Ti）。SwiftShader・不明なら止めて知らせる
- `GPU のタイマー` の行に「使える」か「使えない」が出る
- `pause=1` の行の `1 step 中央値` が `—`（止めているので新しい step が無い）、`depthEvery=1` の行には数値

- [ ] **Step 4: 1 シナリオを試しに回す（クリックから表示まで・1 地点・1 回）**

Run: `RAINTRACE_LOAD=1 RAINTRACE_FPS_REPEAT=1 RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/dry-run pnpm perf:fps tests/perf/fps.perf.ts -g クリック`
Expected: 1 件成功（渋谷 × 500・1000 m）。`load.md` の「2D の表示」は 04 の 0.78 秒前後（1000 m）、「最初の 3D のフレーム」に数値

- [ ] **Step 5: 通常のビルドに戻し、計測のコードが無いことを確かめ直す（M1 の完了条件）**

Run: `pnpm build && (grep -c perfHook build-info/manifest.json || true) && (grep -l raintrace-perf dist/assets/*.js || true) && (grep -l stepTimes dist/assets/*.js || true) && pnpm size`
Expected:
- `0`、何も出ない、何も出ない
- 初期ロード **427.5 KB**（M0 と同じ）。総量は 702.2 KB から ±0.3 KB 以内

- [ ] **Step 6: ゲートを通し、manifest をコミットする**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium`
Expected: すべて成功（E2E 41 件）

```bash
git add tests/perf/fixtures/dem-manifest.json
git commit -m "計測の固定の DEM の manifest（3 地点 × 500・1000 m、パスごとの SHA-256 と 404）を記録する（spec 06 §4.1。本体は .cache/perf-dem/）"
```

- [ ] **Step 7: M1 の報告を書き、マイルストーンの区切りに進む**

`.superpowers/sdd/2026-09-17-06-performance/m1-report.md` に、Task 1〜7 のコミット、Task 2 の Step 14 でどちらの形にしたか（`__RAINTRACE_PERF__` か `import.meta.env.MODE`）、manifest の件数と大きさ、試しの 3 つの表（`.handoff/06-perf/dry-run/*.md`）、Step 5 の数字、ユニットテストの件数、spec と違えたこと（計画で決めたこと 1〜14 のうち実装で変えたもの）を書く。「マイルストーンの区切り」の 2・3 に従う。

---

# M2: 計測と判定（平衡の行は暫定）

M2 の完了条件（spec 06 §1.2）: §5 のすべての行に判定がある（平衡の行は暫定）。直す項目（M4）と別の spec に回す項目を分けている。

### Task 8: 自動の計測（基準の機械、実 GPU の headless）を回し、`docs/perf/<実行日>.md` に記録する（spec 06 §4.1・§4.2）

**Files:**
- Create: `docs/perf/<実行日>.md`（例: `docs/perf/2026-09-18.md`）
- Create（gitignore）: `.handoff/06-perf/baseline/`（生の JSON と表）

**Interfaces:**
- Consumes: M1 のすべて（manifest と `.cache/perf-dem/` を含む）
- Produces: Task 10 の判定の材料（`docs/perf/<実行日>.md` の表）

計測は合わせて 3 時間ほどかかる。各コマンドはバックグラウンドで回し、終わりを待ってから次を回す（同時に回さない）。途中で失敗したら、そのコマンドだけを回し直す（`RAINTRACE_*_SITES` などで絞ってよい。絞ったら記録に書く）。**Step 3〜6 の各組の前と後に、Step 1 の `snap.sh` でマシンの状態を `machine.txt` に足す**（05 の 51.0 の確かめで、負荷の記録が無いと環境の説を否定できなかったため）。

- [ ] **Step 1: 機器の仕様を控え、マシンの状態を足す道具を作る**

Run:
```bash
mkdir -p .handoff/06-perf/baseline
{ date -Iseconds; uname -srm; lscpu | grep -E 'Model name|^CPU\(s\)|Thread|Core'; free -g | head -2; nvidia-smi --query-gpu=name,driver_version --format=csv,noheader; google-chrome --version; node --version; git rev-parse --short HEAD; } | tee .handoff/06-perf/baseline/machine.txt
```
Expected: CPU（32 コア）、GPU（GeForce GTX 1080 Ti）、Chrome の版、HEAD が出る。GPU の名前が違えば、05 の headless の数字と比べられないことを記録に書く

マシンの状態（GPU の使用率とメモリ、load average、CPU を使っている上位のプロセス）を足す道具を作る（gitignore の中）:

```bash
cat > .handoff/06-perf/baseline/snap.sh <<'EOF'
#!/usr/bin/env bash
# 使い方: bash .handoff/06-perf/baseline/snap.sh 'before steps-2d-settle'
{
  echo "=== $1 — $(date -Iseconds)"
  nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv
  uptime
  # ps の pcpu は起動からの平均なので、瞬間の値は top で取る
  top -bn1 -o %CPU | sed -n '7,15p'
  echo
} >> .handoff/06-perf/baseline/machine.txt
EOF
bash .handoff/06-perf/baseline/snap.sh 'before all'
```
Expected: `machine.txt` の末尾に `=== before all` と GPU・`uptime`・上位のプロセスが足される。以後の各組は `bash .handoff/06-perf/baseline/snap.sh 'before <組>' && <コマンド>; bash .handoff/06-perf/baseline/snap.sh 'after <組>'` の形で回す

- [ ] **Step 2: Node のベンチマークを回す（ブラウザとの比の参考）**

Run: `pnpm bench:engine 2000 | tee .handoff/06-perf/baseline/bench-engine.md`
Expected: 表が出る（04 の記録: 半径 10 m の中央値 0.029 ms、半径 100 m の中央値 約 6.2 ms・p95 約 7.4 ms）

- [ ] **Step 3: 平衡までの時間（2D、固定の DEM、18 ラン、最悪 約 100 分）**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/baseline pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected:
- 1 件成功
- `.handoff/06-perf/baseline/steps-2d-settle.{json,md}`（18 行）
- 04 と同じ条件の行（500 m・半径 10 m）の step 数: 綾瀬 267,379・渋谷 49,332・みなとみらい 20,296（DEM が 04 と同じなら一致。違えば、manifest の取得日と 04 の地形の差〈窪地の数が +1〜8。04 の記録〉を記録に書く）
- 全行で DEM の欠け 0・素通し 0
- 長いタスク: M1 の試し（Task 7）では、みなとみらい 500 m・半径 10 m で 1 件・59 ms が出た。**再び出たら、平衡までの始め（読み込み・雨の開始）か、平衡の直前かを突き止める**。`steps-2d-settle.json` の `longTasks` は要約（数・最大・合計）だけで、開始の時刻（`entries`）を持たない（`entries` を持つのは `probe=load` の報告だけ）。そのため、その 1 行だけを `RAINTRACE_STEPS_SITES=minatomirai RAINTRACE_STEPS_SIZES=500` で回し直す前に、steps の報告にも `entries` を足すか（計測用のビルドだけの小さな変更）をコントローラーに相談する。出なければ「再発なし」と書く

- [ ] **Step 4: 3D ありの窓（60 秒、固定の DEM、18 ラン、約 25 分）**

Run（バックグラウンド）: `RAINTRACE_STEPS_MODE=3d RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/baseline pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected: 1 件成功、`steps-3d-window.{json,md}`（18 行、`3D` の列が `3d`、欠け 0）

- [ ] **Step 5: fps（3 地点 × 05 の 4 視点 × 地形のみ・水面あり × 3 回、72 ラン、約 60 分）**

Run（バックグラウンド）: `RAINTRACE_FPS_SET=water-sites RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/baseline pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し`

`water`（05 と同じ既定の雨）ではなく `water-sites`（500 mm・半径 50 m。平衡に届かない雨）を使う。既定の雨はみなとみらいで約 3 秒で平衡に届き、窓の間に水深の転送が止まって地点どうしを比べられないため（Task 6 の直し）。
Expected:
- 1 件成功、`water-sites.{json,md}`
- 05 の表（tech-spec §14.1）とは雨が違うので直接は比べない。渋谷の傾向の参考は、同じ視点を既定の雨で測った `.handoff/06-perf/baseline-check/water-06/`（e95b9c1、8 セルとも 60.0）。2 fps 以上下がるセルがあれば、`machine.txt` の前後と並べて記録に書く（地理院の応答・機械の状態）
- 条件の比較に使えない組（視点がそろわない）が出たら、その組を判定に使わない

- [ ] **Step 6: クリックから 2D・3D を押してから最初の 3D のフレーム（3 地点 × 500・1000 m × 3 回、18 ラン、約 15 分）**

Run（バックグラウンド）: `RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/baseline pnpm perf:fps tests/perf/fps.perf.ts -g クリック`
Expected: 1 件成功、`load.{json,md}`。1000 m の読み込みの長いタスクの最大が 04 の 106〜123 ms 前後

- [ ] **Step 7: バンドルと Worker のチャンクの中身**

Run:
```bash
pnpm build && pnpm size | tee .handoff/06-perf/baseline/size.md
node -e 'const r=require("./build-info/chunk-modules.json");for(const [k,v] of Object.entries(r.workers))console.log(k,v.length,v.filter(x=>x.includes("maplibre")))' | tee .handoff/06-perf/baseline/worker-chunks.txt
```
Expected: 初期ロード 427.5 KB（M1 と同じ）、`ui` 160.0 KB・`index` 20.5 KB 前後。`maplibre-gl-worker-*.js` が `maplibre-gl-shared.mjs` と `maplibre-gl-worker.mjs` を持つ（計画で決めたこと 18）

- [ ] **Step 8: `docs/perf/<実行日>.md` を書く**

次の見出しで書く（表は `.handoff/06-perf/baseline/*.md` から写す。生の JSON は写さない）:

```markdown
# 06 の計測（<実行日>、基準の機械、実 GPU の headless）

- 対応: spec 06 §4（M2）。計画 `docs/superpowers/plans/2026-09-17-06-performance.md` Task 8
- コミット: <Step 1 の HEAD>
- 生の JSON: `.handoff/06-perf/baseline/`（gitignore）

## 機器の仕様
（Step 1 の machine.txt の内容。rAF は 60Hz に刻まれるので fps は 60.0 が上限、と一文添える）

## 1 step の所要時間と平衡までの時間（2D、固定の DEM、「最速」、cap 300 秒）
（steps-2d-settle.md の表。下に Node のベンチマーク〈Step 2〉と、1 step の値の求め方〈計画で決めたこと 2〉を添える）

## 3D ありの 1 step の所要時間と長いタスク（60 秒の窓）
（steps-3d-window.md の表）

## fps（3 地点 × 05 の 4 視点 × 地形のみ・水面あり × 3 回）
（water-sites.md のセルごとの中央値の表。雨は 500 mm・半径 50 m。ランごとの表は JSON にあると書く）

## マシンの状態
（machine.txt の各組の前後の load average・GPU の使用率・目立つ他のプロセスを 1 つの表にまとめる）

## クリックから 2D の地形の表示まで・3D を押してから最初の 3D のフレームまで
（load.md の表と、地点・範囲ごとの中央値）

## メインスレッドの長いタスク
（load・steps・fps の表から、操作ごとの最大を 1 つの表にまとめる: 読み込み 500・1000 m、3D に切り替え、再生中 2D・3D、地図操作中）

## 止まっている間の再描画
（steps-2d-settle.md の「止まっている間の render（2 秒）」の列。2D の水深の canvas が animate: true で 60Hz のままなら約 120）

## 再生中の割り当て
- `flowVectors()` は矢印の計算のたび（最短 100 ms ごと）に 2 × N² の Float32Array を確保する（`src/simulation/FlowSolver.ts` の `computeFlowVectors`。1000 m で 2 × 1031² × 4 バイト = 8.5 MB）。コードを読んで確かめた事実で、計測はしていない

## バンドル
（size.md の表。Worker のチャンクの maplibre-gl-shared の複製〈計画で決めたこと 18〉）
```

- [ ] **Step 9: コミットする**

```bash
git add docs/perf/
git commit -m "06 の自動の計測（3 地点の平衡・1 step の所要時間・fps・クリックから表示まで・長いタスク・バンドル）を docs/perf に記録する（spec 06 §4、M2）"
```

---

### Task 9: ユーザーの手動の計測（実 GPU、1 回。05 の項目 9 を含む）を頼み、記録する（spec 06 §4.2、R06-8）

**Files:**
- Create: `docs/perf/<実行日>-manual.md`

**Interfaces:**
- Consumes: M1 の計測用のビルド
- Produces: 参考値（判定には使わない。spec 06 §4.2）。05 の手動確認の項目 9 の結果

- [ ] **Step 1: 【手動・ユーザー】の依頼をコントローラーに渡す**

次の文面を `.superpowers/sdd/2026-09-17-06-performance/manual-request.md` に書き、コントローラーに渡す（ユーザーには直接送らない）:

```text
【手動・ユーザー】06 の手動の計測（実 GPU、1 回。所要 約 40 分）

0. インターネット接続が必要です（地理院のタイルを実際に取得します）。E2E（4173）や自動の計測を回していないときに行ってください。
   結果は参考値として記録し、合否の判定は自動の計測（開発機）で行います（spec 06 §4.2）。
1. 機器の仕様を控えてください: OS、CPU とコア数、GPU、chrome://gpu の GL_RENDERER、Chrome の版、画面のリフレッシュレート、
   ウィンドウの大きさ（最大化した状態の幅×高さ）。
2. 開発機で:
   cd /home/terapyon/dev/terapyon/raintrace
   git switch feat/06-performance && pnpm install --frozen-lockfile && pnpm build:perf && pnpm preview
3. Chrome を最大化し、下の URL を 1 つずつ、それぞれ新しいシークレットウィンドウで開いてください（前の URL のタイルの cache を
   使わないため）。左上に JSON が出るまで（fps は 30 秒ほど、steps は最大 5 分）、マウスとキーボードに触れず、ウィンドウを前面に
   置いたままにしてください。出た JSON を省略せず全文で控えてください。
   URL の fallback=0 は、粗いズームで 2D に落とす働きを止めて 3D のまま測るためのものです。消さないでください。

   A. 05 の手動確認の項目 9（fps、渋谷、8 個）
   http://localhost:4173/?lat=35.658&lon=139.7016&size=500&probe=fps&z=17&ex=5&pitch=60&water=0&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=500&probe=fps&z=16&ex=10&pitch=85&water=0&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=17&ex=5&pitch=60&water=0&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=16&ex=10&pitch=85&water=0&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=500&probe=fps&z=17&ex=5&pitch=60&water=1&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=500&probe=fps&z=16&ex=10&pitch=85&water=1&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=17&ex=5&pitch=60&water=1&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=16&ex=10&pitch=85&water=1&fallback=0

   B. 51 fps の切り分け（渋谷 1000 m・z16 ×10 p85、5 個。A の 4 個目〈地形のみ〉・8 個目〈毎回転送〉と同じ視点。
      5 個目は矢印の間隔 5 m〈1000 m で実効 10 m・10,000 本〉で、05 の 51 fps を測ったときの矢印の本数）
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=16&ex=10&pitch=85&water=1&depthEvery=2&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=16&ex=10&pitch=85&water=1&depthEvery=4&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=16&ex=10&pitch=85&water=1&pause=1&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=16&ex=10&pitch=85&water=1&arrows=0&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&probe=fps&z=16&ex=10&pitch=85&water=1&arrowsM=5&fallback=0

   C. クリックから 2D・3D を押してから最初の 3D のフレーム（lat・lon を付けない URL。3 個）
   http://localhost:4173/?size=1000&probe=load&at=35.762300,139.824600&mode=3d&fallback=0
   http://localhost:4173/?size=1000&probe=load&at=35.658000,139.701600&mode=3d&fallback=0
   http://localhost:4173/?size=1000&probe=load&at=35.457500,139.632000&mode=3d&fallback=0

   D. 1 step の所要時間（2 個。1 個目は平衡まで数十秒、2 個目は 60 秒の窓）
   http://localhost:4173/?lat=35.658&lon=139.7016&size=500&mm=100&r=10&probe=steps&mode=2d&until=settle&fallback=0
   http://localhost:4173/?lat=35.658&lon=139.7016&size=1000&mm=100&r=500&probe=steps&mode=3d&until=window&ms=60000&fallback=0

4. 終わったら Ctrl+C で preview を止め、pnpm build で通常のビルドに戻してください。
5. 1 の機器の仕様と、A〜D の JSON（全 18 個）を返してください。deltas（フレームの間隔の生の値）や series（時系列）を含むので、
   後から閾値を変えて再採点できます。コアの少ない機械では、水面ありの計測で Worker が 1 コアを使い続けるので結果が変わりえます。
```

- [ ] **Step 2: 届いた結果を記録する**

コントローラーから JSON が届いたら、`docs/perf/<実行日>-manual.md` に次を書く:
- 機器の仕様（Step 1 の 1）
- A: 8 セルの平均 fps・長いフレーム・g2・長いタスクの最大・`gpuTimerQuery`、05 の headless の表（tech-spec §14.1）と並べる。05 の手動確認の項目 9 の結果として、D15 を満たすかを書く
- B: 5 変種と A の 4 個目・8 個目の 7 行の表（Task 11 の自動の表と同じ列）
- C: 3 地点の `selectTo2dMs`・`to3d` の各値・長いタスク
- D: 平衡の step 数・所要・1 step の中央値と p95
- 参考値であり判定に使わないこと、自動の計測と 2 fps 以上違うセルがあればその旨

届く前に Task 10 を進めてよい（判定は自動の計測で行う）。届いたら追記のコミットにする。

- [ ] **Step 3: コミットする**

```bash
git add docs/perf/
git commit -m "06 のユーザーの手動の計測（実 GPU、05 の手動確認の項目 9 を含む。参考値）を docs/perf に記録する（spec 06 §4.2、R06-8）"
```

---

### Task 10: §5 の表の判定（平衡は暫定）、tech-spec §14 への追記、直す項目と別の spec の振り分け（spec 06 §5、M2 の完了）

**Files:**
- Modify: `docs/perf/<実行日>.md`（末尾に「判定」の節）
- Modify: `docs/superpowers/specs/2026-09-10-06-performance-design.md`（§5 の表の後に「M2 の判定」の小節）
- Modify: `specs/tech-spec.md`（§14.1 の 05 の表の後、§14.2 の 05 の表の後に 06 の着手時の実測）

**Interfaces:**
- Consumes: Task 8 の `docs/perf/<実行日>.md`
- Produces: M4 の各 Task の「条件」（下の判定の表の「対応」の列）。M3 と M4 はこの表の行を見て、条件を満たすかを決める

- [ ] **Step 1: 判定の表を書く**

`docs/perf/<実行日>.md` の末尾に、spec 06 §5 の行ごとに次の表を書く。判定の言葉は「基準内」「超過」「暫定: 超過」「判定不能（理由）」のどれか。「対応」には M4 の Task の番号、「別の spec（名前）」、「記録のみ」のどれかを書く:

```markdown
## 判定（spec 06 §5。M2 の時点）

| 指標 | 基準 | 測った値（最悪の条件と、その値） | 判定 | 対応 |
|---|---|---|---|---|
| 1 step の中央値・p95 | 8 ms・16 ms（DEM1A・500 m・外接矩形・Chrome） | 500 m の全面を濡らす雨の 3 地点の最悪の中央値・p95（1000 m の値も参考に並べる） | | 超過なら Task 15（近傍の添字）の後に測り直し、なお超過なら Task 24（ブロック単位の走査。計画し直す）、それでも超えれば Rust WASM の spec |
| 平衡までの時間（「最速」） | 半径 10 m は 60 秒、半径 100 m は 5 分（開発機） | 500 m の 3 地点の r10・r100 の所要（届かなければ「届かず」と step 数） | **暫定**: … | Task 15 の後に Task 25 で確定（fill-spill-merge の spec を起こすか） |
| 地図操作の fps（D15、g2 も） | 平均 57 fps 以上・長いフレーム 1% 以下 | 3 地点 × 4 視点 × 2 条件のうち D15 を外すセル（平均 fps・長いフレーム・g2） | | M3（Task 11〜13）の結果で、矢印の本数ならユーザーの裁定（Task 13 の Step 2b）、転送なら Task 22・23、描画なら遠景の LOD の spec。3 地点の雨は `water-sites`（500 mm・半径 50 m）で、05 の表とは雨が違う |
| メインスレッドの最長ブロック | 50 ms（全操作） | 操作ごとの最大（読み込み 1000 m など） | | 超過が読み込みの終わりなら Task 16（RGBA を軽くする）、なお超過なら Task 17（分割。計画し直す） |
| クリックから 2D の地形の表示 | 3 秒 | 3 地点 × 500・1000 m の中央値の最大 | | 超過なら原因（DEM の取得・デコード）を見て IndexedDB の spec か並列度の見直し |
| 3D を押してから最初の 3D のフレーム | 3 秒 | 同上 | | 超過で主因がタイルの待ちの DEM1A の 404 なら Task 20 |
| 止まっている間の再描画 | 止まっている間は毎フレーム描き直さない | 2 秒の render の回数 | | 0 より大きければ Task 18 |
| 再生中の割り当て | 定期的な大きな確保をしない | 1000 m で 8.5 MB を最短 100 ms ごと（コードの事実） | 超過 | Task 14 |
| バンドル | tech-spec §14.2 の予算 | `ui`・`index` のチャンク | | `ui` が 150 KB を超えていれば Task 19。`index` の 0.5 KB の超過は記録のみ |
| 1000 m 四方 | 上の基準をすべて満たすか | 1000 m で外れた行 | | M4 の後に Task 25 で改めて判定。満たさなければ、1000 m を外すか注意を出すかをユーザーの裁定に上げる |
```

「測った値」と「判定」の列を Task 8 の表の数字で埋める。1 step の中央値・p95 は `steps-2d-settle.md` の 500 m・全面を濡らす雨の行を正とする（tech-spec §6.3 の条件は 500 m・DEM1A）。

- [ ] **Step 2: spec 06 に M2 の判定を書く**

`docs/superpowers/specs/2026-09-10-06-performance-design.md` の §5 の表の直後（「改訂前の R06-3 の 1x の目標…」の段落の前）に足す:

```markdown
> **M2 の判定（<実行日>、`docs/perf/<実行日>.md`）**: <超過した指標を 1 行ずつ、測った値と M4 の対応の Task とともに列挙する>。基準内: <基準内の指標を列挙する>。平衡の行は暫定（M4 の Task 25 で確定する）。
```

- [ ] **Step 3: tech-spec §14 に書き足す**

`specs/tech-spec.md` の §14.1 の「06 へ引き継ぐ条件」の段落の後（「1番目と2番目の未達が…」の前）に、「06 の着手時の実測（<実行日>、実 GPU・headless・開発機。`docs/perf/<実行日>.md`）」の表を足す。列は「指標・目標・測った値（最悪の条件）・判定」で、§14.1 の表の 7 行（1 step の中央値・p95・fps・クリックから 2D・3D の最初のフレーム・最長ブロック・平衡）を並べる。

§14.2 の 05 の表の箇条書きの後に、「06 の着手時（<実行日>）」として Task 8 の Step 7 の表（変わらなければ「05 と同じ」の 1 行と、Worker のチャンクの複製が MapLibre 自身の Worker であること〈計画で決めたこと 18〉）を足す。

- [ ] **Step 4: 直す項目と別の spec の一覧を報告に書く**

`.superpowers/sdd/2026-09-17-06-performance/m2-report.md` に、Step 1 の「対応」の列を、M4 で回す Task（条件を満たしたもの）・回さない Task（条件を満たさなかったもの）・別の spec の候補（起こすかは M4 の後と M6 で決める）に分けて書く。

- [ ] **Step 5: コミットし、マイルストーンの区切りに進む**

文書だけなので、ゲートは `pnpm format && pnpm lint` でよい。

```bash
git add docs/perf/ docs/superpowers/specs/2026-09-10-06-performance-design.md specs/tech-spec.md
git commit -m "spec 06 §5 の M2 の判定（平衡は暫定）と、tech-spec §14 に 06 の着手時の実測を書き足す（M2）"
```

「マイルストーンの区切り」の 2・3 に従う（M2 の報告は `m2-report.md`）。

---

# M3: 51 fps の切り分け

M3 の完了条件（spec 06 §1.2）: 原因を数字つきで `docs/perf/` と spec 06 §5.1 に書いている。M1 だけに依存する（M2 と並べて進めてよいが、計測は時間を分ける）。

**M2 の準備での改訂（2026-09-17）:** 05 の 51.0 fps は c25be04（矢印 10,000 本）の値で、既定の本数（2,500 本）では 60.0 だった。原因は A/B で矢印の本数と特定済み（c25be04 55.3、c25be04 + 9079cba 59.9。`.handoff/06-perf/baseline-check.md`）。M3 は、切り分けの表（M1 の確かめで回した `isolate` ×3）に矢印の本数の 2 変種を足して曲線で確かめ、M4 の対応をユーザーの裁定に上げる。

### Task 11: 切り分けの計測（M1 の確かめの `isolate` ×3 に、矢印の本数の 2 変種を足す。vsync を外す試し）（spec 06 §5.1）

**Files:**
- Create: `docs/perf/<実行日>-isolation.md`
- Create（gitignore）: `.handoff/06-perf/isolation/`

**Interfaces:**
- Consumes: `.handoff/06-perf/baseline-check/isolate/`（e95b9c1 の `isolate` 7 変種 ×3）、Task 6 の組 `isolate`（M2 の準備で 9 変種）、`arrowsM`、`RAINTRACE_UNCAPPED=1`
- Produces: Task 13 の結論の材料

- [ ] **Step 1: 切り分けの表を写し、矢印の本数の 2 変種を 3 回ずつ回す**

表の 7 行（地形のみ・depthEvery=1・2・4・止めた水面・矢印なし・depthEvery=4 と矢印なし）は、M1 の確かめで e95b9c1 に回した `isolate` ×3（`.handoff/06-perf/baseline-check.md` の step 1）を使い、**回し直さない**（コードの差は計測だけの `arrowsM` で、既定の経路は変わらない）。

足す 2 変種（「水面あり・矢印 5 m（1000 m で実効 10 m・10,000 本）」「水面あり・矢印 20 m（実効 40 m・625 本）」）を 3 回ずつ回す。`fps.perf.ts` には変種を絞る環境変数が無いので、`RAINTRACE_FPS_SET=isolate` で 9 変種 × 3 回（27 ラン、約 20 分）を回し、**表には新しい 2 変種の行を使う**。同じ時間に回った 7 変種は、baseline-check の表と 2 fps 以上違わないかの確かめだけに使う（違えば `machine.txt` の前後と並べて記録に書き、表は baseline-check のままにする）。

Run（バックグラウンド）:
```bash
mkdir -p .handoff/06-perf/isolation
pnpm build:perf
# マシンの状態を足す道具（Task 8 の Step 1 と同じ中身で、書き先だけ isolation。Task 8 より先に回すこともあるので、ここで作る）
cat > .handoff/06-perf/isolation/snap.sh <<'EOF'
#!/usr/bin/env bash
{
  echo "=== $1 — $(date -Iseconds)"
  nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv
  uptime
  top -bn1 -o %CPU | sed -n '7,15p'
  echo
} >> .handoff/06-perf/isolation/machine.txt
EOF
bash .handoff/06-perf/isolation/snap.sh 'before isolate' && RAINTRACE_FPS_SET=isolate RAINTRACE_FPS_REPEAT=3 RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/isolation pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し; bash .handoff/06-perf/isolation/snap.sh 'after isolate'
```
Expected:
- 1 件成功、`.handoff/06-perf/isolation/isolate.{json,md}`（27 行）
- 「矢印 5 m」は c25be04 の 55.3（48.5〜55.7）・05 の記録の 51.0（49.0〜55.8）に近い値に落ちる見込み。落ちなければ、その数字のまま記録する（矢印の本数だけでは説明できないことになり、Task 13 の 4 に当てはめる）
- 「矢印 20 m」は 60.0 前後
- 27 ランの実測 pitch（78.6）・描かれるタイル（16）がそろっている。そろわない組が出たら止めて知らせる

- [ ] **Step 2: vsync を外す起動の引数を 1 回だけ試し、記録する**

Run: `RAINTRACE_UNCAPPED=1 RAINTRACE_FPS_SET=isolate RAINTRACE_FPS_REPEAT=1 RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/isolation-uncapped pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し`
Expected（どちらかになる。どちらでも成功として扱い、回し直さない）:
- **効いた**: 「地形のみ」の平均 fps が 60 を明らかに超える（例 90 以上）。9 変種 × 1 回の表をそのまま記録し、天井の外の余裕（特に矢印 5 m と既定の差）を読む。3 回に増やさない
- **効かない**: どの変種も 60.0 fps 以下。「ANGLE の gl-egl では効かない（<Chrome の版>）」と記録する（spec 06 §4.2 の未検証の項目を閉じる）

注意: 効いた場合の D15 の「長いフレーム」の閾値（中央値の 2.5 倍）は中央値が小さくなるので厳しくなる。判定には天井ありの Step 1 の表を使い、外した表は余裕を読むためだけに使う。

- [ ] **Step 3: GPU のタイマーの有無を読む（記録だけ）**

Run: `grep -m1 "GPU のタイマー" .handoff/06-perf/isolation/isolate.md`
Expected: `使える` か `使えない`。どちらでも記録するだけで、Task 12 は行わない（Task 12 の「閉じた理由」）

- [ ] **Step 4: `docs/perf/<実行日>-isolation.md` を書く**

```markdown
# 51 fps の切り分け（<実行日>、spec 06 §5.1、M3）

- 条件: 渋谷・1000 m・z16 ×10 p85（実測 pitch <値>・描かれるタイル <値>）・fallback=0・毎回新しい context・3 回の中央値
- 機器: `docs/perf/<M2 の実行日>.md` と同じ（違えば書く）

## 05 の 51.0 fps の出どころ（M1 の確かめ）
（`.handoff/06-perf/baseline-check.md` の結論と step 3 の表: c25be04 55.3、c25be04 + 9079cba 59.9、b3a8916・e95b9c1 60.0。視点は同じ。マシンの負荷の表）

## 天井あり（判定に使う）
（セルごとの中央値の表: 変種・平均 fps・長いフレーム・g2・render CPU・長いタスクの最大。7 行は baseline-check の isolate〈e95b9c1〉、矢印 5 m・20 m の 2 行は isolation/isolate.md。行ごとに出どころの列を置く）

## 矢印の本数と fps
（矢印なし〈0 本〉・矢印 20 m〈625 本〉・既定〈2,500 本。depthEvery=1 の行〉・矢印 5 m〈10,000 本〉の 4 点を、平均 fps と g2 で並べる）

## 同じ時間の 7 変種の確かめ
（isolation/isolate.md の 7 変種と baseline-check の差。2 fps 以上の差の有無）

## vsync を外した試し
（効いた／効かない。効いたなら表）

## GPU のタイマー
（使える／使えない）
```

- [ ] **Step 5: コミットする**

```bash
git add docs/perf/
git commit -m "51 fps の切り分けの計測（M1 の確かめの isolate に矢印 5 m・20 m を足した矢印の本数の曲線、vsync を外す試し）を docs/perf に記録する（spec 06 §5.1、M3）"
```

---

### Task 12:（閉じた）GPU のタイマーで転送と描画の GPU の時間を分ける（spec 06 §5.1 の表の最後の行）

**閉じた（M2 の準備での改訂、2026-09-17）: 対象（転送か描画か）が消えたので行わない。** 理由: この Task は「51 fps の落ちが水深の転送か描画か」を GPU の時間で分けるためのものだった。M1 の確かめ（`.handoff/06-perf/baseline-check.md`）で、既定の矢印の本数では `depthEvery=1・2・4`・止めた水面・矢印なしがどれも 59.9〜60.0 fps で天井に届き、転送と描画のどちらも上限の内にあると分かった。落ちは A/B で矢印の本数に結びついており（c25be04 55.3 → 9079cba を重ねて 59.9。仕組みは Task 11 の本数の曲線で確かめる）、転送と描画の GPU の時間を分けても M4 の判断が変わらない。Task 11 の Step 3 の「使える／使えない」は記録だけする。Task 13 の結論で転送か描画が再び疑われたら、下の枠から計画し直す。

以下は閉じる前の枠（履歴）。

**（履歴）条件:** Task 11 の Step 3 で `使える`。`使えない` なら行わず、Task 13 の記録に「対象外」と書く。

**計画し直す理由:** `EXT_disjoint_timer_query_webgl2` の問い合わせを MapLibre の描画の前後と水面の Custom Layer の `render` の中に挟む必要がある。MapLibre の描画のループのどこに挟めるか（`map.on('prerender')`・`render` のイベントと GL の状態の cache との関係）は、使えると分かってから `maplibre-gl-dev.mjs` を読んで決める。計画し直すときの枠:
- 計測用のビルドだけ（`perfHook` から `View3dOptions` の受け口で渡す。`onRenderTime` と同じ形）
- 測る区間: (1) 水面の `render` の中の `texSubImage2D` を含む three の描画、(2) フレーム全体（`prerender` から `render`）
- 結果は `docs/perf/<実行日>-isolation.md` の「GPU のタイマー」の節

- [ ] ~~**Step 1: 計画を書き足してレビュー役に送る**~~（閉じた。行わない）

~~この Task の下に、上の枠を具体的な Files・Interfaces・Step（テストを含む）にした計画を書き、コントローラーに送る。承認の後に実装し、1 コミットにする。~~

---

### Task 13: 51 fps の原因を数字で名指しし、spec 06 §5.1 に書き、M4 の対応をユーザーの裁定に上げる（M3 の完了）

**Files:**
- Modify: `docs/perf/<実行日>-isolation.md`（「結論」の節）
- Modify: `docs/superpowers/specs/2026-09-10-06-performance-design.md`（§5.1 の末尾に「結果」）

**Interfaces:**
- Consumes: Task 11 の表（Task 12 は閉じた）
- Produces: M4 の矢印の対応（ユーザーの裁定）、Task 22・23（転送側。既定の本数で転送が主因でなければ行わない）と、遠景の LOD の spec の要否（M6）の条件

**M2 の準備での改訂（2026-09-17）:** 下の Step 1 の 1〜4 は、既定の本数の 7 行ではどれにも当てはまらない（すべて 59.9〜60.0）。矢印 5 m の行を加えた表で、先に Step 1 の 0 を当てはめる。

- [ ] **Step 1: 決め方に当てはめる**

Task 11 の Step 1 の表（天井あり、セルごとの中央値）で、次の順に当てはめる。数字は「平均 fps・g2」の両方で読む（spec 06 §5.1）:

0. **矢印 5 m（10,000 本）が D15 を外し、矢印 20 m（625 本）・既定（2,500 本）・矢印なしが 57 fps 以上で、fps が本数とともに下がる** → 主因は**矢印の symbol の本数**（p85 は描かれるタイルが最も多く、MapLibre は symbol をフレームごとに並べ直す）。転送（`depthEvery=1・2・4`）・水面の描画（止めた水面）・地形の描画（地形のみ）は、既定の本数では上限の内。1〜3 は行わず Step 2 の結論の型を使う。矢印 5 m も D15 を満たすなら「10,000 本でも落ちない（c25be04 との差は矢印以外）」として 4 に進む
1. **止めた水面（`pause=1`）が D15 を満たさない**（転送 0 でも 57 fps 未満）→ 主因は**描画**（水面の約 212 万枚の三角形か地形）。さらに「地形のみ」との差を書く。差が 3 fps 以上なら「水面の描画」、3 fps 未満なら「地形の描画が天井に近い（05 の 59.6・58.5）ところへ水面の描画が加わる」。対応: 遠景の LOD の spec（M6 で雛形）。Task 22・23 は行わない
2. **止めた水面が D15 を満たし、`depthEvery` を上げるほど平均 fps が戻る**（N=4 が N=1 より 3 fps 以上高い）→ 主因は**転送**。対応: Task 22（N=2 が D15 を満たすなら既定の間引き）、満たさなければ Task 23（変わった行だけ・Float16。計画し直す）
3. **矢印なし（`arrows=0`）が `depthEvery=1` より 3 fps 以上高い** → 矢印の `setData` と並べ直しも寄与する。1・2 と独立に記録し、Task 13 の Step 3 の報告で「3D の間の矢印の間引き」を M4 の候補として計画し直すかをコントローラーに相談する（spec 06 §5.2 の候補の一覧に無いので、足すなら計画のレビューに上げる）
4. どれにも当てはまらない（例: どの変種も 51〜54 fps で差が 3 fps 未満）→ 原因は「未切り分け」のまま、数字と、残る候補（GC・Worker とメインの取り合い・合成）を書き、レビュー役に上げる

- [ ] **Step 2: 結論を書く**

`docs/perf/<実行日>-isolation.md` の末尾に「## 結論」として、当てはめた番号、根拠の数字（変種ごとの平均 fps・g2）、対応を書く。0 に当てはまったときは次の型で書く:

```markdown
## 結論

- **主因は矢印の symbol の本数**（Step 1 の 0）。1000 m・z16 ×10 p85・水面ありの平均 fps（3 回の中央値）と g2: 矢印なし <値>・<g2>、矢印 20 m（625 本）<値>・<g2>、既定（2,500 本）<値>・<g2>、矢印 5 m（10,000 本）<値>・<g2>。p85 は描かれるタイルが最も多く（16）、MapLibre は symbol をフレームごとに並べ直すので、本数に比例して CPU の時間が増える
- 既定の本数では、転送（depthEvery=1 <値>・2 <値>・4 <値>）、水面の描画（止めた水面 <値>）、地形の描画（地形のみ <値>）はどれも上限（60.0 fps）の内。render CPU は <値> ms
- 05 の 51.0 fps との関係: c25be04（10,000 本）55.3、c25be04 + 9079cba（2,500 本）59.9（`.handoff/06-perf/baseline-check.md`）
- vsync を外す引数は <効いた／効かない>、GPU のタイマーは <使える／使えない>（Task 12 は閉じた）
- M4 の対応: ユーザーの裁定（下の R）
```

spec 06 §5.1 の末尾（「原因を数字つきで `docs/perf/` と本節に書く」の後）に足す:

```markdown
> **結果（<実行日>、`docs/perf/<実行日>-isolation.md`）**: 主因は <矢印の symbol の本数／転送／水面の描画／地形の描画／未切り分け>。平均 fps（3 回の中央値）と g2: 矢印なし <値>・<g2>、矢印 20 m <値>・<g2>、既定 <値>・<g2>、矢印 5 m <値>・<g2>、地形のみ <値>、depthEvery=1 <値>・2 <値>・4 <値>、止めた水面 <値>。転送・水面の描画・地形の描画は既定の本数では上限の内。vsync を外す引数は <効いた／効かない>、GPU のタイマーは <使える／使えない>。M4 の対応: <ユーザーの裁定の結果>。
```

- [ ] **Step 2b: M4 の対応をユーザーの裁定に上げる（0 に当てはまったとき）**

`.superpowers/sdd/2026-09-17-06-performance/m3-report.md` に次の裁定の依頼を書き、コントローラーに渡す（推奨は付けてよいが、決めるのはユーザー）:

```text
【裁定】1000 m で矢印の間隔に 5 m を選んだときの fps（spec 06 §5.1、M4）

事実: 1000 m・z16 ×10 p85・水面ありで、矢印 5 m（実効 10 m・10,000 本）は <値> fps（g2 <値>）で D15（57）を外す。既定（2,500 本）は <値>、625 本は <値>、矢印なしは <値>。
転送・水面と地形の描画は既定の本数では上限の内。

(a) 1000 m の実効の間隔の下限を 20 m にする（5 m を選んでも 1000 m では 20 m。DisplaySettings にその旨を表示する。文言は strings.ts）
(b) 変えない。記録に残し、注意を表示するかどうかを決める
(c) 矢印の更新を間引く（setData の頻度を下げる）。fps が本数に比例して下がる（並べ直しの負荷で、更新の頻度ではない）なら効かないので落とす
```

M4 の「前」は `arrowsM=5` で測る（`isolate` の「水面あり・矢印 5 m」の行、または同じ URL）。裁定の結果で M4 に Task を足す場合は、計画のレビューに上げる。0 に当てはまらなければこの Step は行わず、1〜4 の対応に従う。

- [ ] **Step 3: コミットし、マイルストーンの区切りに進む**

ゲートは `pnpm format && pnpm lint`。

```bash
git add docs/perf/ docs/superpowers/specs/2026-09-10-06-performance-design.md
git commit -m "51 fps の原因を切り分けの数字で名指しし、spec 06 §5.1 に結果と M4 の対応を書く（M3）"
```

「マイルストーンの区切り」の 2・3 に従う（M3 の報告は `m3-report.md`）。

---

# M4: 安価な改善（1 項目ずつ前後を測る）と平衡の確定

M4 の完了条件（spec 06 §1.2）: 各項目の前後の数字と tech-spec §14 の更新。平衡の行の判定が確定している。

**M4 の進め方（全 Task 共通）:**
1. 各 Task の冒頭の **条件** を、Task 10 の判定の表（と Task 13 の結論）に照らす。満たさなければ、その Task は行わず、`docs/perf/<実行日>-fixes.md` の「行わなかった項目」に「条件: …、測った値: …」と 1 行書く（Task 25 のコミットに含める）
2. 満たすなら、**前**の計測（今の HEAD の `pnpm build:perf`）→ テストを先に書いて直す → **後**の計測（同じコマンド）→ 記録 → ゲート → コミット、の順に行う。前と後は同じ日の同じ機械で続けて測る
3. 前後の数字は `docs/perf/<実行日>-fixes.md` の Task ごとの節に足し、同じ Task のコミットに含める。ファイルが無ければ最初の Task で作る（見出し `# 06 の安価な改善の前後（spec 06 §5.2、M4）` と、機器が `docs/perf/<M2 の実行日>.md` と同じである旨）
4. 「計画し直す」の Task（17・17a・21・23・24）は、条件を満たしたら、その Task の枠を具体的な計画にしてレビュー役に送り、承認の後に行う

### Task 13a: `StepsReport.longTasks` に `entries`（各長いタスクの開始と長さ）を足す（spec 06 §5.2、M2 の修正の裁定）

**条件:** 常に行う（M4 の他の Task の前後の計測より先に行う。M2 で綾瀬 500 m・半径 10 m の再生中に出た 53 ms の長いタスク〈1 件のみ〉が Task 25 の測り直しで再発したとき、再生の始めの直後か平衡の直前かを名指しできるようにする準備）。

**Files:**
- Modify: `src/ui/perfReports.ts`（`StepsReport.longTasks`）
- Modify: `src/ui/perfSteps.ts`（`stepLongTaskEntries`、`runStepsProbe`）
- Modify: `src/ui/perfSteps.test.ts`

**Interfaces:**
- Consumes: `LongTaskSample`（`perfCollectors.ts`。型は変えない）
- Produces: `export function stepLongTaskEntries(entries: readonly LongTaskSample[], fromMs: number, toMs: number): LongTaskSample[]`。`StepsReport.longTasks` の型を `LongTaskSummary` から `LongTaskSummary & { entries: LongTaskSample[] }` に広げる（`LoadReport.longTasks.entries` と同じ形。`perfCollectors.summarizeLongTasks` は変えない）

- [ ] **Step 1: 失敗するテストを書く**

`src/ui/perfSteps.test.ts` の末尾に足す:

```ts
import { summarizeLongTasks } from './perfCollectors'
import { minutesAt1x, stepLongTaskEntries } from './perfSteps'

describe('stepLongTaskEntries（[from, to) の長いタスクの一覧。LoadReport.longTasks.entries と同じ形。spec 06 M4 Task 13a）', () => {
  it('窓の外は落とし、窓の中だけ開始と長さで返す', () => {
    const entries = [
      { startMs: 0, durationMs: 60 },
      { startMs: 100, durationMs: 53 },
      { startMs: 200, durationMs: 70 },
    ]
    expect(stepLongTaskEntries(entries, 100, 200)).toEqual([{ startMs: 100, durationMs: 53 }])
  })

  it('summarizeLongTasks と同じ [from, to) を渡せば、件数が summary.count と一致する（runStepsProbe は両方を同じ start・end で呼ぶ）', () => {
    const entries = [
      { startMs: 50, durationMs: 55 },
      { startMs: 150, durationMs: 60 },
    ]
    const filtered = stepLongTaskEntries(entries, 50, 150)
    expect(filtered).toHaveLength(summarizeLongTasks(entries, true, 50, 150).count)
  })
})
```

（既存の `import { minutesAt1x } from './perfSteps'` はこの 1 行に統合する。）

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm vitest run src/ui/perfSteps.test.ts`
Expected: FAIL（`stepLongTaskEntries is not a function` などの解決の失敗）

- [ ] **Step 3: 直す**

`src/ui/perfSteps.ts` の import を次に置き換える:

```ts
import {
  type LongTaskCollector,
  type LongTaskSample,
  type StepTimeListener,
  summarizeLongTasks,
  summarizeStepSeries,
} from './perfCollectors'
```

`minutesAt1x` の前に足す:

```ts
/** [fromMs, toMs) に始まった長いタスクの一覧（開始と長さだけ。LoadReport.longTasks.entries と同じ形。spec 06 M4 Task 13a） */
export function stepLongTaskEntries(
  entries: readonly LongTaskSample[],
  fromMs: number,
  toMs: number,
): LongTaskSample[] {
  return entries.filter((entry) => entry.startMs >= fromMs && entry.startMs < toMs)
}
```

`runStepsProbe` の戻り値の `longTasks: summarizeLongTasks(longTasks.entries, longTasks.supported, start, end),` を次に置き換える:

```ts
    longTasks: {
      ...summarizeLongTasks(longTasks.entries, longTasks.supported, start, end),
      entries: stepLongTaskEntries(longTasks.entries, start, end),
    },
```

`src/ui/perfReports.ts` の `StepsReport` の `longTasks: LongTaskSummary` を `longTasks: LongTaskSummary & { entries: LongTaskSample[] }` に置き換える（`LongTaskSample` は同じ import 文にすでにある）。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `pnpm vitest run src/ui/`
Expected: PASS

- [ ] **Step 5: 通常のビルドに計測のコードが無いことを確かめ、ゲートを通してコミットする**

`perfReports.ts`・`perfSteps.ts` は既存の `src/ui/perf*.ts`（計測用のビルドだけに入る）の一部なので、新しい分岐は要らない。

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm size`
Expected: すべて成功、初期ロード 427.5 KB（変わらない。`entries` は計測用のビルドの型が広がるだけ）

```bash
git add src/ui/perfReports.ts src/ui/perfSteps.ts src/ui/perfSteps.test.ts
git commit -m "StepsReport.longTasks に entries（各長いタスクの開始と長さ）を足す（LoadReport と同じ形。再生中の長いタスクの再発を特定するため。spec 06 §5.2）"
```

---

### Task 13b: 矢印の 1 辺の本数の上限を全範囲で 50 にする（5 m の選択肢を外す。spec 06 §5.1・§5.2、R06-11 の裁定 (a2)、計画で決めたこと 19）

**条件:** 常に行う（Task 10・Task 13 の判定表ではなく、R06-11 のユーザーの裁定そのものが条件）。

**背景:** Task 13 の M3 の結果（`docs/perf/2026-09-17-isolation.md`）: 矢印の間隔に 5 m を選ぶと、範囲によらず 1 辺 100 本（10,000 本、既定の 4 倍）になる（`arrowSpacingForRange(baseM, sizeM) = baseM × sizeM ÷ 500` なので 1 辺の本数 = 500 ÷ baseM で範囲が消える）。1000 m は 55.7（49.1〜57.1）fps・g2 41 で D15（57 fps）を外し、500 m は 58.3（55.0〜59.4）fps・g2 17 で中央値は D15 の内だが、60 Hz の天井が約 1.2 ms の超過を吸収しているだけで余裕があるわけではない（1 フレームの予算の見積もりでは矢印 10,000 本のコストは範囲によらず約 +9.5 ms）。ユーザーは (a2)「すべての範囲で矢印の 1 辺の本数の上限を 50（既定と同じ）にする」を裁定し、UI の形は「5 m の選択肢を外す」を選んだ（`.superpowers/sdd/2026-09-17-06-performance/arrow-ruling-request.md`）。

**Files:**
- Modify: `src/state/persistedSettings.ts`（`ARROW_SPACINGS`、`ARROW_SPACING_INPUTS`、`clampArrowSpacing`、`parsePersistedSettings`）
- Create: `src/state/persistedSettings.test.ts`（`clampArrowSpacing` の単体テスト。この関数の最初のテストファイル）
- Modify: `src/state/settingsStore.test.ts`（5 の移行、5 でも候補でもない値の既定値戻し）
- Modify: `src/state/arrowSpacing.ts`（コメントの「選べる矢印の間隔（5・10・20 m）」を「10・20 m」に。`arrowSpacingForRange` 自体は変えない）
- Modify: `src/ui/perfParams.ts`（`PERF_ARROW_SPACINGS`）
- Modify: `src/ui/perfHook.ts`（`clampArrowSpacing` を呼んでから `setDisplay` に渡す）
- Modify: `src/ui/simulationSession.test.ts`（`flowVectorSpacingM: 5` を使う 2 件を型のため書き換える。振る舞いの意図は変えない。レビュー M1）
- Modify: `tests/e2e/dem.spec.ts`（矢印の間隔の E2E から `'5 m'` を外す）
- Modify: `tests/perf/fps.perf.ts`（`isolate`・`isolate-500` の「矢印 5 m」の変種のラベルを、クランプ後の本数が読めるものに直す。レビュー R1）
- Modify: `docs/perf/<実行日>-fixes.md`（前後の表）
- Modify: `docs/superpowers/specs/2026-09-10-06-performance-design.md`（§5.1 の結果に前後の数字、§5.2 の候補の行に前後の数字）
- Modify: `specs/tech-spec.md`（§14.1 の「地図操作時のフレームレート」行の「M4 の対応はユーザーの裁定待ち」を結果に置き換え。§8.3「バージョニング方針」に矢印の間隔 5 の読み替えの 1 文を足す。レビュー R2）
- Modify: `docs/superpowers/specs/2026-09-10-05-3d-rendering-design.md`（§3.3 の「選べる間隔（今は 5・10・20 m）」を「今は 10・20 m」に、脚注で R06-11 を参照）

**Interfaces:**
- Consumes: `ARROW_SPACINGS`・`oneOf`（`persistedSettings.ts`、既存）、Task 11 の `isolate`・`isolate-500`（`tests/perf/fps.perf.ts`。組と `extra: { arrowsM: '5' }` は変えない、ラベルだけ直す）、Task 13 の結論
- Produces: `export function clampArrowSpacing(value: (typeof ARROW_SPACING_INPUTS)[number]): (typeof ARROW_SPACINGS)[number]`（`persistedSettings.ts`）。`PERF_ARROW_SPACINGS`（`perfParams.ts`、ローカル、export しない）

- [ ] **Step 1: 前を測る（今の HEAD。isolate の 1000 m・9 変種と isolate-500 の 500 m・2 変種を 3 回ずつ）**

`arrowsM=5` は変更前の今も、Task 11 と同じ「1000 m で実効 10 m・10,000 本」「500 m で実効 5 m・10,000 本」を作る。M4 の「前と後は同じ日の同じ機械で続けて測る」（進め方 2）に従い、Task 11 の値の再確認を兼ねて測り直す。

Run（バックグラウンド。27 + 6 = 33 ラン、約 22 分）:
```bash
pnpm build:perf
mkdir -p .handoff/06-perf/fixes/13b-before
cat > .handoff/06-perf/fixes/13b-before/snap.sh <<'EOF'
#!/usr/bin/env bash
{
  echo "=== $1 — $(date -Iseconds)"
  nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv
  uptime
  top -bn1 -o %CPU | sed -n '7,15p'
  echo
} >> .handoff/06-perf/fixes/13b-before/machine.txt
EOF
bash .handoff/06-perf/fixes/13b-before/snap.sh 'before isolate' && \
  RAINTRACE_FPS_SET=isolate RAINTRACE_FPS_REPEAT=3 RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/13b-before pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し && \
  RAINTRACE_FPS_SET=isolate-500 RAINTRACE_FPS_REPEAT=3 RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/13b-before pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し; \
  bash .handoff/06-perf/fixes/13b-before/snap.sh 'after isolate'
```
Expected: 2 件成功、`.handoff/06-perf/fixes/13b-before/isolate.{json,md}`（27 行）・`isolate-500.{json,md}`（6 行）。「矢印 5 m」の行（1000 m・500 m）の平均 fps・g2 が Task 11・13 の値（1000 m 55.7・g2 41、500 m 58.3・g2 17）に近い（3 回の中央値の差が 2 fps 未満）。差が大きければ `machine.txt` を記録に添えて理由を書き、続ける（止めない）

- [ ] **Step 2: 失敗するテストを書く**

`src/state/persistedSettings.test.ts`（新規ファイル）:
```ts
import { describe, expect, it } from 'vitest'
import { ARROW_SPACINGS, clampArrowSpacing } from './persistedSettings'

describe('clampArrowSpacing（R06-11 の裁定 (a2): 矢印の 1 辺の本数の上限を全範囲で 50 にする。計画で決めたこと 19）', () => {
  it('ARROW_SPACINGS は 5 を含まない（選択肢から外した）', () => {
    expect(ARROW_SPACINGS).toEqual([10, 20])
  })

  it('選べる値（10・20）はそのまま返す', () => {
    expect(clampArrowSpacing(10)).toBe(10)
    expect(clampArrowSpacing(20)).toBe(20)
  })

  it('5（選択肢から外れた値）は 10 として読む（移行）', () => {
    expect(clampArrowSpacing(5)).toBe(10)
  })
})
```

`src/state/settingsStore.test.ts` の `describe('settingsStore（tech-spec §8.3）'` の中、`it('範囲を小さくすると…')` の前に足す:
```ts
  it('矢印の間隔の保存値が 5（外れた選択肢）なら 10 として読み、他の表示の設定はそのまま保つ（R06-11 の移行）', () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        ...DEFAULT_SETTINGS,
        display: { ...DEFAULT_SETTINGS.display, flowVectorSpacingM: 5 },
      }),
    })
    const store = createSettingsStore(storage)
    expect(store.getState().display).toEqual({
      ...DEFAULT_SETTINGS.display,
      flowVectorSpacingM: 10,
    })
  })
```

同じファイルの `it.each` の不正な値の一覧（`['ベースマップが候補に無い', …]` の前）に足す:
```ts
    [
      '矢印の間隔が候補にも 5 にも無い',
      { ...base, display: { ...DEFAULT_SETTINGS.display, flowVectorSpacingM: 15 } },
    ],
```

`src/ui/simulationSession.test.ts` の `flowVectorSpacingM: 5` を使う 2 件は、`ARROW_SPACINGS` を `[10, 20]` にすると型検査で落ちる（レビュー M1）。振る舞いの意図（表示の切り替えと 500 m 以外の値、1000 m の倍）を保ったまま、値を選べる値に書き換える。`session.setArrows(true, 5)`（374 行目）は `number` を受ける別の API なので変えない。

380 行目の `it('設定の矢印の表示と間隔の変更を Worker に送る'` を次に置き換える:
```ts
  it('設定の矢印の表示と間隔の変更を Worker に送る', () => {
    const { worker, settings } = setup()
    settings.getState().setDisplay({ showFlowVectors: false, flowVectorSpacingM: 20 })
    expect(worker.posted.at(-1)).toEqual({ type: 'setArrows', visible: false, spacingM: 20 })
  })
```

388 行目を含む `it('範囲 1000 m では、選んだ間隔の 2 倍を Worker に送る（spec 05 §3.3）'` を次に置き換える:
```ts
  it('範囲 1000 m では、選んだ間隔の 2 倍を Worker に送る（spec 05 §3.3）', () => {
    const { worker, settings } = setup()
    settings.getState().setAreaSize(1000)
    expect(worker.posted.at(-1)).toEqual({ type: 'setArrows', visible: true, spacingM: 20 })
    settings.getState().setDisplay({ flowVectorSpacingM: 20 })
    expect(worker.posted.at(-1)).toEqual({ type: 'setArrows', visible: true, spacingM: 40 })
  })
```

既存の `src/ui/perfParams.test.ts` は変えない。`describe('arrowsM（spec 06 §5.1）'` の 4 つの期待（`arrowsM=5` → `5`、`10` → `10`、`20` → `20`、`15` → `null`）が、この Step の直後（コードを直す前）に失敗する側の役目を果たす（`ARROW_SPACINGS` を `[10, 20]` にした時点で `arrowsM=5` の期待が壊れる）。

- [ ] **Step 3: 失敗を確かめる**

Run: `pnpm vitest run src/state/persistedSettings.test.ts src/state/settingsStore.test.ts src/ui/perfParams.test.ts src/ui/simulationSession.test.ts`
Expected: FAIL（`clampArrowSpacing` が無い・`ARROW_SPACINGS` が `[10, 20]` でない・5 が 10 に migrate されない。`perfParams.test.ts` はまだ全部 PASS のはず、コードをまだ直していないため）。`simulationSession.test.ts` は型の理由で書き換えるが、振る舞いのテストとしては前後とも通る（値を 5 から 20 に変えただけで、Worker に送る仕組みそのものは検査していない）

- [ ] **Step 4: 直す**

`src/state/persistedSettings.ts` の `export const ARROW_SPACINGS = [5, 10, 20] as const` を次に置き換える:
```ts
export const ARROW_SPACINGS = [10, 20] as const
```

`parsePersistedSettings` の直前の JSDoc の 2 行目（`* （呼び出し側が既定値に戻す。マイグレーションはしない。tech-spec §8.3）`）を次に置き換える（レビュー R2）:
```ts
 * （呼び出し側が既定値に戻す。schemaVersion のマイグレーションはしない。外した選択肢の値
 * （矢印の間隔 5）だけ 10 に読み替える。tech-spec §8.3。R06-11）
```

`const oneOf = …` の後、`parsePersistedSettings` の前に足す:
```ts
/**
 * 矢印の間隔の保存値・perfHook が渡す値（5・10・20）。5 は選べる値から外れたが（R06-11 の裁定）、
 * 保存済みの値と計測だけの URL（arrowsM=5）からは今も届きうるので、検証の入力の型に残す
 */
const ARROW_SPACING_INPUTS = [5, ...ARROW_SPACINGS] as const

/**
 * 矢印の間隔を選べる値に丸める。5（選択肢から外れた値）は 10 として読む（移行）。
 * ARROW_SPACING_INPUTS で検証した後の値だけを渡す（parsePersistedSettings と perfHook.ts が呼ぶ。
 * R06-11 の裁定 (a2): すべての範囲で矢印の 1 辺の本数の上限を 50 にする。計画で決めたこと 19）
 */
export function clampArrowSpacing(
  value: (typeof ARROW_SPACING_INPUTS)[number],
): (typeof ARROW_SPACINGS)[number] {
  return value === 5 ? 10 : value
}
```

`parsePersistedSettings` の `const { verticalExaggeration, waterDepthPalette, showFlowVectors, flowVectorSpacingM } = display` の後の `if` を次に置き換える:
```ts
  if (
    !oneOf(VERTICAL_EXAGGERATIONS, verticalExaggeration) ||
    !oneOf(WATER_PALETTES, waterDepthPalette) ||
    typeof showFlowVectors !== 'boolean' ||
    !oneOf(ARROW_SPACING_INPUTS, flowVectorSpacingM)
  ) {
    return null
  }
```
（`oneOf(ARROW_SPACING_INPUTS, flowVectorSpacingM)` に変えただけで、他の 3 つの行は変えない。）

戻り値の `display: { verticalExaggeration, waterDepthPalette, showFlowVectors, flowVectorSpacingM },` を次に置き換える:
```ts
    display: {
      verticalExaggeration,
      waterDepthPalette,
      showFlowVectors,
      flowVectorSpacingM: clampArrowSpacing(flowVectorSpacingM),
    },
```

`src/state/arrowSpacing.ts` の 3 行目「選べる矢印の間隔（5・10・20 m）の基準の範囲」を「選べる矢印の間隔（10・20 m。5 は R06-11 の裁定で外した）の基準の範囲」に直す。

`src/ui/perfParams.ts` の import の下に足す:
```ts
/**
 * 計測だけが使う矢印の間隔（arrowsM）。ARROW_SPACINGS（表示の設定の選べる値）が 5 を外した後も、
 * 5 を選んだときの落ち方を測り続けるために受ける（R06-11 の裁定 (a2)。5 は perfHook.ts が
 * clampArrowSpacing で 10 に丸めてから設定のストアへ渡すので、「10,000 本」ではなく「丸めた後の
 * 2,500 本」を測ることになる。これは裁定の効果を数字で確かめるための意図した挙動）
 */
const PERF_ARROW_SPACINGS = [5, ...ARROW_SPACINGS] as const
```
`PerfParams` の `arrowsM: (typeof ARROW_SPACINGS)[number] | null` を `arrowsM: (typeof PERF_ARROW_SPACINGS)[number] | null` に、`parsePerfParams` の `arrowsM: ARROW_SPACINGS.find((m) => String(m) === params.get('arrowsM')) ?? null,` を `arrowsM: PERF_ARROW_SPACINGS.find((m) => String(m) === params.get('arrowsM')) ?? null,` に置き換える。

`src/ui/perfHook.ts` の import に `clampArrowSpacing` を足す（`import { clampArrowSpacing } from '../state/persistedSettings'`）。`settings.getState().setDisplay({ … })` の中の次の行:
```ts
    ...(params.arrowsM === null ? {} : { flowVectorSpacingM: params.arrowsM }),
```
を次に置き換える:
```ts
    // arrowsM=5・10・20: 矢印の間隔の設定。5 は clampArrowSpacing で 10 に丸める（R06-11 の裁定 (a2):
    // 全範囲で矢印の 1 辺の本数の上限を 50 にする。ARROW_SPACINGS はもう 5 を含まない）。
    // 省けば設定を触らない（spec 06 §5.1）
    ...(params.arrowsM === null ? {} : { flowVectorSpacingM: clampArrowSpacing(params.arrowsM) }),
```

`tests/e2e/dem.spec.ts` の `for (const spacing of ['5 m', '20 m', '10 m']) {` を `for (const spacing of ['20 m', '10 m']) {` に置き換える（5 m のボタンは無くなる）。

`tests/perf/fps.perf.ts` の `isolate` の変種のラベル（レビュー R1）:
```ts
      {
        label: '水面あり・矢印 5 m（arrowsM=5。R06-11 の前は実効 10 m・10,000 本、後は 10 に丸められ 2,500 本）',
        water: '1',
        extra: { arrowsM: '5' },
      },
```
`isolate-500` の変種のラベル:
```ts
      {
        label: '水面あり・矢印 5 m（arrowsM=5。R06-11 の前は実効 5 m・10,000 本、後は 10 に丸められ 2,500 本）',
        water: '1',
        extra: { arrowsM: '5' },
      },
```
（`extra: { arrowsM: '5' }` は変えない。ラベルだけ、Step 1・6 の表を読むときに前後どちらの本数かを取り違えないようにする。）

- [ ] **Step 5: テストが通ることを確かめ、ゲートを通す**

Run: `pnpm vitest run src/state/ src/ui/`
Expected: PASS（`perfParams.test.ts` の 4 つの期待も引き続き PASS。`arrowsM=5` は `PERF_ARROW_SPACINGS` がまだ受ける）

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium && pnpm size`
Expected: すべて成功（E2E は `'5 m'` を外した分だけクリックが減る。初期ロードは変わらない。`ARROW_SPACINGS` は定数の配列なので `DisplaySettings.tsx` は無変更で 2 個のボタンになる）

- [ ] **Step 6: 後を測る（同じコマンド、同じ機械、続けて）**

Run（バックグラウンド。33 ラン、約 22 分）:
```bash
pnpm build:perf
mkdir -p .handoff/06-perf/fixes/13b-after
cat > .handoff/06-perf/fixes/13b-after/snap.sh <<'EOF'
#!/usr/bin/env bash
{
  echo "=== $1 — $(date -Iseconds)"
  nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv
  uptime
  top -bn1 -o %CPU | sed -n '7,15p'
  echo
} >> .handoff/06-perf/fixes/13b-after/machine.txt
EOF
bash .handoff/06-perf/fixes/13b-after/snap.sh 'before isolate' && \
  RAINTRACE_FPS_SET=isolate RAINTRACE_FPS_REPEAT=3 RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/13b-after pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し && \
  RAINTRACE_FPS_SET=isolate-500 RAINTRACE_FPS_REPEAT=3 RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/13b-after pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し; \
  bash .handoff/06-perf/fixes/13b-after/snap.sh 'after isolate'
```
Expected: 2 件成功。「矢印 5 m」の行（1000 m・500 m）は `clampArrowSpacing(5) === 10` により既定（depthEvery=1）の行と同じ 2,500 本になり、平均 fps・g2 が既定の行に近づく（見込み: 1000 m・500 m とも 60.0 前後、g2 は既定と同程度）。既定の行そのもの（depthEvery=1、矢印 20 m）は前と同じ（この Task はそこを変えていない）。見込みと大きく違えば止めて知らせる

- [ ] **Step 7: 記録し、ゲートを通してコミットする**

`docs/perf/<実行日>-fixes.md` に「## Task 13b: 矢印の 1 辺の本数の上限」として、1000 m・500 m それぞれの「矢印 5 m」の行の前後（平均 fps・g2・D15）の表と、既定の行が変わっていないことを書く。1 行加える: 「前の表のこの行（`13b-before`）は 10,000 本、後の表（`13b-after`）は 2,500 本（`clampArrowSpacing(5) === 10` で既定と同じ本数に丸まるため。ラベルは Step 4 で直した）」（レビュー R1）。

`docs/superpowers/specs/2026-09-10-06-performance-design.md` §5.1 の「M4 の対応」の文の末尾（「前後の数字は Task 13b の完了後にこの節へ追記する」）を、実測の前後の数字に置き換える。§5.2 の「矢印の 1 辺の本数を全範囲で 50 に抑える」の行の「注意」列に、コミットと前後の数字（1 行）を足す。

`specs/tech-spec.md` §14.1 の「地図操作時のフレームレート」行の「主因は矢印の symbol の本数で、M4 の対応はユーザーの裁定待ち」を、「主因は矢印の symbol の本数。**R06-11 の裁定 (a2)**: 全範囲で矢印の 1 辺の本数の上限を 50 にする（5 m の選択肢を外す）。M4 の Task 13b で実装し、前後を測った（1000 m <前 fps> → <後 fps>、500 m <前 fps> → <後 fps>）」に置き換える。§8.3 の「バージョニング方針（決定）」の「マイグレーションを書かず、保存値を破棄して既定値にリセットする。」の後に 1 文足す（レビュー R2）:
```markdown
schemaVersion のマイグレーションはしない。外した選択肢の値（矢印の間隔 5）だけ 10 に読み替える（R06-11。§3.3・実装 `src/state/persistedSettings.ts` の `clampArrowSpacing`）。
```

`docs/superpowers/specs/2026-09-10-05-3d-rendering-design.md` §3.3 の「選べる間隔（今は 5・10・20 m）を範囲に応じてどう変えるかと最終の値は、05 の手動確認（1000 m）で決める」を、「選べる間隔は今は 10・20 m（5 m は 06 の R06-11 の裁定〈矢印の 1 辺の本数の上限を全範囲で 50 にする〉で外した）。1000 m の既定の間隔（20 m）は 05 の手動確認で決めた」に置き換える。

**注意（レビューの minor。記録として残す）:**
- m1: Step 1・6 は `isolate`（9 変種）・`isolate-500`（2 変種）を丸ごと回す。1 変種だけを選ぶ環境変数が `fps.perf.ts` に無いため（受け入れ済み。新しい絞り込みの組は作らない）
- m2: Task 13b の後、`isolate`・`isolate-500` の「矢印 5 m」の変種は既定（`depthEvery=1`・矢印 20 m）と同じ 2,500 本になる。それでも変種として残すのは、`arrowsM=5` が「選択肢から外れた値がクランプされること」自体の回帰確認になるため。**後続の `isolate` を使う Task（例: Task 22 の transfer 側の計画し直し）でこの表を読むときは、「矢印 5 m」の行が「もう 10,000 本ではなく、既定と同じ 2,500 本」であることを踏まえる**（Task 13b 以前の記録〈`docs/perf/2026-09-17-isolation.md`〉と比べるときは特に注意）

ゲートは `pnpm format && pnpm lint`（文書だけの追記。コードのゲートは Step 5 で通している）。

```bash
git add src/state/persistedSettings.ts src/state/persistedSettings.test.ts src/state/settingsStore.test.ts src/state/arrowSpacing.ts src/ui/perfParams.ts src/ui/perfHook.ts src/ui/simulationSession.test.ts tests/e2e/dem.spec.ts tests/perf/fps.perf.ts docs/perf/ docs/superpowers/specs/2026-09-10-06-performance-design.md docs/superpowers/specs/2026-09-10-05-3d-rendering-design.md specs/tech-spec.md
git commit -m "矢印の 1 辺の本数の上限を全範囲で 50 にする: 5 m の選択肢を外し（ARROW_SPACINGS を [10, 20] に）、保存値・計測だけの URL の 5 は 10 へ移行する（R06-11 の裁定 (a2)。spec 06 §5.1・§5.2、M4）"
```

---

### Task 14: `flowVectors()` の配列を使い回す（spec 06 §5.2、計画で決めたこと 16）

**条件:** Task 10 の「再生中の割り当て」が超過（コードの事実なので、M2 の判定で超過のはず）。

**Files:**
- Modify: `src/simulation/FlowSolver.ts`（`computeFlowVectors` に出力の配列の引数）
- Modify: `src/simulation/FlowSolver.test.ts`
- Modify: `src/simulation/TsSimulationEngine.ts`（配列を持ち、`loadTerrain` で捨てる）
- Modify: `src/simulation/TsSimulationEngine.test.ts`
- Modify: `src/simulation/types.ts`（`flowVectors` のコメント）
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: なし
- Produces: `export interface FlowVectors { x: Float32Array; y: Float32Array }`、`computeFlowVectors(t, w, win, s, out?: FlowVectors): FlowVectors`。`SimulationEngine.flowVectors()` の型は変えない（戻り値は次の `flowVectors()`・`loadTerrain` まで有効）

- [ ] **Step 1: 前を測る（渋谷 1000 m・全面を濡らす雨・2D・60 秒の窓。矢印は既定で表示）**

Run: `pnpm build:perf && RAINTRACE_STEPS_SITES=shibuya RAINTRACE_STEPS_SIZES=1000 RAINTRACE_STEPS_RAINS=full RAINTRACE_STEPS_UNTIL=window RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/fixes/14-before pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected: 1 件成功。`step／秒`・1 step の p95・最大・長いタスクを控える

- [ ] **Step 2: 失敗するテストを書く**

`src/simulation/FlowSolver.test.ts` の `describe('computeFlowVectors（spec 03 §3.9）'` の中の最後に足す:

```ts
  it('出力の配列を渡すと、それに書いて返す。前の値は 0 に戻す（使い回し。spec 06 §5.2）', () => {
    const t = flat(5, 3)
    for (let i = 0; i < 15; i++) t.elevation[i] = 4 - (i % 5)
    const w = new Float64Array(15)
    w[7] = 0.1
    const out = { x: new Float32Array(15).fill(9), y: new Float32Array(15).fill(9) }
    const v = computeFlowVectors(t, w, { x0: 0, y0: 0, x1: 5, y1: 3 }, createScratch(), out)
    expect(v).toBe(out)
    const fresh = computeFlowVectors(t, w, { x0: 0, y0: 0, x1: 5, y1: 3 }, createScratch())
    expect(Array.from(v.x)).toEqual(Array.from(fresh.x))
    expect(Array.from(v.y)).toEqual(Array.from(fresh.y))
  })

  it('出力の配列の大きさが合わなければ、新しく確保する', () => {
    const w = new Float64Array(9)
    const out = { x: new Float32Array(4), y: new Float32Array(4) }
    const v = computeFlowVectors(flat(3, 3), w, { x0: 0, y0: 0, x1: 3, y1: 3 }, createScratch(), out)
    expect(v).not.toBe(out)
    expect(v.x.length).toBe(9)
  })
```

`src/simulation/TsSimulationEngine.test.ts` の `describe('flowVectors（§3.9、§6.3）'` の中の最後に足す:

```ts
  it('同じ配列を使い回し、呼ぶたびに今の水で書き直す（新しいエンジンの値とビット単位で同じ）', () => {
    const t = buildTerrain(15, 9, 1, (x) => (14 - x) * 0.2)
    const a = engineOn(t)
    const b = engineOn(t)
    const rain = { ...cellCenter(5, 4, 1), radiusM: 2, amountMm: 50 }
    a.addRainfall(rain)
    b.addRainfall(rain)
    const first = a.flowVectors()
    for (let n = 0; n < 20; n++) {
      a.step()
      b.step()
    }
    const second = a.flowVectors()
    expect(second.x).toBe(first.x)
    expect(second.y).toBe(first.y)
    const fresh = engineOn(t)
    fresh.addRainfall(rain)
    for (let n = 0; n < 20; n++) fresh.step()
    const expected = fresh.flowVectors()
    expect(Array.from(second.x)).toEqual(Array.from(expected.x))
    expect(Array.from(second.y)).toEqual(Array.from(expected.y))
  })

  it('loadTerrain で大きさが変わったら、新しい大きさの配列にする', () => {
    const engine = engineOn(buildTerrain(4, 4, 1, () => 0))
    expect(engine.flowVectors().x.length).toBe(16)
    const t = buildTerrain(6, 5, 1, () => 0)
    engine.loadTerrain(t.elevation, t.validMask, t.meta)
    expect(engine.flowVectors().x.length).toBe(30)
  })
```

- [ ] **Step 3: 失敗を確かめる**

Run: `pnpm vitest run src/simulation/FlowSolver.test.ts src/simulation/TsSimulationEngine.test.ts`
Expected: FAIL（`expect(v).toBe(out)`、`expect(second.x).toBe(first.x)`）

- [ ] **Step 4: 直す**

`src/simulation/FlowSolver.ts` の `computeFlowVectors` を次に置き換える:

```ts
/** 流れのベクトル（x は東が正、y は南が正。m／step） */
export interface FlowVectors {
  x: Float32Array
  y: Float32Array
}

/**
 * 現在の W に §3.2 の式を当てはめたときの各セルの流出を、流出先の方向の単位ベクトルで
 * 重み付けして足したもの（m／step）。水は動かさない。濡れていないセルは 0。
 * out を渡すと（大きさが合えば）それを 0 で埋めて書き、返す。1000 m で 2 × 1031² × 4 バイト = 8.5 MB を
 * 矢印の計算のたび（最短 100 ms ごと）に確保しないため（spec 06 §5.2）
 */
export function computeFlowVectors(
  t: TerrainArrays,
  w: Float64Array,
  win: ScanWindow,
  s: Scratch,
  out?: FlowVectors,
): FlowVectors {
  const { width, height } = t
  const n = width * height
  let vx: Float32Array
  let vy: Float32Array
  if (out !== undefined && out.x.length === n && out.y.length === n) {
    vx = out.x
    vy = out.y
    vx.fill(0)
    vy.fill(0)
  } else {
    vx = new Float32Array(n)
    vy = new Float32Array(n)
  }
  const { g } = s
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      const wi = w[i]
      if (wi === 0) continue
      const total = outflowCandidates(t, w, x, y, i, s)
      if (total === 0) continue
      const scale = total <= wi ? 1 : wi / total
      let sx = 0
      let sy = 0
      for (let k = 0; k < 8; k++) {
        const f = scale * g[k]
        sx += f * UNIT_X[k]
        sy += f * UNIT_Y[k]
      }
      vx[i] = sx
      vy[i] = sy
    }
  }
  return out !== undefined && vx === out.x ? out : { x: vx, y: vy }
}
```

（置き換える前の JSDoc「現在の W に §3.2 の式を…濡れていないセルは 0」はこの JSDoc に含めたので消す。）

`src/simulation/TsSimulationEngine.ts`:
- import の `computeFlowVectors,` の隣に `type FlowVectors,` を足す
- `private readonly scratch: Scratch = createScratch()` の後に `/** flowVectors の出力（使い回す。loadTerrain で捨てる。spec 06 §5.2） */` と `private flow: FlowVectors | undefined = undefined` を足す
- `loadTerrain` の `this.notified = new Uint8Array(0)` の後に `this.flow = undefined` を足す
- `flowVectors()` を次に置き換える:

```ts
  flowVectors(): { x: Float32Array; y: Float32Array } {
    const { terrain, grid } = this.require()
    this.flow = computeFlowVectors(terrain, grid.current, grid, this.scratch, this.flow)
    return this.flow
  }
```

`src/simulation/types.ts` の `flowVectors()` の JSDoc を次に置き換える:

```ts
  /**
   * 現在の状態から計算した、各セルの流出のベクトル（水の流れの矢印用）。
   * 戻り値の配列はエンジンが使い回し、次の flowVectors()・loadTerrain で上書きされる。呼び出し側はすぐに読み切る
   * （Worker の SimulationRunner.arrowsFor が thinFlowArrows で読む。spec 06 §5.2）
   */
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `pnpm vitest run src/simulation/ src/workers/`
Expected: PASS（Runner の矢印のテストも通る）

- [ ] **Step 6: 後を測る**

Run: `pnpm build:perf && RAINTRACE_STEPS_SITES=shibuya RAINTRACE_STEPS_SIZES=1000 RAINTRACE_STEPS_RAINS=full RAINTRACE_STEPS_UNTIL=window RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/fixes/14-after pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected: 1 件成功。`step／秒` が前と同じか高い、1 step の最大が前と同じか小さい（GC の停止が減る）。悪化したら止めて知らせる

- [ ] **Step 7: 記録し、ゲートを通してコミットする**

`docs/perf/<実行日>-fixes.md` に「## Task 14: flowVectors の使い回し」として、前後の `step／秒`・1 step の中央値・p95・最大・長いタスクの表を書く。

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium && pnpm size`
Expected: すべて成功（E2E 41 件。矢印の E2E を含む）、初期ロード 427.5 KB

```bash
git add src/simulation/FlowSolver.ts src/simulation/FlowSolver.test.ts src/simulation/TsSimulationEngine.ts src/simulation/TsSimulationEngine.test.ts src/simulation/types.ts docs/perf/
git commit -m "flowVectors() の 2 × N² の配列をエンジンが使い回す（1000 m で 8.5 MB を 100 ms ごとに確保しない。型は変えない。spec 06 §5.2）"
```

---

### Task 15: 1 step の軽い改善: 内側のセルの近傍を添字の足し算で引く（03 の軽微 8、spec 06 §5・§5.2、計画で決めたこと 16）

**条件:** 常に行う（spec 06 §1.2: M4 の 1 step の軽い改善の後に平衡を測り直して確定する）。

**Files:**
- Modify: `src/simulation/FlowSolver.ts`（`Scratch`、`createScratch`、`outflowCandidates` を 2 つに分ける）
- Modify: `src/simulation/FlowSolver.test.ts`
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: Task 14 の `computeFlowVectors`
- Produces: `Scratch` に `offsets: Int32Array`・`offsetsWidth: number`。`export function edgeOutflowCandidates(t, w, x, y, i, s): number`、`export function interiorOutflowCandidates(t, w, i, s): number`（テストが突き合わせる。エンジンの外には公開しない）

- [ ] **Step 1: 前を測る**

Run: `pnpm bench:engine 2000 | tee .handoff/06-perf/fixes/15-before-bench.md`
Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_STEPS_SIZES=500 RAINTRACE_STEPS_RAINS=full RAINTRACE_STEPS_UNTIL=window RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/fixes/15-before pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected: ベンチマークの表、3 地点 × 500 m・全面を濡らす雨の 60 秒の窓の表（1 step の中央値・p95・step／秒）

- [ ] **Step 2: 失敗するテストを書く**

`src/simulation/FlowSolver.test.ts` の import に `edgeOutflowCandidates`・`interiorOutflowCandidates` を足し、末尾に足す:

```ts
describe('内側のセルの近傍の添字（03 の軽微 8、spec 06 §5.2）', () => {
  /** 決まった種の擬似乱数（mulberry32） */
  function random(seed: number): () => number {
    let a = seed
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  it('内側のすべてのセルで、端の版と g・近傍・合計がビット単位で同じ（無効セルと乾いた近傍を含む）', () => {
    const next = random(42)
    const width = 13
    const height = 9
    const t = flat(width, height)
    const w = new Float64Array(width * height)
    for (let i = 0; i < width * height; i++) {
      t.elevation[i] = next() * 2
      t.validMask[i] = next() < 0.15 ? 0 : 1
      w[i] = next() < 0.3 ? 0 : next() * 0.05
    }
    const edge = createScratch()
    const interior = createScratch()
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const a = edgeOutflowCandidates(t, w, x, y, i, edge)
        const b = interiorOutflowCandidates(t, w, i, interior)
        expect(Object.is(a, b)).toBe(true)
        expect(Array.from(interior.g)).toEqual(Array.from(edge.g))
        expect(Array.from(interior.nb)).toEqual(Array.from(edge.nb))
      }
    }
  })

  it('幅が変わったら添字の差を作り直す', () => {
    const s = createScratch()
    const a = flat(5, 5)
    interiorOutflowCandidates(a, new Float64Array(25), 12, s)
    expect(s.offsetsWidth).toBe(5)
    expect(Array.from(s.offsets)).toEqual([-6, -5, -4, -1, 1, 4, 5, 6])
    const b = flat(7, 3)
    interiorOutflowCandidates(b, new Float64Array(21), 8, s)
    expect(s.offsetsWidth).toBe(7)
    expect(Array.from(s.offsets)).toEqual([-8, -7, -6, -1, 1, 6, 7, 8])
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `pnpm vitest run src/simulation/FlowSolver.test.ts`
Expected: FAIL（`edgeOutflowCandidates` が export されていない）

- [ ] **Step 4: 直す**

`src/simulation/FlowSolver.ts` の `Scratch` に足す:

```ts
  /** 内側のセルの 8 近傍の添字の差（NEIGHBOR_DY × 幅 + NEIGHBOR_DX）。offsetsWidth の幅で作った */
  offsets: Int32Array
  offsetsWidth: number
```

`createScratch` を `return { g: new Float64Array(8), nb: new Int32Array(8), offsets: new Int32Array(8), offsetsWidth: -1 }` にする。

`function outflowCandidates(…) { … }` を、次の 3 つに置き換える（`edgeOutflowCandidates` の本体は置き換える前の `outflowCandidates` の本体そのまま）:

```ts
/**
 * セル i（列 x、行 y）から各近傍への流量の候補 g_ij を scratch に書き、合計 G_i を返す。
 * グリッドの外と無効セルは、標高が i と同じで水深 0 の仮想セルとして扱う（§3.3）。
 * 上下左右の端でないセルは、近傍が必ずグリッドの中なので、範囲の判定を省いて添字の足し算で引く
 * （03 の軽微 8。演算の順は同じなので結果はビット単位で同じ。FlowSolver.test.ts が突き合わせる）
 */
function outflowCandidates(
  t: TerrainArrays,
  w: Float64Array,
  x: number,
  y: number,
  i: number,
  s: Scratch,
): number {
  if (x > 0 && y > 0 && x < t.width - 1 && y < t.height - 1) {
    return interiorOutflowCandidates(t, w, i, s)
  }
  return edgeOutflowCandidates(t, w, x, y, i, s)
}

/** 端のセルを含む、どのセルでも使える版（範囲の判定つき） */
export function edgeOutflowCandidates(
  t: TerrainArrays,
  w: Float64Array,
  x: number,
  y: number,
  i: number,
  s: Scratch,
): number {
  const { width, height, elevation, validMask } = t
  const zi = elevation[i]
  const hi = zi + w[i]
  let sum = 0
  for (let k = 0; k < 8; k++) {
    const nx = x + NEIGHBOR_DX[k]
    const ny = y + NEIGHBOR_DY[k]
    let j = -1
    let hj = zi
    if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
      const c = ny * width + nx
      if (validMask[c] !== 0) {
        j = c
        hj = elevation[c] + w[c]
      }
    }
    const dh = hi - hj
    const gk = dh > FLOW_THRESHOLD_M ? FLOW_K * NEIGHBOR_WEIGHT[k] * dh : 0
    s.nb[k] = j
    s.g[k] = gk
    sum += gk
  }
  return sum
}

/** 内側のセル（1 ≤ x < 幅 − 1、1 ≤ y < 高さ − 1）だけに使う版 */
export function interiorOutflowCandidates(
  t: TerrainArrays,
  w: Float64Array,
  i: number,
  s: Scratch,
): number {
  const { width, elevation, validMask } = t
  if (s.offsetsWidth !== width) {
    for (let k = 0; k < 8; k++) s.offsets[k] = NEIGHBOR_DY[k] * width + NEIGHBOR_DX[k]
    s.offsetsWidth = width
  }
  const { offsets } = s
  const zi = elevation[i]
  const hi = zi + w[i]
  let sum = 0
  for (let k = 0; k < 8; k++) {
    const c = i + offsets[k]
    let j = -1
    let hj = zi
    if (validMask[c] !== 0) {
      j = c
      hj = elevation[c] + w[c]
    }
    const dh = hi - hj
    const gk = dh > FLOW_THRESHOLD_M ? FLOW_K * NEIGHBOR_WEIGHT[k] * dh : 0
    s.nb[k] = j
    s.g[k] = gk
    sum += gk
  }
  return sum
}
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `pnpm vitest run src/simulation/`
Expected: PASS（`scenarios.test.ts`・`properties.test.ts`・`fillMatch.test.ts` を含むすべて。結果はビット単位で同じなので期待値は変わらない）

- [ ] **Step 6: 後を測る**

Run: `pnpm bench:engine 2000 | tee .handoff/06-perf/fixes/15-after-bench.md`
Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_STEPS_SIZES=500 RAINTRACE_STEPS_RAINS=full RAINTRACE_STEPS_UNTIL=window RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/fixes/15-after pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected: 半径 100 m の Node の中央値が前より小さい（03 の軽微 8 は solveStep で −18%。bench:engine は step 全体なので減り方は小さくてよい）。ブラウザの 1 step の中央値も前より小さい。**どちらも悪化したら**、V8 の最適化が外れた可能性があるので、`outflowCandidates` の分岐を `solveStep`・`computeFlowVectors` のループの中に書いた形を試し、それでも悪化するなら元に戻して「効果なし」と記録する（コミットは記録だけにする）

- [ ] **Step 7: 記録し、ゲートを通してコミットする**

`docs/perf/<実行日>-fixes.md` に「## Task 15: 内側のセルの近傍の添字」として、Node のベンチマークの前後と、3 地点の 1 step の中央値・p95・step／秒の前後を書く。

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium`
Expected: すべて成功（`src/simulation/**` のカバレッジ 90% 以上）

```bash
git add src/simulation/FlowSolver.ts src/simulation/FlowSolver.test.ts docs/perf/
git commit -m "1 step の軽い改善: 内側のセルの 8 近傍を範囲の判定なしの添字の足し算で引く（結果はビット単位で同じ。03 の軽微 8、spec 06 §5.2）"
```

---

### Task 16: `elevationRgba`・`depressionRgba` でセルごとの配列を作らない（spec 06 §5.2、計画で決めたこと 16）

**条件:** Task 10 の「メインスレッドの最長ブロック」が超過し、超過したのが地形の読み込みの終わり（`load.md` の「長いタスク 読み込み」の最大が 50 ms 超）。

**Files:**
- Modify: `src/map/colormap.ts`
- Modify: `src/map/colormap.test.ts`
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: なし
- Produces: `elevationRgba`・`depressionRgba` の出力は変えない（ビット単位で同じ）

- [ ] **Step 1: 前を測る（3 地点 × 500・1000 m × 3 回、地理院に接続）**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/16-before pnpm perf:fps tests/perf/fps.perf.ts -g クリック`
Expected: 1 件成功。1000 m の「長いタスク 読み込み」の最大と「2D の表示」を控える

- [ ] **Step 2: 旧版と突き合わせるテストを書く**

`src/map/colormap.ts` の `const DEPRESSION_BANDS: readonly Rgb[] = [` を `export const DEPRESSION_BANDS: readonly Rgb[] = [` にする（旧版の写しがテストで帯の色を引くため。値は変えない）。`src/map/colormap.test.ts` の `./colormap` の import に `DEPRESSION_BANDS,` を足し、末尾に足す:

```ts
describe('RGBA の組み立ては、配列を作らない版でも旧版とビット単位で同じ（spec 06 §5.2）', () => {
  /** 決まった種の擬似乱数（mulberry32） */
  function random(seed: number): () => number {
    let a = seed
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /** 置き換える前の elevationRgba（06 の Task 16 の前の colormap.ts の写し） */
  function referenceElevationRgba(
    elevation: Float32Array,
    validMask: Uint8Array,
    min: number,
    max: number,
  ): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(elevation.length * 4)
    const span = max - min
    for (let i = 0; i < elevation.length; i++) {
      if (validMask[i] !== 1) continue
      const [r, g, b] = elevationColor(span > 0 ? ((elevation[i] ?? min) - min) / span : 0)
      rgba.set([r, g, b, 200], i * 4)
    }
    return rgba
  }

  it('elevationRgba: 無効セル・範囲の外・NaN・最低と最高が同じ場合を含めて一致する', () => {
    const next = random(7)
    const n = 4096
    const elevation = new Float32Array(n)
    const validMask = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      elevation[i] = next() * 40 - 5
      validMask[i] = next() < 0.1 ? 0 : 1
    }
    elevation[3] = Number.NaN
    for (const [min, max] of [
      [-2, 30],
      [5, 5],
      [10, 0],
    ] as const) {
      expect(Array.from(elevationRgba(elevation, validMask, min, max))).toEqual(
        Array.from(referenceElevationRgba(elevation, validMask, min, max)),
      )
    }
  })

  /** 置き換える前の depressionRgba（06 の Task 16 の前の colormap.ts の写し） */
  function referenceDepressionRgba(
    fill: Float32Array,
    elevation: Float32Array,
    labels: Int32Array,
    depressions: Parameters<typeof depressionRgba>[3],
  ): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(fill.length * 4)
    for (let i = 0; i < fill.length; i++) {
      const label = labels[i] ?? 0
      if (label === 0 || !depressions[label - 1]?.significant) continue
      const depth = (fill[i] ?? 0) - (elevation[i] ?? 0)
      if (depth <= 0) continue
      const color = DEPRESSION_BANDS[depthBand(depth)] ?? [0, 0, 0]
      rgba.set([color[0], color[1], color[2], 220], i * 4)
    }
    return rgba
  }

  it('depressionRgba: 表示対象・対象外・深さ 0 以下・最も深い帯を含めて一致する', () => {
    const next = random(11)
    const n = 2048
    const fill = new Float32Array(n)
    const elevation = new Float32Array(n)
    const labels = new Int32Array(n)
    for (let i = 0; i < n; i++) {
      elevation[i] = next() * 3
      fill[i] = elevation[i] + (next() < 0.2 ? -0.01 : next() * 0.6)
      labels[i] = Math.floor(next() * 4)
    }
    const depressions = [
      makeDepression({ id: 1, significant: true }),
      makeDepression({ id: 2, significant: false }),
      makeDepression({ id: 3, significant: true }),
    ]
    expect(Array.from(depressionRgba(fill, elevation, labels, depressions))).toEqual(
      Array.from(referenceDepressionRgba(fill, elevation, labels, depressions)),
    )
  })
})
```

- [ ] **Step 3: テストが今の実装で通ることを確かめる（基準を固定する）**

Run: `pnpm vitest run src/map/colormap.test.ts`
Expected: PASS（今の実装は旧版そのものなので通る。直した後も通ることが「ビット単位で同じ」の確かめになる）

- [ ] **Step 4: 直す**

`src/map/colormap.ts` の `elevationRgba` を次に置き換える:

```ts
/**
 * 標高を範囲内の最低〜最高で色分けした RGBA（無効セルは透明）。1000 m（約 106 万セル）ではメインスレッドの
 * 長いタスクの主因だったので（04 の 75 ms）、セルごとに配列（elevationColor の戻り値と set の引数）を作らない。
 * 色の式は interpolateStops と同じで、出力はビット単位で同じ（colormap.test.ts が旧版と突き合わせる。spec 06 §5.2）
 */
export function elevationRgba(
  elevation: Float32Array,
  validMask: Uint8Array,
  min: number,
  max: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(elevation.length * 4)
  const span = max - min
  const last = ELEVATION_STOPS.length - 1
  for (let i = 0; i < elevation.length; i++) {
    if (validMask[i] !== 1) continue
    const t = span > 0 ? ((elevation[i] ?? min) - min) / span : 0
    const position = Math.min(1, Math.max(0, t)) * last
    const lower = Math.min(last - 1, Math.floor(position))
    const f = position - lower
    const a = ELEVATION_STOPS[lower] ?? BLACK
    const b = ELEVATION_STOPS[lower + 1] ?? a
    const o = i * 4
    rgba[o] = Math.round(a[0] + (b[0] - a[0]) * f)
    rgba[o + 1] = Math.round(a[1] + (b[1] - a[1]) * f)
    rgba[o + 2] = Math.round(a[2] + (b[2] - a[2]) * f)
    rgba[o + 3] = ELEVATION_ALPHA
  }
  return rgba
}
```

`depressionRgba` の `const color = DEPRESSION_BANDS[depthBand(depth)] ?? BLACK` と `rgba.set([color[0], color[1], color[2], DEPRESSION_ALPHA], i * 4)` を次に置き換える:

```ts
    const color = DEPRESSION_BANDS[depthBand(depth)] ?? BLACK
    // セルごとに配列を作らない（spec 06 §5.2）
    const o = i * 4
    rgba[o] = color[0]
    rgba[o + 1] = color[1]
    rgba[o + 2] = color[2]
    rgba[o + 3] = DEPRESSION_ALPHA
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `pnpm vitest run src/map/colormap.test.ts`
Expected: PASS（Step 2 の突き合わせを含む）

- [ ] **Step 6: 後を測る**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/16-after pnpm perf:fps tests/perf/fps.perf.ts -g クリック`
Expected: 1000 m の「長いタスク 読み込み」の最大が前より小さい。**50 ms 以下なら** Task 17 は行わない。**50 ms を超えていれば** Task 17 の条件を満たす

- [ ] **Step 7: 記録し、ゲートを通してコミットする**

`docs/perf/<実行日>-fixes.md` に「## Task 16: 地形の RGBA」として、3 地点 × 1000 m の長いタスクの最大と「2D の表示」の前後（中央値）を書く。

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium`
Expected: すべて成功（地形の色分けの E2E を含む）

```bash
git add src/map/colormap.ts src/map/colormap.test.ts docs/perf/
git commit -m "地形の標高・窪地の RGBA をセルごとの配列を作らずに組み立てる（出力はビット単位で同じ。1000 m の読み込みの終わりの長いタスクを減らす。spec 06 §5.2）"
```

---

### Task 17:（条件つき・計画し直す）地形の重ね描きの組み立てを複数のタスクに分ける

**条件:** Task 16 の後も、1000 m **または 500 m** の読み込みの終わりの長いタスクが 50 ms を超える（500 m の読み込みは M2 で 9 ラン中 5 ラン〈綾瀬 #1・#3、みなとみらい #1・#2・#3。51〜73 ms〉が超えており、04 の記録は 0 件だった。500 m の `elevationRgba` は約 19 ms〈04 の記録〉なので、Task 16 だけでは消えない見込み）。

**計画し直す理由:** 残りの内訳（React・Emotion の再描画、`putImageData`、`texSubImage2D`、GC。04 の記録では React・Emotion が計 約 95 ms）を、Task 16 の後の Chrome の Performance のプロファイルで確かめてからでないと、分ける場所が決まらない。計画し直すときの枠:
- 候補 (a): `TerrainOverlay.addAll` の標高と窪地の canvas の組み立てを、`setTimeout(0)` で別のタスクに分ける（`generation` の検査を各タスクの頭に置き、読み込みの取り消しと両立させる）
- 候補 (b): パネルの再描画（`setTerrain` による React の更新）を地図の重ね描きと別のタスクにする
- どちらも Worker とメッセージの形を変えない（安価の内）。変えるなら安価の外（spec 06 §5.2）なので別の spec
- 前後は Task 16 と同じコマンドで測る

- [x] **Step 1: プロファイルを取り、計画を書き足してレビュー役に送る**

計測用のビルドで 1000 m と 500 m の `probe=load` を開き、Chrome の Performance（`page.tracing` でもよい）で読み込みの終わりの長いタスクの内訳を取り、`.handoff/06-perf/fixes/17-profile.md` に書く（500 m は 04 が記録した React・Emotion の再描画〈計 約 95 ms〉を候補に含めて見る）。内訳に合う候補をこの Task の下に具体的な Files・Interfaces・Step（テストを含む）として書き、コントローラーに送る。承認の後に実装し、1 コミットにする。

**Step 1 の結果（2026-09-17、`.handoff/06-perf/fixes/17-profile.md`）:** 読み込みの終わりの長いタスクは 3 ラン（綾瀬・渋谷 1000 m、綾瀬 500 m）とも 1 つで、Worker の `terrain` の応答の中で `TerrainSession.load` の続き（`TerrainOverlay.addAll`・`WaterOverlay.show`・React の commit）が全部走っている。トレースの下の内訳（綾瀬 1000 m／渋谷 1000 m／綾瀬 500 m、ms）: `addAll` 88.5／82.3／51.8（うち `elevationRgba` 42.9／45.5／17.9、`addCanvasLayer` ×2 15.7／10.9／7.0、`ensureArrowImage` 11.5／13.3／13.1、`depressionRgba` 8.9／6.6／5.2）、`WaterOverlay.show` の `ensureArrowImage` 5.5／7.8／9.7、React の commit 9.9／8.9／13.1、GC 7.3／3.0／< 3。候補 (b)（React）は小さいので採らない。候補 (a) を「標高」「窪地と残り」の 2 段で採り、`ensureArrowImage` の `getImageData`（GPU の canvas からの同期の読み戻し）を `willReadFrequently: true` で消す (c) を足す。段に分けると、同じタスクで先に足される 2D の水深・矢印（`WaterOverlay`）と 3D の hillshade・水面（`View3d`）の `beforeId` がまだ無い地形のレイヤーを指せず一番上に積まれるので、**重なりの順を固定の並びから決める**。

**Files（Step 2 以降）:**
- Create: `src/map/layerIds.ts`（`TERRAIN_LAYER_IDS`・`WATER_LAYER_IDS` を移し、重なりの順 `OVERLAY_LAYER_ORDER` と `beforeLayerId` を置く）
- Create: `src/map/layerIds.test.ts`
- Modify: `src/map/TerrainOverlay.ts`（`addAll` を 2 段に分け、`showTerrain` からは別々のタスクで呼ぶ。`TERRAIN_LAYER_IDS` は `./layerIds` から再エクスポート）
- Modify: `src/map/WaterOverlay.ts`（`WATER_LAYER_IDS` を `./layerIds` から再エクスポート。`beforeId` を `beforeLayerId` で決める）
- Modify: `src/map/view3d/View3d.ts`（hillshade・水面の `beforeId` を `beforeLayerId` で決める）
- Modify: `src/map/arrowImage.ts`（`getContext('2d', { willReadFrequently: true })`）
- Modify: `src/map/MapController.ts`（E2E 用の印 `data-overlay-order`: 今のスタイルの実際の重なり順〈`map.getLayersOrder()`〉のうち `OVERLAY_LAYER_ORDER` にある ID）
- Modify: `tests/e2e/simulation.spec.ts`・`tests/e2e/view3d.spec.ts`（重なり順を確かめる）
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: なし（Worker・`src/shared/protocol.ts`・`SimulationEngine` は変えない。R06-4 の安価の内）
- Produces:

```ts
// src/map/layerIds.ts（map の中の純粋なモジュール。maplibre-gl を import しない）
export const TERRAIN_LAYER_IDS = { /* 今の TerrainOverlay.ts の値のまま */ } as const
export const WATER_LAYER_IDS = { water: 'water-depth', arrows: 'water-arrows' } as const
/** 重ね描きのレイヤーの下から上への並び（04 の重ね描き・spec 05 §3.3・§3.6 の今の並びを写したもの） */
export const OVERLAY_LAYER_ORDER: readonly string[] = [
  VIEW3D_LAYER_IDS.hillshade,
  TERRAIN_LAYER_IDS.elevation,
  TERRAIN_LAYER_IDS.depressions,
  WATER_LAYER_IDS.water,
  VIEW3D_LAYER_IDS.water,
  TERRAIN_LAYER_IDS.outline,
  TERRAIN_LAYER_IDS.flow,
  WATER_LAYER_IDS.arrows,
  TERRAIN_LAYER_IDS.markers,
]
/**
 * id を OVERLAY_LAYER_ORDER どおりに置くための addLayer の beforeId: 並びで id より上のレイヤーのうち、
 * 今ある（has が true）一番下のもの。無ければ undefined（一番上に積む）。並びに無い id は例外
 */
export function beforeLayerId(id: string, has: (id: string) => boolean): string | undefined
```

- `TerrainOverlay` の外から見た振る舞い: `data-range-shown` は段 2 の終わりに立つ（今と同じく「全部のレイヤーを足した」印）。`restore`（ベースマップの切り替え）は今と同じく同期で全部を足す

- [ ] **Step 2: 前を測る（Task 16 と同じコマンド）**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/17-before pnpm perf:fps tests/perf/fps.perf.ts -g クリック`（前後に `snap.sh` で `machine.txt` を取る。16-after と同じ手順）
Expected: 1 件成功。「長いタスク 読み込み」「長いタスク 3D」「2D の表示」を控える

- [ ] **Step 3: 重なり順の道具のテストを書く（失敗を確かめる）**

`src/map/layerIds.test.ts`:
- `OVERLAY_LAYER_ORDER` は `TERRAIN_LAYER_IDS`・`WATER_LAYER_IDS`・`VIEW3D_LAYER_IDS` の値をちょうど 1 回ずつ含む
- 何も無ければ `undefined`
- 2D で段に分けた順（水深・矢印が先、地形が後）: 水深（`water-depth`）と矢印（`water-arrows`）だけがあるとき、標高・窪地の `beforeId` は `water-depth`、枠（`terrain-outline`）・流向（`terrain-flow`）は `water-arrows`、最低点（`terrain-markers`）は `undefined`
- 3D: 地形が 1 つも無いときの hillshade は `undefined`、標高があれば `terrain-elevation`。水面（`water-3d`）は枠があれば `terrain-outline`、枠が無く矢印だけあれば `water-arrows`
- 並びに無い id は例外

Run: `pnpm vitest run src/map/layerIds.test.ts`
Expected: FAIL（`./layerIds` が無い）

- [ ] **Step 4: `layerIds.ts` を作り、ID の置き場所を移す**

`TERRAIN_LAYER_IDS`（`TerrainOverlay.ts`）と `WATER_LAYER_IDS`（`WaterOverlay.ts`）の定義を `layerIds.ts` に移し、両ファイルは `export { TERRAIN_LAYER_IDS } from './layerIds'`・`export { WATER_LAYER_IDS } from './layerIds'` で再エクスポートする（`MapController`・`View3d`・E2E の import を変えない。`TerrainOverlay` ⇄ `WaterOverlay` の import も `./layerIds` に替え、循環を作らない）。`beforeLayerId` は並びの中の id の位置から上を順に見て、`has` が true の最初のものを返す。

Run: `pnpm vitest run src/map/layerIds.test.ts && pnpm depcheck`
Expected: PASS

- [ ] **Step 5: 重なり順の印と E2E を足す（今の実装で通ることを確かめる）**

`MapController.writeOverlayLayers` で、`data-overlay-layers` と同じ差分の判定に `this.map.getLayersOrder().filter((id) => OVERLAY_LAYER_ORDER.includes(id)).join(',')` を足し、`dataset.overlayOrder` に書く（MapLibre 6.6.0 の公開 API `Map.getLayersOrder`。内部には頼らない）。
- `tests/e2e/simulation.spec.ts`: 地形が出て水深・矢印のレイヤーが揃った後の `data-overlay-order` が `terrain-elevation,terrain-depressions,water-depth,terrain-outline,terrain-flow,water-arrows,terrain-markers`（`OVERLAY_LAYER_ORDER` から今ある ID を抜いた並び）と一致する
- `tests/e2e/view3d.spec.ts`: 3D に切り替えて水面ができた後、`terrain-3d-hillshade` が先頭で、`water-3d` が `water-depth` と `terrain-outline` の間

Run: `pnpm build && pnpm exec playwright test --project=chromium tests/e2e/simulation.spec.ts tests/e2e/view3d.spec.ts`
Expected: PASS（段に分ける前の同期の実装で、並びが `OVERLAY_LAYER_ORDER` と一致することの基準）

- [ ] **Step 6: 段に分け、`beforeId` を並びから決め、矢印の画像の読み戻しを消す**

`src/map/TerrainOverlay.ts`:
- `addAll` を `addElevationLayer()`（`elevationRgba` と標高の canvas のレイヤー）と `addRemainingLayers()`（窪地の canvas・枠・矢印の画像・流向・最低点・`setDisplay(display)`・`dataset.rangeShown = 'true'`）に分ける。`addAll` は両方を続けて呼ぶ（`restore` が使う）
- `addCanvasLayer`・枠・流向・最低点の `map.addLayer` の第 2 引数に `beforeLayerId(id, (other) => this.map.getLayer(other) !== undefined)` を渡す
- `showTerrain` の `whenMapLoaded` の中は `removeLayers()`・`this.terrain = terrain`・`fitBounds` の後、`this.later(generation, () => { this.addElevationLayer(); this.later(generation, () => this.addRemainingLayers()) })` にする。`later` は `setTimeout(() => this.whenMapLoaded(() => { if (generation === this.generation && this.terrain !== null) run() }), 0)`（読み込みの取り消し〈`clearTerrain`・次の `showTerrain`〉と、段の間のベースマップの切り替え〈`whenMapLoaded` が読み込みを待つ〉と両立させる）
- `restore` の先頭で `this.generation++` する（段の途中でベースマップを切り替えたら、`addAll` が全部を足し、待っている段は捨てる。二重の `addLayer` を起こさない）
- `setDisplay` の「地形のレイヤーがあるか」の判定を、最後に足す `TERRAIN_LAYER_IDS.markers` で見る（段 1 と段 2 の間に表示の設定が変わっても、まだ無い窪地・流向のレイヤーに `setLayoutProperty` しない。覚えた設定は段 2 の終わりの `setDisplay(display)` が適用する）

`src/map/WaterOverlay.ts` の `before(TERRAIN_LAYER_IDS.outline)`・`before(TERRAIN_LAYER_IDS.markers)` を `beforeLayerId(WATER_LAYER_IDS.water, has)`・`beforeLayerId(WATER_LAYER_IDS.arrows, has)` に、`src/map/view3d/View3d.ts` の `hillshadeBeforeId` と `addWater` の `before` を `beforeLayerId(VIEW3D_LAYER_IDS.hillshade, has)`・`beforeLayerId(VIEW3D_LAYER_IDS.water, has)` に替える。

`src/map/arrowImage.ts`: `canvas.getContext('2d', { willReadFrequently: true })`（CPU の canvas にして `getImageData` の GPU からの読み戻しを無くす。24 × 24 の矢印の縁のアンチエイリアスの値がわずかに変わる。`17-profile.md`）。

Run: `pnpm vitest run src/map && pnpm build && pnpm exec playwright test --project=chromium tests/e2e/simulation.spec.ts tests/e2e/view3d.spec.ts tests/e2e/dem.spec.ts`
Expected: PASS（Step 5 の重なり順を含む。`dem.spec.ts` の「範囲を消す」も通る）

- [ ] **Step 7: 後を測る**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/17-after pnpm perf:fps tests/perf/fps.perf.ts -g クリック`（前後に `snap.sh`）
Expected: 1000 m・500 m の「長いタスク 読み込み」の最大（中央値）が 50 ms 以下（見込み: 段 1 が 1000 m で 約 35〜40 ms）。「2D の表示」は段の分だけ遅れてよい（見込み +1〜2 タスク、数十 ms）。**50 ms を超えて残れば**、残りの内訳を記録し、M6（Task 29）で 1000 m の行の裁定と合わせてユーザーに送る（さらに `elevationRgba` を行で分けるのは計画し直しの対象）

- [ ] **Step 8: 記録し、ゲートを通してコミットする**

`docs/perf/<実行日>-fixes.md` に「## Task 17: 地形の重ね描きを 2 段に分ける」として、前後の中央値（3 地点 × 500・1000 m の長いタスク 読み込み・2D の表示）と `17-profile.md` の内訳の要約を書く。

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium && pnpm size`
Expected: すべて成功。`pnpm size` の初期ロードは 427.5 KB のまま（±0.1 KB 程度の増減は記録する）

```bash
git add src/map/ tests/e2e/ docs/perf/
git commit -m "地形の重ね描きを標高と残りの 2 つのタスクに分け、重なり順を固定の並びから決める。矢印の画像の読み戻しを CPU の canvas にする（1000 m の読み込みの終わりの長いタスクを減らす。spec 06 §5.2）"
```

---

### Task 17a:（条件つき・計画し直す）3D 切替の長いタスクの内訳

**条件:** Task 16 の後も、3D に切り替えの長いタスクが 50 ms を超える（段 1 の 1000 m は M2 で 83〜206 ms、500 m は 0〜85 ms。tech-spec §14.1 の「全操作で 50 ms」を超えており、M2 の判定ではこれに対応する Task が無かった。Task 16 の前後の計測は `-g クリック` で回すので、読み込みの長いタスクと同じランで 3D 切替の長いタスクも一緒に測れる）。

**計画し直す理由:** 候補（View3d・three のチャンクの読み込みとシェーダのコンパイル〈動的 import、約 130 KB gzip〉、`ensureRange` の標高のコピーと `fillInvalidNearest`〈準備 18〜21 ms〉、`waterBuild`〈20 ms。約 212 万三角形の索引バッファ〈Uint32 ≈ 25 MB〉の生成を含むかは未確認〉、最初の描画の同期の GPU 転送〈標高・深度の float テクスチャ 4.25 MB × 2、頂点・索引バッファ。`bufferData`・`texImage2D` は同期で、`onRenderTime` の平均 0.4 ms には最初のフレームの跳ね上がりが隠れている〉、MapLibre の `setTerrain` と hillshade のソース、React の再描画）のどれが支配的かを、プロファイルで確かめてからでないと分ける場所が決まらない。

- [x] **Step 1: プロファイルを取り、裁定の枠を決める**

`page.tracing`（Playwright）で計測用のビルドの `probe=load`・`mode=3d` を、1000 m は綾瀬・渋谷を 1 回ずつ、500 m は 1 回プロファイルし、`.handoff/06-perf/fixes/17a-profile.md` に内訳を書く。

- 上の候補のどれか 1 つが支配的で、複数フレームに分けられる見込みがあれば（例: メッシュの生成と転送を別のタスクにする、地形が出た 1 フレーム後に水面を作る）、安価な M4 の Task としてこの下に具体的な Files・Interfaces・Step（テストを含む）を書き、コントローラーに送る。承認の後に実装し、1 コミットにする
- そうでなければ実装は行わず、内訳を `docs/perf/<実行日>-fixes.md` に記録するだけにし、M6（Task 29）で「利用者が選んで入る 3D の切り替えに一度きりのブロックを許すか」を 1000 m の行の裁定と合わせてユーザーに送る（spec 06 §5.2、`.superpowers/sdd/2026-09-17-06-performance/m2-report.md` の「計画に無い残り」）

**Step 1 の結果（2026-09-17、`.handoff/06-perf/fixes/17a-profile.md`）:** 条件は満たす（`16-after/load.json` の 3D の長いタスク: 1000 m 綾瀬 200・90・97、渋谷 89・89・106 ms）。3 ラン（綾瀬・渋谷 1000 m、綾瀬 500 m）とも、3D の長いタスクは 1 つで、**水面の Custom Layer の最初の描画のフレーム**。トレースの下の内訳（綾瀬 1000 m／渋谷 1000 m／綾瀬 500 m、ms。タスク 164／319／166）: three のプログラムのリンクの同期の待ち（`getUniforms` → `onFirstUse`）60.3／211.6／106.7、索引・頂点バッファの一括の `bufferData`（1000 m で 25.4 MB + 8.5 MB）76.4／80.3／約 10、MapLibre の配置 12.1／11.6／18.8、MapLibre の自前のシェーダ < 3／< 3／14.1。チャンクの読み込み・`fillInvalidNearest`・`waterBuild`・`setTerrain`・React はこのタスクに入っていない（別のタスクで 50 ms 未満）。実行環境で `KHR_parallel_shader_compile` が使えることを確かめた。**2 つの支配的な寄与を、Worker・メッセージの形を変えずに複数のフレームに分けられる**ので、記録だけにせず次を行う。

**Files（Step 2 以降）:**
- Modify: `src/renderer/waterMesh.ts`（格子を区画に分ける。`gridVertices`・`gridIndices` は区画版に置き換え、旧版はテストの基準の写しに移す）
- Modify: `src/renderer/waterMesh.test.ts`
- Modify: `src/renderer/waterLayer.ts`（`onAdd` で `compileAsync`、区画のメッシュを数フレームに分けて見せる）
- Modify: `src/renderer/waterLayer.test.ts`
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: Task 17 の後の `View3d`（変えない。`createWaterLayer` の引数・戻り値の形も変えない）
- Produces:

```ts
// src/renderer/waterMesh.ts
/** 1 区画の一辺のセル数。頂点は (255 + 1)² = 65,536 個までなので Uint16 の索引に収まる */
export const PATCH_CELLS = 255
export interface GridPatch { col0: number; row0: number; cols: number; rows: number }
/** N × N 頂点の格子のセル（N − 1）²を、行優先（北から、西から）に patchCells 四方の区画に分ける */
export function gridPatches(n: number, patchCells?: number): GridPatch[]
/** 区画の頂点（(cols + 1) × (rows + 1) 個、格子全体の (列, 行)。行優先） */
export function patchVertices(patch: GridPatch): Float32Array
/** 区画の三角形 (a, d, b)(b, d, e)。頂点番号は区画の中の行優先 */
export function patchIndices(patch: GridPatch): Uint16Array
/** 区画の頂点と索引のバイト数（転送の量の見積もり） */
export function patchBytes(patch: GridPatch): number

// src/renderer/waterLayer.ts
/** 1 フレームに GPU へ上げる区画のバイト数の目安（観測 約 2.35 ms/MB で 約 19 ms） */
export const UPLOAD_BUDGET_BYTES = 8 * 1024 * 1024
/** 見せていない先頭の区画から、合計が budget を超えない数（残りがあれば少なくとも 1） */
export function patchesToReveal(bytes: readonly number[], revealed: number, budget: number): number

// createWaterLayer の options（Task 17a (ii) で追加。レビュー役 R1。戻り値の形は変えない）
/** すべての区画を初めて描いたフレームで 1 回呼ぶ。View3d が E2E・計測の印 data-water-ready（回数）を書く */
onShown: (() => void) | null
```

1000 m（N = 1031）は 5 × 5 = 25 区画（1 区画 約 1.3 MB）で、8 MB の目安なら 5 フレームで全部を見せる。500 m（N = 515）は 3 × 3 = 9 区画で 2 フレーム（実装の後の注: 端の区画が小さいので、実際は 1000 m が 3 フレーム〈7・8・10 区画〉、500 m が 1 フレーム。Task 17a (ii) のレビュー）。水面の見た目（色・高さ・重なり）は変えない。**振る舞いの変化**: 3D に切り替えた直後、水面はシェーダのリンクが終わるまで（トレースで 60〜210 ms）描かれず、その後の数フレームで区画ごとに現れる（読み込み直後は水深 0 なので見えるものは無い。再生中に 3D に切り替えたときだけ目に見える）。承認の可否をレビュー役に問う点。

- [ ] **Step 2: 前を測る（Task 16 と同じコマンド。Task 17 のコミットの後）**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/17a-before pnpm perf:fps tests/perf/fps.perf.ts -g クリック`（前後に `snap.sh`）
Expected: 1 件成功。「長いタスク 3D」「最初の 3D のフレーム」「水面の作成」を控える

- [ ] **Step 3: 区画と見せる数のテストを書く（失敗を確かめる）**

`src/renderer/waterMesh.test.ts`（今の `gridVertices`・`gridIndices` の実装をテストの中に「旧版の写し」として置く）:
- `gridPatches(7, 3)` は 2 × 2 = 4 区画（`{col0:0,row0:0,cols:3,rows:3}`・`{3,0,3,3}`・`{0,3,3,3}`・`{3,3,3,3}`）、`gridPatches(8, 3)` は端の区画が 1 セル（3 × 3 = 9 区画）
- 旧版と同じ三角形の集合: n = 8・patchCells = 3 で、各区画の索引を区画の頂点の (列, 行) を通して格子全体の頂点番号に直し、三角形（3 つ組）を並べ替えたものが旧版の `gridIndices(8)` を 3 つ組にして並べ替えたものと一致する（向き〈a, d, b〉も含めて一致）
- `gridPatches(1031)` は 25 区画、三角形の合計は 2 × 1030²、各区画の頂点数は 65,536 以下、`patchIndices` の最大は頂点数 − 1。`gridPatches(515)` は 9 区画

`src/renderer/waterLayer.test.ts`:
- `patchesToReveal([3, 3, 3], 0, 7)` は 2、`([3, 3, 3], 2, 7)` は 1、`([10, 1], 0, 7)` は 1（1 区画が目安を超えても 1 つは進める）、`([3], 1, 7)` は 0

Run: `pnpm vitest run src/renderer`
Expected: FAIL（`gridPatches`・`patchesToReveal` が無い）

- [ ] **Step 4: 区画を実装する**

`waterMesh.ts` に上の関数を足し、`gridVertices`・`gridIndices` を消す（src からの参照が無くなる。旧版はテストの写しだけ）。`patchIndices` は区画の中の頂点番号 `r × (cols + 1) + c` で `(a, d, b)(b, d, e)` を並べる。

Run: `pnpm vitest run src/renderer/waterMesh.test.ts`
Expected: PASS

- [ ] **Step 5: シェーダのリンクを非同期にし、区画を数フレームに分けて見せる**

`src/renderer/waterLayer.ts` の `createWaterLayer`:
- 1 つの `BufferGeometry`・`Mesh` の代わりに、`gridPatches(n)` の区画ごとに `Mesh`（`material` は共有、`frustumCulled = false`、`visible = false`）を `scene` に足す。区画の `BufferGeometry`（`CELL_ATTRIBUTE` に `patchVertices`、索引に `patchIndices`）は**見せる直前に作る**（`waterBuild` の 1000 m 約 19 ms の配列の生成も分かれる）。区画ごとの見積もり `patchBytes` は最初に配列にしておく
- `onAdd`: `renderer` を作った後に `renderer.compileAsync(scene, camera).then(() => { if (disposed) return; programReady = true; map.triggerRepaint() })`。`compile` は見えないメッシュも辿る（three 0.185.1 の `compile` は `scene.traverse`）ので、区画を見せる前にプログラムができる。`KHR_parallel_shader_compile` が無い環境では three が 10 ms 後にすぐ完了とみなし、最初の描画で今と同じく待つ（振る舞いは今と同じ）
- `render`: `renderer === null || !programReady` なら何もしない（`onRenderTime` も呼ばない）。見せていない区画があれば `patchesToReveal(bytes, revealed, UPLOAD_BUDGET_BYTES)` 個の区画のジオメトリを作って `visible = true` にし、描いた後に `map.triggerRepaint()` で次のフレームを頼む
- `dispose`: 作った区画のジオメトリをすべて `dispose` する（作っていない区画は何もしない）

Run: `pnpm vitest run src/renderer && pnpm build && pnpm exec playwright test --project=chromium tests/e2e/view3d.spec.ts`
Expected: PASS（水面が冠水とともに色づく E2E〈`waterColoredFraction`〉、ベースマップの切り替え・コンテキストの喪失からの水面の作り直しを含む）

- [ ] **Step 6: 後を測り、トレースで内訳を確かめる**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/17a-after pnpm perf:fps tests/perf/fps.perf.ts -g クリック`（前後に `snap.sh`）
Expected: 1000 m・500 m の「長いタスク 3D」の最大（中央値）が 50 ms 以下（見込み: MapLibre の配置と自前のシェーダの 約 15〜35 ms が残る）。あわせて Step 1 と同じトレース（綾瀬 1000 m を 1 回）で、`onFirstUse` と `createBuffer` が 1 フレームに 20 ms を超えて出ないことを確かめ、`.handoff/06-perf/fixes/17a-after/profile.md` に書く。**50 ms を超えて残れば**残りの内訳を記録し、M6（Task 29）で「利用者が選んで入る 3D の切り替えに一度きりのブロックを許すか」をユーザーに送る

描画の回数が 1 → 25（1000 m）になるので、fps が落ちていないことも確かめる:
Run（バックグラウンド、上の後に）: `RAINTRACE_FPS_SET=water-sites RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/17a-after pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し`
Expected: セルごとの中央値が M2 の `water-sites` の記録（`docs/perf/2026-09-17.md` の fps の表）から 1 fps 以上下がらない。下がれば記録してレビュー役に送る（`PATCH_CELLS` を大きくする余地はない〈Uint16 の上限〉ので、区画の描画をまとめる別案は計画し直しの対象）

- [ ] **Step 7: 記録し、ゲートを通してコミットする**

`docs/perf/<実行日>-fixes.md` に「## Task 17a: 水面の最初の描画を複数のフレームに分ける」として、前後の中央値（3 地点 × 500・1000 m の長いタスク 3D・最初の 3D のフレーム・水面の作成）、`water-sites` の fps、`17a-profile.md` の内訳の要約を書く。

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium && pnpm size`
Expected: すべて成功。初期ロードは 427.5 KB のまま（renderer は遅延のチャンク）

```bash
git add src/renderer/ docs/perf/
git commit -m "水面のシェーダのリンクを非同期にし、格子を 255 セル四方の区画に分けて数フレームで転送する（3D の切り替えの最初の描画の長いタスクを減らす。spec 06 §5.2）"
```

---

### Task 18: 止まっている間は水深の canvas を再描画させない（spec 06 §5.2、計画で決めたこと 16）

**条件:** Task 10 の「止まっている間の再描画」で、2 秒の render の回数が 0 より大きい。

**Files:**
- Modify: `src/map/WaterOverlay.ts`（`uploadCanvasSource`、`draw`、`addLayers`）
- Create: `src/map/WaterOverlay.test.ts`
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: なし
- Produces: `export function uploadCanvasSource(source: { play?: () => void; pause?: () => void } | undefined): void`

- [ ] **Step 1: 前を測る（みなとみらい 500 m・半径 10 m は数秒で平衡。2D）**

Run: `pnpm build:perf && RAINTRACE_STEPS_SITES=minatomirai RAINTRACE_STEPS_SIZES=500 RAINTRACE_STEPS_RAINS=r10 RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/fixes/18-before pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected: 1 件成功、「止まっている間の render（2 秒）」が約 120（60Hz）

- [ ] **Step 2: 失敗するテストを書く**

`src/map/WaterOverlay.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { uploadCanvasSource } from './WaterOverlay'

describe('uploadCanvasSource（止まっている間は再描画させない。spec 06 §5.2）', () => {
  it('play の後に pause を呼ぶ（pause が _playing の間に prepare で 1 回だけ転送する）', () => {
    const calls: string[] = []
    uploadCanvasSource({ play: () => calls.push('play'), pause: () => calls.push('pause') })
    expect(calls).toEqual(['play', 'pause'])
  })

  it('ソースが無い・まだ読み込まれていない（play が無い）ときは何もしない', () => {
    expect(() => uploadCanvasSource(undefined)).not.toThrow()
    const calls: string[] = []
    uploadCanvasSource({ pause: () => calls.push('pause') })
    expect(calls).toEqual([])
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `pnpm vitest run src/map/WaterOverlay.test.ts`
Expected: FAIL（`uploadCanvasSource is not a function`）

- [ ] **Step 4: 直す**

`src/map/WaterOverlay.ts` の import の `import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'` を `import type { CanvasSource, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'` にし、`const EMPTY …` の後に足す:

```ts
/**
 * canvas ソースに描いた内容を 1 回だけ転送し、再描画を 1 回頼む（spec 06 §5.2）。MapLibre 6.6.0 の CanvasSource は、
 * play() で _playing を立てて triggerRepaint し、pause() は _playing の間に prepare()（texture.update）を呼んでから
 * _playing を下ろす（maplibre-gl-dev.mjs 4601〜4609・4649 行）。_playing を立てたままにしないので、
 * hasTransition() が偽になり、止まっている間は地図を毎フレーム描き直さない。play・pause は onAdd の load() で
 * 付くので、まだ読み込まれていないソースでは何もしない（最初の prepare() がそのときの canvas から texture を作る）
 */
export function uploadCanvasSource(
  source: { play?: () => void; pause?: () => void } | undefined,
): void {
  if (source?.play === undefined || source.pause === undefined) return
  source.play()
  source.pause()
}
```

`draw` の `target.context.putImageData(target.image, 0, 0)` の後に足す:

```ts
    uploadCanvasSource(this.map.getSource<CanvasSource>(WATER_LAYER_IDS.water))
```

`addLayers` の `// 毎フレーム内容が変わるので animate: true（spec 04 §6.1）` と `animate: true,` を次に置き換える:

```ts
    // animate: true は止まっている間も毎フレーム再描画させる（04 の申し送り）。描いたときだけ draw が
    // uploadCanvasSource で転送する（spec 06 §5.2）
```

```ts
      animate: false,
```

クラスの JSDoc の `animate: true で置き、描画フレームごとに最新の水深だけを着色する` を `animate: false で置き、描画フレームごとに最新の水深だけを着色して、そのときだけ転送する` にする。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `pnpm vitest run src/map/ src/ui/`
Expected: PASS

- [ ] **Step 6: E2E で 2D の水と復帰を確かめる**

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 41 件成功（2D の水深の表示・ベースマップの切り替えの後の水・コンテキスト喪失からの復帰を含む。失敗したら、`uploadCanvasSource` の前に texture が無い〈最初の prepare の前〉場合の見え方を疑い、`addLayers` の後に `this.requestDraw()` を足して確かめ直す）

- [ ] **Step 7: 後を測る**

Run: `pnpm build:perf && RAINTRACE_STEPS_SITES=minatomirai RAINTRACE_STEPS_SIZES=500 RAINTRACE_STEPS_RAINS=r10 RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/fixes/18-after pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected: 「止まっている間の render（2 秒）」が 0〜数回（前の約 120 から大きく減る）、step 数は前と同じ

- [ ] **Step 8: 記録し、ゲートを通してコミットする**

`docs/perf/<実行日>-fixes.md` に「## Task 18: 止まっている間の再描画」として前後の回数を書き、MapLibre の内部への新しい依存（`CanvasSource` の `play`・`pause` の中身）を M6 の一覧に足すことを書く。

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm size`
Expected: すべて成功、初期ロードは 427.5 KB ±0.1（`WaterOverlay` は初期ロードに入っている）

```bash
git add src/map/WaterOverlay.ts src/map/WaterOverlay.test.ts docs/perf/
git commit -m "水深の canvas ソースを animate: false にし、描いたときだけ play・pause で 1 回転送する（止まっている間の 60Hz の再描画をやめる。spec 06 §5.2）"
```

---

### Task 19: `ui` のチャンク: `TextField` を `FormControl`・`OutlinedInput` に置き換える（spec 06 §5.2、tech-spec §14.2、RB-1）

**条件:** Task 10 の「バンドル」で `ui` のチャンクが 150 KB を超えている。

**Files:**
- Modify: `src/ui/components/RainfallControls.tsx`
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: なし
- Produces: 画面の振る舞いは変えない（ラベルで引ける入力欄、エラーの説明文、`inputMode`）

- [ ] **Step 1: 前を測る**

Run: `pnpm build && pnpm size | tee .handoff/06-perf/fixes/19-before-size.md`
Expected: `ui` 160.0 KB 前後、初期ロード 427.5 KB

- [ ] **Step 2: 置き換える**

`src/ui/components/RainfallControls.tsx` を次に置き換える:

```tsx
import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import OutlinedInput from '@mui/material/OutlinedInput'
import Slider from '@mui/material/Slider'
import { useId } from 'react'
import { AMOUNT_MM, RADIUS_MIN_M } from '../../state/persistedSettings'
import { strings } from '../strings'

interface Props {
  amountText: string
  radiusText: string
  maxRadiusM: number
  amountInvalid: boolean
  radiusInvalid: boolean
  /** 開始の後はリセットするまで入力できない（spec 04 §3） */
  disabled: boolean
  onAmountChange: (text: string) => void
  onRadiusChange: (text: string) => void
}

interface NumberFieldProps {
  label: string
  value: string
  disabled: boolean
  error: boolean
  helperText: string | undefined
  inputMode: 'numeric' | 'decimal'
  onChange: (text: string) => void
}

/**
 * TextField と同じ見た目と関連づけ（label の for、説明文の aria-describedby）の入力欄。TextField は本アプリが
 * 使わない Select・Menu・Popover の実装まで静的に読み、ui のチャンクを予算の 150 KB から押し上げるので使わない
 * （tech-spec §14.2、spec 06 §5.2、RB-1 の順序）
 */
function NumberField(props: NumberFieldProps) {
  const { label, value, disabled, error, helperText, inputMode, onChange } = props
  const id = useId()
  const helperId = `${id}-helper`
  return (
    <FormControl size="small" variant="outlined" disabled={disabled} error={error}>
      <InputLabel htmlFor={id}>{label}</InputLabel>
      <OutlinedInput
        id={id}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputProps={{
          inputMode,
          ...(helperText === undefined ? {} : { 'aria-describedby': helperId }),
        }}
      />
      {helperText === undefined ? null : (
        <FormHelperText id={helperId}>{helperText}</FormHelperText>
      )}
    </FormControl>
  )
}

/** 雨量と半径（base-spec §10、spec 04 §9）。入力欄とスライダーは同じ値を持つ */
export function RainfallControls(props: Props) {
  const { amountText, radiusText, maxRadiusM, amountInvalid, radiusInvalid, disabled } = props
  const sliderValue = (text: string, min: number, max: number): number => {
    const value = Number(text)
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <NumberField
        label={strings.rainfall.amount}
        value={amountText}
        disabled={disabled}
        error={amountInvalid}
        helperText={amountInvalid ? strings.rainfall.amountError : undefined}
        inputMode="numeric"
        onChange={props.onAmountChange}
      />
      <Slider
        aria-label={strings.rainfall.amountSlider}
        size="small"
        min={AMOUNT_MM.min}
        max={AMOUNT_MM.max}
        step={1}
        disabled={disabled}
        value={sliderValue(amountText, AMOUNT_MM.min, AMOUNT_MM.max)}
        onChange={(_, value) => props.onAmountChange(String(value))}
      />
      <NumberField
        label={strings.rainfall.radius}
        value={radiusText}
        disabled={disabled}
        error={radiusInvalid}
        helperText={radiusInvalid ? strings.rainfall.radiusError(maxRadiusM) : undefined}
        inputMode="decimal"
        onChange={props.onRadiusChange}
      />
      <Slider
        aria-label={strings.rainfall.radiusSlider}
        size="small"
        min={RADIUS_MIN_M}
        max={maxRadiusM}
        step={1}
        disabled={disabled}
        value={sliderValue(radiusText, RADIUS_MIN_M, maxRadiusM)}
        onChange={(_, value) => props.onRadiusChange(String(value))}
      />
    </Box>
  )
}
```

`pnpm typecheck` が `inputProps` を非推奨・型の誤りとして落とす（MUI 9 の `InputBase` が `slotProps.input` だけを受ける）場合は、`inputProps={{ … }}` を `slotProps={{ input: { … } }}` に替える。

- [ ] **Step 3: テストと E2E を通す**

Run: `pnpm vitest run src/ui/`
Expected: PASS（パネルの jsdom のテストがラベルで入力欄を引いていれば、それも通る）

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 41 件成功（`getByLabel(strings.rainfall.amount)` の値・無効化・エラーの表示、キーボードの Tab の順を含む）

- [ ] **Step 4: 後を測る**

Run: `pnpm size | tee .handoff/06-perf/fixes/19-after-size.md`
Expected: `ui` が前より小さい。**150 KB 以下にならなければ**、減った量を記録し、残りの超過（パネルの遅延読み込み〈RB-1 の次の手〉）は M6 で「記録のみ」とする（パネルの遅延読み込みは画面の読み込みの形を変えるので、この計画では行わない）

- [ ] **Step 5: 記録し、ゲートを通してコミットする**

`docs/perf/<実行日>-fixes.md` に「## Task 19: ui のチャンク」として `ui`・`index`・初期ロード・総量の前後を書く。

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

```bash
git add src/ui/components/RainfallControls.tsx docs/perf/
git commit -m "雨量と半径の入力欄を TextField から FormControl・OutlinedInput に置き換え、ui のチャンクを小さくする（見た目と関連づけは同じ。tech-spec §14.2、spec 06 §5.2）"
```

---

### Task 20:（条件つき）範囲の DEM の段を手がかりに、範囲の外のタイルの DEM1A の 404 を省く（spec 06 §5.2、計画で決めたこと 16）

**条件:** Task 10 の「3D を押してから最初の 3D のフレーム」が 3 秒を超え、その主因がタイルの待ち（`load.md` の「最初の 3D のフレーム」と「水面」の差）で、かつ超えた地点の DEM が段 2・3。3 地点はどれも段 1（DEM1A）なので、**M2 の計測だけでは条件を満たさない見込み**。満たさなければ行わず、「行わなかった項目」に書く（段 2・3 の地域では z17 の外のタイルごとに 404 が 1 回起きる事実は、05 の記録のまま残す）。

**M2 の実測での訂正:** みなとみらい 1000 m は段 2 の DEM で走っていた（`docs/perf/2026-09-17.md`）。「3 地点はどれも段 1」は 1000 m では誤りで、この Task を行う場合の前後の計測は `nemuro` に加えてみなとみらい 1000 m でもできる。ただし M2 の「3D を押してから最初の 3D のフレーム」は中央値の最大 0.64 s で 3 秒の内（基準内）なので、条件は満たされていない。**Task 20 は行わない**（「行わなかった項目」に書く）。

**Files:**
- Modify: `src/dem/terrainTiles.ts`（`RangeElevation.level`、`outsideSources`、`loadOutsideTile`、`generateTerrariumTile`）
- Modify: `src/dem/terrainTiles.test.ts`
- Modify: `src/map/view3d/View3d.ts`（`ensureRange`）
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: なし
- Produces: `RangeElevation.level?: DemTier['level']`、`outsideSources(z: DemZoom, level?: DemTier['level'])`、`loadOutsideTile(tile, fetchTile, cache, level?)`

- [ ] **Step 1: 前を測る**

条件を満たした地点（段 2）の 1000 m で、`RAINTRACE_LOAD=1` のテストを回す。段 2 の地点 `nemuro`（根室駅付近）は Task 6 で `tests/perf/support.ts` の `LOAD_ONLY_SITES` にあるので、新しい地点の鍵（`tier2` など）は足さず、`RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=nemuro RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/20-before pnpm perf:fps tests/perf/fps.perf.ts -g クリック` で回す。

- [ ] **Step 2: 失敗するテストを書く**

`src/dem/terrainTiles.test.ts` の `describe('範囲の外の出所（計画で決めたこと 6）'` の中に足す:

```ts
  it('範囲の段が 2 なら z17 で DEM1A を試さない。段 3 なら DEM1A と DEM5 を試さない（spec 06 §5.2）', () => {
    expect(outsideSources(demZoom(17), 2)).toEqual([
      { dem: 'dem5a', zoom: 15 },
      { dem: 'dem5b', zoom: 15 },
      { dem: 'dem5c', zoom: 15 },
      { dem: 'dem10b', zoom: 14 },
    ])
    expect(outsideSources(demZoom(17), 3)).toEqual([{ dem: 'dem10b', zoom: 14 }])
    expect(outsideSources(demZoom(16), 3)).toEqual([{ dem: 'dem10b', zoom: 14 }])
    expect(outsideSources(demZoom(17), 1)[0]).toEqual({ dem: 'dem1a', zoom: 17 })
    expect(outsideSources(demZoom(14), 3)).toEqual([{ dem: 'dem10b', zoom: 14 }])
  })
```

`describe('loadOutsideTile（GSI に無いズーム・404・無効画素）'` の中に足す:

```ts
  it('段 2 の手がかりを渡すと、z17 のタイルで DEM1A を取りに行かない（404 を 1 回省く）', async () => {
    const fetchTile = fakeFetch({ 'dem5a/15/250/125': constantTile(9) })
    const result = await loadOutsideTile(tileId(17, 1000, 500), fetchTile, new OutsideTileCache(), 2)
    expect(fetchTile.calls).toEqual(['dem5a/15/250/125'])
    expect(result?.tile).toEqual({ z: 15, x: 250, y: 125 })
  })
```

- [ ] **Step 3: 失敗を確かめる**

Run: `pnpm vitest run src/dem/terrainTiles.test.ts`
Expected: FAIL（段 2 で DEM1A が先頭に残る）

- [ ] **Step 4: 直す**

`src/dem/terrainTiles.ts` の import に `import type { DemTier } from './demSources.ts'` を足す（`DemId` の import と同じ行にまとめてよい）。

`RangeElevation` の `elevation` の後に足す:

```ts
  /**
   * 範囲の DEM の段（02 の selectDem が選んだもの）。範囲の外のタイルの出所の手がかりにする（spec 06 §5.2）。
   * 省略は 1（手がかりなし）
   */
  level?: DemTier['level']
```

`outsideSources` を次に置き換える:

```ts
/**
 * DEM のズーム z のタイルの、範囲の外の出所の候補（先に試す順。404 なら次）。GSI に無い z16 は親から作る。
 * level は範囲の DEM の段の手がかり: 段 2 の範囲の周りは DEM1A が無い見込みなので試さず、段 3 は DEM5 も試さない
 * （段 2・3 の地域で z17 の外のタイルごとに起きていた 404 を省く。spec 06 §5.2）。範囲から遠いタイルも同じ段と
 * みなすので、段の境目の近くでは外の地形が 1 段粗くなりうる（3D の見た目だけ）
 */
export function outsideSources(z: DemZoom, level: DemTier['level'] = 1): readonly OutsideSource[] {
  if (level >= 3) return z >= 15 ? [DEM10B_Z14] : [{ dem: 'dem10b', zoom: z }]
  if (z >= 17) {
    return level === 2 ? [...DEM5, DEM10B_Z14] : [{ dem: 'dem1a', zoom: 17 }, ...DEM5, DEM10B_Z14]
  }
  if (z >= 15) return [...DEM5, DEM10B_Z14]
  return [{ dem: 'dem10b', zoom: z }]
}
```

`loadOutsideTile` の引数に `level: DemTier['level'] = 1` を足し（`cache` の後）、`for (const source of outsideSources(tile.z))` を `for (const source of outsideSources(tile.z, level))` にする。JSDoc に `level は範囲の DEM の段の手がかり（outsideSources）` を 1 行足す。

`generateTerrariumTile` の `outside = await loadOutsideTile(tile, fetchTile, cache)` を `outside = await loadOutsideTile(tile, fetchTile, cache, range?.level ?? 1)` にする。

`src/map/view3d/View3d.ts` の `ensureRange` の `this.range = { z: geo.z, … elevation, }` の `elevation,` の後に `level: geo.level,` を足す。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `pnpm vitest run src/dem/ src/map/view3d/`
Expected: PASS（段を渡さない既存のテストは今までどおり）

- [ ] **Step 6: 後を測り、記録し、ゲートを通してコミットする**

Step 1 と同じコマンドを `…/20-after` で回し、「最初の 3D のフレーム」と「水面」の差の前後を `docs/perf/<実行日>-fixes.md` の「## Task 20: DEM の段の手がかり」に書く。

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium`
Expected: すべて成功（`src/dem/**` のカバレッジ 85% 以上、3D の E2E を含む）

```bash
git add src/dem/terrainTiles.ts src/dem/terrainTiles.test.ts src/map/view3d/View3d.ts tests/perf/support.ts docs/perf/
git commit -m "範囲の DEM の段を手がかりに、範囲の外のタイルで無い DEM（段 2 の DEM1A、段 3 の DEM1A・DEM5）を取りに行かない（404 を省く。spec 06 §5.2）"
```

---

### Task 21:（条件つき・計画し直す）待つ要求の無くなった範囲の外のタイルの取得を止める

**条件:** Task 20 を行い、その後も「最初の 3D のフレーム」が 3 秒を超え、主因が取り消された要求の取得が枠（同時 6 件）を占めること（05 の計画で決めたこと 23）。

**計画し直す理由:** `OutsideTileCache` は 1 つの取得の Promise を複数の DEM タイルで共有するので、1 つの要求の取り消しで fetch を止めると他のタイルまで失敗にする（05 の計画で決めたこと 23）。「そのタイルを待つ要求が 0 になったら止める」ための参照の数え方（`isWanted` の拡張と `AbortController` の持ち方）は、`mainTileGenerator.ts`・`gsiDemTile.ts`・`OutsideTileCache` を合わせて設計する必要があり、安価に収まるかは設計してから決める（spec 06 §5.2「止める方は安価に収まる場合だけ」）。計画し直すときの枠:
- `createMainGsiFetcher` の各取得に `AbortController` を持ち、枠を待つ間と再試行の前だけでなく、取得中にも `isWanted` を見る（`setInterval` か、`generate` の `signal` の `abort` イベントからの通知）
- 止めた取得は cache に失敗として残さない（次に要るときに取り直す）
- テスト: 偽の `fetch` と偽の時計で、待つ要求が 0 になった取得が止まり、別のタイルの要求は止まらないこと

- [ ] **Step 1: 計画を書き足してレビュー役に送る**

上の枠を具体的な Files・Interfaces・Step（テストを含む）にして、この Task の下に書き、コントローラーに送る。安価に収まらない（メッセージの形・Worker を変える）と分かったら、行わずに M6 の別の spec の候補に書く。

---

### Task 22:（条件つき）1000 m の範囲では水深のテクスチャの転送を 2 回に 1 回にする（spec 06 §5.2 の 51 fps の転送側、計画で決めたこと 16）

**条件:** Task 13 の結論が「主因は転送」で、Task 11 の表で `depthEvery=2` のセルが D15 を満たす。`depthEvery=2` でも満たさなければ、この Task は行わず Task 23 に進む。

**見込み（M2 の準備での改訂、2026-09-17）: おそらく条件を満たさない。** M1 の確かめ（`.handoff/06-perf/baseline-check.md`）で、既定の矢印の本数では `depthEvery=1` がすでに 60.0 fps（`depthEvery=2・4` は 59.9）で、転送側は主因でなかった。Task 13 の結論が「主因は矢印の本数」なら、この Task と Task 23 は行わず「行わなかった項目」に書く。条件はそのまま残す。

**Files:**
- Modify: `src/map/view3d/View3d.ts`（`defaultDepthUploadEvery`、`addWater`）
- Create: `src/map/view3d/View3d.depth.test.ts`
- Modify: `docs/perf/<実行日>-fixes.md`

**Interfaces:**
- Consumes: Task 3 の `depthUploadEvery`
- Produces: `export const DEPTH_UPLOAD_THROTTLE_MIN_SIZE = 768`、`export function defaultDepthUploadEvery(size: number): number`

- [ ] **Step 1: 前を測る**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_FPS_SET=water-sites RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/22-before pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し`
Expected: Task 8 の Step 5（`water-sites`）と同じ表（水面ありの 1000 m・z16 ×10 p85 が D15 を外す）

- [ ] **Step 2: 失敗するテストを書く**

`src/map/view3d/View3d.depth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEPTH_UPLOAD_THROTTLE_MIN_SIZE, defaultDepthUploadEvery } from './View3d'

describe('defaultDepthUploadEvery（1000 m の水深の転送の間引き。spec 06 §5.1・§5.2）', () => {
  it('一辺が 768 セル以下（500 m まで）は毎回、それより大きい（1000 m）は 2 回に 1 回', () => {
    expect(DEPTH_UPLOAD_THROTTLE_MIN_SIZE).toBe(768)
    expect(defaultDepthUploadEvery(516)).toBe(1)
    expect(defaultDepthUploadEvery(768)).toBe(1)
    expect(defaultDepthUploadEvery(1031)).toBe(2)
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `pnpm vitest run src/map/view3d/View3d.depth.test.ts`
Expected: FAIL（export が無い。`View3d.ts` は `View3d.test.ts` と同じく node の環境で読める）

- [ ] **Step 4: 直す**

`src/map/view3d/View3d.ts` の `const CAMERA_MS = 500` の後に足す:

```ts
/** これより一辺のセル数が大きい範囲（1000 m）は、水深のテクスチャの転送を間引く（spec 06 §5.1 の結果） */
export const DEPTH_UPLOAD_THROTTLE_MIN_SIZE = 768

/**
 * 水深のテクスチャを何回の更新に 1 回転送するかの既定。1000 m（一辺 1031 セル、4.25 MB）の毎フレームの転送が
 * z16 ×10 p85 の fps を D15 の外に落としていた（docs/perf の切り分け）ので、2 回に 1 回にする（「最速」の frame は
 * 約 60Hz で届くので、見た目の更新は約 30Hz）。計測の depthEvery=N（View3dOptions.depthUploadEvery）はこれより優先する
 */
export function defaultDepthUploadEvery(size: number): number {
  return size > DEPTH_UPLOAD_THROTTLE_MIN_SIZE ? 2 : 1
}
```

`addWater` の `depthUploadEvery: this.options.depthUploadEvery ?? 1,` を `depthUploadEvery: this.options.depthUploadEvery ?? defaultDepthUploadEvery(geo.size),` にする。

計測用のフックは URL に `depthEvery` が無いとき `depthUploadEvery` を渡さない（Task 4）ので、この既定がそのまま測られる。

- [ ] **Step 5: テスト・後の計測・記録**

Run: `pnpm vitest run src/map/view3d/`
Expected: PASS

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_FPS_SET=water-sites RAINTRACE_FPS_SITES=ayase,shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/06-perf/fixes/22-after pnpm perf:fps tests/perf/fps.perf.ts -g 測り直し`
Expected: 3 地点の 1000 m・z16 ×10 p85・水面ありが D15 を満たす。500 m のセルは前と同じ（毎回転送のまま）。満たさなければ、この Task のコードを戻し（コミットしない）、Task 23 に進む

`docs/perf/<実行日>-fixes.md` に「## Task 22: 1000 m の水深の転送の間引き」として 3 地点 × 4 視点の水面ありの前後を書く。

- [ ] **Step 6: ゲートを通してコミットする**

Run: `pnpm build && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm exec playwright test --project=chromium`
Expected: すべて成功（E2E は 500 m 以下で、毎回転送のまま）

```bash
git add src/map/view3d/View3d.ts src/map/view3d/View3d.depth.test.ts docs/perf/
git commit -m "1000 m の範囲では水深のテクスチャの転送を 2 回に 1 回にする（z16 ×10 p85・水面ありの fps を D15 に戻す。spec 06 §5.1・§5.2）"
```

---

### Task 23:（条件つき・計画し直す）水深のテクスチャの転送を軽くする（変わった行だけ・Float16）

**条件:** Task 13 の結論が「主因は転送」で、Task 22 を行っても D15 を満たさない（または `depthEvery=2` が D15 を満たさない）。

**計画し直す理由:** どちらも three の `DataTexture` の更新の仕方を変える。「変わった行だけ」は前の frame との差の行の範囲を求める CPU の費用（1000 m で 4.25 MB の比較）と、three が部分の `texSubImage2D` を出せるか（`WebGLRenderer.copyTextureToTexture` か、GL を直接使うか）、「Float16」は `HalfFloatType` の変換の費用と精度（水深の 1 cm の閾値と 5 cm の帯）を、試してから決める必要がある。計画し直すときの枠:
- 変更は `src/renderer/waterLayer.ts` に閉じる（three の import は renderer だけ）
- 前後は Task 22 と同じコマンドと、`isolate` の組
- 精度の確かめ: Float16 なら、帯の境目の水深（0.05 m・0.10 m）と 1 cm の閾値の前後で、`waterTextures.ts` の式と同じ帯になることのテスト

- [ ] **Step 1: 試しの計測をし、計画を書き足してレビュー役に送る**

2 つの案を使い捨てのブランチ（`git switch -c tmp/06-upload-trial`。コミットしてもよいが `feat/06-performance` には入れない）で最小の形で試し、`isolate` の組の `depthEvery=1` の変種だけを 1 回ずつ測り、結果と選んだ案をこの Task の下に具体的な Files・Interfaces・Step として書いて、コントローラーに送る。承認の後に `feat/06-performance` で実装し、1 コミットにする。使い捨てのブランチは消す。

---

### Task 24:（条件つき・計画し直す）走査の範囲を 16 × 16 セルのブロック単位にする（spec 06 §5 の 1 step の行、03 §3.5）

**条件:** Task 15 の後の 500 m・全面を濡らす雨の 1 step の中央値が 8 ms を超える、または p95 が 16 ms を超える。

**計画し直す理由:** 全面を濡らす雨は外接矩形が範囲全体になるので、ブロック単位にしても全部のブロックが濡れていれば走査は減らない。減るのは「濡れた場所が散らばる」雨で、どの条件で効くかを `bench:engine` の合成地形とブラウザの 3 地点で確かめてから設計する（tech-spec §6.4 の「WASM が明確に有利な箇所」1 と同じ論点で、TypeScript で安価に収まるかを先に見る）。計画し直すときの枠:
- `src/simulation/WaterGrid.ts` の外接矩形を、16 × 16 のブロックの濡れの印（ビットの配列）に置き換える
- 結果はビット単位で同じ（`scenarios.test.ts`・`properties.test.ts`・`fillMatch.test.ts` が変わらない）
- それでも超えるなら Rust WASM の spec（tech-spec §6.3・§6.4）を M6 で起こす

- [x] **Step 1: 計画を書き足してレビュー役に送る**

上の枠を具体的な Files・Interfaces・Step（テストを含む）にして、この Task の下に書き、コントローラーに送る。

**計画し直した結果（2026-09-17、head 2a692ba）: Task 24 は行わない。条件を作った全面を濡らす雨では効かないため。記録だけする。500 m 全面の 8 ms と 1000 m の 37〜45 ms は、M6（Task 29）の WASM の spec の判断に渡す。**

- 条件は満たした: Task 15 の後の 500 m・全面を濡らす雨の 1 step の中央値は 3 地点で 8.2〜8.6 ms（`docs/perf/2026-09-17-fixes.md` の Task 15、`until=window` 窓 60 秒の値）。M2 の 1000 m 全面は 37〜45 ms。**注記（Task 25 を受けて）**: この 8.2〜8.6 ms は `until=window` の値で、Task 25 の `until=settle`（M2 と同じ条件）では 500 m の中央値は 6.50〜7.90 ms となり 8 ms を超えない。settle の値で見れば条件を満たしていなかったことになるが、ブロック単位の走査の効果そのものが小さい（下の見積もり）という結論は変わらない
- 確かめ方: `pnpm bench:engine 2000`（512²。半径 10 m 0.022 ms、半径 100 m 5.111 ms）に加え、同じ合成地形を 515²・1031² に広げた使い捨てのスクリプトで、`beginStep`・`solveStep`・`endStep` を別々に計時し（1000 step）、step 0・10・100・500・999 で「外接矩形の中の濡れたセルの割合」と「濡れたセルを含む 16 × 16 ブロックを周囲 1 ブロック広げたときに走査するセルの割合」を数えた。生ログとスクリプトは `.handoff/06-perf/fixes/24-bench.md`・`24-bench/`（gitignore）
- 時間の内訳（中央値）: 515² 全面は合計 10.22 ms のうち solveStep 9.28・endStep 0.87・beginStep 0.06。1031² 全面は 41.75 ms のうち 37.99・3.47・0.25。外接矩形が全部乾いていても solveStep の読み飛ばしは 515² で 0.74 ms（1 セル約 2.8 ns）にすぎず、時間の約 90% は濡れたセル（1 セル約 39 ns）の `outflowCandidates` と配分そのもの
- 全面を濡らす雨の走査するブロックは外接矩形の 91〜97%（515²）・86〜94%（1031²）。ブロック単位で減るのは上限でも 515² で 0.06〜0.15 ms（0.6〜1.5%）、1031² で 0.4〜0.9 ms（1〜2%）で、500 m の中央値を 8 ms 未満にできない
- 散らばる雨（9 か所 × 半径 10 m）では、最初の数十 step は 93〜96% を省けるが、その時点の step はもともと軽い。step 100 で 65%（1031²）、step 500 以降は 2〜4% に下がり（薄い水が外接矩形のほぼ全体に広がる）、run 全体の中央値・p95 はほとんど変わらない。中央の半径 100 m でも step 500 以降に省けるのは約 20%（約 0.25 ms、約 4%）
- したがって「散らばる雨で意味があり、かつ条件を作った場合にも効く」を満たさない。`WaterGrid.ts` は変えない。`docs/perf/<実行日>-fixes.md` の「行わなかった項目」（Task 25）に「条件: 500 m 全面の 1 step 中央値 > 8 ms、測った値: 8.2〜8.6 ms。ブロック単位で減るのは上限で約 1%（`.handoff/06-perf/fixes/24-bench.md`）」と書く

---

### Task 25: 平衡までの時間を測り直して §5 の平衡の行を確定し、M4 の前後を tech-spec §14 に書く（spec 06 §1.2・§5、M4 の完了）

**条件:** 常に行う。

**Files:**
- Modify: `docs/perf/<実行日>-fixes.md`（「平衡の確定」「行わなかった項目」「M4 の後の判定」）
- Modify: `docs/superpowers/specs/2026-09-10-06-performance-design.md`（§5 の「M4 の後の判定」）
- Modify: `specs/tech-spec.md`（§14.1・§14.2 に M4 の後の値）

**Interfaces:**
- Consumes: Task 14〜24 の結果
- Produces: M6 が起こす別の spec の一覧（fill-spill-merge・Rust WASM・遠景の LOD・IndexedDB のうち要るもの）

- [ ] **Step 1: 平衡を測り直す（2D、固定の DEM、18 ラン、最悪 約 100 分）**

Run: `pnpm bench:engine 2000 | tee .handoff/06-perf/m4-final/bench-engine.md`
Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_STEPS_OUT_DIR=.handoff/06-perf/m4-final pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間`
Expected: 1 件成功、`steps-2d-settle.md`。step 数は Task 8 と同じ（Task 14・15 は結果を変えない。違えば止めて知らせる）、所要は Task 8 と同じか短い

- [ ] **Step 2: 平衡の行を確定する**

`docs/perf/<実行日>-fixes.md` に「## 平衡の確定（spec 06 §5）」として、500 m の 3 地点の半径 10 m・100 m の所要の Task 8 と Step 1 の値を並べ、次で判定する:
- 3 地点とも半径 10 m が 60 秒以内、かつ半径 100 m が 300 秒以内 → **基準内**。fill-spill-merge の spec は起こさない
- どれかが超える（または届かず）→ **超過**。03 §4.1 のとおり (b) 静的な fill-spill-merge 法を本命、(a) virtual pipe モデルを次点として、M6 で spec の雛形を起こす
- 1000 m の行も並べ、1000 m 四方の判定の材料にする

- [ ] **Step 3: M4 の後の判定の表を書く**

`docs/perf/<実行日>-fixes.md` に「## M4 の後の判定」として、Task 10 の判定の表と同じ行・列で、M4 で直した行は後の値、直さなかった行は M2 の値を書く。「対応」の列は「直した（Task N）」「基準内」「別の spec: <名前>」「記録のみ（理由）」のどれか。1000 m 四方の行は、他の行が満たされていなければ「ユーザーの裁定に上げる（1000 m を外すか注意を出すか）」と書き、コントローラーに知らせる。

「## 行わなかった項目」に、条件を満たさず行わなかった Task（番号・条件・測った値）を 1 行ずつ書く。

- [ ] **Step 4: spec 06 と tech-spec に書く**

spec 06 §5 の「M2 の判定」の引用の後に足す:

```markdown
> **M4 の後の判定（<実行日>、`docs/perf/<実行日>-fixes.md`）**: 直した項目: <Task 番号と指標、前 → 後>。平衡: <確定の判定と値>。別の spec を起こす: <名前の並び、無ければ「なし」>。記録のみ: <指標と理由>。
```

`specs/tech-spec.md` §14.1 の「06 の着手時の実測」の表の後に「06 の M4 の後（<実行日>）」の表（同じ列）を足す。§14.2 に、Task 19 を行ったならその後の `pnpm size` の表を足す。

- [ ] **Step 5: コミットし、マイルストーンの区切りに進む**

ゲートは `pnpm format && pnpm lint`（文書だけ。直した Task のゲートは各 Task で通している）。

```bash
git add docs/perf/ docs/superpowers/specs/2026-09-10-06-performance-design.md specs/tech-spec.md
git commit -m "平衡までの時間を M4 の後に測り直して spec 06 §5 の平衡の行を確定し、M4 の前後を tech-spec §14 に書く（M4）"
```

「マイルストーンの区切り」の 2・3 に従う（M4 の報告は `m4-report.md`）。

---

# M5: `probe=water`（境界 15 と 16 の可視率・ちらつき率。R06-7）

M5 の完了条件（spec 06 §1.2）: 表が `docs/perf/` にある。15 が p85 で通らなければ R05-4 をユーザーの裁定に上げている。M1 だけに依存する。

### Task 26: 水面のシェーダの計測用の uniform と `setDebug`（spec 06 §3、計画で決めたこと 15）

**Files:**
- Modify: `src/renderer/waterShaders.ts`、`src/renderer/waterShaders.test.ts`
- Modify: `src/renderer/waterLayer.ts`、`src/renderer/waterLayer.test.ts`
- Modify: `src/map/view3d/options.ts`（`onWaterDebug`、`WaterDebug` の型の再 export）
- Modify: `src/map/view3d/View3d.ts`（`addWater`・`removeWater`）

**Interfaces:**
- Consumes: なし
- Produces:
  - `src/renderer/waterLayer.ts`: `export type WaterDebugMode = 'off' | 'mask' | 'mask-nodepth'`、`export interface WaterDebug { mode: WaterDebugMode; liftM: number }`、`export function debugUniform(debug: WaterDebug): [number, number]`、`export function debugDepthTest(mode: WaterDebugMode): boolean`、`WaterLayer.setDebug(debug: WaterDebug): void`、`WaterUniforms.u_debug: { value: Vector2 }`
  - `View3dOptions.onWaterDebug?: (setDebug: ((debug: WaterDebug) => void) | null) => void`（水面を作ったときに setDebug、外したときに null を渡す）
  - `src/map/view3d/options.ts` から `export type { WaterDebug } from '../../renderer/waterLayer'`

- [ ] **Step 1: 失敗するテストを書く**

`src/renderer/waterShaders.test.ts` の 1 件目の `expect(WATER_VERTEX).toContain('(z + (d >= u_minDepth ? d : 0.0)) * u_exaggeration')` を次に置き換え、describe の最後に 1 件足す:

```ts
    expect(WATER_VERTEX).toContain('(z + (d >= u_minDepth ? d : 0.0) + lift) * u_exaggeration')
```

```ts
  it('計測用（probe=water）: u_debug.x が 1 なら判定用の不透明のマゼンタで描き、u_debug.y だけ持ち上げる（spec 06 §3）', () => {
    expect(WATER_VERTEX).toContain('float lift = u_debug.x > 0.5 ? u_debug.y : 0.0;')
    expect(WATER_FRAGMENT).toContain('if (u_debug.x > 0.5) {')
    expect(WATER_FRAGMENT).toContain('fragColor = vec4(1.0, 0.0, 1.0, 1.0);')
    // 1 cm 未満を捨てる判定は、判定用の色より先（footprint は 1 cm 以上の水面）
    expect(WATER_FRAGMENT.indexOf('discard')).toBeLessThan(WATER_FRAGMENT.indexOf('u_debug.x > 0.5'))
  })
```

`src/renderer/waterLayer.test.ts` の import に `debugDepthTest`・`debugUniform` を足し、末尾に足す（uniform の名前の一致のテストは、Step 3 の後に `u_debug` を含めて通る）:

```ts
describe('計測用の setDebug の値（probe=water。spec 06 §3）', () => {
  it('off は [0, 持ち上げ]、mask・mask-nodepth は [1, 持ち上げ]', () => {
    expect(debugUniform({ mode: 'off', liftM: 0 })).toEqual([0, 0])
    expect(debugUniform({ mode: 'mask', liftM: 0.1 })).toEqual([1, 0.1])
    expect(debugUniform({ mode: 'mask-nodepth', liftM: 0 })).toEqual([1, 0])
  })

  it('深度テストを切るのは mask-nodepth だけ', () => {
    expect(debugDepthTest('off')).toBe(true)
    expect(debugDepthTest('mask')).toBe(true)
    expect(debugDepthTest('mask-nodepth')).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm vitest run src/renderer/`
Expected: FAIL（シェーダの文字列、`debugUniform` が無い）

- [ ] **Step 3: シェーダを直す**

`src/renderer/waterShaders.ts` の `WATER_VERTEX` の `uniform float u_minDepth;` の後に `uniform vec2 u_debug;` を足し、

```glsl
  // 高さ = (標高 + 水深) × 垂直強調。1 cm 未満の頂点は地形と同じ高さに置く
  float h = (z + (d >= u_minDepth ? d : 0.0)) * u_exaggeration;
```

を次に置き換える:

```glsl
  // 計測（probe=water。spec 06 §3）: u_debug.x が 1 なら u_debug.y（m。垂直強調の前）だけ持ち上げる。通常は 0.0 を足すだけ
  float lift = u_debug.x > 0.5 ? u_debug.y : 0.0;
  // 高さ = (標高 + 水深) × 垂直強調。1 cm 未満の頂点は地形と同じ高さに置く
  float h = (z + (d >= u_minDepth ? d : 0.0) + lift) * u_exaggeration;
```

`WATER_FRAGMENT` の `uniform float u_alpha;` の後に `uniform vec2 u_debug;` を足し、`if (v_depth < u_minDepth) discard;` の後に足す:

```glsl
  // 計測（probe=water）: 判定用の不透明のマゼンタ（S の measureWater と同じ色。spec 06 §3）
  if (u_debug.x > 0.5) {
    fragColor = vec4(1.0, 0.0, 1.0, 1.0);
    return;
  }
```

- [ ] **Step 4: waterLayer を直す**

`src/renderer/waterLayer.ts`:
- three の import に `Vector2` を足す
- `WaterLayerOptions` の前に足す:

```ts
/** 計測用の描き方（probe=water。spec 06 §3）。mask: 判定用の色で描く。mask-nodepth: さらに深度テストを切る */
export type WaterDebugMode = 'off' | 'mask' | 'mask-nodepth'

export interface WaterDebug {
  mode: WaterDebugMode
  /** 水面を持ち上げる高さ（m。垂直強調の前）。地形が正当に隠す分と沈み込みを分けるのに使う（計画で決めたこと 15） */
  liftM: number
}

/** u_debug の値（x: 0 = 通常・1 = 判定用の色、y: 持ち上げ） */
export function debugUniform(debug: WaterDebug): [number, number] {
  return [debug.mode === 'off' ? 0 : 1, debug.liftM]
}

/** 深度テストを使うか（footprint を数える mask-nodepth だけ切る） */
export function debugDepthTest(mode: WaterDebugMode): boolean {
  return mode !== 'mask-nodepth'
}
```

- `WaterLayer` の `setLut` の後に足す:

```ts
  /** 計測用（probe=water）。通常の描画では呼ばない */
  setDebug(debug: WaterDebug): void
```

- `WaterUniforms` の `u_alpha` の後に `u_debug: { value: Vector2 }` を足し、`buildUniforms` の戻り値の `u_alpha: …,` の後に `u_debug: { value: new Vector2(0, 0) },` を足す
- `createWaterLayer` の戻り値の `setLut(next) { … },` の後に足す:

```ts
    setDebug(debug) {
      if (disposed) return
      const [mode, lift] = debugUniform(debug)
      uniforms.u_debug.value.set(mode, lift)
      material.depthTest = debugDepthTest(debug.mode)
      material.depthWrite = debugDepthTest(debug.mode)
      map.triggerRepaint()
    },
```

- [ ] **Step 5: View3d に受け口を足す**

`src/map/view3d/options.ts` の先頭の import の後に足す:

```ts
import type { WaterDebug } from '../../renderer/waterLayer'

export type { WaterDebug }
```

`View3dOptions` の `onWaterBuildTime` の後に足す（`DEFAULT_VIEW3D_OPTIONS` には足さない）:

```ts
  /**
   * 計測用（probe=water。spec 06 §3）。水面を作ったときに setDebug を、外したときに null を渡す。
   * 省略は受け口なし
   */
  onWaterDebug?: (setDebug: ((debug: WaterDebug) => void) | null) => void
```

`src/map/view3d/View3d.ts` の `addWater` の `this.water = water` の後に `this.options.onWaterDebug?.((debug) => water.setDebug(debug))` を足し、`removeWater` の `this.water = null` の後に `this.options.onWaterDebug?.(null)` を足す。

- [ ] **Step 6: テスト・ゲート・E2E**

Run: `pnpm vitest run src/renderer/ src/map/view3d/`
Expected: PASS（uniform の名前の一致のテストが `u_debug` を含めて通る）

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

Run: `pnpm build && pnpm exec playwright test --project=chromium && pnpm size`
Expected: E2E 41 件成功（3D の水面の画素のテストを含む。u_debug は 0 なので描画は変わらない）、初期ロード M4 の後の値のまま

- [ ] **Step 7: コミットする**

```bash
git add src/renderer/waterShaders.ts src/renderer/waterShaders.test.ts src/renderer/waterLayer.ts src/renderer/waterLayer.test.ts src/map/view3d/options.ts src/map/view3d/View3d.ts
git commit -m "水面のシェーダに計測用の uniform（判定用の色と持ち上げ）と setDebug を足す（probe=water の準備。通常の描画は変わらない。spec 06 §3、R06-7）"
```

---

### Task 27: `probe=water` と `water.perf.ts`（spec 06 §3、R06-7、計画で決めたこと 15）

**Files:**
- Modify: `src/ui/perfParams.ts`、`src/ui/perfParams.test.ts`（`probe=water`、`zs`、`wet`）
- Create: `src/ui/perfWaterStats.ts`、`src/ui/perfWaterStats.test.ts`
- Create: `src/ui/perfWater.ts`
- Modify: `src/ui/perfReports.ts`（`WaterProbeRow`・`WaterProbeReport`）
- Modify: `src/ui/perfHook.ts`
- Create: `tests/perf/water.perf.ts`

**Interfaces:**
- Consumes: Task 26 の `View3dOptions.onWaterDebug`・`WaterDebug`、Task 4 の `perfWait`
- Produces:
  - `PerfProbe` に `'water'`、`PerfParams.zooms: number[]`・`PerfParams.wetMs: number`
  - `src/ui/perfWaterStats.ts`: `JITTER_DEG`・`ERODE_PX`・`LIFT_M`・`VISIBLE_PASS`・`FLICKER_PASS`・`MIN_FOOTPRINT_PX`・`MIN_CAMERA_CLEARANCE_M`、`magentaMask(rgba)`、`erode(mask, width, height, times)`、`countMask(mask)`、`WaterMeasure`、`measureWaterMasks(input)`、`WaterVerdict`、`judgeWater(measure, cameraClearanceM)`
  - `<html data-water-result>`

- [ ] **Step 1: 判定の失敗するテストを書く**

`src/ui/perfWaterStats.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  countMask,
  erode,
  judgeWater,
  magentaMask,
  measureWaterMasks,
  MIN_FOOTPRINT_PX,
  type WaterMeasure,
} from './perfWaterStats'

describe('magentaMask（S の readMask と同じ閾値）', () => {
  it('R > 200・G < 80・B > 200 の画素だけ 1', () => {
    const rgba = Uint8Array.of(255, 0, 255, 255, 201, 79, 201, 255, 255, 80, 255, 255, 200, 0, 255, 255)
    expect(Array.from(magentaMask(rgba))).toEqual([1, 1, 0, 0])
  })
})

describe('erode', () => {
  it('5 × 5 の全部 1 を 2 回削ると中央の 1 画素だけ残る', () => {
    const mask = new Uint8Array(25).fill(1)
    const once = erode(mask, 5, 5, 1)
    expect(countMask(once)).toBe(9)
    const twice = erode(mask, 5, 5, 2)
    expect(countMask(twice)).toBe(1)
    expect(twice[12]).toBe(1)
  })
})

describe('measureWaterMasks（計画で決めたこと 15）', () => {
  it('可視率（spec の定義）・持ち上げ比・ちらつき率', () => {
    const footprint = new Uint8Array(25).fill(1)
    const v0 = new Uint8Array(25).fill(1)
    v0.fill(0, 0, 5) // 上の 1 行が隠れている
    const v1 = v0.slice()
    const v2 = v0.slice()
    v2[12] = 0 // 中央が 1 つの揺らしでだけ消える（ちらつき）
    const lifted = new Uint8Array(25).fill(1)
    lifted.fill(0, 0, 2) // 持ち上げても 2 画素は隠れる（地形が正当に隠す分）
    const m = measureWaterMasks({ width: 5, height: 5, footprint, visible: [v0, v1, v2], lifted })
    expect(m).toEqual({
      footprintPx: 25,
      visiblePx: 20,
      liftedPx: 23,
      visibleRatio: 0.8,
      unoccludedRatio: 20 / 23,
      interiorPx: 1,
      flickerRatio: 1,
    })
  })

  it('footprint・持ち上げが空なら比は null', () => {
    const empty = new Uint8Array(4)
    const m = measureWaterMasks({ width: 2, height: 2, footprint: empty, visible: [empty], lifted: empty })
    expect([m.visibleRatio, m.unoccludedRatio, m.flickerRatio]).toEqual([null, null, null])
  })
})

describe('judgeWater（S と同じ閾値: 持ち上げ比 0.98 以上・ちらつき 1% 以下）', () => {
  const base: WaterMeasure = {
    footprintPx: 10_000,
    visiblePx: 9900,
    liftedPx: 9950,
    visibleRatio: 0.99,
    unoccludedRatio: 0.995,
    interiorPx: 9000,
    flickerRatio: 0.001,
  }

  it('閾値の内なら pass、外なら fail', () => {
    expect(judgeWater(base, 100).verdict).toBe('pass')
    expect(judgeWater({ ...base, unoccludedRatio: 0.97 }, 100).verdict).toBe('fail')
    expect(judgeWater({ ...base, flickerRatio: 0.02 }, 100).verdict).toBe('fail')
  })

  it('水面がほとんど画面に無い・カメラが地面に近すぎるなら評価不能（不合格と読まない）', () => {
    expect(judgeWater({ ...base, footprintPx: MIN_FOOTPRINT_PX - 1 }, 100).verdict).toBe(
      'not-evaluable',
    )
    expect(judgeWater(base, 0.5).verdict).toBe('not-evaluable')
    expect(judgeWater(base, null).verdict).toBe('pass')
  })
})
```

`src/ui/perfParams.test.ts` の「すべての項目を読む」の URL を `'?probe=water&…'` に替え（`probe: 'water'` を期待に）、末尾に `'&zs=15.5,16.25&wet=15000'` を足し、期待に `zooms: [15.5, 16.25], wetMs: 15_000` を足す。「既定値」の期待に `zooms: [16], wetMs: 20_000` を足す。`describe('parseAt…'` の前に足す:

```ts
describe('zs（probe=water の視点のズームの並び）', () => {
  it('範囲の外・数でない値は捨て、何も残らなければ z の 1 つ', () => {
    expect(parsePerfParams('?probe=water&z=17&zs=15,x,99,16.5')?.zooms).toEqual([15, 16.5])
    expect(parsePerfParams('?probe=water&z=17&zs=x')?.zooms).toEqual([17])
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm vitest run src/ui/perfWaterStats.test.ts src/ui/perfParams.test.ts`
Expected: FAIL

- [ ] **Step 3: 判定を書く**

`src/ui/perfWaterStats.ts`:

```ts
/**
 * probe=water の判定（spec 06 §3、R06-7、計画で決めたこと 15）。S の spike/src/capture.ts の measureWater の
 * 考え方を移し、地形が正当に隠す分を分けるために「持ち上げた水面」の描き方を足した。純粋な関数だけを置く
 */

/** bearing を揺らす量（度）。遠くの画素の移動をちらつきと取り違えないよう、内側を削ってから比べる（S の計画 D9） */
export const JITTER_DEG = [0, 0.002, -0.002] as const
export const ERODE_PX = 2
/** 持ち上げる高さ（m。垂直強調の前）。弦の沈み込みの最大（z15 で 2.46 cm）の 4 倍 */
export const LIFT_M = 0.1
/** S の判定の閾値（持ち上げ比の最小、ちらつき率の最大） */
export const VISIBLE_PASS = 0.98
export const FLICKER_PASS = 0.01
/** これより水面の画素が少ない視点は評価しない（05 の Task 13 の落とし穴: カメラが強調した地形の中） */
export const MIN_FOOTPRINT_PX = 500
export const MIN_CAMERA_CLEARANCE_M = 1

/** 判定用の色（マゼンタ）の画素を 1 にしたマスク（RGBA の並び） */
export function magentaMask(rgba: Uint8Array): Uint8Array {
  const mask = new Uint8Array(Math.floor(rgba.length / 4))
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4
    mask[i] =
      (rgba[o] ?? 0) > 200 && (rgba[o + 1] ?? 255) < 80 && (rgba[o + 2] ?? 0) > 200 ? 1 : 0
  }
  return mask
}

/** 4 近傍で times 回削る（端の 1 画素は 0） */
export function erode(mask: Uint8Array, width: number, height: number, times: number): Uint8Array {
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

export function countMask(mask: Uint8Array): number {
  let count = 0
  for (const value of mask) count += value
  return count
}

export interface WaterMeasure {
  /** 深度テストなしの水面の画素（1 cm 以上の水面が画面に占める画素） */
  footprintPx: number
  /** 深度テストありで見えた画素（揺らしの 1 つ目） */
  visiblePx: number
  /** 深度テストありで、水面を LIFT_M 持ち上げたときに見えた画素 */
  liftedPx: number
  /** spec 06 §3 の定義: 見えた / footprint（地形が正当に隠す分を含む） */
  visibleRatio: number | null
  /** 見えた / 持ち上げたときに見えた（沈み込みだけを見る。判定に使う） */
  unoccludedRatio: number | null
  interiorPx: number
  /** 削った footprint の内側で、揺らしの間に見え方が変わった画素の割合 */
  flickerRatio: number | null
}

export function measureWaterMasks(input: {
  width: number
  height: number
  footprint: Uint8Array
  visible: readonly Uint8Array[]
  lifted: Uint8Array
}): WaterMeasure {
  const footprintPx = countMask(input.footprint)
  const first = input.visible[0] ?? new Uint8Array(input.footprint.length)
  const visiblePx = countMask(first)
  const liftedPx = countMask(input.lifted)
  const interior = erode(input.footprint, input.width, input.height, ERODE_PX)
  let interiorPx = 0
  let changed = 0
  for (let i = 0; i < interior.length; i++) {
    if (interior[i] !== 1) continue
    interiorPx++
    if (input.visible.some((mask) => mask[i] !== first[i])) changed++
  }
  return {
    footprintPx,
    visiblePx,
    liftedPx,
    visibleRatio: footprintPx === 0 ? null : Math.min(1, visiblePx / footprintPx),
    unoccludedRatio: liftedPx === 0 ? null : Math.min(1, visiblePx / liftedPx),
    interiorPx,
    flickerRatio: interiorPx === 0 ? null : changed / interiorPx,
  }
}

export type WaterVerdict = 'pass' | 'fail' | 'not-evaluable'

export function judgeWater(
  measure: WaterMeasure,
  cameraClearanceM: number | null,
): { verdict: WaterVerdict; reason: string } {
  if (measure.footprintPx < MIN_FOOTPRINT_PX) {
    return {
      verdict: 'not-evaluable',
      reason: `水面が画面にほとんど無い（${measure.footprintPx} px）。カメラが強調した地形の中か、水平線すれすれ`,
    }
  }
  if (cameraClearanceM !== null && cameraClearanceM < MIN_CAMERA_CLEARANCE_M) {
    return {
      verdict: 'not-evaluable',
      reason: `カメラと地面の差が ${cameraClearanceM.toFixed(2)} m`,
    }
  }
  const { unoccludedRatio, flickerRatio } = measure
  if (unoccludedRatio === null || flickerRatio === null) {
    return { verdict: 'not-evaluable', reason: '持ち上げた水面か内側の画素が無い' }
  }
  const pass = unoccludedRatio >= VISIBLE_PASS && flickerRatio <= FLICKER_PASS
  return {
    verdict: pass ? 'pass' : 'fail',
    reason: `持ち上げ比 ${unoccludedRatio.toFixed(4)}・ちらつき ${(flickerRatio * 100).toFixed(3)}%`,
  }
}
```

`src/ui/perfParams.ts`:
- `PerfProbe` と `PROBES` に `'water'` を足す
- `PerfParams` の `at` の後に足す:

```ts
  /** probe=water: 順に置く地図のズーム（zs=15.5,16。範囲の外・数でない値は捨てる。無ければ [zoom]） */
  zooms: number[]
  /** probe=water: 降雨を「最速」で回してから止めるまで（ms。wet=） */
  wetMs: number
```

- `parsePerfParams` の `const zoom = …` を作り（`zoom: number('z', 16, 0, 18)` を `const zoom = number('z', 16, 0, 18)` に出して `zoom,` にする）、戻り値の `at: …,` の後に足す:

```ts
    zooms: (() => {
      const list = (params.get('zs') ?? '')
        .split(',')
        .map((part) => (part.trim() === '' ? Number.NaN : Number(part)))
        .filter((value) => Number.isFinite(value) && value >= 0 && value <= 18)
      return list.length === 0 ? [zoom] : list
    })(),
    wetMs: number('wet', 20_000, 0, 300_000),
```

- [ ] **Step 4: 判定のテストが通ることを確かめる**

Run: `pnpm vitest run src/ui/perfWaterStats.test.ts src/ui/perfParams.test.ts`
Expected: PASS

- [ ] **Step 5: `probe=water` を書く**

`src/ui/perfReports.ts` の import に `import type { WaterMeasure, WaterVerdict } from './perfWaterStats'` を足し、末尾に足す:

```ts
export interface WaterProbeRow {
  requestedZoom: number
  mapZoom: number
  mapPitch: number
  /** 画面の中心で描かれている地形タイルのズーム（実測。data-drawn-tile-zoom） */
  drawnTileZoom: string
  /** カメラの高さ − カメラの真下の地形の高さ（m、垂直強調の後）。地形が無ければ null */
  cameraClearanceM: number | null
  measure: WaterMeasure
  verdict: WaterVerdict
  reason: string
}

export interface WaterProbeReport {
  params: PerfParams
  /** 降雨を止めた時点の step */
  stoppedAtStep: number | null
  rows: WaterProbeRow[]
}
```

`src/ui/perfWater.ts`:

```ts
/**
 * probe=water（spec 06 §3、R06-7、計画で決めたこと 15）: 降雨を「最速」で wetMs だけ回して止め、zs の視点ごとに
 * 水面を 3 通りに描いて画素を数え、可視率・持ち上げ比・ちらつき率を出す。pnpm build:perf のときだけビルドに入る
 */
import type { Map as MapLibreMap } from 'maplibre-gl'
import type { WaterDebug } from '../map/view3d/options'
import type { SettingsStore } from '../state/settingsStore'
import type { PerfParams } from './perfParams'
import type { WaterProbeReport, WaterProbeRow } from './perfReports'
import {
  JITTER_DEG,
  judgeWater,
  LIFT_M,
  magentaMask,
  measureWaterMasks,
  type WaterMeasure,
} from './perfWaterStats'
import {
  nextFrame,
  placeViewOnLoadedTerrain,
  sleep,
  WAIT_MS,
  waitFor,
  waitForDataset,
  waitTilesLoaded,
} from './perfWait'
import type { TerrainSession } from './terrainSession'

/**
 * 次の描画の直後に、既定のフレームバッファの画素を読んでマスクにする。preserveDrawingBuffer を変えないため、
 * render イベントの中（合成の前）で読む。フレームバッファの切り替えは MapLibre の GL の状態の cache を通す
 * （gl.bindFramebuffer を直接呼ぶと MapLibre が覚えている値とずれる）。map.painter.context.bindFramebuffer は
 * MapLibre 6.6.0 の内部（M6 の一覧に足す）
 */
function readMask(map: MapLibreMap): Promise<Uint8Array> {
  return new Promise((resolve) => {
    map.once('render', () => {
      const { context } = map.painter
      const { gl } = context
      context.bindFramebuffer.set(null)
      const rgba = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4)
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
      resolve(magentaMask(rgba))
    })
    map.triggerRepaint()
  })
}

/** 描き方を変えた後、タイルが揃って 1 フレーム描くのを待ってから読む */
async function drawAndRead(
  map: MapLibreMap,
  setDebug: (debug: WaterDebug) => void,
  debug: WaterDebug,
): Promise<Uint8Array> {
  setDebug(debug)
  await waitTilesLoaded(map)
  await nextFrame()
  return readMask(map)
}

async function measureWater(
  map: MapLibreMap,
  setDebug: (debug: WaterDebug) => void,
): Promise<WaterMeasure> {
  const bearing = map.getBearing()
  const footprint = await drawAndRead(map, setDebug, { mode: 'mask-nodepth', liftM: 0 })
  const lifted = await drawAndRead(map, setDebug, { mode: 'mask', liftM: LIFT_M })
  const visible: Uint8Array[] = []
  for (const delta of JITTER_DEG) {
    map.jumpTo({ bearing: bearing + delta })
    visible.push(await drawAndRead(map, setDebug, { mode: 'mask', liftM: 0 }))
  }
  map.jumpTo({ bearing })
  setDebug({ mode: 'off', liftM: 0 })
  const { gl } = map.painter.context
  return measureWaterMasks({
    width: gl.drawingBufferWidth,
    height: gl.drawingBufferHeight,
    footprint,
    visible,
    lifted,
  })
}

/** カメラの高さ − カメラの真下の地形の高さ（m）。map.transform の 2 つは MapLibre 6.6.0 の型にある */
function cameraClearanceM(map: MapLibreMap): number | null {
  const ground = map.queryTerrainElevation(map.transform.getCameraLngLat())
  return ground === null ? null : map.transform.getCameraAltitude() - ground
}

export async function runWaterProbe(
  session: TerrainSession,
  settings: SettingsStore,
  params: PerfParams,
  getSetDebug: () => ((debug: WaterDebug) => void) | null,
): Promise<WaterProbeReport> {
  const { store, simulation } = session
  await waitFor(
    () => store.getState().load.status === 'ready',
    (listener) => store.subscribe(listener),
  )
  store.getState().setViewMode('3d')
  await waitFor(
    () => store.getState().view3dStatus === '3d',
    (listener) => store.subscribe(listener),
  )
  const controller = session.view3d.mapController()
  const selected = store.getState().selected
  if (controller === null || selected === null) throw new Error('地図または地点がありません')
  const { map } = controller
  const container = map.getContainer()
  await waitForDataset(container, (dataset) => dataset.view3dFramed === 'true')
  await waitForDataset(container, (dataset) => Number(dataset.waterBuilds ?? '0') >= 1, WAIT_MS)
  const { amountMm, radiusM } = settings.getState().rainfall
  simulation.setSpeed('max')
  simulation.start(amountMm, radiusM)
  await sleep(params.wetMs)
  simulation.pause()
  // 止めた後の最後の frame（水面の転送）を流す
  await sleep(500)
  const rows: WaterProbeRow[] = []
  for (const zoom of params.zooms) {
    await placeViewOnLoadedTerrain(
      map,
      { center: [selected.lon, selected.lat], zoom, pitch: params.pitch, bearing: params.bearing },
      () => undefined,
      () => waitTilesLoaded(map),
    )
    await sleep(params.settleMs)
    const setDebug = getSetDebug()
    if (setDebug === null) throw new Error('水面がありません（onWaterDebug が呼ばれていない）')
    const clearance = cameraClearanceM(map)
    const measure = await measureWater(map, setDebug)
    const { verdict, reason } = judgeWater(measure, clearance)
    rows.push({
      requestedZoom: zoom,
      mapZoom: map.getZoom(),
      mapPitch: map.getPitch(),
      drawnTileZoom: container.dataset.drawnTileZoom ?? '',
      cameraClearanceM: clearance,
      measure,
      verdict,
      reason,
    })
  }
  return { params, stoppedAtStep: simulation.store.getState().stats?.step ?? null, rows }
}
```

`src/ui/perfHook.ts`:
- import に `import type { WaterDebug } from '../map/view3d/options'` と `import { runWaterProbe } from './perfWater'` を足す
- `const waterBuildMs: number[] = []` の後に `let setWaterDebug: ((debug: WaterDebug) => void) | null = null` を足す
- `session.view3d.setOptions({ … })` の `onWaterBuildTime: …,` の後に `onWaterDebug: (setDebug) => { setWaterDebug = setDebug },` を足す
- `publish` の `key` の型に `| 'waterResult'` を足す
- `if (params.probe === 'load') { … }` の後に足す:

```ts
    if (params.probe === 'water') {
      publish(
        'waterResult',
        await runWaterProbe(session, settings, params, () => setWaterDebug),
      )
      return
    }
```

- [ ] **Step 6: `water.perf.ts` を書く**

`tests/perf/water.perf.ts`:

```ts
/**
 * 境界 15 と 16 の可視率・ちらつき率（spec 06 §3・§6 の 6、R06-7、計画で決めたこと 15）。pnpm build:perf の後に
 *   pnpm perf:fps tests/perf/water.perf.ts
 * で回す（地理院に接続する）。渋谷・500 m・500 mm・半径 50 m（05 の撮影と同じ水）を 20 秒「最速」で回して止め、
 * pitch 45・60・85 × 倍率 1・2・5・10 ごとに、描かれるタイルが 15・16 になる見込みのズームとその 0.25・0.5 粗い
 * ズームを置いて測る。環境変数: RAINTRACE_WATER_OUT_DIR（.handoff/06-perf/water-probe）・RAINTRACE_WATER_PITCHES（45,60,85）・
 * RAINTRACE_WATER_EX（1,2,5,10）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { drawnTileZoom } from '../../src/dem/tileZoom'
import { mapZoomForCentreTileZoom } from '../../src/map/view3d/drawnZoom'
import type { WaterProbeReport, WaterProbeRow } from '../../src/ui/perfReports'
import {
  assertPerfBuild,
  listFromEnv,
  outDirFromEnv,
  query,
  readReport,
  SITES,
  withFreshPage,
} from './support'

const ALL_PITCHES = ['45', '60', '85'] as const
const ALL_EXAGGERATIONS = ['1', '2', '5', '10'] as const
/** 絞って試すとき: RAINTRACE_WATER_PITCHES=60 RAINTRACE_WATER_EX=1 */
const PITCHES = listFromEnv(process.env.RAINTRACE_WATER_PITCHES, ALL_PITCHES, ALL_PITCHES).map(Number)
const EXAGGERATIONS = listFromEnv(process.env.RAINTRACE_WATER_EX, ALL_EXAGGERATIONS, ALL_EXAGGERATIONS).map(
  Number,
)
const DRAWN = [15, 16] as const
/** 見込みは実測より粗い側にだけ外れる（05 の計画で決めたこと 3）ので、見込みのズームから粗い側へも置く */
const OFFSETS = [0, -0.25, -0.5] as const
const outDir = outDirFromEnv(process.env.RAINTRACE_WATER_OUT_DIR, '.handoff/06-perf/water-probe')
const PAGE_TIMEOUT_MS = 600_000

interface Cell {
  pitch: number
  ex: number
  drawn: number
  row: WaterProbeRow | null
}

const ratio = (value: number | null, digits: number): string =>
  value === null ? '—' : value.toFixed(digits)

test('境界 15 と 16 の可視率・ちらつき率（probe=water）', async ({ browser }, testInfo) => {
  assertPerfBuild()
  test.setTimeout(PITCHES.length * EXAGGERATIONS.length * PAGE_TIMEOUT_MS)
  const baseURL = testInfo.project.use.baseURL ?? 'http://localhost:4175'
  const reports: { pitch: number; ex: number; report: WaterProbeReport }[] = []
  const cells: Cell[] = []
  for (const pitch of PITCHES) {
    for (const ex of EXAGGERATIONS) {
      const zooms = DRAWN.flatMap((d) =>
        OFFSETS.map((o) => (mapZoomForCentreTileZoom(drawnTileZoom(d), pitch) + o).toFixed(3)),
      )
      const url = query({
        lat: SITES.shibuya.lat,
        lon: SITES.shibuya.lon,
        size: '500',
        mm: '500',
        r: '50',
        probe: 'water',
        zs: zooms.join(','),
        ex: String(ex),
        pitch: String(pitch),
        wet: '20000',
        settle: '1000',
        fallback: '0',
      })
      const report = await withFreshPage(browser, baseURL, async (page) => {
        await page.goto(url)
        return readReport<WaterProbeReport>(page, 'data-water-result', PAGE_TIMEOUT_MS)
      })
      expect(report.rows.length).toBe(zooms.length)
      reports.push({ pitch, ex, report })
      for (const d of DRAWN) {
        // 実測の描かれるタイルが d で、評価できる最初の行をそのセルの値にする
        const row =
          report.rows.find((r) => r.drawnTileZoom === String(d) && r.verdict !== 'not-evaluable') ??
          null
        cells.push({ pitch, ex, drawn: d, row })
      }
    }
  }
  const lines = [
    '渋谷・500 m・500 mm・半径 50 m を「最速」で 20 秒回して止めた水面。判定は持ち上げ比 0.98 以上かつちらつき 1% 以下（S と同じ閾値。持ち上げ比 = 見えた画素 / 0.10 m 持ち上げたときに見えた画素）',
    '',
    '| pitch | 倍率 | 描かれるタイル | 地図のズーム（実測 pitch） | footprint (px) | 可視率（見えた / footprint） | 持ち上げ比 | ちらつき | カメラと地面 (m) | 判定 |',
    '|---:|---:|---:|---|---:|---:|---:|---:|---:|---|',
  ]
  for (const { pitch, ex, drawn, row } of cells) {
    if (row === null) {
      lines.push(`| ${pitch} | ${ex} | ${drawn} | — | — | — | — | — | — | 評価できる視点が無い |`)
      continue
    }
    const m = row.measure
    lines.push(
      `| ${pitch} | ${ex} | ${drawn} | ${row.mapZoom.toFixed(3)}（${row.mapPitch.toFixed(1)}） | ${m.footprintPx} | ${ratio(m.visibleRatio, 4)} | ${ratio(m.unoccludedRatio, 4)} | ${m.flickerRatio === null ? '—' : `${(m.flickerRatio * 100).toFixed(3)}%`} | ${ratio(row.cameraClearanceM, 1)} | ${row.verdict === 'pass' ? '○' : '×'}（${row.reason}） |`,
    )
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(new URL('water.json', outDir), `${JSON.stringify(reports, null, 2)}\n`)
  writeFileSync(new URL('water.md', outDir), `${lines.join('\n')}\n`)
  console.log(lines.join('\n'))
})
```

- [ ] **Step 7: ゲートを通し、1 視点で試す**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

Run: `pnpm build:perf && RAINTRACE_WATER_PITCHES=60 RAINTRACE_WATER_EX=1 RAINTRACE_WATER_OUT_DIR=.handoff/06-perf/water-dry pnpm perf:fps tests/perf/water.perf.ts`
Expected:
- 1 件成功
- `water.md` の 2 行（p60 ×1 の 15・16）が `○` か `×`（評価できる視点が無い、が 2 行とも出たら、`cameraClearanceM` が極端〈負・数千 m〉でないか JSON を見る。`getCameraAltitude` が地形の高さを含まない値なら、`judgeWater` に渡す clearance を null にして footprint の条件だけで評価する形に直し、報告に書く）
- 5 cm 刻みの水面が見える視点で footprint が数千 px 以上

Run: `pnpm build && (grep -c perfHook build-info/manifest.json || true) && (grep -l raintrace-perf dist/assets/*.js || true) && pnpm size`
Expected: `0`、何も出ない、初期ロードは M4 の後の値のまま

- [ ] **Step 8: コミットする**

```bash
git add src/ui/perfParams.ts src/ui/perfParams.test.ts src/ui/perfWaterStats.ts src/ui/perfWaterStats.test.ts src/ui/perfWater.ts src/ui/perfReports.ts src/ui/perfHook.ts tests/perf/water.perf.ts
git commit -m "probe=water: 水面を深度テストなし・あり・持ち上げの 3 通りに描いて画素を数え、境界 15 と 16 の可視率・持ち上げ比・ちらつき率を出す（spec 06 §3、R06-7）"
```

---

### Task 28: 境界 15 と 16 の表を記録し、必要なら R05-4 をユーザーの裁定に上げる（M5 の完了）

**Files:**
- Create: `docs/perf/<実行日>-water-probe.md`
- Modify（15 が p85 で通らないときだけ）: `docs/superpowers/specs/2026-09-10-00-overview.md`（R05-4 の行）

**Interfaces:**
- Consumes: Task 27 の `water.perf.ts`
- Produces: spec 06 §6 の 6 の表。R05-4 の再裁定の要否

- [ ] **Step 1: 測る（12 ページ、約 20〜40 分）**

Run（バックグラウンド）: `pnpm build:perf && RAINTRACE_WATER_OUT_DIR=.handoff/06-perf/water-probe pnpm perf:fps tests/perf/water.perf.ts`
Expected: 1 件成功、`water.{json,md}`（24 行 = 3 pitch × 4 倍率 × 2 境界）

- [ ] **Step 2: 記録する**

`docs/perf/<実行日>-water-probe.md` に、`water.md` の表と、次を書く:
- 判定の読み方（計画で決めたこと 15: 可視率は地形が正当に隠す分を含むので参考、判定は持ち上げ比）
- 05 の撮影（`.handoff/05-screenshots/`）で評価できなかった p85 の倍率 2 以上が、この表で評価できたか
- 「評価できる視点が無い」セルの数と理由（カメラが強調した地形の中など）

- [ ] **Step 3: R05-4 に当てはめる**

- **p85 の倍率 1・2・5・10 のうち、描かれるタイル 15 の行に × があり、同じ倍率の 16 の行が ○** → 15 は p85 で通らない。`docs/superpowers/specs/2026-09-10-00-overview.md` の R05-4 の行の裁定の欄の末尾に「**06 の probe=water（<実行日>、`docs/perf/<実行日>-water-probe.md`）: p85 の倍率 <値> で境界 15 が持ち上げ比 <値>・ちらつき <値> で不合格、16 は合格。R05-4 をユーザーの裁定に戻す（境界を 16 にする／遠景の沈み込みを PoC で許す）**」と書き、コントローラーに知らせる（コントローラーがユーザーに裁定を頼む。この計画では境界の定数を変えない）
- **15 も 16 も ×** → 境界の問題ではなく、その視点の水面の描き方（polygonOffset の強さや遠景の精度）の問題として記録し、コントローラーに知らせる
- **15 が全部 ○（または評価できない行だけ）** → 「R05-4 の境界 15 は p85 でも可視率・ちらつきの基準を満たす（評価できなかった視点: …）」と overview の R05-4 の行に 1 文足す

- [ ] **Step 4: コミットし、マイルストーンの区切りに進む**

ゲートは `pnpm format && pnpm lint`。

```bash
git add docs/perf/ docs/superpowers/specs/2026-09-10-00-overview.md
git commit -m "probe=water で境界 15 と 16 の可視率・ちらつき率の表を記録し、R05-4 に当てはめる（spec 06 §6 の 6、R06-7、M5）"
```

「マイルストーンの区切り」の 2・3 に従う（M5 の報告は `m5-report.md`）。

---

# M6: 締め

M6 の完了条件（spec 06 §1.2）: spec 06 §6 を満たす。

### Task 29: 完了条件の照合、tech-spec §14 の値、MapLibre 6.6.0 の内部への依存の一覧、別の spec の雛形（spec 06 §6）

**Files:**
- Modify: `specs/tech-spec.md`（§14.1・§14.2 の最終の値、§14.4「MapLibre 6.6.0 の内部への依存（版を上げるときの確認点）」を新設）
- Modify: `docs/superpowers/specs/2026-09-10-06-performance-design.md`（Status と §6 の照合）
- Modify: `docs/superpowers/specs/2026-09-10-00-overview.md`（§6 の R06 の行に 06 の結果）
- Create（M4 の後の判定で「別の spec を起こす」とした分だけ）: `docs/superpowers/specs/<実行日>-07-<名前>-design.md`

**Interfaces:**
- Consumes: Task 8〜28 の記録
- Produces: 06 の PR の材料

- [ ] **Step 1: MapLibre 6.6.0 の内部への依存の一覧を tech-spec に移す**

`specs/tech-spec.md` の §14.3 の後（`---` の前）に足す。行番号は `node_modules/maplibre-gl/dist/maplibre-gl-dev.mjs`（6.6.0）で、書く前に各行を開いて今も正しいことを確かめる:

```markdown
## 14.4 MapLibre 6.6.0 の内部への依存（版を上げるときの確認点）

実装 spec 05・06 で、MapLibre の公開 API の外、または挙動の細部に頼っているもの。`maplibre-gl` の版を上げるときは、各項目を `maplibre-gl-dev.mjs` で読み直し、E2E と計測（`pnpm perf:fps`）を回す。行番号は 6.6.0 のもの。

| 頼っているもの | 使っている場所 | 本番か計測だけか | 確かめること |
|---|---|---|---|
| `map.terrain.tileManager.getRenderableTiles()` と戻り値の `tileID.canonical`（10017 行） | `src/map/view3d/View3d.ts` の `measuredCentreZoom`（毎 render） | 本番 | (c) の判定の実測。有無と形 |
| `map.painter.context.gl` | `src/map/fpsProbe.ts`・`src/ui/perfWater.ts` | 計測だけ | GL のコンテキストの取り出し（`drawingBufferWidth`・`readPixels`） |
| `map.painter.context.bindFramebuffer.set(null)`（16954 行）と `render` イベントの中の `gl.readPixels` | `src/ui/perfWater.ts` | 計測だけ | `render` が `painter.render` の直後に同期で発火し（26187〜26197 行）、その時点で既定のフレームバッファに描き終えていること（合成の前） |
| 地形が有効な間は `opaquePassCutoff = 0`（19118〜19121 行）で、symbol は深度テストなし（`getDepthModeForSublayer` → `DepthMode.disabled`、19074 行）で水面（custom）の上に描かれる。線・円のレイヤーは custom の後の 2 つ目の地形のパス（22979〜23000 行）で LEQUAL で描かれる | `src/ui/perfWater.ts` が水の矢印（`arrows=0`）・範囲の枠・流れの向き・最低点を隠して読む（Task 27 のレビュー I1・I4） | 計測だけ | 判定用の色を覆うレイヤーが変わっていないこと |
| `jumpTo` に center・zoom を渡すと `terrain.getElevationForLngLatZoom(center, options.zoom)` で中心の標高を決め（22264 行）、小数のズームでは 0 m になって次の zoom を渡さない `jumpTo` まで残る（実測） | `src/ui/perfWater.ts` の `settleCenterElevation`。`placeViewOnLoadedTerrain` を使うほかの計測（fps・view）の視点も同じ影響を受ける | 計測だけ | 中心の標高が 0 m に置かれるか（直っていれば `settleCenterElevation` は何もしない） |
| `_elevateCameraIfInsideTerrain`（22431〜22443 行、22454 行で登録） | 計測の視点の照合（`tests/perf/fps.perf.ts` の pitch の下限 −10）、手動確認の「×10 はズーム 16.0 まで」 | 計測・手動 | ×10 で pitch 85 を要求すると 78.6° に落ち着くこと |
| `Map.setTerrain` の先頭の `style._checkLoaded()`（25027〜25028 行）と、喪失の `_contextLost` が `style = null` にしつつ `map.terrain` を残すこと（23170〜23189 行） | `View3d.afterRender`・`View3d.dispose` の `isLoaded()` の守り | 本番 | 読み込み中・喪失の間の例外の種類 |
| 3D の地形の喪失からの復帰で、失ったコンテキストの GL 資源を触る警告（175〜258 件） | `tests/e2e/view3d.spec.ts` の喪失のテストの許容（400 件未満） | E2E | 警告が消えたら許容を外す |
| `CanvasSource` の `play()`（`_playing` を立てて `triggerRepaint`）と `pause()`（`_playing` の間に `prepare()` で `texture.update` してから下ろす）（4601〜4609・4649・4672〜4673 行） | `src/map/WaterOverlay.ts` の `uploadCanvasSource`（06 の Task 18。行わなかったなら、この行は書かない） | 本番 | `pause()` が転送すること、`hasTransition()` が `_playing` を返すこと |
| `pause()` → `prepare()` → `Texture.update`（`maplibre-gl-shared-dev.mjs` 16852〜16905 行）が MapLibre の render パスの外（アプリの rAF の中）で走ること。`Texture.update` は現在アクティブなユニットに `gl.bindTexture(TEXTURE_2D, …)` で直に bind し、pixel-store の値を Context のキャッシュ済みの setter で設定して既定値に戻すだけで、フレームバッファ・viewport・program には触れない | `src/map/WaterOverlay.ts` の `uploadCanvasSource`（06 の Task 18） | 本番 | 安全な理由: MapLibre の `Texture.bind` は常に直に bind し直す（`maplibre-gl-shared-dev.mjs` 16924〜16928 行）ので MapLibre 側に古い bind のキャッシュが残らない。three.js の水面のレンダラーは毎 render の前に `resetState()` を呼ぶ（`src/renderer/waterLayer.ts` 約 357 行）。版を上げたら `Texture.update`・`Texture.bind` のこの前提が変わっていないか確かめる |
| `Style.hasTransition()` が、再生中の canvas ソースがあると真になり `idle` が来ないこと | 計測の待ち（`areTilesLoaded()` を使い `idle` を待たない） | 計測だけ | — |
| `map._camera.transform`（23231 行。6.6.0 の `Map` には `transform` の getter が無い）の `getCameraAltitude()`（9564〜9565 行）・`getCameraLngLat()`・`elevation` と `map.queryTerrainElevation`（→ `getElevation`、10306〜10307 行） | `src/ui/perfWater.ts` のカメラと地面の差・読みごとのカメラ | 計測だけ | 高さの基準（どちらも海面から・垂直強調を含む。dev.mjs で確認済み） |
```

- [ ] **Step 2: tech-spec §14 の最終の値を書く**

§14.1 の「06 の M4 の後」の表（Task 25）を正とし、表の上の「目標」の表は変えない。§14.1 の末尾に、51 fps の原因（Task 13。05 の 51.0 は c25be04〈矢印 10,000 本〉の値で、M2 の準備で §14.1 に訂正済み）と `probe=water` の結果（Task 28）を 1 文ずつ足す。§14.2 に、M6 の時点の `pnpm build && pnpm size` の表を足す（Task 19 を行わず変わらなければ「06 の着手時と同じ」）。

spec 06 §4.1 の本文の「3D の有無で 2 通り測る（step の所要時間・長いタスク・fps）」を、計画で決めたこと 4 に合わせて直す（M1 のレビューの持ち越し）。直した後の文:

```markdown
- 平衡までの時間は 2D だけで測る。3D ありでは平衡を待たず、60 秒の窓で 1 step の所要時間と長いタスクを測る（3D の描画は平衡の step 数を変えない。エンジンは決定的）。fps は 3D で測る
```

- [ ] **Step 3: 別の spec の雛形を起こす（M4 の後の判定で要るとしたものだけ）**

Task 25 の「別の spec を起こす」に挙げたものごとに、`docs/superpowers/specs/<実行日>-07-<名前>-design.md`（2 つ以上なら 07・08 と番号を進める。名前は `fill-spill-merge`・`far-field-lod`・`rust-wasm`・`indexeddb-cache` のどれか）を次の形で作る。本文は書かず、06 の数字と論点だけを置く（spec を書くのは 06 の後。R06-4）:

```markdown
# Spec 07: <名前>

- Status: 雛形（06 の判定で起こすことにした。本文は未着手）
- 日付: <実行日>
- 起こした理由: spec 06 §5 の <指標> が、M4 の安価な改善の後も <基準> を超えた（<測った値>、`docs/perf/<実行日>-fixes.md`）
- 対応: <tech-spec の節、03 §4.1 など>

## 1. 目的
（未着手）

## 2. 06 から引き継ぐ数字
- <Task 25 の表の該当する行を写す>

## 3. 論点（06 の時点で分かっているもの）
- <fill-spill-merge なら: 03 §4.1 の (b) 静的な fill-spill-merge 法を本命、(a) virtual pipe モデルを次点。遠景の LOD なら: Task 13 の結論と Task 28 の表。Rust WASM なら: tech-spec §6.3・§6.4。IndexedDB なら: tech-spec §8.4>
```

起こすものが無ければ、このステップでは何も作らず、Step 4 の照合に「別の spec: なし」と書く。

- [ ] **Step 4: spec 06 §6 を照合する**

spec 06 の §6 の後に「### 6.1 照合（<実行日>）」を足し、6 つの条件ごとに「満たす／満たさない」と根拠（`docs/perf/` のファイルと節、コミット）を書く:
1. すべてのシナリオの計測結果（手動を含む）: Task 8・9
2. §5 の各指標の決着: Task 25 の「M4 の後の判定」
3. tech-spec §14 の実測: Task 10・25・29
4. 51 fps の原因: Task 13
5. MapLibre 6.6.0 の一覧: Task 29 の Step 1
6. 境界 15 と 16 の表と R05-4: Task 28

1 つでも満たさなければ、足りないものを書いてコントローラーに知らせ、この Task を止める。すべて満たしたら、spec 06 の冒頭の Status を「完了（<実行日>）。§6.1 のとおり」に改める。overview §6 の R06-4〜R06-8 の行の「裁定」の欄の末尾に、それぞれの結果を 1 文ずつ足す（例: R06-6 は「平衡は <判定>（`docs/perf/<実行日>-fixes.md`）」）。

- [ ] **Step 5: コミットする**

ゲートは `pnpm format && pnpm lint`。

```bash
git add specs/tech-spec.md docs/superpowers/specs/
git commit -m "06 の締め: spec 06 §6 の照合、tech-spec §14 の最終の値と MapLibre 6.6.0 の内部への依存の一覧（§14.4）、判定で起こす別の spec の雛形（M6）"
```

---

### Task 30: ブランチ全体の最終の確認と PR の本文の下書き（M6 の完了）

**Files:**
- Create（gitignore）: `.handoff/06-performance-pr.md`、`.superpowers/sdd/2026-09-17-06-performance/m6-report.md`

**Interfaces:**
- Consumes: ブランチのすべて
- Produces: ユーザーが push と PR に使う本文（R06-9: PR は 1 つ）

- [ ] **Step 1: 全部のゲートを通す**

Run: `pnpm install --frozen-lockfile && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm build && pnpm exec playwright test --project=chromium && pnpm size`
Expected: すべて成功（E2E 43 件。D の SPA のテストと 06 の追加を含む）。`git status --short` が空（format が何も変えない）。`pnpm install` が lockfile を変えない（依存を足していない）

- [ ] **Step 2: 通常のビルドに計測のコードが無いことを確かめる**

Run: `(grep -c perfHook build-info/manifest.json || true) && (grep -l raintrace-perf dist/assets/*.js || true) && (grep -l stepTimes dist/assets/*.js || true) && (grep -l u_debug dist/assets/index-*.js || true)`
Expected: `0`、何も出ない、何も出ない、何も出ない（`u_debug` は 3D の水面のチャンク〈`waterLayer-*.js`〉にだけある。シェーダの文字列なので通常のビルドにも入るが、初期ロードには入らない）

- [ ] **Step 3: main との差を確かめる**

Run: `git diff --stat main...HEAD -- package.json pnpm-lock.yaml src/shared/protocol.ts src/simulation/types.ts`
Expected: `package.json`・`pnpm-lock.yaml`・`src/shared/protocol.ts` に差が無い（R06-4 の「安価」）。`src/simulation/types.ts` はコメントだけの差（Task 14 を行った場合）

- [ ] **Step 4: PR の本文の下書きを書く**

`.handoff/06-performance-pr.md` に、プロジェクトの PR の書き方（`writing-pr-descriptions` の skill を使う）で次を書く:
- 概要: spec 06（性能）。計測の道具、3 地点の計測、51 fps の切り分け、安価な改善、probe=water
- マイルストーンごとのコミットの一覧（M0〜M6）と、各マイルストーンのレビューの承認
- §5 の判定の表（Task 25 の「M4 の後の判定」）と、起こした別の spec
- 計測のコードが通常のビルドに入らないことの確かめ（Step 2）
- spec との差異（計画で決めたこと 1〜18 のうち、spec の文面と違う形にしたもの。例: `probe=water` の持ち上げ比、平衡を 2D だけで測ったこと）
- 手動の計測（Task 9）の結果の要約と、05 の手動確認の項目 9 を 06 で行ったこと（R06-8）
- 後回しの項目（spec 06 §2.3）はこの PR に含まないこと（R06-10）
- **既存挙動の変更**: 必ず次の 3 つを含める（レビュー役の M4 の must-fix）: Task 13b（矢印の間隔の 5 m の選択肢を外した。保存済み・URL の 5 は 10 に丸める）、Task 17a (ii)（3D の水面はプログラム〈シェーダ〉ができた後、区画ごとに数フレームで現れる。読み込み直後は水深 0 なので見えず、再生中に 3D へ切り替えたときだけ目に見える）、Task 19（雨量・半径の入力欄の実装を `TextField` から `FormControl`＋`OutlinedInput` に変更。見た目・ラベル・関連づけは変えていない）
- 末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

- [ ] **Step 5: M6 の報告を書き、マイルストーンの区切りに進む**

`.superpowers/sdd/2026-09-17-06-performance/m6-report.md` に Step 1〜3 の結果と、PR の本文の場所を書く。コミットは無い（gitignore のファイルだけ）。「マイルストーンの区切り」の 2・3 に従う。ブランチ全体のレビューの承認の後、push と PR はユーザーが行う（`.handoff/` の手順）。

---

## spec 06 の完了条件との対応（§6）

| §6 | Task |
|---|---|
| 1. すべてのシナリオの記録（手動を含む） | 8・9 |
| 2. §5 の各指標の決着 | 10・25 |
| 3. tech-spec §14 の実測 | 10・25・29 |
| 4. 51 fps の原因 | 11〜13 |
| 5. MapLibre 6.6.0 の一覧を tech-spec に | 29 |
| 6. 境界 15・16 の表と R05-4 | 26〜28 |

## 計画の見直し（自己レビュー）

- **spec の網羅**: spec 06 §1.2 の M1〜M6、§3 の表の新規の 10 項目（step の所要時間・長いタスク・質量誤差の表示・平衡・クリックから 2D・3D の最初のフレーム・`arrows=0`・`depthEvery=N`・`probe=water`、既存の 3 項目の再利用）、§4.1 のシナリオ（3 地点 × 500・1000 m × 3 つの雨 × 3D の有無、fps の 4 視点 × 3 地点、DEM の固定）、§4.2（自動・手動・基準の機械・記録）、§5 の 10 行、§5.1 の 6 行（vsync と GPU のタイマーは確かめる Step と条件つきの Task）、§5.2 の 6 候補と Worker のチャンクの複製、§6 の 6 条件に、上の「spec 06 との対応」の表の Task がある
- **spec と違えたところ**（PR の「spec との差異」に書く）:
  - §4.1「3D の有無で 2 通り測る」: 平衡は 2D だけで測り、3D ありは 60 秒の窓で 1 step の所要時間と長いタスクだけを測る（計画で決めたこと 4）
  - §3「可視率 = 深度テストなし と ありの画素」: 判定には持ち上げ比を使い、spec の可視率は参考に残す（計画で決めたこと 15）
  - §4.2「実行するファイルは tests/perf/ に 1 つ足す」: `steps.perf.ts` のほかに、共有の `support.ts`・`demFixtures.ts` と、M5 の `water.perf.ts` を足す（計画で決めたこと 11）
  - §5.2「止まっている間は水深の canvas を pause、動いているときは play」: 計画どおり `animate: false` ＋ 描いたときだけ `play()`/`pause()` を 1 回呼ぶ形にした（controller 裁定 C9、Task 18）。理由: `CanvasSource.onAdd` は `animate` が真のときだけ `play()` を呼ぶ（`maplibre-gl-dev.mjs` 約 4625 行）ので、spec の字面どおり `animate: true` のまま止まっている間だけ `pause()` を呼ぶ形にすると、3D で水深の canvas が隠れている間も `Style.hasTransitions()` はすべてのソースを見て回る（同 14385 行）ため `idle` にならず、隠れた 2D canvas の再描画（と、それに相乗りする地図全体の再描画）が止まらない。`animate: false` ＋ 描画時だけ play/pause なら 2D・3D どちらも「描いたときだけ転送・再描画を 1 回頼む」に統一できる。詳細は `docs/perf/2026-09-17-fixes.md` の「## Task 18」
- **計画し直す Task**: 12（GPU のタイマー）・17（読み込みの分割）・21（取得の取り消し）・23（転送の軽量化）・24（ブロック単位の走査）。どれも条件を満たしたときだけで、条件と計画し直すときの枠を書いた
- **型と名前の一貫**: `PerfParams` の項目（Task 4・27）、`StepTimeSnapshot`（Task 2・4）、`StepsReport`・`LoadReport`・`WaterProbeReport`（Task 5・27、`tests/perf/` は型だけ）、`depthUploadEvery`（Task 3・4・22）、`onWaterDebug`・`WaterDebug`（Task 26・27）、`ReportAttribute`（Task 6・27）を突き合わせた
- **まだ確かめていない前提**（実行の中で確かめ、外れたら分岐に従う）: `__RAINTRACE_PERF__` が Worker に届くこと（Task 2 の Step 14）、`longtask` の `buffered`（Task 7 の Step 2 の「未対応」でないこと）、`getCameraAltitude` の基準（Task 27 の Step 7）、MUI 9 の `OutlinedInput` の `inputProps`（Task 19 の Step 2）、vsync を外す引数（Task 11 の Step 2）、GPU のタイマー（Task 11 の Step 3）
