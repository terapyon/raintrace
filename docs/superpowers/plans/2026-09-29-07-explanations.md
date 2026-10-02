# Spec 07 地図の印の説明と、流出の説明・可視化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 地図の ○（最低点・あふれ出し点）をクリックすると説明と数値が出るようにし、水が減る理由（範囲の外への流出・1 cm 未満の非表示）を画面で説明し、流出している縁を 2D・3D の地図に帯で見せる（spec 07、R07-1〜R07-5）。

**Architecture:** ○ のクリックは `TerrainSession` の `onClick` で `queryRenderedFeatures`（±4 px の矩形）を先に引き、当たれば純粋関数 `reduceClick` の新しい `marker-click` で `kind: 'marker'` のポップオーバーにする。流出の帯は、Worker の地形の読み込みの経路で 1 回だけ `buildOutflowCells`（`src/simulation/outflowCells.ts`。FlowSolver の近傍の表を使うマスクと、多始点の幅優先探索の `nearest`）を作り、地形の解析と同じく `TerrainPayload.outflow` に入れて Transferable で送る。メインは配列を受け取るだけで、2D は `WaterOverlay` の新しい canvas ソース `water-outflow` に、3D は水面の Custom Layer のシェーダ（`u_outflowNearest` の R32F テクスチャ・smooth の varying）に描く。エンジンの計算は変えない。`TerrainPayload` に `outflow` を足す（下の「spec からの逸脱」）。

**Tech Stack:** spec 01〜06 の構成（Vite 8.2.2、React 19、MUI 9、zustand 5、MapLibre GL 6.6.0、three 0.185.1、TypeScript 6、Vitest 4、Playwright 1.62、Biome）。**依存は足さない**（`@mui/icons-material` も足さない。情報アイコンは `@mui/material/utils` の `createSvgIcon` で自作する）

**Spec:** `docs/superpowers/specs/2026-09-27-07-explanations-design.md`（4d3ec34。レビュー役 raintrace-7e の承認済み。R07-1〜R07-5、must-fix M1・M2、推奨 R2〜R5、軽微 m1〜m7 を反映済み。これが正）。スパイクの記録 `.handoff/07-spike-3d-outflow.md` と差分 `.handoff/07-spike-3d-outflow/spike.patch` は**参考**（スパイクは R8 のマスクとセルごとの判定だった。本計画は spec どおり `outflowNearest` の帯と R32F の平らな添字にする。`u_outflowGround`・`u_outflowLift`・`OUTFLOW_QUALIFIER` はスパイク専用で、入れない）。前の計画の書式と慣習は `docs/superpowers/plans/2026-09-17-06-performance.md`（以下「06 の計画」）と `2026-09-13-05-3d-rendering.md`

**前提:** ブランチ `feat/07-explanations`（4d3ec34。spec の確定のコミット）。本計画の Task 1 はその次のコミットから。計画そのものはコーディネーターがコミットする。**ブランチは 1 本、PR は最後に 1 つ**。push と PR はユーザーが行う（PR の本文は gitignore の `.handoff/07-explanations-pr.md` に下書きする）。最後の Task の後にレビュー役のチェックポイントを置く

**spec からの逸脱（コーディネーターの指示、2026-09-29。spec は後で直す）:** spec 07 §5.1 は「地形を読み込んだとき、メインスレッドで `outflowBoundaryMask` を 1 回だけ作る」「Worker とのメッセージも変えない」と書いているが、本計画は**Worker の地形の読み込みの経路（`src/workers/simulation.worker.ts` の `analyzeTerrain` の後）で `buildOutflowCells` を呼び、結果を `TerrainPayload.outflow`（`src/shared/protocol.ts`）に足して、地形の解析の配列と同じく Transferable で 1 回だけ送る**。理由: ui → simulation の値の import（tech-spec §4.2 の図に無い依存。dependency-cruiser の例外の規則と、FlowSolver の定数が初期ロードに入ること）を避けるため。Worker は simulation を import してよく（`workers-isolated`）、地形の解析と同じく読み込みのときに 1 回で済む。メインの `SimulationSession`・`WaterOverlay`・`View3d`・水面の層は型と配列を受け取るだけにする。`TerrainPayload` の形は変わる（項目が 1 つ増える）が、コマンドのメッセージ（`SimulationCommand`）と frame の形は変えない

## Global Constraints

- Node 24、pnpm 12.1.0。**依存を足さない**。`pnpm-workspace.yaml` の `minimumReleaseAge: 14400`・`minimumReleaseAgeStrict: true`（10 日のクールダウン）は変えない。`pnpm install` が lockfile を書き換えたら止めて知らせる
- エンジンの計算（`src/simulation/FlowSolver.ts` のループ・`TsSimulationEngine`）は変えない。メッセージ（`src/shared/protocol.ts`）は `TerrainPayload` に `outflow` を足すだけで、ほかの形は変えない（上の「spec からの逸脱」）
- 書式と lint は Biome（2 スペース、シングルクォート、セミコロンなし、行幅 100）。**画面に出す文字列は `src/ui/strings.ts` にだけ置く**（tech-spec §9.4）。コメントとテスト名は日本語。利用者に見える文はすべて日本語
- 層の規則（tech-spec §4.2、`.dependency-cruiser.mjs`）:
  - `src/simulation/`・`src/dem/`・`src/shared/` は相対 import に `.ts` を付ける。simulation・dem は純粋（自ディレクトリの外に依存しない。`console`・`performance` も使わない）
  - `src/renderer/`・`src/state/`・`src/shared/` は simulation・dem から型だけを import する
  - `src/map/`（テストを除く）は simulation・shared から**型だけ**を import する。したがって `NEIGHBOR_DX`・`NEIGHBOR_DY` の値を map から import してはならない（計画で決めたこと 1）
  - renderer は map・ui・state を import しない。three を import してよいのは `src/renderer/` だけ。`src/renderer/` はほかの層から動的 import か型だけで読む
  - Worker（`src/workers/`）は simulation・dem・shared と `src/workers/` 以外を import しない（`outflowCells.ts` を呼ぶのは Worker）。**dependency-cruiser の規則は足さない・変えない**
  - 循環 import を作らない。エントリから届かないモジュールを作らない
- 大きな配列を React の state・props・context、zustand のストアに載せない（tech-spec §2 原則 2）。流出の表（`OutflowCells`）は地形（`TerrainPayload`。`SimulationClient` が持つ）の一部として `SimulationSession`・`WaterOverlay`・`View3d` が参照する
- **各 Task の終わりのゲート**: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`。
  - 実行時のコード（`src/` の本番の経路、または E2E の support）を変えた Task では E2E も回す: `pnpm build && pnpm exec playwright test --project=chromium`（ポート 4173、**フォアグラウンド**。計画の作成時点で 43 件〈`pnpm exec playwright test --list --project=chromium` で確認〉。Task 9 の後は 49 件）
  - 実行時のコードを変えた Task ではバンドルも見る: `pnpm build && pnpm size`。**初期ロードの上限 500 KB**。計画の作成時点の値は 419.9 KB（2026-09-18 の `dist` で `pnpm size` を読んだ値。Task 1 の Step 1 で取り直す）。本計画の追加は数 KB の見込みで、1 Task で +3 KB を超えたら原因を報告に書く
  - ユニットテストは計画の作成時点で 759 件・82 ファイル（`pnpm test` で確認）。各 Task の Expected に増分を書く
- カバレッジの閾値（`vitest.config.ts`）: `src/simulation/**` 90%、`src/dem/**` 85%、`src/state/**` 80%
- **計測の実行**（Task 1・10）: `pnpm build:perf` の後に `pnpm perf:fps …`（`playwright.perf.config.ts`、**ポート 4175**、実 GPU の headless Chrome、workers 1）。**E2E（4173）と同時に回さない**。計測どうしも同時に回さない。10 分を超える計測はバックグラウンドで回して終わりを待つ（Bash の上限は 10 分）。計測の後は `pnpm build` で `dist` を通常のビルドに戻す。要約は `docs/perf/<実行日>-outflow.md` にコミットし、生の JSON は gitignore の `.handoff/07-perf/` に置く。機器の仕様（`nproc`・`nvidia-smi --query-gpu=name,driver_version --format=csv,noheader`）を添える。基準の機械は 06 と同じ開発機（32 コア・GeForce GTX 1080 Ti）
- 1 Task 1 コミット。コミットメッセージは日本語で、末尾に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` を付ける（下の各 Task のコミット例では省略しているが、必ず付ける）。push はしない
- 【手動・ユーザー】の手順は、実装役がユーザーに直接送らない。コントローラーに渡し、コントローラーがユーザーに送る

## Review Focus

spec が明示していないが、使う人に最も効きそうな入力・状態（多い順）。各行のテストを担当の Task に足してある。

1. **既存の E2E のクリックが ○ に当たる**: 今のセル情報のテスト（地図の 1/3・1/2、3D の 0.5・0.55、降雨マーカーのすぐ南）が、たまたま ○ の上だと印の説明が開く。期待: 既存の 43 件はそのまま通る。当たったら**クリックの位置を ○ から離す**（挙動は変えない）。Task 3〜9 の E2E のゲートで全件を回して確かめる
2. **沿岸（無効セルが多い範囲）・全部無効の範囲**: 無効セルの縁に沿って帯ができ、全部無効なら帯は空で何も塗らず、転送もしない。Task 2 に「半分が無効（海）の範囲」「全部無効」のテスト、Task 7 に「帯が空なら塗らず false」のテストを足した
3. **窪地の一覧に無い `depressionId`・最低点の無い地形**: `markerInfoRows` は数値を引けない印を飛ばし、行が 0 ならポップオーバーを開かない（空の枠だけの表示にしない）。Task 4 にテストを足した
4. **表示を切っている間の Reset（`setWater(null)`）の後に入れ直す**: 古い帯が残らない（推奨 R4）。Task 9 の 2D の E2E に「切る → Reset → 入れる → 帯が出ない」を足した
5. **3D に切り替える前に表示の切り替えを変えた・水面の作り直し（地形の変更・ベースマップの切り替え・喪失）**: 作り直した水面が今の設定（`showOutflow`）と今の地形の `nearest` を引き継ぐ。Task 8 に「3D を作る前に変えた設定が初期値に入る」テストを足した（水面の作り直しの経路は `View3d.addWater` の 1 か所で、`this.showOutflow`・`terrain.outflow` を読む）

## 計画で決めたこと（spec と指示に無い細部）

レビュー役とコーディネーターが確かめられるよう、ここにまとめる。

1. **`outflowBoundaryMask`・`outflowNearest` の置き場所と作る場所**（コーディネーターの指示で改訂。冒頭の「spec からの逸脱」）: 関数は `src/simulation/outflowCells.ts`（純粋。`./FlowSolver.ts` の `NEIGHBOR_DX`・`NEIGHBOR_DY` を値で import する。simulation の中どうしなので `core-is-pure` を満たす）。
   - 呼ぶのは Worker（`src/workers/simulation.worker.ts`。`analyzeTerrain` の直後に `buildOutflowCells(grid.validMask, range.size)`）。`packTerrain`（`src/workers/terrainResult.ts`）が `payload.outflow` に入れ、`mask`・`nearest`・`band` の buffer を transfer に足す（1000 m で約 1 MB + 4.25 MB + 帯の分。複製せずに移す）
   - `TerrainPayload`（`src/shared/protocol.ts`）に `outflow: OutflowCells` を足す（shared から simulation へは型だけ。`types-only-from-core` を満たす）
   - メインの ui（`SimulationSession`）・map（`WaterOverlay`・`View3d`）・renderer は、`terrain.outflow` を**型だけ**の import で受け取る。ui → simulation の値の import は作らず、dependency-cruiser の規則・tech-spec §4.2 の図は変えない。`outflowCells.ts` は Worker のエントリから届くので、`not-reachable-from-entry` の一時的な除外も要らない（Task 2 の `pnpm depcheck` で確かめる）
   - `src/shared/` に置く案は採らない（shared は simulation から型しか import できない）。map で表を写す案は、spec §5.1 の「FlowSolver の表を import する」（推奨 R3）に反する
2. **帯の幅（R07-5）**: `bandCells = max(1, ceil(N × OUTFLOW_BAND_RATIO))`（N は一辺のセル数）。spec の「ceil(0.01 × 一辺 m ÷ セルの大きさ m)」の一辺 m は `N × cellSizeM` なので、セルの大きさで割ると N になる（浮動小数点の 0.01 × 500 が 5 をわずかに超えて 6 にならないよう、1e-9 を引いてから切り上げる）。500 m（N = 516）で 6 セル、1000 m（N ≈ 1031）で 11 セル、250 m（N ≈ 258）で 3 セル。
   - **帯は深さ 0（マスクのセル）から `bandCells − 1` まで**（帯の太さがマスクのセルを含めて `bandCells` セル = 範囲の一辺の約 1% になる）。spec の「帯の幅以内」の読み方の 1 つで、深さ `bandCells` まで含めると 1 セル太くなる
   - 幅優先探索は**有効セルだけを通る**（無効セルは −1 のまま。その先へも広げない）
3. **○ の数値の引き先**: spec §3.3 は「`appStore` の `terrain.depressions` から引く」だが、`appStore` は要約（`TerrainSummary`）しか持たず、窪地の一覧も標高の配列も無い（tech-spec §2 原則 2）。そこで `TerrainSession.markerInfo(markers)` が `SimulationClient.terrain`（`cellInfo` と同じ出どころ）から `markerInfoRows` で引く。窪地は `depressions[id − 1]`（`TerrainOverlay` の `depressionRgba` と同じ引き方）で、`id` が一致しなければ飛ばす
4. **色の置き場所**: `src/map/overlayColors.ts`（新規、純粋）に `MARKER_COLORS`（`lowest: '#1565c0'`・`spill: '#ef6c00'`）・`OUTFLOW_COLOR`（`'#c2185b'`）・`OUTFLOW_OPACITY`（0.9）・`OUTFLOW_VISIBLE_M`（0.001）・`hexToRgb` を置く。`TerrainOverlay`（circle の色）・`outflowPaint.ts`（2D）・`View3d`（3D に渡す値）・`MarkerLegend`・`OutflowLegend`（ui）・E2E がここから読む。renderer は map を import しないので、色は `View3d` が `WaterLayerOptions.outflow` で渡す
5. **3D の uniform は 4 つ**: spec §7.1 の 3 つ（`u_outflowNearest`・`u_outflowMinDepth`・`u_showOutflow`）に、色の `u_outflowColor`（premultiplied の `vec4`）を足す。色をシェーダの文字列に焼くと、renderer が map の定数を読めず色を二重に持つことになるため。`u_showOutflow` は 0/1 の float（`u_debug` と同じく、切り替えでプログラムをリンクし直さない）
6. **3D のテクスチャ**: spec（4d3ec34）どおり、既存の `floatTexture`（R32F・NearestFilter）に `Float32Array.from(nearest)` を入れる。長さが N² でなければ全部 −1（帯なし）にする（`outflowNearestData`。GL なしでテストする）。シェーダは `u_showOutflow` が 0 の間と計測の間（`u_debug.x > 0.5`）は `u_outflowNearest` を読まない
7. **2D の転送は、塗るセルが変わった描画だけ**: spec §6 は「超えたら絞る」だが、`paintOutflow` が「前回と同じセルの一覧なら rgba に触れず false」を返す形にすると、比較は帯のセル数以下の整数の比較だけで、N² の `putImageData` と転送（1000 m で 4.25 MB）を省ける。**最初からこの形にする**（spec の「超えたら」の手当てを先に入れる。Task 10 の計測はこの形で測る）。`setWater(null)` のときは全部消して転送する（推奨 R4）
8. **`WaterOverlay.restore()`**: 足し直した後に `requestDraw()` を呼び、今の水深で描き直す（流出の canvas は「前回塗ったセルの一覧」と常に一致しているので、足し直したソースに古い帯は出ない。spec §5.2 の「restore でも消す」をこの形で満たす）
9. **ポップオーバーの出し分け**: `CellInfoPopover` は `kind` が `cell`・`outside` のときだけ開く（今は `closed` 以外なら開くので、`marker` でも開いてしまう）。`MarkerInfoPopover` は `kind === 'marker'` かつ行が 1 つ以上のときだけ開く
10. **印の重なり**: `reduceClick` の `marker-click` が並べ替えと重複の除去をする（最低点を先、あふれ出し点は `depressionId` の昇順。`queryRenderedFeatures` はタイルの境目で同じ地物を 2 回返しうる）。印が 0 個なら閉じる
11. **流出の凡例**: `MarkerLegend`（○ の 2 色）の隣に別のコンポーネント `OutflowLegend`（■ 1 色）を置く。`DisplaySettings` の並びは「窪地の凡例 → ○ の凡例 → 流出のスイッチ → 流出の凡例」
12. **情報アイコン**: spec §4.1 の `InfoOutlined` は `@mui/icons-material`（依存に無い）なので、`createSvgIcon` で丸と「i」を自作する（見た目は同じ種類。Material Icons の path を写さないので、ライセンスの表記も要らない）。Tooltip は `describeChild`（ボタンの名前は「領域外流出量の説明」、説明文はツールチップ）
13. **地形の購読の形は変えない**: 流出の表は `TerrainPayload` の中にあるので、`SimulationSession.onTerrain` の購読者も `View3dLike.setTerrain(terrain)` も今の形のまま。`View3d` は `terrain.outflow.nearest` を読む
14. **E2E で ○ を探す方法**: 通常のビルドには計測用のフックが無く、`map.project` を呼べない。そこで**スクリーンショットの色の塊**で ○ を探す（`colorBlobs`。色の許容は各成分 12。MUI の青 #1976d2 と区別できる）。範囲の端の ○ が右のパネルに隠れないよう、○ のテストは狭い画面（800 × 900、md 未満）でパネルをたたんで行う。色を汚す重ね描き（標高・窪地・地形の流向・水の流れの矢印）は切る
15. **E2E の流出の画素**: スパイクと同じ判定（`r ≥ 140 ∧ g ≤ 90 ∧ 40 ≤ b ≤ 150 ∧ r − b ≥ 60`）。範囲の枠と降雨マーカーの赤（#d32f2f）もこれに当たるので、**同じ視点で降雨の前に数えた値との差**で判定する。3D は M2 のとおり、カメラを固定して t1（帯が出た時点）と t2（その後）を数え、**増える**ことを確かめる（「変わる」だけにすると SwiftShader の揺れで偽の合格になりうる）
16. **fps の計測**: 06 の `fps.perf.ts` に組 `outflow-500`・`outflow-1000` を足す。各組は 2D（`mode=2d`・`pitch=0`）と 3D（z17 ×5 p60）の水面あり、雨は範囲に内接する円（500 mm、半径は範囲の半分）で縁まで水が届く。地点は渋谷とみなとみらい（沿岸）。**「前」は Task 1 で、アプリのコードを変える前に測る**（Task 1 は `tests/perf/` だけを変える）。「後」は Task 10。判定はセルごとの中央値の差が 0.5 fps 以内（spec §6）。今の `fps.perf.ts` は `report.view3d` が `'3d'` でないと落ちるので、2D の条件は `'off'` を期待するよう直す
17. **tech-spec §8.3 の `flowVectorSpacingM`**: 型の注が `5 | 10 | 20` のまま（06 の R06-11 で `10 | 20` になった）。同じ節に `showOutflowCells` を足すので、ついでに `10 | 20` に直す（Task 11）

## ファイル構成

| ファイル | 責務 | Task |
|---|---|---|
| `tests/perf/fps.perf.ts` | 2D の条件（`mode=2d`）を受ける、組 `outflow-500`・`outflow-1000` | 1 |
| `docs/perf/<実行日>-outflow.md` | fps の前後の要約 | 1・10 |
| `src/simulation/outflowCells.ts`（+ test） | `outflowBoundaryMask`・`outflowBandCells`・`outflowNearest`・`buildOutflowCells` | 2 |
| `src/shared/protocol.ts`、`src/workers/terrainResult.ts`（+ test）、`src/workers/simulation.worker.ts` | Worker で流出の表を作り、`TerrainPayload.outflow` で送る | 2 |
| `src/map/overlayColors.ts`（+ test） | 印・流出の色と閾値の定数、`hexToRgb` | 3 |
| `src/map/terrainFeatures.ts`（+ test）、`src/map/TerrainOverlay.ts` | あふれ出し点の `depressionId`、circle の色を定数から | 3 |
| `src/state/clickState.ts`（+ test） | `MarkerRef`、`kind: 'marker'`、`marker-click`、`confirm` の no-op | 3 |
| `src/ui/components/CellInfoPopover.tsx`（+ test） | `cell`・`outside` のときだけ開く | 3 |
| `src/ui/markerInfo.ts`（+ test） | 当たりの矩形、地物 → 印、印 → 数値の行 | 4 |
| `src/ui/components/MarkerInfoPopover.tsx`（+ test）、`src/ui/components/MarkerInfoHost.tsx`、`src/ui/App.tsx` | 印の説明のポップオーバー | 4 |
| `src/ui/terrainSession.ts` | ○ のクリック・カーソル・`markerInfo` | 4 |
| `src/ui/components/MarkerLegend.tsx`、`src/ui/components/DisplaySettings.tsx`、`src/ui/components/Legends.test.tsx` | ○ の凡例 | 4 |
| `src/ui/strings.ts` | `markerInfo`・`legend`・`stats`・`panel`・`disclaimer` の追加 | 4・5・6 |
| `src/ui/components/StatisticsPanel.tsx`（+ test）、`src/ui/components/WaterLegend.tsx` | ツールチップ、1 cm の注記 | 5 |
| `src/state/persistedSettings.ts`（+ test）、`src/state/settingsStore.test.ts` | `display.showOutflowCells`（欠けていれば true） | 6 |
| `src/ui/components/OutflowLegend.tsx`、`src/ui/components/DisplaySettings.tsx`（+ test 新規） | 流出のスイッチと凡例 | 6 |
| `src/map/outflowPaint.ts`（+ test） | 2D の帯の塗り分け（`paintOutflow`・`clearOutflow`）、3D に渡す値（`outflowLayerSpec`、Task 8） | 7・8 |
| `src/map/layerIds.ts`（+ test）、`src/map/WaterOverlay.ts` | `water-outflow` の canvas ソースとレイヤー | 7 |
| `src/ui/simulationSession.ts`（+ test） | `terrain.outflow` を 2D に渡す、表示の切り替え | 7 |
| `tests/e2e/simulation.spec.ts`、`tests/e2e/view3d.spec.ts` | 重なり順に `water-outflow` を足す | 7・9 |
| `src/renderer/waterShaders.ts`（+ test）、`src/renderer/waterLayer.ts`（+ test） | 3D の帯（`u_outflowNearest` ほか） | 8 |
| `src/map/view3d/View3d.ts`（+ test）、`src/ui/view3dSession.ts`（+ test） | 3D へのつなぎ | 8 |
| `tests/e2e/explanations.spec.ts`（新規）、`tests/e2e/support/app.ts`、`tests/e2e/support/png.ts` | spec 07 §7.2 の E2E | 9 |
| `specs/tech-spec.md` §8.3・§9、spec 07 の Status | 文書 | 11 |

## spec 07 との対応（再同期用）

| spec 07 | Task |
|---|---|
| §3.1 クリックの判定（±4 px・複数を並べる・3D・m1・m3） | 3・4・9 |
| §3.2 状態（`MarkerRef`・`marker-click`・`confirm` の no-op、R2） | 3 |
| §3.3 地物のプロパティ（`depressionId`） | 3 |
| §3.4 表示（`MarkerInfoPopover`・`markerInfo` の文言） | 4 |
| §3.5 カーソル | 4・9 |
| §3.6 凡例（色は 1 か所） | 3・4 |
| §4.1 統計のツールチップ | 5・9 |
| §4.2 水深の凡例の注記 | 5・9 |
| §4.3 注意事項の 1 行（R07-3） | 5 |
| §5.1 判定（マスク・近傍の表・帯・`outflowNearest`、R3・R07-1・R07-5・m6） | 2・7 |
| §5.2 2D の canvas ソース（順・消去・3D で隠す、R4） | 7・9 |
| §5.2 3D の Custom Layer（R32F・smooth・R5・計測中は出さない・M1） | 8・9 |
| §5.3 切り替えと保存（欠けていれば true、m2） | 6・7・8 |
| §6 性能（fps の前後・沿岸・初期ロード） | 1・10、各 Task の `pnpm size` |
| §7.1 ユニット | 2〜8 |
| §7.2 E2E（M2 を含む） | 9 |
| §7.3 手動確認（スマートフォンの幅） | 11 |
| §8 完了条件（tech-spec の節） | 11 |

---

### Task 1: fps の計測に 2D の条件と流出の組を足し、「前」を測る（spec 07 §6、計画で決めたこと 16）

**Files:**
- Modify: `tests/perf/fps.perf.ts`
- Create: `docs/perf/<実行日>-outflow.md`（`<実行日>` は計測を回した日。`date +%F`）

**Interfaces:**
- Consumes: 06 の `fps.perf.ts`（`SETS`・`Variant.extra`・`query`・`withFreshPage`）、`perfHook` の `mode=2d`（既存）
- Produces: 組 `outflow-500`・`outflow-1000`（Task 10 が同じ組で「後」を測る）。`.handoff/07-perf/before/outflow-{500,1000}.{json,md}`

- [ ] **Step 1: 初期ロードの基準を取り直す**

Run: `pnpm build && pnpm size`
Expected: `初期ロード: 419.9 KB`（±0.1 KB）。違えば、その値を以後の基準として報告に書く

- [ ] **Step 2: 2D の条件を受けるように、照合を直す**

`tests/perf/fps.perf.ts` の計測のループの中の次の部分を置き換える。

置き換える前:

```ts
            // 3D のまま（(c) で 2D に落ちていない。フックも data-perf-error にする）
            expect(report.view3d).toBe('3d')
            // 視点は厳密な一致ではなく「幅」で照合する（05 のコントローラーの裁定）。地形があると MapLibre は
            // カメラを地形の上に保つので、pitch は要求より下がる。この照合は「フックが pitch を無視した」ような
            // 取り違えを捕まえるためのもので、角度そのものの検証ではない
            const requestedPitch = Number(view.pitch)
```

置き換えた後:

```ts
            // 2D の条件（extra の mode=2d。spec 07 §6）は 3D に切り替えないので off。3D の条件は 3D のまま
            // （(c) で 2D に落ちていない。フックも data-perf-error にする）
            const mode2d = variant.extra?.mode === '2d'
            expect(report.view3d).toBe(mode2d ? 'off' : '3d')
            // 視点は厳密な一致ではなく「幅」で照合する（05 のコントローラーの裁定）。地形があると MapLibre は
            // カメラを地形の上に保つので、pitch は要求より下がる。この照合は「フックが pitch を無視した」ような
            // 取り違えを捕まえるためのもので、角度そのものの検証ではない。2D の条件は extra の pitch（0）を要求する
            const requestedPitch = Number(variant.extra?.pitch ?? view.pitch)
```

- [ ] **Step 3: 組を足す**

`const TERRAIN_MAIN_ONLY` の定義の直後に足す:

```ts
/**
 * 流出の帯（spec 07 §6）の前後の比較。2D（mode=2d・pitch 0。3D に切り替えない）と 3D の水面あり。
 * 雨は範囲に内接する円（半径は範囲の半分）で、縁まで水が届き、帯の塗り分けが毎フレーム動く。
 * 2D の行の「視点」の列は URL の z だけが効く（pitch は extra の 0、ex は 2D では使わない）
 */
const OUTFLOW_VARIANTS: readonly Variant[] = [
  { label: '2D・水面あり（縁まで降雨）', water: '1', extra: { mode: '2d', pitch: '0' } },
  { label: '3D・水面あり（縁まで降雨）', water: '1' },
]
```

`const SETS: Record<string, SetDef> = {` の中、`'isolate-500': { … },` の後に足す:

```ts
  // 流出の帯（spec 07 §6）。RAINTRACE_FPS_SITES=shibuya,minatomirai（沿岸を 1 つ含める）と組み合わせる
  'outflow-500': {
    sizes: ['500'],
    views: ['z17 ×5 p60'],
    waterRain: { mm: '500', r: '250' },
    variants: OUTFLOW_VARIANTS,
  },
  'outflow-1000': {
    sizes: ['1000'],
    views: ['z17 ×5 p60'],
    waterRain: { mm: '500', r: '500' },
    variants: OUTFLOW_VARIANTS,
  },
```

ファイル先頭のコメントの `RAINTRACE_FPS_SET（terrain-main・terrain-tiles・water・isolate・water-sites）` を `RAINTRACE_FPS_SET（terrain-main・terrain-tiles・water・isolate・isolate-500・water-sites・outflow-500・outflow-1000）` にする。

- [ ] **Step 4: 型と書式を確かめる**

Run: `pnpm format && pnpm lint && pnpm typecheck`
Expected: すべて成功

- [ ] **Step 5: 「前」を測る（バックグラウンド、2 組を順に。E2E と同時に回さない）**

Run（バックグラウンド）:

```bash
pnpm build:perf && \
RAINTRACE_FPS_SET=outflow-500 RAINTRACE_FPS_SITES=shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/07-perf/before pnpm perf:fps tests/perf/fps.perf.ts -g 'fps の測り直し' && \
RAINTRACE_FPS_SET=outflow-1000 RAINTRACE_FPS_SITES=shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/07-perf/before pnpm perf:fps tests/perf/fps.perf.ts -g 'fps の測り直し'
```

Expected: 2 回とも `1 passed`（2 つ目の test は RAINTRACE_LOAD が無いので skip）。`.handoff/07-perf/before/outflow-500.md`・`outflow-1000.md` ができる（各 2 地点 × 2 条件 × 3 回 = 12 ラン）。実行の前後に `nproc` と `nvidia-smi --query-gpu=name,driver_version --format=csv,noheader` を `.handoff/07-perf/before/machine.txt` に書く。2D の行の `view3d` が `off` で落ちたら Step 2 を見直す

- [ ] **Step 6: 要約を書く**

`docs/perf/<実行日>-outflow.md` を作る:

```markdown
# spec 07: 流出の帯の fps の前後（<実行日>）

- 対応: spec 07 §6、計画 `docs/superpowers/plans/2026-09-29-07-explanations.md` Task 1・10
- 道具: `tests/perf/fps.perf.ts` の組 `outflow-500`・`outflow-1000`（2D は `mode=2d`・`pitch=0`、3D は z17 ×5 p60。水面あり、500 mm・半径は範囲の半分を「最速」で降雨）
- 地点: 渋谷・みなとみらい（沿岸）。各セル 3 回、セルごとの中央値で比べる
- 機器: <machine.txt の内容>（headless、実 GPU、ANGLE）
- 生の JSON: `.handoff/07-perf/before/`・`.handoff/07-perf/after/`（gitignore）
- 判定: セルごとの平均 fps の中央値の差が 0.5 fps 以内（spec 07 §6）

## 前（<コミット>。アプリのコードは 4d3ec34 のまま）

<outflow-500.md と outflow-1000.md の先頭の「セルごとの 3 回の中央値」の表をそのまま貼る>
```

- [ ] **Step 7: `dist` を通常のビルドに戻す**

Run: `pnpm build`
Expected: 成功

- [ ] **Step 8: コミット**

```bash
git add tests/perf/fps.perf.ts docs/perf/<実行日>-outflow.md
git commit -m "spec 07 Task 1: fps の計測に 2D の条件と流出の組を足し、変更前を測る"
```

---

### Task 2: 流出の縁のマスクと帯の表を Worker で作り、地形と一緒に送る（`src/simulation/outflowCells.ts`。spec 07 §5.1〈Worker で作る逸脱〉、計画で決めたこと 1・2）

**Files:**
- Create: `src/simulation/outflowCells.ts`
- Create: `src/simulation/outflowCells.test.ts`
- Modify: `src/shared/protocol.ts`
- Modify: `src/workers/terrainResult.ts`、`src/workers/terrainResult.test.ts`
- Modify: `src/workers/simulation.worker.ts`

**Interfaces:**
- Consumes: `NEIGHBOR_DX`・`NEIGHBOR_DY`（`src/simulation/FlowSolver.ts`）
- Produces:
  - `OUTFLOW_BAND_RATIO = 0.01`
  - `interface OutflowCells { mask: Uint8Array; nearest: Int32Array; band: Int32Array }`
  - `outflowBoundaryMask(validMask: Uint8Array, width: number, height: number): Uint8Array`
  - `outflowBandCells(size: number): number`
  - `outflowNearest(mask: Uint8Array, validMask: Uint8Array, width: number, height: number, bandCells: number): Int32Array`
  - `buildOutflowCells(validMask: Uint8Array, size: number): OutflowCells`
  - `TerrainPayload.outflow: OutflowCells`（`src/shared/protocol.ts`。Task 7・8 がメインで読む）
  - `packTerrain(grid, analysis, geo, outflow: OutflowCells)`（`src/workers/terrainResult.ts`）

- [ ] **Step 1: 失敗するテストを書く**

`src/simulation/outflowCells.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NEIGHBOR_DX, NEIGHBOR_DY } from './FlowSolver.ts'
import {
  buildOutflowCells,
  OUTFLOW_BAND_RATIO,
  outflowBandCells,
  outflowBoundaryMask,
  outflowNearest,
} from './outflowCells.ts'

/** 行ごとの文字列から有効セルのマスクを作る（'#' は有効、'.' は無効） */
function grid(rows: string[]): { validMask: Uint8Array; width: number; height: number } {
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const validMask = new Uint8Array(width * height)
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) validMask[y * width + x] = row[x] === '#' ? 1 : 0
  })
  return { validMask, width, height }
}

/** 0/1 の配列を行ごとの文字列にする */
function rowsOf(values: ArrayLike<number>, width: number): string[] {
  const rows: string[] = []
  for (let i = 0; i < values.length; i += width) {
    rows.push(Array.from({ length: width }, (_, x) => String(values[i + x])).join(''))
  }
  return rows
}

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

const allValid = (n: number): Uint8Array => new Uint8Array(n * n).fill(1)
const chebyshev = (a: number, b: number, width: number): number =>
  Math.max(Math.abs((a % width) - (b % width)), Math.abs(Math.floor(a / width) - Math.floor(b / width)))

describe('outflowBoundaryMask（spec 07 §5.1）', () => {
  it('全部有効なら、グリッドの端の 1 周だけが 1 で、内側は 0', () => {
    const { validMask, width, height } = grid(['####', '####', '####', '####'])
    expect(rowsOf(outflowBoundaryMask(validMask, width, height), width)).toEqual([
      '1111',
      '1001',
      '1001',
      '1111',
    ])
  })

  it('内側の無効セルの周り（斜めを含む）が 1 になり、無効セルそのものは 0', () => {
    const { validMask, width, height } = grid([
      '#######',
      '#######',
      '#######',
      '###.###',
      '#######',
      '#######',
      '#######',
    ])
    expect(rowsOf(outflowBoundaryMask(validMask, width, height), width)).toEqual([
      '1111111',
      '1000001',
      '1011101',
      '1010101',
      '1011101',
      '1000001',
      '1111111',
    ])
  })

  it('近傍の表は FlowSolver の NEIGHBOR_DX・NEIGHBOR_DY と同じ（表から作った期待値と一致する。推奨 R3）', () => {
    const next = random(11)
    const width = 13
    const height = 9
    const validMask = Uint8Array.from({ length: width * height }, () => (next() < 0.2 ? 0 : 1))
    const expected = new Uint8Array(width * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (validMask[i] === 0) continue
        for (let k = 0; k < NEIGHBOR_DX.length; k++) {
          const nx = x + (NEIGHBOR_DX[k] ?? 0)
          const ny = y + (NEIGHBOR_DY[k] ?? 0)
          const outside = nx < 0 || nx >= width || ny < 0 || ny >= height
          if (outside || validMask[ny * width + nx] === 0) expected[i] = 1
        }
      }
    }
    expect(Array.from(outflowBoundaryMask(validMask, width, height))).toEqual(Array.from(expected))
  })
})

describe('outflowBandCells（R07-5、計画で決めたこと 2）', () => {
  it('帯の幅は一辺のセル数の 1% を切り上げ、1 未満にしない', () => {
    expect(OUTFLOW_BAND_RATIO).toBe(0.01)
    expect(outflowBandCells(500)).toBe(5)
    expect(outflowBandCells(516)).toBe(6)
    expect(outflowBandCells(1031)).toBe(11)
    expect(outflowBandCells(258)).toBe(3)
    expect(outflowBandCells(50)).toBe(1)
  })
})

describe('outflowNearest（spec 07 §5.1、軽微 m6）', () => {
  it('帯の幅が 1 なら、マスクのセルは自分自身を指し、ほかと無効セルは −1', () => {
    const { validMask, width, height } = grid(['#####', '#####', '##.##', '#####', '#####'])
    const mask = outflowBoundaryMask(validMask, width, height)
    const nearest = outflowNearest(mask, validMask, width, height, 1)
    for (let i = 0; i < nearest.length; i++) {
      expect(nearest[i]).toBe(mask[i] === 1 ? i : -1)
    }
    expect(nearest[2 * width + 2]).toBe(-1)
  })

  it('帯の幅の境目: 深さ bandCells − 1 までが帯で、その先は −1', () => {
    const n = 11
    const validMask = allValid(n)
    const nearest = outflowNearest(outflowBoundaryMask(validMask, n, n), validMask, n, n, 3)
    const row = Array.from({ length: n }, (_, x) => ((nearest[5 * n + x] ?? -1) >= 0 ? 1 : 0))
    expect(row).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1])
  })

  it('全部有効なら、帯の中の各セルの nearest はマスクのセルで、チェビシェフ距離は幅 − 1 以下。帯は端からの距離で決まる', () => {
    const n = 15
    const band = 4
    const validMask = allValid(n)
    const mask = outflowBoundaryMask(validMask, n, n)
    const nearest = outflowNearest(mask, validMask, n, n, band)
    for (let i = 0; i < n * n; i++) {
      const x = i % n
      const y = Math.floor(i / n)
      const fromEdge = Math.min(x, y, n - 1 - x, n - 1 - y)
      const j = nearest[i] ?? -1
      if (fromEdge <= band - 1) {
        expect(mask[j]).toBe(1)
        expect(chebyshev(i, j, n)).toBe(fromEdge)
      } else {
        expect(j).toBe(-1)
      }
    }
  })

  it('始点を添字の昇順で入れた幅優先探索で最初に届いたものを指す（決定的）', () => {
    const n = 11
    const validMask = allValid(n)
    const mask = outflowBoundaryMask(validMask, n, n)
    const a = outflowNearest(mask, validMask, n, n, 3)
    // (x=1, y=5) に隣り合うマスクのセルは (0,4)=44・(0,5)=55・(0,6)=66。添字の小さい 44 が先に届く
    expect(a[5 * n + 1]).toBe(44)
    // (x=1, y=1) に隣り合うマスクのセルは 0・1・2・11・22。0 が先に届く
    expect(a[1 * n + 1]).toBe(0)
    expect(Array.from(outflowNearest(mask, validMask, n, n, 3))).toEqual(Array.from(a))
  })

  it('沿岸（右半分が無効）: 無効セルの縁に沿って帯ができ、無効セルは −1（Review Focus 2）', () => {
    const { validMask, width, height } = grid([
      '#####.....',
      '#####.....',
      '#####.....',
      '#####.....',
      '#####.....',
    ])
    const mask = outflowBoundaryMask(validMask, width, height)
    const nearest = outflowNearest(mask, validMask, width, height, 2)
    // x=4 は無効セルに接するのでマスク、x=3 は深さ 1 で帯、無効セルは −1
    expect(nearest[2 * width + 4]).toBe(2 * width + 4)
    expect(nearest[2 * width + 3]).toBeGreaterThanOrEqual(0)
    expect(nearest[2 * width + 5]).toBe(-1)
  })
})

describe('buildOutflowCells', () => {
  it('band は nearest が 0 以上のセルの添字の昇順の一覧', () => {
    const n = 20
    const cells = buildOutflowCells(allValid(n), n)
    const expected: number[] = []
    for (let i = 0; i < n * n; i++) if ((cells.nearest[i] ?? -1) >= 0) expected.push(i)
    expect(Array.from(cells.band)).toEqual(expected)
    // n = 20 は帯の幅 1（端の 1 周 = 76 セル）
    expect(cells.band.length).toBe(76)
    expect(cells.mask.length).toBe(n * n)
  })

  it('全部無効なら、マスクも帯も空で、nearest はすべて −1（Review Focus 2）', () => {
    const n = 8
    const cells = buildOutflowCells(new Uint8Array(n * n), n)
    expect(cells.band.length).toBe(0)
    expect(Array.from(cells.mask).every((v) => v === 0)).toBe(true)
    expect(Array.from(cells.nearest).every((v) => v === -1)).toBe(true)
  })

  it('1000 m（1031²）でも 1 秒以内に作れる（spec 07 §6 の見込みは数十 ms。粗い上限）', () => {
    const n = 1031
    const start = Date.now()
    const cells = buildOutflowCells(allValid(n), n)
    expect(Date.now() - start).toBeLessThan(1000)
    expect(cells.band.length).toBeGreaterThan(4 * (n - 1))
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `pnpm exec vitest run src/simulation/outflowCells.test.ts`
Expected: FAIL（`./outflowCells.ts` が無い）

- [ ] **Step 3: 実装する**

`src/simulation/outflowCells.ts`:

```ts
/**
 * 流出しているセルの表示のための、地形だけで決まる表（spec 07 §5.1）。地形を読み込んだときに Worker で
 * 1 回だけ作り（workers/simulation.worker.ts）、TerrainPayload.outflow でメインへ送る。エンジンの計算には使わない。
 *
 * 仮想セル（グリッドの外・無効セル）は元のセルと同じ標高で水深 0 として扱われる（spec 03 §3.3、FlowSolver.ts）。
 * そのため「近傍にグリッドの外か無効セルを含む有効セル」は、水深が θ を超えればその step に必ず外へ流す。
 * 近傍の定義は FlowSolver の NEIGHBOR_DX・NEIGHBOR_DY をそのまま使う（08 で流れが 4 近傍になれば、マスクも
 * 一緒に変わる。推奨 R3）。帯の広げ方は見た目の規則なので、FlowSolver の表とは独立に 8 近傍で歩く
 */
import { NEIGHBOR_DX, NEIGHBOR_DY } from './FlowSolver.ts'

/** 帯の幅を範囲の一辺の何割にするか（R07-5） */
export const OUTFLOW_BAND_RATIO = 0.01

/** 帯を広げる歩み（8 近傍。FlowSolver の表とは独立。spec 07 §5.1） */
const BAND_DX = [-1, 0, 1, -1, 1, -1, 0, 1]
const BAND_DY = [-1, -1, -1, 0, 0, 1, 1, 1]

export interface OutflowCells {
  /** 有効セルのうち、近傍にグリッドの外か無効セルを含むものが 1 */
  mask: Uint8Array
  /** 各セルが帯の中なら、幅優先探索で最初に届いたマスクのセルの添字。マスクのセルは自分自身。帯の外・無効セルは −1 */
  nearest: Int32Array
  /** nearest が 0 以上のセルの添字（昇順）。2D の描画はここだけを走査する */
  band: Int32Array
}

/** 有効セルのうち、近傍（FlowSolver の表）にグリッドの外か無効セルを含むものを 1 にする */
export function outflowBoundaryMask(
  validMask: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (validMask[i] === 0) continue
      for (let k = 0; k < NEIGHBOR_DX.length; k++) {
        const nx = x + NEIGHBOR_DX[k]
        const ny = y + NEIGHBOR_DY[k]
        // 無効の判定は FlowSolver と同じく validMask[c] !== 0 の否定
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || validMask[ny * width + nx] === 0) {
          mask[i] = 1
          break
        }
      }
    }
  }
  return mask
}

/**
 * 帯の幅（セル数）。範囲の一辺（N セル × セルの大きさ m）の 1% をセルの大きさで割って切り上げる = ceil(N × 1%)。
 * 0.01 × 500 が浮動小数点で 5 をわずかに超えないよう 1e-9 を引く。1 未満にはしない（計画で決めたこと 2）
 */
export function outflowBandCells(size: number): number {
  return Math.max(1, Math.ceil(size * OUTFLOW_BAND_RATIO - 1e-9))
}

/**
 * マスクのセルからの多始点の幅優先探索（spec 07 §5.1、軽微 m6）。始点は添字の昇順でキューに入れるので、
 * 結果は決定的。歩みは有効セルだけを通り、深さ bandCells − 1 で打ち切る（帯の太さはマスクのセルを含めて
 * bandCells セル）。帯の外・無効セルは −1
 */
export function outflowNearest(
  mask: Uint8Array,
  validMask: Uint8Array,
  width: number,
  height: number,
  bandCells: number,
): Int32Array {
  const n = width * height
  const nearest = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  let tail = 0
  for (let i = 0; i < n; i++) {
    if (mask[i] === 1) {
      nearest[i] = i
      queue[tail++] = i
    }
  }
  let head = 0
  for (let depth = 1; depth < bandCells && head < tail; depth++) {
    const levelEnd = tail
    for (; head < levelEnd; head++) {
      const c = queue[head]
      const cx = c % width
      const cy = (c - cx) / width
      for (let k = 0; k < BAND_DX.length; k++) {
        const nx = cx + BAND_DX[k]
        const ny = cy + BAND_DY[k]
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
        const j = ny * width + nx
        if (validMask[j] === 0 || nearest[j] !== -1) continue
        nearest[j] = nearest[c]
        queue[tail++] = j
      }
    }
  }
  return nearest
}

/** 一辺 size セルの範囲の流出の表を作る（地形の読み込みのときに 1 回） */
export function buildOutflowCells(validMask: Uint8Array, size: number): OutflowCells {
  const mask = outflowBoundaryMask(validMask, size, size)
  const nearest = outflowNearest(mask, validMask, size, size, outflowBandCells(size))
  let count = 0
  for (let i = 0; i < nearest.length; i++) if (nearest[i] >= 0) count++
  const band = new Int32Array(count)
  for (let i = 0, k = 0; i < nearest.length; i++) if (nearest[i] >= 0) band[k++] = i
  return { mask, nearest, band }
}
```

（`src/simulation` は `noUncheckedIndexedAccess` が false なので、添字の読みに `?? 0` は要らない。tech-spec §10.2）

- [ ] **Step 4: 通ることを確かめる**

Run: `pnpm exec vitest run src/simulation/outflowCells.test.ts`
Expected: PASS（12 件）

- [ ] **Step 5: `packTerrain` のテストを直し、足す**

`src/workers/terrainResult.test.ts`:

import に `import type { OutflowCells } from '../simulation/outflowCells'` を足し、`makeAnalysis` の後に足す:

```ts
/** 2 × 2 の範囲の流出の表（中身は packTerrain が触れないので、形だけ合わせる） */
function makeOutflow(): OutflowCells {
  return {
    mask: Uint8Array.from([1, 1, 1, 0]),
    nearest: Int32Array.from([0, 1, 2, -1]),
    band: Int32Array.from([0, 1, 2]),
  }
}
```

ファイルの中の `packTerrain(grid, makeAnalysis(), geo)` と `packTerrain(grid, analysis, geo)` のすべての呼び出しに、4 つ目の引数 `makeOutflow()` を足す（`transfer` を見るテストでは `const outflow = makeOutflow()` を作って渡す）。`transfer は payload の …` のテストの期待値を次にし、テスト名の「analysis の flowDirection・fill・labels の buffer」を「analysis の flowDirection・fill・labels と流出の表の mask・nearest・band の buffer」にする:

```ts
    expect(transfer).toEqual([
      payload.elevation.buffer,
      payload.validMask.buffer,
      analysis.flowDirection.buffer,
      analysis.fill.buffer,
      analysis.labels.buffer,
      outflow.mask.buffer,
      outflow.nearest.buffer,
      outflow.band.buffer,
    ])
```

`describe('packTerrain', …)` の中に足す:

```ts
  it('payload は Worker で作った流出の表をそのまま outflow に持つ（spec 07 §5.1。複製せずに移す）', () => {
    const outflow = makeOutflow()
    const { payload } = packTerrain(makeGrid(), makeAnalysis(), geo, outflow)
    expect(payload.outflow).toBe(outflow)
  })
```

Run: `pnpm exec vitest run src/workers/terrainResult.test.ts`
Expected: FAIL（`packTerrain` の 4 つ目の引数と `outflow` が無い。型の検査は Step 8 のゲートで行う）

- [ ] **Step 6: `TerrainPayload` に足し、`packTerrain` で送る**

`src/shared/protocol.ts` の import に `import type { OutflowCells } from '../simulation/outflowCells.ts'` を足し、`TerrainPayload` を次にする:

```ts
/** 読み込んだ地形。配列は Transferable で送る（tech-spec §5.4） */
export interface TerrainPayload extends TerrainAnalysis {
  elevation: Float32Array
  validMask: Uint8Array
  geo: TerrainGeo
  /**
   * 流出の縁のマスクと帯（spec 07 §5.1）。地形の解析と同じく Worker が読み込みのときに 1 回だけ作って送る
   * （spec の「メインスレッドで作る」からの逸脱。計画 2026-09-29-07 の冒頭）。メインは読むだけ
   */
  outflow: OutflowCells
}
```

`src/workers/terrainResult.ts` の import に `import type { OutflowCells } from '../simulation/outflowCells'` を足し、`packTerrain` を次にする:

```ts
/**
 * メインスレッドへ送る地形を作る。標高・validMask は複製（.slice()）して送る（tech-spec §5.4）。
 * 元の grid は Worker がエンジンに渡す（エンジンが複製を持つので、Worker は grid を保持しない。spec 04）。
 * 流出の表（spec 07 §5.1）は Worker が作ったものをそのまま移す（Worker は持ち続けない）
 */
export function packTerrain(
  grid: AssembledGrid,
  analysis: TerrainAnalysis,
  geo: TerrainGeo,
  outflow: OutflowCells,
): { payload: TerrainPayload; transfer: ArrayBuffer[] } {
  const elevation = grid.elevation.slice()
  const validMask = grid.validMask.slice()
  const payload: TerrainPayload = { ...analysis, elevation, validMask, geo, outflow }
  // flowDirection・fill・labels は TerrainAnalysis の型が ArrayBufferLike（SharedArrayBuffer を含む）を
  // 許すが、analyzeTerrain が new Uint8Array 等で作るので実体は必ず ArrayBuffer。流出の表も同じ
  const transfer: ArrayBuffer[] = [
    elevation.buffer,
    validMask.buffer,
    analysis.flowDirection.buffer as ArrayBuffer,
    analysis.fill.buffer as ArrayBuffer,
    analysis.labels.buffer as ArrayBuffer,
    outflow.mask.buffer as ArrayBuffer,
    outflow.nearest.buffer as ArrayBuffer,
    outflow.band.buffer as ArrayBuffer,
  ]
  return { payload, transfer }
}
```

`src/workers/simulation.worker.ts`:

import に `import { buildOutflowCells } from '../simulation/outflowCells'` を足す（`analyzeTerrain` の import の次）。`const { range, tier } = selection`（`const analysis = analyzeTerrain(grid)` の次の行）の次の行に足す:

```ts
    // 流出の縁のマスクと帯（spec 07 §5.1）。validMask だけから作る。地形の解析と同じく読み込みのときに 1 回で、
    // 転送も 1 回（計画で決めたこと 1）。grid.validMask はこのあとエンジンに渡すが、ここでは読むだけ
    const outflow = buildOutflowCells(grid.validMask, range.size)
```

`const { payload, transfer } = packTerrain(grid, analysis, geo)` を `const { payload, transfer } = packTerrain(grid, analysis, geo, outflow)` にする。

- [ ] **Step 7: 通ることと、依存の規則を確かめる**

Run: `pnpm exec vitest run src/simulation/outflowCells.test.ts src/workers/terrainResult.test.ts`
Expected: PASS

Run: `pnpm depcheck`
Expected: 成功（違反 0）。`outflowCells.ts` は Worker のエントリ（`simulation.worker.ts`）から届くので `not-reachable-from-entry` に当たらない（**一時的な除外は要らない**）。shared → simulation は型だけ、workers → simulation は許されている。dependency-cruiser の設定は変えない

- [ ] **Step 8: ゲート（E2E とバンドルを含む）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 772 件（759 + 12 + 1）。`src/simulation/**` の行カバレッジ 90% 以上。型の検査で `TerrainPayload` を作る箇所（`packTerrain` だけ。テストは `as TerrainPayload` の偽物）に漏れが無いこと

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 43 passed（地形の読み込みの経路を変えた）

Run: `pnpm build && pnpm size`
Expected: 初期ロードは Task 1 の基準と同じ（±0.1 KB。`outflowCells.ts` と FlowSolver の定数は Worker のチャンクにだけ入る。`simulation.worker` のチャンクの増分を報告に書く）

- [ ] **Step 9: コミット**

```bash
git add src/simulation/outflowCells.ts src/simulation/outflowCells.test.ts src/shared/protocol.ts src/workers/terrainResult.ts src/workers/terrainResult.test.ts src/workers/simulation.worker.ts
git commit -m "spec 07 Task 2: 流出の縁のマスクと帯の表（outflowCells）を Worker で作り、地形と一緒に送る"
```

---

### Task 3: 印の状態・色の定数・地物の `depressionId`（spec 07 §3.2・§3.3・§3.6、推奨 R2）

**Files:**
- Create: `src/map/overlayColors.ts`、`src/map/overlayColors.test.ts`
- Modify: `src/map/terrainFeatures.ts`、`src/map/terrainFeatures.test.ts`
- Modify: `src/map/TerrainOverlay.ts`
- Modify: `src/state/clickState.ts`、`src/state/clickState.test.ts`
- Modify: `src/ui/components/CellInfoPopover.tsx`、`src/ui/components/CellInfoPopover.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces:
  - `MARKER_COLORS: { lowest: '#1565c0'; spill: '#ef6c00' }`、`OUTFLOW_COLOR = '#c2185b'`、`OUTFLOW_OPACITY = 0.9`、`OUTFLOW_VISIBLE_M = 0.001`、`hexToRgb(hex: string): [number, number, number]`（`src/map/overlayColors.ts`）
  - `type MarkerProperties = { kind: 'lowest' } | { kind: 'spill'; depressionId: number }`（`src/map/terrainFeatures.ts`）
  - `type MarkerRef = { marker: 'lowest' } | { marker: 'spill'; depressionId: number }`、`Popover` の `{ kind: 'marker'; markers: readonly MarkerRef[] } & Anchor`、`ClickEvent` の `{ type: 'marker-click'; markers: readonly MarkerRef[] } & Anchor`、`sortMarkers(markers): MarkerRef[]`（`src/state/clickState.ts`）

- [ ] **Step 1: 色の定数のテストを書く**

`src/map/overlayColors.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  hexToRgb,
  MARKER_COLORS,
  OUTFLOW_COLOR,
  OUTFLOW_OPACITY,
  OUTFLOW_VISIBLE_M,
} from './overlayColors'

describe('地図の印と流出の色（spec 07 §3.6・§5.2）', () => {
  it('印は最低点が青、あふれ出し点がオレンジ。流出は赤紫（不透明度 0.9）、閾値は 1 mm（R07-1）', () => {
    expect(MARKER_COLORS).toEqual({ lowest: '#1565c0', spill: '#ef6c00' })
    expect(OUTFLOW_COLOR).toBe('#c2185b')
    expect(OUTFLOW_OPACITY).toBe(0.9)
    expect(OUTFLOW_VISIBLE_M).toBe(0.001)
  })

  it('hexToRgb は #rrggbb を 0〜255 の 3 つにする', () => {
    expect(hexToRgb('#c2185b')).toEqual([194, 24, 91])
    expect(hexToRgb(MARKER_COLORS.lowest)).toEqual([21, 101, 192])
    expect(hexToRgb(MARKER_COLORS.spill)).toEqual([239, 108, 0])
  })
})
```

- [ ] **Step 2: `markerFeatures` のテストを直す**

`src/map/terrainFeatures.test.ts` の `describe('markerFeatures', …)` の最初の `it` の末尾（`expect(collection.features[1]?.geometry.coordinates)…` の後）に足す:

```ts
    // あふれ出し点だけ depressionId（Depression.id）を持つ（spec 07 §3.3）
    expect(collection.features.map((f) => f.properties)).toEqual([
      { kind: 'lowest' },
      { kind: 'spill', depressionId: 2 },
    ])
```

- [ ] **Step 3: `reduceClick` のテストを足す**

`src/state/clickState.test.ts` の import を `import { CLOSED, type ClickEvent, type MarkerRef, type Popover, reduceClick, sortMarkers } from './clickState'` にし、ファイルの末尾に足す:

```ts
describe('reduceClick の印（spec 07 §3.2、推奨 R2、R07-4）', () => {
  const lowest: MarkerRef = { marker: 'lowest' }
  const spill = (depressionId: number): MarkerRef => ({ marker: 'spill', depressionId })
  const markerClick = (markers: MarkerRef[], at = Q): ClickEvent => ({
    type: 'marker-click',
    markers,
    ...at,
  })
  const marker: Popover = { kind: 'marker', markers: [lowest], ...P }

  it('marker-click で印の説明を開く。最低点を先、あふれ出し点は depressionId の昇順に並べ、重複を除く', () => {
    expect(reduceClick(CLOSED, markerClick([spill(3), lowest, spill(1), spill(3)]))).toEqual({
      popover: { kind: 'marker', markers: [lowest, spill(1), spill(3)], ...Q },
      select: null,
    })
  })

  it('セル情報を開いているときの marker-click も、印の説明に開き直す', () => {
    expect(reduceClick(cell, markerClick([spill(2)])).popover).toEqual({
      kind: 'marker',
      markers: [spill(2)],
      ...Q,
    })
  })

  it('印が 0 個の marker-click は閉じる', () => {
    expect(reduceClick(marker, markerClick([]))).toEqual({ popover: CLOSED, select: null })
  })

  it('印の説明を開いているときの confirm は何もしない（新しい地点を選ばない）', () => {
    expect(reduceClick(marker, { type: 'confirm' })).toEqual({ popover: marker, select: null })
  })

  it('close で閉じ、地図のクリックでセル情報に開き直す', () => {
    expect(reduceClick(marker, { type: 'close' })).toEqual({ popover: CLOSED, select: null })
    expect(reduceClick(marker, click('inside')).popover).toEqual({ kind: 'cell', ...Q })
  })

  it('sortMarkers は入力の配列を変えない', () => {
    const input = [spill(2), lowest]
    sortMarkers(input)
    expect(input).toEqual([spill(2), lowest])
  })
})
```

- [ ] **Step 4: `CellInfoPopover` のテストを足す**

`src/ui/components/CellInfoPopover.test.tsx` の `describe` の末尾に足す:

```tsx
  it('印の説明（kind: marker）のときは開かない（MarkerInfoPopover が出す。spec 07 §3.4）', () => {
    render(
      <CellInfoPopover
        popover={{ kind: 'marker', markers: [{ marker: 'lowest' }], ...position }}
        cell={null}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('cell-info')).toBeNull()
  })
```

- [ ] **Step 5: 失敗を確かめる**

Run: `pnpm exec vitest run src/map/overlayColors.test.ts src/map/terrainFeatures.test.ts src/state/clickState.test.ts src/ui/components/CellInfoPopover.test.tsx`
Expected: FAIL（`overlayColors` が無い、`sortMarkers`・`marker-click` が無い、depressionId が無い、marker でも開く）

- [ ] **Step 6: 色の定数を作る**

`src/map/overlayColors.ts`:

```ts
/**
 * 地図の印（○）と流出の帯の色（spec 07 §3.6・§5.2）。地図のレイヤー（TerrainOverlay・WaterOverlay）、3D の水面へ
 * 渡す値（View3d）、凡例（ui）、E2E がここから読む（色を二重に持たない）。maplibre-gl を import しない純粋なモジュール
 */

/** ○ の色。最低点は青、あふれ出し点はオレンジ */
export const MARKER_COLORS = { lowest: '#1565c0', spill: '#ef6c00' } as const

/** 流出しているセルの帯の色（赤紫。水の青・窪地の配色・計測のマゼンタ〈probe=water〉と分ける） */
export const OUTFLOW_COLOR = '#c2185b'
export const OUTFLOW_OPACITY = 0.9
/** 流出中として塗る水深の閾値（m。R07-1）。θ（1e-5 m）より大きく、描画の閾値（1 cm）より小さい */
export const OUTFLOW_VISIBLE_M = 0.001

/** '#rrggbb' を [r, g, b]（0〜255）にする */
export function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}
```

- [ ] **Step 7: 地物に `depressionId` を足し、circle の色を定数から読む**

`src/map/terrainFeatures.ts` の `markerFeatures` を置き換える:

```ts
/** ○ の地物のプロパティ。あふれ出し点だけ窪地の id（Depression.id）を持つ（spec 07 §3.3） */
export type MarkerProperties = { kind: 'lowest' } | { kind: 'spill'; depressionId: number }

/** 最低点と、表示対象の窪地（R02-3）の spill point */
export function markerFeatures(
  terrain: Pick<TerrainPayload, 'lowestIndex' | 'depressions' | 'geo'>,
): PointCollection<MarkerProperties> {
  const features: PointFeature<MarkerProperties>[] = []
  if (terrain.lowestIndex !== -1) {
    features.push(point(cellCenter(terrain.geo, terrain.lowestIndex), { kind: 'lowest' }))
  }
  for (const d of terrain.depressions) {
    if (d.significant) {
      features.push(
        point(cellCenter(terrain.geo, d.spillIndex), { kind: 'spill', depressionId: d.id }),
      )
    }
  }
  return { type: 'FeatureCollection', features }
}
```

`src/map/TerrainOverlay.ts` の import に `import { MARKER_COLORS } from './overlayColors'` を足し、circle の paint の `'circle-color': ['match', ['get', 'kind'], 'lowest', '#1565c0', '#ef6c00'],` を次にする:

```ts
          // 色は凡例（ui の MarkerLegend）と同じ定数（spec 07 §3.6）
          'circle-color': [
            'match',
            ['get', 'kind'],
            'lowest',
            MARKER_COLORS.lowest,
            MARKER_COLORS.spill,
          ],
```

- [ ] **Step 8: 印の状態を足す**

`src/state/clickState.ts` の `Popover`・`ClickEvent`・`reduceClick` を次にする（ファイル冒頭のコメントと `ClickTarget`・`ClickTransition`・`CLOSED` はそのまま）:

```ts
/** 置く位置。lon・lat は地図の位置、x・y はビューポートの座標（px。地図のクリックの位置） */
interface Anchor {
  lon: number
  lat: number
  x: number
  y: number
}

/** 地図の ○（spec 07 §3.2）。あふれ出し点は窪地の id で引く */
export type MarkerRef = { marker: 'lowest' } | { marker: 'spill'; depressionId: number }

/** 開いているポップオーバー */
export type Popover =
  | { kind: 'closed' }
  | ({ kind: 'cell' | 'outside' } & Anchor)
  /** 印の説明（spec 07 §3）。markers は 1 個以上で、sortMarkers の順 */
  | ({ kind: 'marker'; markers: readonly MarkerRef[] } & Anchor)
```

`ClickEvent` に 1 行足す（`| { type: 'marker-drag-end'; lon: number; lat: number }` の後）:

```ts
  /** 地図の ○ のクリック（spec 07 §3.1）。当たった印をすべて渡す */
  | ({ type: 'marker-click'; markers: readonly MarkerRef[] } & Anchor)
```

`reduceClick` の前に足す:

```ts
/** 並びのキー。最低点が 0、あふれ出し点は窪地の id（1 から） */
const markerKey = (m: MarkerRef): number => (m.marker === 'lowest' ? 0 : m.depressionId)

/**
 * 最低点を先、あふれ出し点は depressionId の昇順に並べ、同じ印を 1 つにする（R07-4。queryRenderedFeatures は
 * タイルの境目で同じ地物を 2 回返しうる）。入力は変えない
 */
export function sortMarkers(markers: readonly MarkerRef[]): MarkerRef[] {
  const seen = new Set<number>()
  return [...markers]
    .sort((a, b) => markerKey(a) - markerKey(b))
    .filter((m) => {
      const key = markerKey(m)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}
```

`reduceClick` の `switch` の `case 'confirm':` を置き換え、`case 'marker-click':` を足す:

```ts
    case 'marker-click': {
      const markers = sortMarkers(event.markers)
      if (markers.length === 0) return { popover: CLOSED, select: null }
      const { lon, lat, x, y } = event
      return { popover: { kind: 'marker', markers, lon, lat, x, y }, select: null }
    }
    case 'confirm':
      // 印の説明には「ここを降雨中心にする」が無い。Anchor を持つので、ここで弾かないと型は通ったまま
      // 新しい地点が選ばれてしまう（推奨 R2）
      if (popover.kind === 'closed' || popover.kind === 'marker') return { popover, select: null }
      return { popover: CLOSED, select: { lon: popover.lon, lat: popover.lat } }
```

- [ ] **Step 9: `CellInfoPopover` を `cell`・`outside` のときだけ開く**

`src/ui/components/CellInfoPopover.tsx` の `const open = popover.kind !== 'closed'` を次にする:

```tsx
  // 印の説明（kind: marker）は MarkerInfoPopover が出す（spec 07 §3.4、計画で決めたこと 9）
  const open = popover.kind === 'cell' || popover.kind === 'outside'
```

- [ ] **Step 10: 通ることを確かめる**

Run: `pnpm exec vitest run src/map/overlayColors.test.ts src/map/terrainFeatures.test.ts src/state/clickState.test.ts src/ui/components/CellInfoPopover.test.tsx`
Expected: PASS

- [ ] **Step 11: ゲート（E2E とバンドルを含む）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 781 件（772 + 9）

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 43 passed（挙動は変えていない）

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下（Task 1 の基準から +0.1 KB 前後）

- [ ] **Step 12: コミット**

```bash
git add src/map/overlayColors.ts src/map/overlayColors.test.ts src/map/terrainFeatures.ts src/map/terrainFeatures.test.ts src/map/TerrainOverlay.ts src/state/clickState.ts src/state/clickState.test.ts src/ui/components/CellInfoPopover.tsx src/ui/components/CellInfoPopover.test.tsx
git commit -m "spec 07 Task 3: 印の状態（marker-click・confirm の no-op）、色の定数、あふれ出し点の depressionId"
```

---

### Task 4: ○ のクリックで開く説明・カーソル・○ の凡例（spec 07 §3.1・§3.4〜§3.6）

**Files:**
- Create: `src/ui/markerInfo.ts`、`src/ui/markerInfo.test.ts`
- Create: `src/ui/components/MarkerInfoPopover.tsx`、`src/ui/components/MarkerInfoPopover.test.tsx`
- Create: `src/ui/components/MarkerInfoHost.tsx`
- Create: `src/ui/components/MarkerLegend.tsx`
- Modify: `src/ui/strings.ts`、`src/ui/App.tsx`、`src/ui/terrainSession.ts`、`src/ui/components/DisplaySettings.tsx`、`src/ui/components/Legends.test.tsx`

**Interfaces:**
- Consumes: `MarkerRef`・`sortMarkers`（Task 3）、`MARKER_COLORS`（Task 3）、`TERRAIN_LAYER_IDS.markers`、`formatMeters`・`formatVolume`・`formatArea`
- Produces:
  - `MARKER_HIT_PX = 4`、`markerHitBox(x: number, y: number): [[number, number], [number, number]]`
  - `markerRefsFromFeatures(features: readonly { properties?: unknown }[]): MarkerRef[]`
  - `type MarkerInfoRow = { marker: 'lowest'; elevationM: number } | { marker: 'spill'; depressionId: number; spillElevationM: number; maxDepthM: number; capacityM3: number; areaM2: number }`
  - `markerInfoRows(terrain: Pick<TerrainPayload, 'elevation' | 'lowestIndex' | 'depressions'>, markers: readonly MarkerRef[]): MarkerInfoRow[]`
  - `TerrainSession.markerInfo(markers: readonly MarkerRef[]): MarkerInfoRow[]`
  - `strings.markerInfo`・`strings.legend.markersAria`（E2E・凡例が使う）
  - テストの印: `data-testid="marker-info"`（枠）、`marker-info-lowest`・`marker-info-spill`（行）、`marker-elevation`・`marker-spill-elevation`・`marker-max-depth`・`marker-capacity`・`marker-area`（数値）、`marker-legend`・`marker-legend-lowest`・`marker-legend-spill`

- [ ] **Step 1: 文言を足す**

`src/ui/strings.ts` の `cellInfo: { … },` の直後に足す:

```ts
  /** 地図の ○ の説明（spec 07 §3.4） */
  markerInfo: {
    lowest: {
      title: '最低点',
      body: '範囲の中でいちばん低い地点です。水が集まりやすい場所の目安です。',
    },
    spill: {
      title: 'あふれ出し点',
      body: 'くぼ地が水で満たされると、ここから水があふれ出します。',
    },
    elevation: '標高',
    spillElevation: 'あふれる標高',
    maxDepth: 'くぼ地の最大の深さ',
    capacity: 'ためられる水の量',
    area: 'くぼ地の面積',
    close: '閉じる',
  },
```

`legend: { … }` の中、`depressionAria` の後に足す:

```ts
    markersAria: '地図の印の凡例。青い丸は最低点、オレンジの丸はあふれ出し点',
```

- [ ] **Step 2: `markerInfo` のテストを書く**

`src/ui/markerInfo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { makeDepression } from '../simulation/testing/terrainGrids.test-support'
import { MARKER_HIT_PX, markerHitBox, markerInfoRows, markerRefsFromFeatures } from './markerInfo'

const terrain = {
  elevation: Float32Array.of(3, 1.25, 5),
  lowestIndex: 1,
  depressions: [
    makeDepression({ id: 1, spillElevation: 10.5, maxDepthM: 0.2, capacityM3: 12, areaM2: 80 }),
    makeDepression({ id: 2, spillElevation: 11.5, maxDepthM: 0.4, capacityM3: 30, areaM2: 150 }),
  ],
}

describe('markerHitBox（spec 07 §3.1）', () => {
  it('クリックの位置の ±4 px の矩形', () => {
    expect(MARKER_HIT_PX).toBe(4)
    expect(markerHitBox(100, 50)).toEqual([
      [96, 46],
      [104, 54],
    ])
  })
})

describe('markerRefsFromFeatures', () => {
  it('kind と depressionId から印を読み、形の違うものは捨てる', () => {
    expect(
      markerRefsFromFeatures([
        { properties: { kind: 'lowest' } },
        { properties: { kind: 'spill', depressionId: 2 } },
        { properties: { kind: 'spill' } },
        { properties: { kind: 'spill', depressionId: 1.5 } },
        { properties: { kind: 'other' } },
        { properties: null },
        {},
      ]),
    ).toEqual([{ marker: 'lowest' }, { marker: 'spill', depressionId: 2 }])
  })
})

describe('markerInfoRows（計画で決めたこと 3）', () => {
  it('最低点は標高、あふれ出し点は窪地の 4 つの数値（depressions[id − 1]）', () => {
    expect(
      markerInfoRows(terrain, [{ marker: 'lowest' }, { marker: 'spill', depressionId: 2 }]),
    ).toEqual([
      { marker: 'lowest', elevationM: 1.25 },
      {
        marker: 'spill',
        depressionId: 2,
        spillElevationM: 11.5,
        maxDepthM: 0.4,
        capacityM3: 30,
        areaM2: 150,
      },
    ])
  })

  it('窪地の一覧に無い id・最低点の無い地形の印は飛ばす（Review Focus 3）', () => {
    expect(markerInfoRows(terrain, [{ marker: 'spill', depressionId: 9 }])).toEqual([])
    expect(markerInfoRows({ ...terrain, lowestIndex: -1 }, [{ marker: 'lowest' }])).toEqual([])
  })

  it('id がずれていれば（depressions[id − 1].id が違う）飛ばす', () => {
    const shifted = { ...terrain, depressions: [makeDepression({ id: 2 })] }
    expect(markerInfoRows(shifted, [{ marker: 'spill', depressionId: 1 }])).toEqual([])
  })
})
```

（`makeDepression` の引数は `Partial<Depression>` のはず。違えば `src/simulation/testing/terrainGrids.test-support.ts` の形に合わせる）

- [ ] **Step 3: `MarkerInfoPopover` のテストを書く**

`src/ui/components/MarkerInfoPopover.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Popover } from '../../state/clickState'
import type { MarkerInfoRow } from '../markerInfo'
import { strings } from '../strings'
import { MarkerInfoPopover } from './MarkerInfoPopover'

afterEach(cleanup)

const position = { lon: 139.7, lat: 35.6, x: 100, y: 100 }
const marker: Popover = {
  kind: 'marker',
  markers: [{ marker: 'lowest' }, { marker: 'spill', depressionId: 2 }],
  ...position,
}
const lowest: MarkerInfoRow = { marker: 'lowest', elevationM: 12.345 }
const spill: MarkerInfoRow = {
  marker: 'spill',
  depressionId: 2,
  spillElevationM: 13.5,
  maxDepthM: 0.426,
  capacityM3: 31.44,
  areaM2: 82.4,
}

describe('MarkerInfoPopover（spec 07 §3.4）', () => {
  it('最低点: 見出し・説明・標高を出す', () => {
    render(<MarkerInfoPopover popover={marker} rows={[lowest]} onClose={vi.fn()} />)
    const row = screen.getByTestId('marker-info-lowest')
    expect(within(row).getByText(strings.markerInfo.lowest.title)).toBeTruthy()
    expect(within(row).getByText(strings.markerInfo.lowest.body)).toBeTruthy()
    expect(within(row).getByTestId('marker-elevation').textContent).toBe('12.35 m')
  })

  it('あふれ出し点: 見出し・説明と 4 つの数値を既存の書式で出す', () => {
    render(<MarkerInfoPopover popover={marker} rows={[spill]} onClose={vi.fn()} />)
    const row = screen.getByTestId('marker-info-spill')
    expect(within(row).getByText(strings.markerInfo.spill.title)).toBeTruthy()
    expect(within(row).getByText(strings.markerInfo.spill.body)).toBeTruthy()
    expect(within(row).getByTestId('marker-spill-elevation').textContent).toBe('13.50 m')
    expect(within(row).getByTestId('marker-max-depth').textContent).toBe('0.43 m')
    expect(within(row).getByTestId('marker-capacity').textContent).toBe('31.4 m³')
    expect(within(row).getByTestId('marker-area').textContent).toBe('82 m²')
  })

  it('重なった印は、最低点を先に縦に並べる（R07-4）。「閉じる」で閉じる', async () => {
    const onClose = vi.fn()
    render(<MarkerInfoPopover popover={marker} rows={[lowest, spill]} onClose={onClose} />)
    const rows = screen.getAllByTestId(/^marker-info-(lowest|spill)$/)
    expect(rows.map((r) => r.dataset.testid)).toEqual(['marker-info-lowest', 'marker-info-spill'])
    await userEvent.click(screen.getByRole('button', { name: strings.markerInfo.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('「ここを降雨中心にする」は出さない（spec 07 §3.2）', () => {
    render(<MarkerInfoPopover popover={marker} rows={[lowest]} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: strings.cellInfo.useAsCenter })).toBeNull()
  })

  it('印の説明でないとき・行が無いときは開かない（Review Focus 3）', () => {
    render(
      <MarkerInfoPopover popover={{ kind: 'cell', ...position }} rows={[]} onClose={vi.fn()} />,
    )
    expect(screen.queryByTestId('marker-info')).toBeNull()
    cleanup()
    render(<MarkerInfoPopover popover={marker} rows={[]} onClose={vi.fn()} />)
    expect(screen.queryByTestId('marker-info')).toBeNull()
  })
})
```

- [ ] **Step 4: ○ の凡例のテストを足す**

`src/ui/components/Legends.test.tsx` の import に `import { MarkerLegend } from './MarkerLegend'` を足し、`describe('凡例', …)` の中に足す:

```tsx
  it('○ の凡例は、最低点とあふれ出し点を地図と同じ色（map/overlayColors.ts）で出す（spec 07 §3.6）', () => {
    render(<MarkerLegend />)
    expect(screen.getByRole('img', { name: strings.legend.markersAria })).toBeTruthy()
    expect(screen.getByText(strings.markerInfo.lowest.title)).toBeTruthy()
    expect(screen.getByText(strings.markerInfo.spill.title)).toBeTruthy()
    expect(screen.getByTestId('marker-legend-lowest').style.backgroundColor).toBe('rgb(21, 101, 192)')
    expect(screen.getByTestId('marker-legend-spill').style.backgroundColor).toBe('rgb(239, 108, 0)')
  })
```

- [ ] **Step 5: 失敗を確かめる**

Run: `pnpm exec vitest run src/ui/markerInfo.test.ts src/ui/components/MarkerInfoPopover.test.tsx src/ui/components/Legends.test.tsx`
Expected: FAIL（モジュールが無い）

- [ ] **Step 6: `markerInfo.ts` を作る**

`src/ui/markerInfo.ts`:

```ts
import type { TerrainPayload } from '../shared/protocol'
import type { MarkerRef } from '../state/clickState'

/** 印の説明の 1 行分の数値（spec 07 §3.4） */
export type MarkerInfoRow =
  | { marker: 'lowest'; elevationM: number }
  | {
      marker: 'spill'
      depressionId: number
      spillElevationM: number
      maxDepthM: number
      capacityM3: number
      areaM2: number
    }

/** 当たりの矩形の半幅（px）。指で押しやすくするため、点ではなく矩形で問い合わせる（spec 07 §3.1） */
export const MARKER_HIT_PX = 4

/** queryRenderedFeatures に渡す矩形（地図の要素の中の座標） */
export function markerHitBox(x: number, y: number): [[number, number], [number, number]] {
  return [
    [x - MARKER_HIT_PX, y - MARKER_HIT_PX],
    [x + MARKER_HIT_PX, y + MARKER_HIT_PX],
  ]
}

/** 描画された ○ の地物のプロパティ（map/terrainFeatures.ts の MarkerProperties）から印を読む。形の違うものは捨てる */
export function markerRefsFromFeatures(features: readonly { properties?: unknown }[]): MarkerRef[] {
  const refs: MarkerRef[] = []
  for (const feature of features) {
    const properties = feature.properties
    if (typeof properties !== 'object' || properties === null) continue
    const { kind, depressionId } = properties as Record<string, unknown>
    if (kind === 'lowest') refs.push({ marker: 'lowest' })
    else if (kind === 'spill' && typeof depressionId === 'number' && Number.isInteger(depressionId)) {
      refs.push({ marker: 'spill', depressionId })
    }
  }
  return refs
}

/**
 * 印の数値を地形から引く（計画で決めたこと 3）。窪地は depressions[id − 1]（id は 1 から順。TerrainOverlay の
 * depressionRgba と同じ引き方）で、id が一致しなければ飛ばす。最低点の無い地形（lowestIndex −1）も飛ばす
 */
export function markerInfoRows(
  terrain: Pick<TerrainPayload, 'elevation' | 'lowestIndex' | 'depressions'>,
  markers: readonly MarkerRef[],
): MarkerInfoRow[] {
  const rows: MarkerInfoRow[] = []
  for (const m of markers) {
    if (m.marker === 'lowest') {
      if (terrain.lowestIndex < 0) continue
      rows.push({ marker: 'lowest', elevationM: terrain.elevation[terrain.lowestIndex] ?? 0 })
      continue
    }
    const d = terrain.depressions[m.depressionId - 1]
    if (d === undefined || d.id !== m.depressionId) continue
    rows.push({
      marker: 'spill',
      depressionId: d.id,
      spillElevationM: d.spillElevation,
      maxDepthM: d.maxDepthM,
      capacityM3: d.capacityM3,
      areaM2: d.areaM2,
    })
  }
  return rows
}
```

- [ ] **Step 7: `MarkerInfoPopover`・`MarkerInfoHost` を作る**

`src/ui/components/MarkerInfoPopover.tsx`:

```tsx
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import type { Popover as PopoverState } from '../../state/clickState'
import { formatArea, formatMeters, formatVolume } from '../format'
import type { MarkerInfoRow } from '../markerInfo'
import { strings } from '../strings'

interface Props {
  popover: PopoverState
  /** popover が marker のときの数値（sortMarkers の順） */
  rows: readonly MarkerInfoRow[]
  onClose: () => void
}

function Value({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 3 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" data-testid={testId}>
        {value}
      </Typography>
    </Box>
  )
}

function Row({ row }: { row: MarkerInfoRow }) {
  const text = strings.markerInfo[row.marker]
  return (
    <Box data-testid={`marker-info-${row.marker}`}>
      <Typography variant="subtitle2">{text.title}</Typography>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {text.body}
      </Typography>
      {row.marker === 'lowest' ? (
        <Value
          label={strings.markerInfo.elevation}
          value={formatMeters(row.elevationM)}
          testId="marker-elevation"
        />
      ) : (
        <>
          <Value
            label={strings.markerInfo.spillElevation}
            value={formatMeters(row.spillElevationM)}
            testId="marker-spill-elevation"
          />
          <Value
            label={strings.markerInfo.maxDepth}
            value={formatMeters(row.maxDepthM)}
            testId="marker-max-depth"
          />
          <Value
            label={strings.markerInfo.capacity}
            value={formatVolume(row.capacityM3)}
            testId="marker-capacity"
          />
          <Value
            label={strings.markerInfo.area}
            value={formatArea(row.areaM2)}
            testId="marker-area"
          />
        </>
      )}
    </Box>
  )
}

/**
 * 地図の ○ の説明（spec 07 §3.4）。形は CellInfoPopover と同じ（背景を持たず、root はクリックを通し、紙だけが
 * 受ける。焦点を閉じ込めず、スクロールも止めない）。印が複数なら Divider で区切って縦に並べる（R07-4）
 */
export function MarkerInfoPopover({ popover, rows, onClose }: Props) {
  const open = popover.kind === 'marker' && rows.length > 0
  return (
    <Popover
      open={open}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={open ? { top: popover.y, left: popover.x } : { top: 0, left: 0 }}
      hideBackdrop
      disableScrollLock
      disableEnforceFocus
      slotProps={{
        root: { sx: { pointerEvents: 'none' } },
        paper: { sx: { pointerEvents: 'auto' } },
      }}
    >
      <Box data-testid="marker-info" sx={{ p: 1.5, minWidth: 220, maxWidth: 320 }}>
        {rows.map((row, k) => (
          <Box key={row.marker === 'lowest' ? 'lowest' : `spill-${row.depressionId}`}>
            {k > 0 && <Divider sx={{ my: 1 }} />}
            <Row row={row} />
          </Box>
        ))}
        <Box sx={{ mt: 1 }}>
          <Button size="small" onClick={onClose}>
            {strings.markerInfo.close}
          </Button>
        </Box>
      </Box>
    </Popover>
  )
}
```

（`open` が偽のとき `popover.y` を読まないので、`popover.kind` の絞り込みは `open` の別名の条件で効く。型が通らなければ `popover.kind === 'marker'` を三項の条件に直接書く）

`src/ui/components/MarkerInfoHost.tsx`:

```tsx
import { useStore } from 'zustand'
import type { TerrainSession } from '../terrainSession'
import { MarkerInfoPopover } from './MarkerInfoPopover'

/** 印の説明のポップオーバーをストアにつなぐ。数値は開いたときの地形から読む（配列を props に載せない） */
export function MarkerInfoHost({ session }: { session: TerrainSession }) {
  const popover = useStore(session.store, (s) => s.popover)
  const rows = popover.kind === 'marker' ? session.markerInfo(popover.markers) : []
  return (
    <MarkerInfoPopover
      popover={popover}
      rows={rows}
      onClose={() => session.dispatchClick({ type: 'close' })}
    />
  )
}
```

`src/ui/App.tsx` の import に `import { MarkerInfoHost } from './components/MarkerInfoHost'` を足し、`<CellInfoHost session={session} />` の次の行に `<MarkerInfoHost session={session} />` を足す。

- [ ] **Step 8: `MarkerLegend` を作り、`DisplaySettings` に置く**

`src/ui/components/MarkerLegend.tsx`:

```tsx
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { MARKER_COLORS } from '../../map/overlayColors'
import { strings } from '../strings'

const KINDS = ['lowest', 'spill'] as const

/** 地図の ○ の凡例（spec 07 §3.6）。色は地図のレイヤーと同じ定数（map/overlayColors.ts）から読む */
export function MarkerLegend() {
  return (
    <Box
      role="img"
      aria-label={strings.legend.markersAria}
      data-testid="marker-legend"
      sx={{ my: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}
    >
      {KINDS.map((kind) => (
        <Box key={kind} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            component="span"
            data-testid={`marker-legend-${kind}`}
            style={{ backgroundColor: MARKER_COLORS[kind] }}
            sx={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #ffffff', boxShadow: 1 }}
          />
          <Typography variant="caption">{strings.markerInfo[kind].title}</Typography>
        </Box>
      ))}
    </Box>
  )
}
```

`src/ui/components/DisplaySettings.tsx` の import に `import { MarkerLegend } from './MarkerLegend'` を足し、`<DepressionLegend />` の次の行に `<MarkerLegend />` を足す。

- [ ] **Step 9: `TerrainSession` に ○ のクリック・カーソル・`markerInfo` を足す**

`src/ui/terrainSession.ts`:

import を足す・直す:

```ts
import { type ClickEvent, type ClickTarget, type MarkerRef, reduceClick } from '../state/clickState'
import { type MarkerInfoRow, markerHitBox, markerInfoRows, markerRefsFromFeatures } from './markerInfo'
```

`TerrainOverlay` の import を `import { type OverlayDisplay, TERRAIN_LAYER_IDS, TerrainOverlay } from '../map/TerrainOverlay'` にする。

`attach` の中の `const onClick = …` を置き換える:

```ts
    const onClick = (event: MapMouseEvent): void => {
      const { lng, lat } = event.lngLat
      // event.point は地図の要素の中の座標。ポップオーバーはビューポートの座標で置くので、要素の左上を足す
      // （地図の要素が画面の左上から始まるとは限らない）
      const rect = map.getContainer().getBoundingClientRect()
      const x = rect.left + event.point.x
      const y = rect.top + event.point.y
      // ○（最低点・あふれ出し点）に当たれば、セル情報の代わりに印の説明を開く（spec 07 §3.1）。
      // 当たりの判定は描画された円に任せ、±4 px の矩形で問い合わせる。3D でも circle は地形に焼かれず直接
      // 描かれ、queryRenderedFeatures は標高を渡して判定する（軽微 m1）
      const markers = markersAt(event.point.x, event.point.y)
      if (markers.length > 0) {
        this.dispatchClick({ type: 'marker-click', markers, lon: lng, lat, x, y })
        return
      }
      this.dispatchClick({
        type: 'map-click',
        target: this.clickTarget(lng, lat),
        lon: lng,
        lat,
        x,
        y,
      })
    }
    // 印のレイヤーが無い（地形が無い・読み込み中・段に分けて足す途中）ときは問い合わせない。無いレイヤーを
    // 指定すると MapLibre がエラーのイベントを出す（maplibre-gl-dev.mjs 15024）
    const markersAt = (px: number, py: number): MarkerRef[] => {
      if (map.getLayer(TERRAIN_LAYER_IDS.markers) === undefined) return []
      return markerRefsFromFeatures(
        map.queryRenderedFeatures(markerHitBox(px, py), { layers: [TERRAIN_LAYER_IDS.markers] }),
      )
    }
    // ○ の上では指の形のカーソル（spec 07 §3.5）。レイヤー付きの mouseenter・mouseleave は、レイヤーが無い間は
    // 問い合わせない（maplibre-gl-dev.mjs 24517〜24560 の _createDelegatedListener）。ドラッグ中は MapLibre に任せる
    const onMarkerEnter = (): void => {
      map.getCanvas().style.cursor = 'pointer'
    }
    const onMarkerLeave = (): void => {
      map.getCanvas().style.cursor = ''
    }
```

`map.on('click', onClick)` の次に足す:

```ts
    map.on('mouseenter', TERRAIN_LAYER_IDS.markers, onMarkerEnter)
    map.on('mouseleave', TERRAIN_LAYER_IDS.markers, onMarkerLeave)
```

戻り値の後始末の `map.off('click', onClick)` の次に足す:

```ts
      map.off('mouseenter', TERRAIN_LAYER_IDS.markers, onMarkerEnter)
      map.off('mouseleave', TERRAIN_LAYER_IDS.markers, onMarkerLeave)
```

`cellInfo` の後に足す:

```ts
  /** 印の説明の数値（spec 07 §3.4、計画で決めたこと 3）。地形が無ければ空 */
  markerInfo(markers: readonly MarkerRef[]): MarkerInfoRow[] {
    const terrain = this.client.terrain
    return terrain === null ? [] : markerInfoRows(terrain, markers)
  }
```

- [ ] **Step 10: 通ることを確かめる**

Run: `pnpm exec vitest run src/ui/markerInfo.test.ts src/ui/components/MarkerInfoPopover.test.tsx src/ui/components/Legends.test.tsx`
Expected: PASS

- [ ] **Step 11: ゲート（E2E とバンドルを含む）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 792 件（781 + 11）

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 43 passed。**落ちたテストがあれば、そのクリックが ○ に当たっていないかを最初に疑う**（Review Focus 1。当たっていればクリックの位置を ○ から離す。挙動は変えない）

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下（Divider・Popover は既に入っている。+1 KB 前後の見込み）

- [ ] **Step 12: コミット**

```bash
git add src/ui/markerInfo.ts src/ui/markerInfo.test.ts src/ui/components/MarkerInfoPopover.tsx src/ui/components/MarkerInfoPopover.test.tsx src/ui/components/MarkerInfoHost.tsx src/ui/components/MarkerLegend.tsx src/ui/components/Legends.test.tsx src/ui/components/DisplaySettings.tsx src/ui/strings.ts src/ui/App.tsx src/ui/terrainSession.ts
git commit -m "spec 07 Task 4: ○ のクリックで開く説明のポップオーバー、○ の上のカーソル、○ の凡例"
```

---

### Task 5: 領域外流出量のツールチップ・水深の凡例の注記・注意事項の 1 行（spec 07 §4、R07-3）

**Files:**
- Modify: `src/ui/strings.ts`
- Modify: `src/ui/components/StatisticsPanel.tsx`、`src/ui/components/StatisticsPanel.test.tsx`
- Modify: `src/ui/components/WaterLegend.tsx`、`src/ui/components/Legends.test.tsx`
- Modify: `src/ui/components/DisclaimerDialog.test.tsx`

**Interfaces:**
- Consumes: なし
- Produces: `strings.stats.outflowHelp`・`strings.stats.outflowHelpLabel`・`strings.legend.waterThinNote`、`strings.disclaimer.lines` の 4 行目。テストの印 `data-testid="water-legend-note"`

- [ ] **Step 1: 文言を足す**

`src/ui/strings.ts`:

`stats: { … }` の `outflow: '領域外流出量',` の次に足す:

```ts
    outflowHelpLabel: '領域外流出量の説明',
    outflowHelp:
      '範囲の端や、海などの標高データの無い場所から、外へ流れ出た水の量です。下水道・地面への浸み込み・蒸発は考えていません。',
```

`legend: { … }` の `waterAria` の次に足す:

```ts
    waterThinNote: '1 cm 未満の薄い水は表示しません（領域内の水量には含みます）。',
```

`disclaimer.lines` の 3 行目（`'建物、道路構造、…考慮されていません。',`）の後に足す:

```ts
      '範囲の端や標高データの無い場所に達した水は、範囲の外へ流れ出たものとして扱います。',
```

- [ ] **Step 2: 失敗するテストを書く**

`src/ui/components/StatisticsPanel.test.tsx` の import に `import userEvent from '@testing-library/user-event'` と `import { strings } from '../strings'` を足し、`describe` の中に足す:

```tsx
  it('領域外流出量の横の情報アイコンにツールチップが付き、説明文を出す（spec 07 §4.1）', async () => {
    render(<StatisticsPanel simulation={createSimulationStore()} />)
    const help = screen.getByRole('button', { name: strings.stats.outflowHelpLabel })
    await userEvent.hover(help)
    expect((await screen.findByRole('tooltip')).textContent).toBe(strings.stats.outflowHelp)
  })
```

`src/ui/components/Legends.test.tsx` の `describe('凡例', …)` に足す:

```tsx
  it('水深の凡例の下に、1 cm 未満は表示しないことの注記を出す（spec 07 §4.2）', () => {
    render(<WaterLegend palette="stepped" />)
    expect(screen.getByTestId('water-legend-note').textContent).toBe(strings.legend.waterThinNote)
  })
```

`src/ui/components/DisclaimerDialog.test.tsx` の、`for (const line of strings.disclaimer.lines)` のある `it` の中に足す:

```tsx
    // 範囲の外への流出の 1 行（spec 07 §4.3、R07-3）
    expect(strings.disclaimer.lines).toHaveLength(4)
```

- [ ] **Step 3: 失敗を確かめる**

Run: `pnpm exec vitest run src/ui/components/StatisticsPanel.test.tsx src/ui/components/Legends.test.tsx src/ui/components/DisclaimerDialog.test.tsx`
Expected: FAIL（ボタンと注記が無い）。注意事項は Step 1 の文言で既に 4 行なので通る

- [ ] **Step 4: ツールチップを付ける**

`src/ui/components/StatisticsPanel.tsx`:

import に足す:

```tsx
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import { createSvgIcon } from '@mui/material/utils'
```

`const ZERO` の前に足す:

```tsx
/**
 * 丸の中の「i」（spec 07 §4.1 の InfoOutlined の代わり。@mui/icons-material は依存に無いので、同じ種類の形を
 * 自作する。計画で決めたこと 12）
 */
const InfoIcon = createSvgIcon(
  <>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="11" y="10" width="2" height="7" />
    <rect x="11" y="6.5" width="2" height="2" />
  </>,
  'Info',
)

/**
 * 領域外流出量の説明（spec 07 §4.1）。キーボードで焦点を移せ（IconButton）、焦点・ホバー・タップ（enterTouchDelay 0）
 * で開く。describeChild で、ボタンの名前は「領域外流出量の説明」、説明文はツールチップにする
 */
function OutflowHelp() {
  return (
    <Tooltip
      title={strings.stats.outflowHelp}
      describeChild
      enterTouchDelay={0}
      leaveTouchDelay={5000}
    >
      <IconButton size="small" aria-label={strings.stats.outflowHelpLabel} sx={{ ml: 0.5, p: 0.25 }}>
        <InfoIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  )
}
```

見出しのセルを次にする:

```tsx
            <TableCell component="th" scope="row" sx={{ pl: 0 }}>
              {label}
              {testId === 'stat-outflow' && <OutflowHelp />}
            </TableCell>
```

- [ ] **Step 5: 水深の凡例に注記を足す**

`src/ui/components/WaterLegend.tsx` の戻り値を、凡例の `Box`（role="img"。子は読み上げの木から外れる）の外に注記を置く形にする:

```tsx
  return (
    <>
      <Box role="img" aria-label={strings.legend.waterAria} data-testid="water-legend" sx={{ my: 1 }}>
        {/* ここは今の中身のまま */}
      </Box>
      {/* 1 cm 未満の薄い水は描かない（base-spec §30）。水が「消えた」ように見える理由（spec 07 §4.2） */}
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        data-testid="water-legend-note"
        sx={{ mb: 1 }}
      >
        {strings.legend.waterThinNote}
      </Typography>
    </>
  )
```

- [ ] **Step 6: 通ることを確かめる**

Run: `pnpm exec vitest run src/ui/components/StatisticsPanel.test.tsx src/ui/components/Legends.test.tsx src/ui/components/DisclaimerDialog.test.tsx`
Expected: PASS

- [ ] **Step 7: ゲート（E2E とバンドルを含む）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 794 件（792 + 2）

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 43 passed（免責ダイアログの E2E は 1 行目だけを見る）

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下（IconButton の分、+1 KB 前後）

- [ ] **Step 8: コミット**

```bash
git add src/ui/strings.ts src/ui/components/StatisticsPanel.tsx src/ui/components/StatisticsPanel.test.tsx src/ui/components/WaterLegend.tsx src/ui/components/Legends.test.tsx src/ui/components/DisclaimerDialog.test.tsx
git commit -m "spec 07 Task 5: 領域外流出量のツールチップ、水深の凡例の 1 cm の注記、注意事項の流出の 1 行"
```

---

### Task 6: 「流出しているセル」の設定・スイッチ・凡例（spec 07 §5.3、軽微 m2）

**Files:**
- Modify: `src/state/persistedSettings.ts`、`src/state/persistedSettings.test.ts`、`src/state/settingsStore.test.ts`
- Create: `src/ui/components/OutflowLegend.tsx`
- Create: `src/ui/components/DisplaySettings.test.tsx`
- Modify: `src/ui/components/DisplaySettings.tsx`、`src/ui/components/Legends.test.tsx`、`src/ui/strings.ts`

**Interfaces:**
- Consumes: `OUTFLOW_COLOR`・`OUTFLOW_OPACITY`（Task 3）
- Produces: `PersistedSettings['display']['showOutflowCells']: boolean`（既定 true。Task 7・8 が読む）、`strings.panel.showOutflow`・`strings.legend.outflow`・`strings.legend.outflowAria`、テストの印 `outflow-legend-swatch`

- [ ] **Step 1: 文言を足す**

`src/ui/strings.ts` の `panel: { … }` の `showWaterFlow: '水の流れ',` の次に `showOutflow: '流出しているセル',` を足す。`legend: { … }` の `markersAria` の次に足す:

```ts
    outflow: 'この辺りから範囲の外へ流出中',
    outflowAria: '流出の凡例。赤紫の帯は、この辺りから範囲の外へ水が流れ出ていることを示す',
```

- [ ] **Step 2: 保存値のテストを書く**

`src/state/persistedSettings.test.ts` の import を `import { ARROW_SPACINGS, clampArrowSpacing, DEFAULT_SETTINGS, parsePersistedSettings } from './persistedSettings'` にし、末尾に足す:

```ts
describe('display.showOutflowCells（spec 07 §5.3、軽微 m2）', () => {
  /** v0.2.0 が保存した値（showOutflowCells が無い。注意事項は了解済み） */
  const V020 = {
    schemaVersion: 1,
    rainfall: { amountMm: 120, radiusM: 30 },
    area: { sizeM: 500 },
    display: {
      verticalExaggeration: 2,
      waterDepthPalette: 'stepped',
      showFlowVectors: true,
      flowVectorSpacingM: 10,
    },
    map: { basemap: 'pale', theme: 'system' },
    disclaimerAcknowledgedAt: '2026-09-20T01:02:03.000Z',
  }

  it('既定はオン', () => {
    expect(DEFAULT_SETTINGS.display.showOutflowCells).toBe(true)
  })

  it('v0.2.0 の保存値は捨てずに読み、注意事項の了解を残し、showOutflowCells を true で補う', () => {
    const parsed = parsePersistedSettings(V020)
    expect(parsed?.disclaimerAcknowledgedAt).toBe('2026-09-20T01:02:03.000Z')
    expect(parsed?.rainfall).toEqual({ amountMm: 120, radiusM: 30 })
    expect(parsed?.display.showOutflowCells).toBe(true)
  })

  it('保存された false はそのまま読む', () => {
    const parsed = parsePersistedSettings({
      ...V020,
      display: { ...V020.display, showOutflowCells: false },
    })
    expect(parsed?.display.showOutflowCells).toBe(false)
  })

  it.each<[string, unknown]>([
    ['文字列', 'yes'],
    ['null', null],
    ['数', 1],
  ])('型が違えば（%s）これまでどおり全体を捨てる（null）', (_, value) => {
    expect(
      parsePersistedSettings({ ...V020, display: { ...V020.display, showOutflowCells: value } }),
    ).toBeNull()
  })
})
```

`src/state/settingsStore.test.ts` の不正な値の `it.each` の表に 1 行足す（`'矢印の表示が真偽値でない'` の次）:

```ts
    [
      '流出の表示が真偽値でない',
      { ...base, display: { ...DEFAULT_SETTINGS.display, showOutflowCells: 'yes' } },
    ],
```

同じファイルの `describe('settingsStore（tech-spec §8.3）', …)` の中に足す:

```ts
  it('v0.2.0 の保存値（showOutflowCells が無い）を読んでも、注意事項の了解と雨量は残り、流出の表示はオン（spec 07 §5.3）', () => {
    const { showOutflowCells: _, ...display } = DEFAULT_SETTINGS.display
    const store = createSettingsStore(
      memoryStorage({
        [SETTINGS_KEY]: JSON.stringify({
          ...DEFAULT_SETTINGS,
          rainfall: { amountMm: 80, radiusM: 15 },
          display,
          disclaimerAcknowledgedAt: '2026-09-20T01:02:03.000Z',
        }),
      }),
    )
    expect(store.getState().disclaimerAcknowledgedAt).toBe('2026-09-20T01:02:03.000Z')
    expect(store.getState().rainfall).toEqual({ amountMm: 80, radiusM: 15 })
    expect(store.getState().display.showOutflowCells).toBe(true)
  })
```

（`_` が lint の未使用変数に当たるなら、`const display: Record<string, unknown> = { ...DEFAULT_SETTINGS.display }; delete display.showOutflowCells` にする）

- [ ] **Step 3: スイッチと凡例のテストを書く**

`src/ui/components/DisplaySettings.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createAppStore } from '../../state/appStore'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import { createSettingsStore } from '../../state/settingsStore'
import { strings } from '../strings'
import { DisplaySettings } from './DisplaySettings'

afterEach(cleanup)

describe('DisplaySettings の流出の表示（spec 07 §5.3）', () => {
  it('「流出しているセル」のスイッチは既定でオンで、切ると保存する設定に書く', async () => {
    const settings = createSettingsStore(memoryStorage())
    render(<DisplaySettings app={createAppStore()} settings={settings} />)
    const toggle = screen.getByLabelText(strings.panel.showOutflow) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    await userEvent.click(toggle)
    expect(settings.getState().display.showOutflowCells).toBe(false)
  })

  it('○ の凡例の隣に流出の凡例を出す', () => {
    render(<DisplaySettings app={createAppStore()} settings={createSettingsStore(memoryStorage())} />)
    expect(screen.getByRole('img', { name: strings.legend.markersAria })).toBeTruthy()
    expect(screen.getByRole('img', { name: strings.legend.outflowAria })).toBeTruthy()
  })
})
```

`src/ui/components/Legends.test.tsx` の import に `import { OutflowLegend } from './OutflowLegend'` を足し、`describe('凡例', …)` に足す:

```tsx
  it('流出の凡例は、地図と同じ色（map/overlayColors.ts）の四角と文を出す（spec 07 §5.3）', () => {
    render(<OutflowLegend />)
    expect(screen.getByRole('img', { name: strings.legend.outflowAria })).toBeTruthy()
    expect(screen.getByText(strings.legend.outflow)).toBeTruthy()
    expect(screen.getByTestId('outflow-legend-swatch').style.backgroundColor).toBe('rgb(194, 24, 91)')
  })
```

- [ ] **Step 4: 失敗を確かめる**

Run: `pnpm exec vitest run src/state/persistedSettings.test.ts src/state/settingsStore.test.ts src/ui/components/DisplaySettings.test.tsx src/ui/components/Legends.test.tsx`
Expected: FAIL（`showOutflowCells` が無い、`OutflowLegend` が無い）

- [ ] **Step 5: 保存値に足す**

`src/state/persistedSettings.ts`:

`PersistedSettings['display']` の `flowVectorSpacingM` の後に足す:

```ts
    /**
     * 流出しているセルの表示（spec 07 §5.3）。v0.2.0 の保存値には無いので、欠けていれば true で補う（型が違えば
     * これまでどおり全体を捨てる）。足したのは任意の項目で形は変わらないので、schemaVersion は 1 のまま
     */
    showOutflowCells: boolean
```

`DEFAULT_SETTINGS.display` に `showOutflowCells: true,` を足す（`flowVectorSpacingM: 10,` の後）。

`parsePersistedSettings` の表示の検証を次にする:

```ts
  const { verticalExaggeration, waterDepthPalette, showFlowVectors, flowVectorSpacingM } = display
  // v0.2.0 の保存値には無い。欠けていれば既定の true で補い、了解の日時を含む他の設定を失わせない（spec 07 §5.3）
  const showOutflowCells = display.showOutflowCells === undefined ? true : display.showOutflowCells
  if (
    !oneOf(VERTICAL_EXAGGERATIONS, verticalExaggeration) ||
    !oneOf(WATER_PALETTES, waterDepthPalette) ||
    typeof showFlowVectors !== 'boolean' ||
    !oneOf(ARROW_SPACING_INPUTS, flowVectorSpacingM) ||
    typeof showOutflowCells !== 'boolean'
  ) {
    return null
  }
```

戻り値の `display` に `showOutflowCells,` を足す（`flowVectorSpacingM: clampArrowSpacing(flowVectorSpacingM),` の後）。関数のコメントの「外した選択肢の値（矢印の間隔 5）だけ 10 に読み替える」の後に「欠けた `showOutflowCells` は true で補う（spec 07）」を足す。

- [ ] **Step 6: 流出の凡例とスイッチを作る**

`src/ui/components/OutflowLegend.tsx`:

```tsx
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { OUTFLOW_COLOR, OUTFLOW_OPACITY } from '../../map/overlayColors'
import { strings } from '../strings'

/**
 * 流出の帯の凡例（spec 07 §5.3）。帯の内側のセルそのものは流出していないので、「この辺りから」と書く（R07-5）。
 * 色は地図と同じ定数（map/overlayColors.ts）
 */
export function OutflowLegend() {
  return (
    <Box
      role="img"
      aria-label={strings.legend.outflowAria}
      sx={{ my: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}
    >
      <Box
        component="span"
        data-testid="outflow-legend-swatch"
        style={{ backgroundColor: OUTFLOW_COLOR, opacity: OUTFLOW_OPACITY }}
        sx={{ width: 12, height: 12 }}
      />
      <Typography variant="caption">{strings.legend.outflow}</Typography>
    </Box>
  )
}
```

`src/ui/components/DisplaySettings.tsx` の import に `import { OutflowLegend } from './OutflowLegend'` を足し、`<MarkerLegend />` の次に足す:

```tsx
      <FormControlLabel
        control={
          <Switch
            checked={display.showOutflowCells}
            onChange={(_, checked) => setDisplay({ showOutflowCells: checked })}
          />
        }
        label={strings.panel.showOutflow}
      />
      <OutflowLegend />
```

コンポーネントのコメントの「水の流れ・配色・矢印の間隔は保存する設定」を「水の流れ・配色・矢印の間隔・流出しているセル（spec 07）は保存する設定」にする。

- [ ] **Step 7: 通ることを確かめる**

Run: `pnpm exec vitest run src/state/persistedSettings.test.ts src/state/settingsStore.test.ts src/ui/components/DisplaySettings.test.tsx src/ui/components/Legends.test.tsx`
Expected: PASS

- [ ] **Step 8: ゲート（E2E とバンドルを含む）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 805 件（794 + 11）。`src/state/**` の行カバレッジ 80% 以上

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 43 passed（E2E の `acknowledgeDisclaimer` は `DEFAULT_SETTINGS` を書くので、新しい項目を含む）

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下

- [ ] **Step 9: コミット**

```bash
git add src/state/persistedSettings.ts src/state/persistedSettings.test.ts src/state/settingsStore.test.ts src/ui/components/OutflowLegend.tsx src/ui/components/DisplaySettings.tsx src/ui/components/DisplaySettings.test.tsx src/ui/components/Legends.test.tsx src/ui/strings.ts
git commit -m "spec 07 Task 6: 流出しているセルの表示の設定（v0.2.0 の保存値は true で補う）、スイッチと凡例"
```

---

### Task 7: 2D の流出の帯（`water-outflow` の canvas ソース。spec 07 §5.1・§5.2、推奨 R4、計画で決めたこと 7・8）

**Files:**
- Create: `src/map/outflowPaint.ts`、`src/map/outflowPaint.test.ts`
- Modify: `src/map/layerIds.ts`、`src/map/layerIds.test.ts`
- Modify: `src/map/WaterOverlay.ts`
- Modify: `src/ui/simulationSession.ts`、`src/ui/simulationSession.test.ts`
- Modify: `tests/e2e/simulation.spec.ts`、`tests/e2e/view3d.spec.ts`（重なり順）

**Interfaces:**
- Consumes: `OutflowCells`・`TerrainPayload.outflow`（Task 2）、`OUTFLOW_COLOR`・`OUTFLOW_OPACITY`・`OUTFLOW_VISIBLE_M`・`hexToRgb`（Task 3）、`display.showOutflowCells`（Task 6）
- Produces:
  - `interface OutflowPainted { cells: Int32Array; next: Int32Array; count: number }`、`createOutflowPainted(band: Int32Array): OutflowPainted`、`clearOutflow(rgba, painted): boolean`、`paintOutflow(water, outflow, rgba, painted): boolean`（`src/map/outflowPaint.ts`）
  - `WATER_LAYER_IDS.outflow = 'water-outflow'`（`OVERLAY_LAYER_ORDER` の `WATER_LAYER_IDS.water` の直後）
  - `WaterOverlay.show(geo, outflow: OutflowCells | null)`、`WaterOverlay.setOutflowVisible(visible: boolean)`
  - `SimulationSession.setOutflowVisible(visible: boolean)`（`onTerrain` の形は変えない。計画で決めたこと 13）

- [ ] **Step 1: 塗り分けのテストを書く**

`src/map/outflowPaint.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { clearOutflow, createOutflowPainted, paintOutflow } from './outflowPaint'

/**
 * 1 行 6 セルの範囲。帯は 0・1・2（0 と 1 は 0 を、2 は 2 を指す）。3〜5 は帯の外
 */
const outflow = {
  band: Int32Array.of(0, 1, 2),
  nearest: Int32Array.of(0, 0, 2, -1, -1, -1),
}
const alpha = (rgba: Uint8ClampedArray): number[] =>
  Array.from({ length: rgba.length / 4 }, (_, i) => rgba[i * 4 + 3] ?? 0)

describe('paintOutflow（spec 07 §5.1・§5.2）', () => {
  it('nearest の指すセルの水深が 1 mm 以上なら、帯のセルを #c2185b（不透明）で塗る。閾値の境目', () => {
    const rgba = new Uint8ClampedArray(6 * 4)
    const painted = createOutflowPainted(outflow.band)
    const water = Float32Array.of(0.001, 0, 0.0009, 1, 1, 1)
    expect(paintOutflow(water, outflow, rgba, painted)).toBe(true)
    // 0 と 1 は 0 の水深（1 mm）で塗る。2 は 0.9 mm で塗らない。帯の外（3〜5）は水があっても塗らない
    expect(alpha(rgba)).toEqual([255, 255, 0, 0, 0, 0])
    expect(Array.from(rgba.slice(0, 4))).toEqual([194, 24, 91, 255])
    expect(painted.count).toBe(2)
  })

  it('前回塗ったセルのうち、今回塗らないものは透明にする', () => {
    const rgba = new Uint8ClampedArray(6 * 4)
    const painted = createOutflowPainted(outflow.band)
    paintOutflow(Float32Array.of(1, 0, 0, 0, 0, 0), outflow, rgba, painted)
    expect(paintOutflow(Float32Array.of(0, 0, 1, 0, 0, 0), outflow, rgba, painted)).toBe(true)
    expect(alpha(rgba)).toEqual([0, 0, 255, 0, 0, 0])
  })

  it('塗るセルが前回と同じなら rgba に触れず false（転送しない。計画で決めたこと 7）', () => {
    const rgba = new Uint8ClampedArray(6 * 4)
    const painted = createOutflowPainted(outflow.band)
    paintOutflow(Float32Array.of(1, 0, 0, 0, 0, 0), outflow, rgba, painted)
    rgba[3] = 7 // 触れたかどうかの目印
    expect(paintOutflow(Float32Array.of(0.5, 0, 0, 0, 0, 0), outflow, rgba, painted)).toBe(false)
    expect(rgba[3]).toBe(7)
  })

  it('帯が空なら何も塗らず、false（全部無効の範囲。Review Focus 2）', () => {
    const empty = { band: new Int32Array(0), nearest: new Int32Array(6).fill(-1) }
    const rgba = new Uint8ClampedArray(6 * 4)
    expect(paintOutflow(Float32Array.of(1, 1, 1, 1, 1, 1), empty, rgba, createOutflowPainted(empty.band))).toBe(false)
    expect(alpha(rgba)).toEqual([0, 0, 0, 0, 0, 0])
  })
})

describe('clearOutflow（setWater(null) の経路。推奨 R4）', () => {
  it('塗っているセルを全部透明にし、消したものがあれば true。2 回目は false', () => {
    const rgba = new Uint8ClampedArray(6 * 4)
    const painted = createOutflowPainted(outflow.band)
    paintOutflow(Float32Array.of(1, 0, 1, 0, 0, 0), outflow, rgba, painted)
    expect(clearOutflow(rgba, painted)).toBe(true)
    expect(alpha(rgba)).toEqual([0, 0, 0, 0, 0, 0])
    expect(painted.count).toBe(0)
    expect(clearOutflow(rgba, painted)).toBe(false)
  })
})
```

`src/map/layerIds.test.ts` の `describe` の中に足す:

```ts
  it('流出の帯（water-outflow）は 2D の水深のすぐ上、3D の水面の下（spec 07 §5.2）', () => {
    expect(OVERLAY_LAYER_ORDER.indexOf(WATER_LAYER_IDS.outflow)).toBe(
      OVERLAY_LAYER_ORDER.indexOf(WATER_LAYER_IDS.water) + 1,
    )
    expect(
      beforeLayerId(WATER_LAYER_IDS.outflow, having(VIEW3D_LAYER_IDS.water, TERRAIN_LAYER_IDS.outline)),
    ).toBe(VIEW3D_LAYER_IDS.water)
    expect(beforeLayerId(WATER_LAYER_IDS.water, having(WATER_LAYER_IDS.outflow))).toBe(
      WATER_LAYER_IDS.outflow,
    )
  })
```

- [ ] **Step 2: `SimulationSession` のテストを直し、足す**

`src/ui/simulationSession.test.ts`:

- `const terrain = { geo } as TerrainPayload` を次にする（地形は Worker が作った流出の表を持つ。Task 2）:

```ts
const terrain = {
  geo,
  outflow: {
    mask: new Uint8Array(geo.size * geo.size),
    nearest: new Int32Array(geo.size * geo.size).fill(-1),
    band: new Int32Array(0),
  },
} as unknown as TerrainPayload
```

- `fakeOverlay()` の型と中身に `setOutflowVisible: ReturnType<typeof vi.fn>` と `setOutflowVisible: vi.fn(),` を足す（型の 2 か所と中身の 1 か所）
- `expect(overlay.show).toHaveBeenCalledWith(terrain.geo)` を `expect(overlay.show).toHaveBeenCalledWith(terrain.geo, terrain.outflow)` にする

ファイルの末尾に足す:

```ts
describe('SimulationSession: 流出の帯（spec 07 §5）', () => {
  it('terrainReady は地形の流出の表（Worker が作ったもの）をそのまま overlay に渡す（メインでは作らない）', () => {
    const { session } = setup()
    const overlay = fakeOverlay()
    session.attach(fakeController(), () => overlay)
    session.terrainReady(terrain, CENTER)
    expect(overlay.show.mock.calls.at(-1)?.[1]).toBe(terrain.outflow)
  })

  it('設定の showOutflowCells を overlay に渡す（attach の時点の値と、その後の変化。spec 07 §5.3）', () => {
    const { session, settings } = setup()
    settings.getState().setDisplay({ showOutflowCells: false })
    const overlay = fakeOverlay()
    session.attach(fakeController(), () => overlay)
    expect(overlay.setOutflowVisible).toHaveBeenLastCalledWith(false)
    settings.getState().setDisplay({ showOutflowCells: true })
    expect(overlay.setOutflowVisible).toHaveBeenLastCalledWith(true)
  })
})
```

- [ ] **Step 3: 失敗を確かめる**

Run: `pnpm exec vitest run src/map/outflowPaint.test.ts src/map/layerIds.test.ts src/ui/simulationSession.test.ts`
Expected: FAIL（`outflowPaint` が無い、`WATER_LAYER_IDS.outflow` が無い、`show` の 2 つ目の引数・`setOutflowVisible` が無い）

- [ ] **Step 4: 塗り分けを作る**

`src/map/outflowPaint.ts`:

```ts
/**
 * 2D の流出の帯の塗り分け（spec 07 §5.1・§5.2）。WaterOverlay が描画フレームごとに呼ぶ。帯のセル（band）だけを
 * 走査し、前回塗ったセルの一覧を持って、そこだけを消す。maplibre-gl を import しない純粋なモジュール
 */
import type { OutflowCells } from '../simulation/outflowCells'
import { hexToRgb, OUTFLOW_COLOR, OUTFLOW_VISIBLE_M } from './overlayColors'

const [R, G, B] = hexToRgb(OUTFLOW_COLOR)

/** 塗っているセルの一覧（先頭 count 個）と、次の描画で塗るセルを集める作業領域。どちらも帯のセル数の大きさ */
export interface OutflowPainted {
  cells: Int32Array
  next: Int32Array
  count: number
}

export function createOutflowPainted(band: Int32Array): OutflowPainted {
  return { cells: new Int32Array(band.length), next: new Int32Array(band.length), count: 0 }
}

/** 塗っているセルを全部透明にする（setWater(null)。推奨 R4）。消したものがあれば true */
export function clearOutflow(rgba: Uint8ClampedArray, painted: OutflowPainted): boolean {
  if (painted.count === 0) return false
  for (let k = 0; k < painted.count; k++) rgba[(painted.cells[k] ?? 0) * 4 + 3] = 0
  painted.count = 0
  return true
}

/**
 * 帯のセルのうち、nearest の指すセルの水深が OUTFLOW_VISIBLE_M（1 mm。R07-1）以上のものを OUTFLOW_COLOR で塗る
 * （不透明。重ねの不透明度はレイヤーの raster-opacity）。塗るセルが前回と同じなら rgba に触れず false
 * （呼び出し側は転送しない。計画で決めたこと 7）。変われば前回の分を消して塗り、true
 */
export function paintOutflow(
  water: ArrayLike<number>,
  outflow: Pick<OutflowCells, 'band' | 'nearest'>,
  rgba: Uint8ClampedArray,
  painted: OutflowPainted,
): boolean {
  const { band, nearest } = outflow
  const next = painted.next
  let count = 0
  for (let k = 0; k < band.length; k++) {
    const i = band[k] ?? 0
    // NaN は比較が偽になり、塗らない
    if ((water[nearest[i] ?? -1] ?? 0) >= OUTFLOW_VISIBLE_M) next[count++] = i
  }
  if (count === painted.count) {
    let same = true
    for (let k = 0; k < count && same; k++) same = next[k] === painted.cells[k]
    if (same) return false
  }
  clearOutflow(rgba, painted)
  for (let k = 0; k < count; k++) {
    const o = (next[k] ?? 0) * 4
    rgba[o] = R
    rgba[o + 1] = G
    rgba[o + 2] = B
    rgba[o + 3] = 255
  }
  painted.next = painted.cells
  painted.cells = next
  painted.count = count
  return true
}
```

- [ ] **Step 5: レイヤーの ID と並びを足す**

`src/map/layerIds.ts`:

```ts
export const WATER_LAYER_IDS = {
  water: 'water-depth',
  /** 流出の帯（spec 07 §5.2）。2D の水深の直後 */
  outflow: 'water-outflow',
  arrows: 'water-arrows',
} as const
```

`OVERLAY_LAYER_ORDER` の `WATER_LAYER_IDS.water,` の次の行に `WATER_LAYER_IDS.outflow,` を足す。

- [ ] **Step 6: `WaterOverlay` に流出の canvas を足す**

`src/map/WaterOverlay.ts` を次にする（`uploadCanvasSource` とその前のコメントは今のまま残す。`EMPTY`・`ARROW_IMAGE` も今のまま）:

```ts
import type { CanvasSource, GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import type { Corners } from '../dem/gridRange'
import type { OutflowCells } from '../simulation/outflowCells'
import { ensureArrowImage } from './arrowImage'
import { beforeLayerId, WATER_LAYER_IDS } from './layerIds'
import { clearOutflow, createOutflowPainted, type OutflowPainted, paintOutflow } from './outflowPaint'
import { OUTFLOW_OPACITY } from './overlayColors'
import type { PointCollection } from './terrainFeatures'
import { WATER_LAYER_OPACITY, type WaterPalette, waterRgba } from './waterColormap'

export { WATER_LAYER_IDS } from './layerIds'

const ARROW_IMAGE = 'water-flow-arrow'
const EMPTY: PointCollection<{ bearing: number }> = { type: 'FeatureCollection', features: [] }

// （uploadCanvasSource は今のまま）

/** 範囲の大きさの canvas と、その RGBA（putImageData で描く） */
interface Canvas2d {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  rgba: Uint8ClampedArray<ArrayBuffer>
  image: ImageData
}

function createCanvas2d(size: number): Canvas2d | null {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) return null
  const rgba = new Uint8ClampedArray(size * size * 4)
  return { canvas, context, rgba, image: new ImageData(rgba, size, size) }
}

/** 流出の帯の canvas と、帯の表・塗っているセル（spec 07 §5.2） */
interface OutflowTarget extends Canvas2d {
  cells: OutflowCells
  painted: OutflowPainted
}

interface Target extends Canvas2d {
  corners: Corners
  outflow: OutflowTarget | null
}
```

クラスのコメントの最後に「流出の帯（spec 07 §5.2）は別の canvas ソース（water-outflow）に、水深と同じ描画フレームで塗る」を足す。フィールドに足す:

```ts
  /** 流出しているセルの表示（設定の display.showOutflowCells。spec 07 §5.3） */
  private outflowVisible = true
```

`show` を置き換える:

```ts
  /** 地形の範囲に水深・流出の帯の canvas と矢印のレイヤーを置く（最初は透明）。outflow が null なら帯は置かない */
  show(geo: { size: number; corners: Corners }, outflow: OutflowCells | null): void {
    this.clear()
    const generation = this.generation
    const water = createCanvas2d(geo.size)
    if (water === null) return
    const outflowCanvas = outflow === null ? null : createCanvas2d(geo.size)
    this.target = {
      ...water,
      corners: geo.corners,
      outflow:
        outflow === null || outflowCanvas === null
          ? null
          : { ...outflowCanvas, cells: outflow, painted: createOutflowPainted(outflow.band) },
    }
    this.whenMapLoaded(() => {
      if (generation === this.generation) this.addLayers()
    })
  }
```

`setDepthVisible` の置き換え後:

```ts
  /**
   * 2D の水深の canvas を出すか。3D の間は水面の Custom Layer と二重になるので隠し、着色も止める（spec 05 §3.6）。
   * 流出の帯も 3D の間は隠す（3D は水面のシェーダが描く。spec 07 §5.2）
   */
  setDepthVisible(visible: boolean): void {
    this.depthVisible = visible
    if (this.map.getLayer(WATER_LAYER_IDS.water) !== undefined) {
      this.map.setLayoutProperty(WATER_LAYER_IDS.water, 'visibility', visible ? 'visible' : 'none')
    }
    this.applyOutflowVisibility()
    if (visible) this.requestDraw()
  }

  /** 流出しているセルの表示（spec 07 §5.3）。出すときは今の水深で塗り直す */
  setOutflowVisible(visible: boolean): void {
    this.outflowVisible = visible
    this.applyOutflowVisibility()
    if (visible) this.requestDraw()
  }

  private applyOutflowVisibility(): void {
    if (this.map.getLayer(WATER_LAYER_IDS.outflow) === undefined) return
    const shown = this.depthVisible && this.outflowVisible
    this.map.setLayoutProperty(WATER_LAYER_IDS.outflow, 'visibility', shown ? 'visible' : 'none')
  }
```

`restore` を置き換える:

```ts
  /**
   * ベースマップの切り替えで消えたソースとレイヤーを足し直す（冪等。Task 10）。足し直した後に今の水深で描き直す
   * （流出の canvas は塗っているセルの一覧と常に一致しているので、古い帯は出ない。計画で決めたこと 8）
   */
  restore(): void {
    if (this.target === null) return
    this.addLayers()
    this.requestDraw()
  }
```

`draw` を置き換え、`drawOutflow` を足す:

```ts
  private readonly draw = (): void => {
    this.frame = 0
    const target = this.target
    if (target === null) return
    if (this.latest === null) target.rgba.fill(0)
    else waterRgba(this.latest, this.palette, target.rgba)
    target.context.putImageData(target.image, 0, 0)
    uploadCanvasSource(this.map.getSource<CanvasSource>(WATER_LAYER_IDS.water))
    if (target.outflow !== null) this.drawOutflow(target.outflow)
  }

  /**
   * 流出の帯（spec 07 §5.2）。水が無い（setWater(null)。reset・start・失敗・異常終了）ときは、表示の有無に関わらず
   * 全部消す（推奨 R4。切っている間の Reset の後に入れ直しても古い帯を出さない）。切っている間は塗らない
   * （入れ直すときに setOutflowVisible が塗り直す）。塗るセルが変わらなければ転送しない（計画で決めたこと 7）
   */
  private drawOutflow(outflow: OutflowTarget): void {
    let changed: boolean
    if (this.latest === null) changed = clearOutflow(outflow.rgba, outflow.painted)
    else if (this.outflowVisible) {
      changed = paintOutflow(this.latest, outflow.cells, outflow.rgba, outflow.painted)
    } else return
    if (!changed) return
    outflow.context.putImageData(outflow.image, 0, 0)
    uploadCanvasSource(this.map.getSource<CanvasSource>(WATER_LAYER_IDS.outflow))
  }
```

`addLayers` の、水深のレイヤーを足した直後（`// 白に濃い青の縁` の前）に足す:

```ts
    // 流出の帯（spec 07 §5.2）。水深のすぐ上、範囲の枠・矢印・○ の下。水の canvas とは別のソース（表示の切り替えを
    // 水と独立にするため）。3D の間と切っている間は隠す
    if (target.outflow !== null) {
      this.map.addSource(WATER_LAYER_IDS.outflow, {
        type: 'canvas',
        canvas: target.outflow.canvas,
        coordinates: target.corners,
        animate: false,
      })
      this.map.addLayer(
        {
          id: WATER_LAYER_IDS.outflow,
          type: 'raster',
          source: WATER_LAYER_IDS.outflow,
          layout: { visibility: this.depthVisible && this.outflowVisible ? 'visible' : 'none' },
          paint: { 'raster-opacity': OUTFLOW_OPACITY, 'raster-resampling': 'nearest' },
        },
        before(WATER_LAYER_IDS.outflow),
      )
    }
```

`removeLayers` は `Object.values(WATER_LAYER_IDS)` を回すので、流出のレイヤーとソースも消える（変えない）。

- [ ] **Step 7: `SimulationSession` で流出の表を渡す**

`src/ui/simulationSession.ts`（simulation からは何も import しない。流出の表は `terrain.outflow` にある）:

フィールドの `private depthCanvasVisible = true` の後に足す:

```ts
  /** 流出しているセルの表示（設定の display.showOutflowCells。spec 07 §5.3） */
  private outflowVisible = true
```

コンストラクタの `apply` の中、`this.setPalette(display.waterDepthPalette)` の後に `this.setOutflowVisible(display.showOutflowCells)` を足す。

`terrainReady` の `this.overlay?.show(terrain.geo)` を次にする:

```ts
    // 流出の帯の表は Worker が地形の読み込みで作って送ってくる（spec 07 §5.1。計画で決めたこと 1）
    this.overlay?.show(terrain.geo, terrain.outflow)
```

`attach` の `overlay.setDepthVisible(this.depthCanvasVisible)` の次に `overlay.setOutflowVisible(this.outflowVisible)` を足し、`if (this.terrain !== null) overlay.show(this.terrain.geo)` を `if (this.terrain !== null) overlay.show(this.terrain.geo, this.terrain.outflow)` にする。

`setPalette` の後に足す:

```ts
  /** 流出しているセルの表示（spec 07 §5.3）。3D は View3dSession が設定から直接受ける */
  setOutflowVisible(visible: boolean): void {
    this.outflowVisible = visible
    this.overlay?.setOutflowVisible(visible)
  }
```

- [ ] **Step 8: 依存の規則を確かめる**

Run: `pnpm depcheck`
Expected: 成功（ui・map は `OutflowCells` を型だけで読む。値の import は Worker の 1 か所だけ）

- [ ] **Step 9: 既存の E2E の重なり順を直す**

`tests/e2e/simulation.spec.ts` の `OVERLAY_ORDER_2D` の `WATER_LAYER_IDS.water,` の次の行に `WATER_LAYER_IDS.outflow,` を足す。テスト名の「（標高・窪地・水深・枠・流向・矢印・最低点）」を「（標高・窪地・水深・流出の帯・枠・流向・矢印・○）」にする。

`tests/e2e/view3d.spec.ts` の `3D で降雨を始めると水面が出て…` のテストの `data-overlay-order` の配列の `WATER_LAYER_IDS.water,` の次の行に `WATER_LAYER_IDS.outflow,` を足し、`expect(visible3d).not.toContain(WATER_LAYER_IDS.water)` の次の行に足す:

```ts
    // 2D の流出の帯も 3D の間は隠す（3D は水面のシェーダが描く。spec 07 §5.2）
    expect(visible3d).not.toContain(WATER_LAYER_IDS.outflow)
```

- [ ] **Step 10: 通ることを確かめる**

Run: `pnpm exec vitest run src/map/outflowPaint.test.ts src/map/layerIds.test.ts src/ui/simulationSession.test.ts`
Expected: PASS

- [ ] **Step 11: ゲート（E2E とバンドルを含む）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 813 件（805 + 8）

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 43 passed

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下（`outflowPaint.ts`・`WaterOverlay` の追加分だけ。simulation のコードは初期ロードに入らない）

- [ ] **Step 12: コミット**

```bash
git add src/map/outflowPaint.ts src/map/outflowPaint.test.ts src/map/layerIds.ts src/map/layerIds.test.ts src/map/WaterOverlay.ts src/ui/simulationSession.ts src/ui/simulationSession.test.ts tests/e2e/simulation.spec.ts tests/e2e/view3d.spec.ts
git commit -m "spec 07 Task 7: 2D の流出の帯（water-outflow の canvas ソース）、Worker が作った流出の表を描く"
```

---

### Task 8: 3D の流出の帯（水面の Custom Layer のシェーダ。spec 07 §5.2、R07-2、推奨 R5、must-fix M1、計画で決めたこと 5・6）

**Files:**
- Modify: `src/renderer/waterShaders.ts`、`src/renderer/waterShaders.test.ts`
- Modify: `src/renderer/waterLayer.ts`、`src/renderer/waterLayer.test.ts`
- Modify: `src/map/outflowPaint.ts`、`src/map/outflowPaint.test.ts`
- Modify: `src/map/view3d/View3d.ts`、`src/map/view3d/View3d.test.ts`
- Modify: `src/ui/view3dSession.ts`、`src/ui/view3dSession.test.ts`

**Interfaces:**
- Consumes: `TerrainPayload.outflow`（Task 2）、`OUTFLOW_*`・`hexToRgb`（Task 3）、`display.showOutflowCells`（Task 6）
- Produces:
  - `interface WaterOutflow { nearest: Int32Array; rgb: readonly [number, number, number]; opacity: number; minDepthM: number }`、`WaterLayerOptions.outflow: WaterOutflow`、`WaterLayerOptions.showOutflow: boolean`、`WaterLayer.setShowOutflow(show: boolean): void`、`outflowNearestData(nearest: Int32Array, n: number): Float32Array`、`outflowColorUniform(outflow: Pick<WaterOutflow, 'rgb' | 'opacity'>): Vector4`、`buildUniforms(elevation, depth, lut, outflowNearest, options)`（`src/renderer/waterLayer.ts`）
  - `outflowLayerSpec(nearest: Int32Array | null): WaterOutflow`（`src/map/outflowPaint.ts`）
  - `View3dInit.showOutflow: boolean`、`View3d.setShowOutflow(show)`、`View3dLike.setShowOutflow(show)`（`setTerrain` の形は変えない。計画で決めたこと 13）

- [ ] **Step 1: シェーダのテストを足す**

`src/renderer/waterShaders.test.ts` の末尾に足す:

```ts
describe('流出の帯のシェーダ（spec 07 §5.2、推奨 R5）', () => {
  it('頂点シェーダ: u_outflowNearest の平らな添字 k を読み、k のセルの水深を u_depth から引く。非表示と計測の間は読まない', () => {
    expect(WATER_VERTEX).toContain('if (u_showOutflow > 0.5 && u_debug.x <= 0.5) {')
    expect(WATER_VERTEX).toContain('int k = int(texelFetch(u_outflowNearest, cell, 0).r);')
    expect(WATER_VERTEX).toContain(
      'texelFetch(u_depth, ivec2(k % u_size, k / u_size), 0).r >= u_outflowMinDepth',
    )
    // 高さの式は変えない（持ち上げない。スパイクの判定 (e)）
    expect(WATER_VERTEX).toContain('(z + (d >= u_minDepth ? d : 0.0) + lift) * u_exaggeration')
  })

  it('varying は smooth（provoking vertex で辺ごとに見え方が変わる flat は使わない）', () => {
    expect(WATER_VERTEX).toContain('smooth out float v_outflow;')
    expect(WATER_FRAGMENT).toContain('smooth in float v_outflow;')
    expect(WATER_VERTEX).not.toMatch(/\bflat\b/)
    expect(WATER_FRAGMENT).not.toMatch(/\bflat\b/)
  })

  it('フラグメントシェーダ: v_outflow > 0.5 なら 1 cm の discard より先に、流出の色（premultiplied）を出す', () => {
    expect(WATER_FRAGMENT).toContain('if (v_outflow > 0.5) {')
    expect(WATER_FRAGMENT).toContain('fragColor = u_outflowColor;')
    expect(WATER_FRAGMENT.indexOf('v_outflow > 0.5')).toBeLessThan(WATER_FRAGMENT.indexOf('discard'))
  })

  it('スパイク専用の uniform は入れない', () => {
    for (const name of ['u_outflowGround', 'u_outflowLift', 'u_outflowMask', 'OUTFLOW_QUALIFIER']) {
      expect(WATER_VERTEX).not.toContain(name)
      expect(WATER_FRAGMENT).not.toContain(name)
    }
  })
})
```

- [ ] **Step 2: 水面の層のテストを直し、足す**

`src/renderer/waterLayer.test.ts`:

import に `outflowColorUniform,`・`outflowNearestData,` を足す。

`uniform の名前がシェーダの宣言とマテリアルで一致する` の `it` の `options` と `buildUniforms` の呼び出しを次にする:

```ts
    const options: Pick<
      WaterLayerOptions,
      'size' | 'exaggeration' | 'lut' | 'outflow' | 'showOutflow'
    > = {
      size: 2,
      exaggeration: 2,
      lut,
      outflow: { nearest: new Int32Array(4).fill(-1), rgb: [0.5, 0.1, 0.3], opacity: 0.9, minDepthM: 0.001 },
      showOutflow: true,
    }
    const uniforms = buildUniforms(dummyTexture, dummyTexture, dummyTexture, dummyTexture, options)
```

同じ `it` の末尾に足す:

```ts
    // 流出の帯の uniform（spec 07 §7.1）
    expect(declaredUniformNames(WATER_VERTEX)).toEqual(
      expect.arrayContaining(['u_outflowNearest', 'u_outflowMinDepth', 'u_showOutflow']),
    )
    expect(declaredUniformNames(WATER_FRAGMENT)).toContain('u_outflowColor')
```

ファイルの末尾に足す:

```ts
describe('流出の帯の uniform の値（spec 07 §5.2、計画で決めたこと 5・6）', () => {
  it('outflowNearestData: 平らな添字を float32 にそのまま入れる（帯の外は −1）', () => {
    expect(Array.from(outflowNearestData(Int32Array.of(-1, 0, 3, 1_062_960), 2))).toEqual([
      -1, 0, 3, 1_062_960,
    ])
  })

  it('outflowNearestData: 長さが N² でなければ全部 −1（帯なし）', () => {
    expect(Array.from(outflowNearestData(new Int32Array(0), 2))).toEqual([-1, -1, -1, -1])
  })

  it('outflowColorUniform: premultiplied（rgb × 不透明度、不透明度）', () => {
    const color = outflowColorUniform({ rgb: [1, 0.5, 0], opacity: 0.9 })
    expect(color.toArray()).toEqual([0.9, 0.45, 0, 0.9])
  })

  it('buildUniforms: u_showOutflow は表示なら 1・非表示なら 0、u_outflowMinDepth は渡した値', () => {
    const texture = new DataTexture(new Float32Array(1), 1, 1, RedFormat, FloatType)
    const lut: WaterLut = {
      rgb: new Uint8Array([1, 2, 3]),
      bandsPerM: 20,
      maxIndex: 0,
      epsilonM: 0.001,
      alpha: 0.8,
      minDepthM: 0.01,
    }
    const outflow = { nearest: new Int32Array(1), rgb: [1, 0, 0] as const, opacity: 0.9, minDepthM: 0.001 }
    const on = buildUniforms(texture, texture, texture, texture, {
      size: 1,
      exaggeration: 1,
      lut,
      outflow,
      showOutflow: true,
    })
    const off = buildUniforms(texture, texture, texture, texture, {
      size: 1,
      exaggeration: 1,
      lut,
      outflow,
      showOutflow: false,
    })
    expect(on.u_showOutflow.value).toBe(1)
    expect(off.u_showOutflow.value).toBe(0)
    expect(on.u_outflowMinDepth.value).toBe(0.001)
    expect(on.u_outflowNearest.value).toBe(texture)
  })
})
```

- [ ] **Step 3: 3D に渡す値と、3D のつなぎのテストを足す**

`src/map/outflowPaint.test.ts` の import に `outflowLayerSpec` を足し、末尾に足す:

```ts
describe('outflowLayerSpec（3D の水面に渡す値。計画で決めたこと 4）', () => {
  it('色は OUTFLOW_COLOR を 0〜1 にしたもの、不透明度 0.9、閾値 1 mm。nearest はそのまま、null なら空', () => {
    const nearest = Int32Array.of(0, -1)
    const spec = outflowLayerSpec(nearest)
    expect(spec.nearest).toBe(nearest)
    expect(spec.rgb).toEqual([194 / 255, 24 / 255, 91 / 255])
    expect(spec.opacity).toBe(0.9)
    expect(spec.minDepthM).toBe(0.001)
    expect(outflowLayerSpec(null).nearest).toHaveLength(0)
  })
})
```

`src/ui/view3dSession.test.ts`:

`fakeView()` に `setShowOutflow: vi.fn(),` を足す（`satisfies View3dLike` が型で確かめる）。`describe` の中に足す:

```ts
  it('流出の表示: 3D を作る前に変えた設定を作るときに渡し、その後の変化も渡す（spec 07 §5.3、Review Focus 5）', async () => {
    const { settings, app, view, inits } = setup()
    settings.getState().setDisplay({ showOutflowCells: false })
    app.getState().setViewMode('3d')
    await vi.waitFor(() => expect(inits).toHaveLength(1))
    expect(inits[0]?.showOutflow).toBe(false)
    settings.getState().setDisplay({ showOutflowCells: true })
    expect(view.setShowOutflow).toHaveBeenLastCalledWith(true)
  })
```

`src/map/view3d/View3d.test.ts` の `View3dInit` の 4 か所の `palette: 'stepped',` の次の行に `showOutflow: true,` を足す。

- [ ] **Step 4: 失敗を確かめる**

Run: `pnpm exec vitest run src/renderer src/map/outflowPaint.test.ts src/ui/view3dSession.test.ts`
Expected: FAIL（uniform・関数・`setShowOutflow` が無い）

- [ ] **Step 5: シェーダを書く**

`src/renderer/waterShaders.ts` の `WATER_VERTEX`・`WATER_FRAGMENT` を次にする（ファイル冒頭のコメントと `PRECISION` はそのまま。コメントに「flat」という語を書かない。テストが `\bflat\b` を見る）:

```ts
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
  // 流出の帯（spec 07 §5.2、推奨 R5）: 補間した v_outflow が 0.5 を超えるところは、1 cm の discard をせず、
  // 1 cm 以上でも水の色ではなく流出の色（premultiplied）で塗る。discard と塗りの判定は同じ v_outflow で行う
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
```

- [ ] **Step 6: 水面の層に流出を足す**

`src/renderer/waterLayer.ts`:

three の import に `Vector4,` を足す（`Vector2,` の後）。

`WaterLayerOptions` の前に足す:

```ts
/** 流出の帯（spec 07 §5.2）。値は View3d が map の定数から作って渡す（renderer は map を import しない） */
export interface WaterOutflow {
  /** 各セルの帯の中の最も近いマスクのセルの平らな添字。帯の外は −1。長さが N² でなければ帯なしとして扱う */
  nearest: Int32Array
  /** 流出の色（0〜1。premultiplied にする前） */
  rgb: readonly [number, number, number]
  opacity: number
  /** 流出中とみなす水深（m。R07-1） */
  minDepthM: number
}
```

`WaterLayerOptions` の `lut: WaterLut` の後に足す:

```ts
  outflow: WaterOutflow
  /** 流出しているセルを出すか（設定の display.showOutflowCells。spec 07 §5.3） */
  showOutflow: boolean
```

`WaterLayer` の `setLut` の後に足す:

```ts
  /** 流出しているセルの表示（uniform なので、プログラムのリンクをやり直さない） */
  setShowOutflow(show: boolean): void
```

`WaterUniforms` の `u_debug` の後に足す:

```ts
  u_outflowNearest: { value: DataTexture }
  u_outflowMinDepth: { value: number }
  u_showOutflow: { value: number }
  u_outflowColor: { value: Vector4 }
```

`resolveDepthData` の前に足す:

```ts
/**
 * u_outflowNearest（R32F）に入れる値（計画で決めたこと 6）。float32 は 2^24 までの整数を正確に表し、1000 m でも
 * 1031² ≈ 106 万なので足りる。長さが N² でなければ全部 −1（帯なし）
 */
export function outflowNearestData(nearest: Int32Array, n: number): Float32Array {
  if (nearest.length !== n * n) return new Float32Array(n * n).fill(-1)
  return Float32Array.from(nearest)
}

/** 流出の色の uniform（premultiplied。MapLibre のブレンドは ONE, ONE_MINUS_SRC_ALPHA） */
export function outflowColorUniform(outflow: Pick<WaterOutflow, 'rgb' | 'opacity'>): Vector4 {
  const [r, g, b] = outflow.rgb
  const a = outflow.opacity
  return new Vector4(r * a, g * a, b * a, a)
}
```

`buildUniforms` を置き換える:

```ts
export function buildUniforms(
  elevationTexture: DataTexture,
  depthTexture: DataTexture,
  lut: DataTexture,
  outflowNearestTexture: DataTexture,
  options: Pick<WaterLayerOptions, 'size' | 'exaggeration' | 'lut' | 'outflow' | 'showOutflow'>,
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
    u_debug: { value: new Vector2(0, 0) },
    u_outflowNearest: { value: outflowNearestTexture },
    u_outflowMinDepth: { value: options.outflow.minDepthM },
    u_showOutflow: { value: options.showOutflow ? 1 : 0 },
    u_outflowColor: { value: outflowColorUniform(options.outflow) },
  }
}
```

`createWaterLayer` の中:

```ts
  const depthTexture = floatTexture(zeros, n)
  // 流出の帯の最も近いマスクのセル（spec 07 §5.2）。地形ごとに 1 回だけ転送する（水面を作るとき）
  const outflowTexture = floatTexture(outflowNearestData(options.outflow.nearest, n), n)
```

`const uniforms = buildUniforms(elevationTexture, depthTexture, lut, options)` を `const uniforms = buildUniforms(elevationTexture, depthTexture, lut, outflowTexture, options)` にする。`release` の `depthTexture.dispose()` の次に `outflowTexture.dispose()` を足す。戻り値の `setLut` の後に足す:

```ts
    setShowOutflow(show) {
      if (gate.disposed()) return
      uniforms.u_showOutflow.value = show ? 1 : 0
      map.triggerRepaint()
    },
```

- [ ] **Step 7: 3D に渡す値を作る**

`src/map/outflowPaint.ts` の import に `import type { WaterOutflow } from '../renderer/waterLayer'` を足し、`OUTFLOW_OPACITY` を overlayColors の import に足して、末尾に足す:

```ts
/** 3D の水面（renderer）に渡す流出の値（計画で決めたこと 4）。nearest が無ければ空（帯なし） */
export function outflowLayerSpec(nearest: Int32Array | null): WaterOutflow {
  return {
    nearest: nearest ?? new Int32Array(0),
    rgb: [R / 255, G / 255, B / 255],
    opacity: OUTFLOW_OPACITY,
    minDepthM: OUTFLOW_VISIBLE_M,
  }
}
```

（map から renderer へは型だけの import。`renderer-dynamic-only` を満たす。`waterColormap.ts` の `WaterLut` と同じ形）

- [ ] **Step 8: `View3d` につなぐ**

`src/map/view3d/View3d.ts`:

import に足す:

```ts
import { outflowLayerSpec } from '../outflowPaint'
```

`View3dInit` の `palette: WaterPalette` の後に足す:

```ts
  /** 流出しているセルを出すか（設定の display.showOutflowCells。spec 07 §5.3） */
  showOutflow: boolean
```

フィールドの `private terrain: TerrainPayload | null = null` の後に足す:

```ts
  private showOutflow: boolean
```

コンストラクタの `this.palette = init.palette` の後に `this.showOutflow = init.showOutflow` を足す。

`setTerrain` は変えない（流出の表は `terrain.outflow` にあり、地形が変われば水面を作り直すので、新しい `nearest` で作られる）。

`setPalette` の後に足す:

```ts
  /** 流出しているセルの表示（spec 07 §5.3）。水面を作り直すときも今の値で作る（Review Focus 5） */
  setShowOutflow(show: boolean): void {
    this.showOutflow = show
    this.water?.setShowOutflow(show)
  }
```

`addWater` の `create(map, { … })` の `lut: waterLutSpec(this.palette),` の次に足す:

```ts
      // 流出の帯（spec 07 §5.2。3D では canvas を地形に貼ると更新されないので、水面のシェーダで描く。must-fix M1）
      outflow: outflowLayerSpec(terrain.outflow.nearest),
      showOutflow: this.showOutflow,
```

- [ ] **Step 9: `View3dSession` につなぐ**

`src/ui/view3dSession.ts`:

`View3dLike` の `setPalette` の後に足す:

```ts
  setShowOutflow(show: boolean): void
```

`attach` の設定の購読の中、`setPalette` の `if` の後に足す:

```ts
      if (state.display.showOutflowCells !== previous.display.showOutflowCells) {
        this.view?.setShowOutflow(state.display.showOutflowCells)
      }
```

`ensureView` の `create(controller, { … })` の `palette: display.waterDepthPalette,` の次に `showOutflow: display.showOutflowCells,` を足す。

- [ ] **Step 10: 通ることを確かめる**

Run: `pnpm exec vitest run src/renderer src/map src/ui/view3dSession.test.ts`
Expected: PASS

- [ ] **Step 11: ゲート（E2E とバンドルを含む）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 823 件（813 + 10）

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 43 passed（3D の水の配色の E2E は画面の中心だけを見るので、縁の帯に当たらない。コンソールのエラーと警告が 0 のまま〈シェーダのコンパイルの失敗はここで出る〉）

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下（renderer・View3d は遅延読み込みなので、初期ロードは Task 7 とほぼ同じ）

- [ ] **Step 12: コミット**

```bash
git add src/renderer/waterShaders.ts src/renderer/waterShaders.test.ts src/renderer/waterLayer.ts src/renderer/waterLayer.test.ts src/map/outflowPaint.ts src/map/outflowPaint.test.ts src/map/view3d/View3d.ts src/map/view3d/View3d.test.ts src/ui/view3dSession.ts src/ui/view3dSession.test.ts
git commit -m "spec 07 Task 8: 3D の流出の帯（水面のシェーダ、u_outflowNearest の R32F・smooth の varying）"
```

---

### Task 9: E2E（spec 07 §7.2、must-fix M2、計画で決めたこと 14・15）

**Files:**
- Create: `tests/e2e/explanations.spec.ts`
- Modify: `tests/e2e/support/app.ts`、`tests/e2e/support/png.ts`、`tests/e2e/view3d.spec.ts`

**Interfaces:**
- Consumes: テストの印（Task 4・5）、`strings.*`（Task 4〜6）、`MARKER_COLORS`・`hexToRgb`（Task 3）、`WATER_LAYER_IDS.outflow`（Task 7）
- Produces: `mapElement(page)`・`switchTo3d(page)`・`hideTerrainOverlays(page)`・`nextFrames(page)`（`support/app.ts`）、`outflowColoredCount(img)`・`colorBlobs(img, rgb, tolerance)`・`type Blob`（`support/png.ts`）

- [ ] **Step 1: 画素の道具を足す**

`tests/e2e/support/png.ts` の末尾に足す:

```ts
/**
 * 流出の帯の色（#c2185b を不透明度 0.9 で重ねた色。spec 07 §5.2）に当たる画素の数。07 のスパイク
 * （.handoff/07-spike-3d-outflow.md）と同じ判定で、計測のマゼンタ（255, 0, 255）・水の青・○ のオレンジは含まない。
 * 範囲の枠と降雨マーカーの赤（#d32f2f）も当たるので、呼び出し側は同じ視点で降雨の前に数えた値との差で使う
 */
export function outflowColoredCount(img: DecodedPng): number {
  const { width, height, channels, data } = img
  let count = 0
  for (let i = 0; i < width * height; i++) {
    const o = i * channels
    const r = data[o] ?? 0
    const g = data[o + 1] ?? 0
    const b = data[o + 2] ?? 0
    if (r >= 140 && g <= 90 && b >= 40 && b <= 150 && r - b >= 60) count++
  }
  return count
}

/** 同じ色の画素の塊（4 連結）。x・y は画素の中心の平均（画像の中の座標） */
export interface Blob {
  x: number
  y: number
  count: number
}

/** rgb に近い（各成分の差が tolerance 以下の）画素の塊を、大きい順に返す（○ を探す。spec 07 の E2E） */
export function colorBlobs(
  img: DecodedPng,
  rgb: readonly [number, number, number],
  tolerance: number,
): Blob[] {
  const { width, height, channels, data } = img
  const total = width * height
  const hit = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    const o = i * channels
    const near =
      Math.abs((data[o] ?? 0) - rgb[0]) <= tolerance &&
      Math.abs((data[o + 1] ?? 0) - rgb[1]) <= tolerance &&
      Math.abs((data[o + 2] ?? 0) - rgb[2]) <= tolerance
    if (near) hit[i] = 1
  }
  const blobs: Blob[] = []
  const stack: number[] = []
  for (let start = 0; start < total; start++) {
    if (hit[start] !== 1) continue
    hit[start] = 2
    stack.push(start)
    let sx = 0
    let sy = 0
    let n = 0
    while (stack.length > 0) {
      const c = stack.pop() as number
      const x = c % width
      const y = (c - x) / width
      sx += x
      sy += y
      n++
      const neighbors = [
        x > 0 ? c - 1 : -1,
        x < width - 1 ? c + 1 : -1,
        y > 0 ? c - width : -1,
        y < height - 1 ? c + width : -1,
      ]
      for (const j of neighbors) {
        if (j >= 0 && hit[j] === 1) {
          hit[j] = 2
          stack.push(j)
        }
      }
    }
    blobs.push({ x: sx / n + 0.5, y: sy / n + 0.5, count: n })
  }
  return blobs.sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 2: 画面の道具を共有にする**

`tests/e2e/support/app.ts` の import に `import { strings } from '../../../src/ui/strings'` を足し、末尾に足す:

```ts
export const mapElement = (page: Page): Locator => page.locator('[data-map-loaded="true"]')

/** パネルの「3D」を押し、3D の視点へ動き終えるまで待つ（SwiftShader では地形の用意に数秒かかる） */
export async function switchTo3d(page: Page): Promise<void> {
  await page.getByRole('button', { name: strings.view3d.view3d, exact: true }).click()
  await expect(mapElement(page)).toHaveAttribute('data-view3d', '3d', { timeout: 30_000 })
  await expect(mapElement(page)).toHaveAttribute('data-view3d-framed', 'true', { timeout: 30_000 })
}

/** 標高・窪地・地形の流向・水の流れの矢印を切る（画素の色の判定を汚さない。spec 07 の E2E） */
export async function hideTerrainOverlays(page: Page): Promise<void> {
  for (const label of [
    strings.panel.showElevation,
    strings.panel.showDepressions,
    strings.panel.showFlow,
    strings.panel.showWaterFlow,
  ]) {
    await page.getByLabel(label, { exact: true }).uncheck()
  }
}

/** 描画フレームを 2 つ待つ（rAF で描く canvas・シェーダの変化が画面に出るまで） */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}
```

`tests/e2e/view3d.spec.ts` の、ファイル内の `const mapElement = …` と `async function switchTo3d(…) { … }` を消し、`./support/app` の import に `mapElement,`・`switchTo3d,` を足す（中身は同じなので、テストの振る舞いは変わらない）。

- [ ] **Step 3: E2E を書く**

`tests/e2e/explanations.spec.ts`:

```ts
import { expect, type Page, test } from '@playwright/test'
import { hexToRgb, MARKER_COLORS } from '../../src/map/overlayColors'
import { WATER_LAYER_IDS } from '../../src/map/WaterOverlay'
import { strings } from '../../src/ui/strings'
import {
  acknowledgeDisclaimer,
  collectErrors,
  hideTerrainOverlays,
  mapElement,
  nextFrames,
  switchTo3d,
  tabTo,
  waitTerrain,
} from './support/app'
import { routeGsi } from './support/gsi'
import { type Blob, colorBlobs, decodePng, outflowColoredCount } from './support/png'

const SHIBUYA = '/?lat=35.658000&lon=139.701600'
/** 範囲（500 m）に内接する円の雨。縁まで水が届き、流出の帯が出る（07 のスパイクと同じ雨） */
const EDGE_RAIN = '&mm=500&r=250'
/** ○ を探す画面（md 未満。パネルは下で、たためる。範囲の端の ○ が右のパネルに隠れない。計画で決めたこと 14） */
const NARROW = { width: 800, height: 900 }
/** たたんだ下のパネルの見出しの分（px） */
const BOTTOM_BAR_PX = 100
/** 右のパネル（幅 320 px）の分（px） */
const SIDE_PANEL_PX = 340
/**
 * ○ の色の許容（各成分）。circle の中は指定の色そのものなので小さくてよい。MUI の青（#1976d2）は最低点の青と
 * 各成分 17〜18 違うので、12 なら区別できる
 */
const MARKER_TOLERANCE = 12
/** ○ とみなす塊の最小の画素数（3D の遠い ○ は小さく描かれる） */
const MARKER_MIN_PX = 10
/**
 * 流出の帯の画素のしきい値（降雨の前との差）。実測を報告に書き、しきい値は大きな余裕を取る（06 の慣習）。
 * スパイク（実 GPU）では 500 m・1 セル幅の帯でも 3D で 240〜420 px だった。帯は 6 セル幅なので、それより多い
 */
const OUTFLOW_MIN_PX = 200
/** t1 から t2 への増え方の下限（3D。M2）。SwiftShader の揺れ（色の分類ではほぼ 0）より十分大きく */
const OUTFLOW_GROWTH_PX = 100
/** 帯を消した後の、降雨の前との差の許容（揺れ） */
const OUTFLOW_NOISE_PX = 30

type Clip = { x: number; y: number; width: number; height: number }

/** 地図のうちパネルに隠れない部分（狭い画面は下の見出し、広い画面は右のパネルを除く） */
async function mapClip(page: Page, narrow: boolean): Promise<Clip> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox()
  if (box === null) throw new Error('地図の canvas がありません')
  return narrow
    ? { x: box.x, y: box.y, width: box.width, height: box.height - BOTTOM_BAR_PX }
    : { x: box.x, y: box.y, width: box.width - SIDE_PANEL_PX, height: box.height }
}

/** 色 hex の ○ を、狭い画面の地図の見えている部分から探す（ページの座標。大きい順） */
async function findMarkers(page: Page, hex: string): Promise<Blob[]> {
  const clip = await mapClip(page, true)
  const blobs = colorBlobs(decodePng(await page.screenshot({ clip })), hexToRgb(hex), MARKER_TOLERANCE)
  return blobs
    .filter((b) => b.count >= MARKER_MIN_PX)
    .map((b) => ({ ...b, x: clip.x + b.x, y: clip.y + b.y }))
}

/** どの ○ からも 24 px 以上離れた、範囲の中の点（地図の中心の近くから探す） */
function awayFrom(clip: Clip, markers: readonly Blob[]): { x: number; y: number } {
  for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    for (const fy of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      const p = { x: clip.x + clip.width * fx, y: clip.y + clip.height * fy }
      if (markers.every((m) => Math.hypot(m.x - p.x, m.y - p.y) >= 24)) return p
    }
  }
  throw new Error('○ から離れた点が見つかりません')
}

/**
 * 色 hex の ○ をクリックして、行 testId の説明が開くまで繰り返す（3D は垂直強調を変えた直後に ○ の位置が動く）。
 * 見つからなければ 'no-marker' のまま時間切れになる
 */
async function clickMarker(page: Page, hex: string, testId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const [blob] = await findMarkers(page, hex)
        if (blob === undefined) return 'no-marker'
        await page.mouse.click(blob.x, blob.y)
        return (await page.getByTestId(testId).first().isVisible()) ? 'open' : 'closed'
      },
      { timeout: 30_000 },
    )
    .toBe('open')
}

async function outflowCount(page: Page, clip: Clip): Promise<number> {
  return outflowColoredCount(decodePng(await page.screenshot({ clip })))
}

test.describe('地図の印の説明と流出の表示（spec 07 §7.2）', () => {
  test.describe.configure({ timeout: 90_000 })

  test.beforeEach(async ({ context }) => {
    await routeGsi(context)
    await acknowledgeDisclaimer(context)
  })

  test('2D: 最低点の ○ の上ではカーソルが指の形になり、クリックすると説明と標高が出る。○ でない所はセル情報を開く（§3.1・§3.4・§3.5）', async ({
    page,
  }) => {
    const errors = collectErrors(page)
    await page.setViewportSize(NARROW)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    await page.getByRole('button', { name: strings.panel.collapse }).click()
    await expect
      .poll(async () => (await findMarkers(page, MARKER_COLORS.lowest)).length, { timeout: 10_000 })
      .toBeGreaterThan(0)
    const lowest = await findMarkers(page, MARKER_COLORS.lowest)
    const spills = await findMarkers(page, MARKER_COLORS.spill)
    const target = lowest[0] as Blob
    const canvas = page.locator('canvas.maplibregl-canvas')
    await page.mouse.move(target.x, target.y)
    await expect(canvas).toHaveCSS('cursor', 'pointer')
    await page.mouse.click(target.x, target.y)
    const row = page.getByTestId('marker-info-lowest')
    await expect(row).toContainText(strings.markerInfo.lowest.title)
    await expect(row).toContainText(strings.markerInfo.lowest.body)
    await expect(row.getByTestId('marker-elevation')).toHaveText(/^-?\d+\.\d{2} m$/)
    await expect(page.getByTestId('cell-info')).toBeHidden()
    // ○ から離れた範囲の中の点は、今までどおりセル情報（spec 07 §7.2）
    const away = awayFrom(await mapClip(page, true), [...lowest, ...spills])
    await page.mouse.move(away.x, away.y)
    await expect(canvas).not.toHaveCSS('cursor', 'pointer')
    await page.mouse.click(away.x, away.y)
    await expect(page.getByTestId('cell-info')).toBeVisible()
    await expect(page.getByTestId('marker-info')).toBeHidden()
    expect(errors).toEqual([])
  })

  test('2D: あふれ出し点の ○ をクリックすると、説明と 4 つの数値が出る（§3.4）', async ({ page }) => {
    await page.setViewportSize(NARROW)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    await page.getByRole('button', { name: strings.panel.collapse }).click()
    await clickMarker(page, MARKER_COLORS.spill, 'marker-info-spill')
    const row = page.getByTestId('marker-info-spill').first()
    await expect(row).toContainText(strings.markerInfo.spill.title)
    await expect(row).toContainText(strings.markerInfo.spill.body)
    await expect(row.getByTestId('marker-spill-elevation')).toHaveText(/^-?\d+\.\d{2} m$/)
    await expect(row.getByTestId('marker-max-depth')).toHaveText(/^\d+\.\d{2} m$/)
    await expect(row.getByTestId('marker-capacity')).toHaveText(/ m³$/)
    await expect(row.getByTestId('marker-area')).toHaveText(/^\d+ m²$/)
  })

  test('3D: ○ のクリックで説明が開く（垂直強調 ×1 と ×5。§3.1、軽微 m1）', async ({ page }) => {
    test.setTimeout(150_000)
    const errors = collectErrors(page)
    await page.setViewportSize(NARROW)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    await switchTo3d(page)
    for (const ex of [1, 5] as const) {
      await page
        .getByRole('group', { name: strings.view3d.exaggeration })
        .getByRole('button', { name: strings.view3d.exaggerationValue(ex), exact: true })
        .click()
      await page.getByRole('button', { name: strings.panel.collapse }).click()
      await clickMarker(page, MARKER_COLORS.lowest, 'marker-info-lowest')
      await expect(page.getByTestId('marker-elevation')).toHaveText(/^-?\d+\.\d{2} m$/)
      await page.getByRole('button', { name: strings.markerInfo.close }).click()
      await expect(page.getByTestId('marker-info')).toBeHidden()
      await page.getByRole('button', { name: strings.panel.expand }).click()
    }
    expect(errors).toEqual([])
  })

  test('2D: 縁まで雨を置いて再生すると water-outflow に流出の色が出て、切ると消え、切っている間の Reset の後に入れ直しても古い帯は出ない（§5.2・§5.3、推奨 R4、Review Focus 4）', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const errors = collectErrors(page)
    await page.goto(`${SHIBUYA}${EDGE_RAIN}`)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    const mapEl = mapElement(page)
    const visibleLayers = async (): Promise<string> =>
      (await mapEl.getAttribute('data-visible-overlay-layers')) ?? ''
    await expect.poll(visibleLayers).toContain(WATER_LAYER_IDS.outflow)
    const clip = await mapClip(page, false)
    const c0 = await outflowCount(page, clip)
    await page.getByRole('button', { name: strings.playback.max, exact: true }).click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect
      .poll(async () => (await outflowCount(page, clip)) - c0, { timeout: 60_000 })
      .toBeGreaterThan(OUTFLOW_MIN_PX)
    // 切ると消える
    await page.getByLabel(strings.panel.showOutflow).uncheck()
    await expect.poll(visibleLayers).not.toContain(WATER_LAYER_IDS.outflow)
    await nextFrames(page)
    expect((await outflowCount(page, clip)) - c0).toBeLessThanOrEqual(OUTFLOW_NOISE_PX)
    // 切っている間に Reset（setWater(null)）。入れ直しても古い帯は出ない
    await page.getByRole('button', { name: strings.playback.reset }).click()
    await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
    await page.getByLabel(strings.panel.showOutflow).check()
    await expect.poll(visibleLayers).toContain(WATER_LAYER_IDS.outflow)
    await nextFrames(page)
    await nextFrames(page)
    expect((await outflowCount(page, clip)) - c0).toBeLessThanOrEqual(OUTFLOW_NOISE_PX)
    expect(errors).toEqual([])
  })

  test('3D: 流出の帯はカメラを固定したまま再生中に増える（t1 < t2。must-fix M2）。切ると降雨の前に戻る', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const errors = collectErrors(page)
    await page.goto(`${SHIBUYA}${EDGE_RAIN}`)
    await waitTerrain(page)
    await hideTerrainOverlays(page)
    await switchTo3d(page)
    // ここから先はカメラを動かさない（3D の視点へ動き終えた後）
    const clip = await mapClip(page, false)
    const c0 = await outflowCount(page, clip)
    await page.getByRole('button', { name: strings.playback.max, exact: true }).click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect
      .poll(async () => Number(await mapElement(page).getAttribute('data-water-ready')), {
        timeout: 30_000,
      })
      .toBeGreaterThanOrEqual(1)
    // t1: 帯が出るまで待つ（canvas を地形に貼る方式のように最初の絵で凍ると、ここで c0 のまま時間切れになる）
    let c1 = 0
    await expect
      .poll(
        async () => {
          c1 = await outflowCount(page, clip)
          return c1 - c0
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(OUTFLOW_MIN_PX)
    // t2: 同じカメラのまま、さらに増える（最初に描いた 1 回で凍ると、ここで c1 のまま時間切れになる）
    await expect
      .poll(async () => (await outflowCount(page, clip)) - c1, { timeout: 60_000 })
      .toBeGreaterThan(OUTFLOW_GROWTH_PX)
    // 切ると u_showOutflow が 0 になり、降雨の前と同じに戻る
    await page.getByLabel(strings.panel.showOutflow).uncheck()
    await nextFrames(page)
    await expect
      .poll(async () => (await outflowCount(page, clip)) - c0, { timeout: 10_000 })
      .toBeLessThanOrEqual(OUTFLOW_NOISE_PX)
    expect(errors).toEqual([])
  })

  test('領域外流出量の説明のアイコンに Tab で焦点を移すとツールチップが出る。水深の凡例の注記と ○・流出の凡例が出る（§3.6・§4.1・§4.2）', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    const help = page.getByRole('button', { name: strings.stats.outflowHelpLabel })
    await tabTo(page, help, 80)
    await expect(page.getByRole('tooltip')).toHaveText(strings.stats.outflowHelp)
    await expect(page.getByTestId('water-legend-note')).toHaveText(strings.legend.waterThinNote)
    await expect(page.getByRole('img', { name: strings.legend.markersAria })).toBeVisible()
    await expect(page.getByRole('img', { name: strings.legend.outflowAria })).toBeVisible()
  })
})
```

- [ ] **Step 4: 回して、実測を控える**

Run: `pnpm build && pnpm exec playwright test --project=chromium tests/e2e/explanations.spec.ts`
Expected: 6 passed。次のときは直してから進む:
- あふれ出し点のテストが `no-marker` で時間切れ: フィクスチャ（渋谷に全タイル同じ DEM1A）に表示対象の窪地が無い。パネルの「表示対象」の件数を確かめ、0 ならコーディネーターに知らせる（地点を変えるかは裁定）
- 最低点が見つからない: 範囲の端の ○ がたたんだパネルの見出しに隠れていないか（`BOTTOM_BAR_PX` を見直す）
- 流出の画素のしきい値に届かない: 実測の `c1 − c0` と `c2 − c1` を控え、しきい値を実測の半分以下にする（しきい値を下げる理由を報告に書く）。3D で `c1 − c0` が 0 のままなら、M1 の凍る不具合（または `u_showOutflow`・`nearest` が渡っていない）を疑う

実測（3 回）の `c0`・`c1 − c0`・`c2 − c1`・切った後の差（2D・3D）を報告に書き、各しきい値のコメントに「実測 … 」を足す。

- [ ] **Step 5: ゲート（E2E の全件）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（ユニットは 823 件のまま）

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 49 passed（43 + 6）

- [ ] **Step 6: コミット**

```bash
git add tests/e2e/explanations.spec.ts tests/e2e/support/app.ts tests/e2e/support/png.ts tests/e2e/view3d.spec.ts
git commit -m "spec 07 Task 9: E2E（○ の説明・2D と 3D の流出の帯〈3D は t1 < t2〉・ツールチップ）"
```

---

### Task 10: fps の「後」を測り、前と比べる（spec 07 §6、計画で決めたこと 16）

**Files:**
- Modify: `docs/perf/<実行日>-outflow.md`（Task 1 で作ったもの）

**Interfaces:**
- Consumes: Task 1 の組と「前」の記録
- Produces: 判定（セルごとの中央値の差が 0.5 fps 以内か）

- [ ] **Step 1: 「後」を測る（バックグラウンド。E2E と同時に回さない）**

Run（バックグラウンド）:

```bash
pnpm build:perf && \
RAINTRACE_FPS_SET=outflow-500 RAINTRACE_FPS_SITES=shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/07-perf/after pnpm perf:fps tests/perf/fps.perf.ts -g 'fps の測り直し' && \
RAINTRACE_FPS_SET=outflow-1000 RAINTRACE_FPS_SITES=shibuya,minatomirai RAINTRACE_FPS_OUT_DIR=.handoff/07-perf/after pnpm perf:fps tests/perf/fps.perf.ts -g 'fps の測り直し'
```

Expected: 2 回とも `1 passed`。機器の仕様を `.handoff/07-perf/after/machine.txt` に書く（前と同じ機械であることを確かめる）

- [ ] **Step 2: 前後を比べて書く**

`docs/perf/<実行日>-outflow.md` に「後」の表（`outflow-500.md`・`outflow-1000.md` の中央値の表）と、次の比較の表を足す:

```markdown
## 後（<コミット>）

<中央値の表>

## 前後の比較（平均 fps の中央値）

| 地点 | 範囲 | 条件 | 前 | 後 | 差 | 判定（0.5 fps 以内） |
|---|---|---|---:|---:|---:|---|
| 渋谷 | 500 m | 2D | … | … | … | ○ / × |
| …（2 地点 × 2 範囲 × 2 条件 = 8 行） |

- 長いフレームと g2 の本数も前後で並べて、増えていないかを書く
- 沿岸（みなとみらい）の帯のセル数（無効セルの縁の分だけ多い）を、`buildOutflowCells` の band の長さとして 1 回だけ控える（任意。計測用のフックは足さない。分からなければ「未計測」と書く）
```

- [ ] **Step 3: 判定の分岐**

- すべて ○: Step 4 へ
- 2D だけ ×: 2D の転送は既に「塗るセルが変わった描画だけ」（計画で決めたこと 7）。これ以上の手当ては spec に無いので、**コーディネーターに知らせて止まる**（数字と、`paintOutflow` が true を返した描画の割合の見込みを添える）
- 3D が ×: spec に手当てが無い。**コーディネーターに知らせて止まる**（頂点ごとの texelFetch の増加〈1000 m で約 106 万頂点〉が原因の候補）

- [ ] **Step 4: `dist` を通常のビルドに戻し、コミットする**

Run: `pnpm build && pnpm size`
Expected: 成功。初期ロード 500 KB 以下（値を記録に書く）

```bash
git add docs/perf/<実行日>-outflow.md
git commit -m "spec 07 Task 10: 流出の帯の fps の前後（2D・3D、渋谷・みなとみらい、500・1000 m）"
```

---

### Task 11: tech-spec・spec の状態・完了条件の照合・PR の下書き（spec 07 §8）

**Files:**
- Modify: `specs/tech-spec.md`（§8.3・§9.3・§9.6、新しい §9.7）
- Modify: `docs/superpowers/specs/2026-09-27-07-explanations-design.md`（Status の行だけ）
- Create（gitignore）: `.handoff/07-explanations-pr.md`

**Interfaces:**
- Consumes: Task 1〜10 の結果
- Produces: 文書

- [ ] **Step 1: tech-spec §8.3 を直す**

`specs/tech-spec.md` §8.3 の `display` の型に足し、矢印の間隔の型を直す（計画で決めたこと 17）:

```ts
    showFlowVectors: boolean
    flowVectorSpacingM: 10 | 20   // 範囲 500 m での間隔。実際の間隔は 値 × 範囲 ÷ 500（実装 spec 05 §3.3）。保存済みの 5 は 10 として読む（R06-11）
    showOutflowCells: boolean     // 既定 true。流出しているセルの表示（実装 spec 07 §5.3）
```

型の下の段落の最後に足す: 「`showOutflowCells` は実装 spec 07 で足した任意の項目で、v0.2.0 の保存値には無い。欠けていれば既定の `true` で補い、他の設定（注意事項の了解を含む）を捨てない。型が違えば、ほかの項目と同じく全体を捨てる。形は変わらないので `schemaVersion` は 1 のまま。」

- [ ] **Step 2: tech-spec §9 に足す**

§9.3 の主要コンポーネントの表に 3 行足す（`CellInfoPopover` の行の後）:

```markdown
| `MarkerInfoPopover` | 地図の ○（最低点・あふれ出し点）の説明と数値（実装 spec 07 §3） | `Popover`, `Divider` |
| `MarkerLegend`・`OutflowLegend` | ○ の 2 色と流出の帯の凡例（実装 spec 07 §3.6・§5.3） | `Box`, `Typography` |
```

`DisplaySettings` の行の「主な MUI 要素」の説明に「流出しているセルのスイッチ（実装 spec 07）」を足す。`StatisticsPanel` の行に「領域外流出量のツールチップ（`Tooltip`・`IconButton`）」を足す。

§9.6 の末尾に足す: 「実装 spec 07 で、注意事項に 4 行目『範囲の端や標高データの無い場所に達した水は、範囲の外へ流れ出たものとして扱います。』を足した（R07-3）。」

§9.6 の後に新しい節を足す:

```markdown
## 9.7 地図の印の説明と流出の表示（実装 spec 07）

- **地図の ○**: 青は最低点（範囲の中で標高が最も低い有効セル）、オレンジはあふれ出し点（有意な窪地ごとの spill セル）。クリック（±4 px の矩形で `queryRenderedFeatures`）で説明と数値のポップオーバーを開く。重なった ○ は 1 つのポップオーバーに、最低点を先、あふれ出し点は窪地の id の昇順で並べる。○ の上ではカーソルを指の形にする。3D でも同じ（circle は地形に焼かれず直接描かれる）。色は `src/map/overlayColors.ts` の 1 か所に置き、地図と凡例が共有する
- **水が減る理由**: エンジンに排水の項は無く、水が減るのは範囲の端と無効セル（海・データ欠損）への流出だけ（§6.6、base-spec §18）。統計の「領域外流出量」にツールチップで説明を付け、水深の凡例に「1 cm 未満は表示しない」の注記を置く
- **流出しているセルの帯**: 「近傍（FlowSolver の近傍の表）にグリッドの外か無効セルを含む有効セル」のマスクを地形の読み込みのときに Worker で 1 回だけ作り（`src/simulation/outflowCells.ts`。地形の解析と同じく `TerrainPayload.outflow` で Transferable として送る）、マスクのセルから範囲の一辺の 1% の帯（多始点の幅優先探索の `nearest`）を広げる。描画のたびに、`nearest` の指すマスクのセルの水深が 1 mm 以上の帯のセルを赤紫（#c2185b、不透明度 0.9）で塗る。帯の内側のセルそのものは流出していないので、凡例は「この辺りから範囲の外へ流出中」とする
  - 2D は canvas ソース `water-outflow`（2D の水深の直後）。塗るセルが変わった描画だけ転送する
  - 3D は水面の Custom Layer のシェーダで描く（`u_outflowNearest` は R32F に平らな添字、smooth の varying を 0.5 で切る）。3D で canvas の raster を地形に貼ると、RenderToTexture のキャッシュで再生中に更新されない（maplibre-gl-dev.mjs 22990 ほか。spec 07 §5.2）ため
  - 表示の切り替えは `display.showOutflowCells`（§8.3）。性能は `docs/perf/<実行日>-outflow.md`
```

- [ ] **Step 3: spec 07 の Status を更新する**

`docs/superpowers/specs/2026-09-27-07-explanations-design.md` の 3 行目（`- Status: …`）の末尾に「。実装済み（`feat/07-explanations`、計画 `docs/superpowers/plans/2026-09-29-07-explanations.md`）」を足す（本文は変えない）。

- [ ] **Step 4: 完了条件を照合する（ブランチ全体）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm licenses`
Expected: すべて成功。ユニット 823 件

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 49 passed

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下（Task 1 の基準との差を控える）

spec 07 §7.1 の各項目がどのテストに当たるかを、報告に表で書く（`reduceClick`・`markerFeatures`・`outflowBoundaryMask`・`outflowNearest`・2D の塗り分け・水面の uniform・保存値・`MarkerInfoPopover`・`StatisticsPanel`・`WaterLegend`・`MarkerLegend`）。

- [ ] **Step 5: 【手動・ユーザー】スマートフォンの幅の確認（spec 07 §7.3）**

コントローラーに次を渡す（実装役はユーザーに直接送らない）: 「`pnpm build && pnpm preview --port 4173` で開き、スマートフォン（または開発者ツールの端末の幅）で、地点を選んでパネルをたたみ、○ をタップすると説明が開くこと、統計の情報アイコンをタップするとツールチップが開くことを確かめてください。」結果が届いたら報告に書く。

- [ ] **Step 6: PR の本文を下書きする（gitignore）**

`.handoff/07-explanations-pr.md` に、プロジェクトの PR の書き方（`writing-pr-descriptions` の skill を使う）で書く:
- 概要: spec 07（地図の ○ の説明、水が減る理由の説明、流出の帯の 2D・3D の表示）。ユーザーの疑問（2026-09-27）と裁定 R07-1〜R07-5
- コミットの一覧（Task 1〜11）
- spec との差異（計画で決めたこと 1〜3・5・7・12。特に: 流出の表を Worker で作り `TerrainPayload.outflow` で送ること〈spec §5.1 の「メインスレッドで作る」「メッセージを変えない」からの逸脱。コーディネーターの指示〉、数値の引き先が `SimulationClient.terrain` であること、2D の転送を最初から「変わった描画だけ」にしたこと、帯の太さの読み方、`u_outflowColor` を足したこと、情報アイコンの自作）
- **既存挙動の変更**: `CellInfoPopover` は印の説明のときに開かない。保存値に `display.showOutflowCells` を足した（v0.2.0 の保存値はそのまま読める）。注意事項に 1 行を足した（了解済みの利用者にダイアログを出し直すことはしない）
- fps の前後の表（Task 10）と初期ロードの差
- E2E の 3D の t1 < t2（M2）の実測
- 手動確認（Task 11 Step 5）の結果
- 末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

ユーザーが push と PR をまとめて行うので、`.handoff/07-explanations-pr.md` の先頭に、実行する順のコマンド（`git push -u origin feat/07-explanations`、`gh pr create --base main --head feat/07-explanations --title "…" --body-file .handoff/07-explanations-pr.md`）を書く。

- [ ] **Step 7: コミット**

```bash
git add specs/tech-spec.md docs/superpowers/specs/2026-09-27-07-explanations-design.md
git commit -m "spec 07 Task 11: tech-spec §8.3・§9（印の説明と流出の表示）、spec 07 の状態"
```

---

## レビュー役のチェックポイント（ブランチ全体、Task 11 の後）

実装役は Task 11 の報告に次をまとめ、コントローラーがレビュー役（raintrace-7e）に渡す。**承認まで PR の本文を確定しない**（ユーザーの push はその後）。

1. `git log --oneline 4d3ec34..HEAD`（Task 1〜11 の 11 コミット）と `git diff --stat 4d3ec34..HEAD`
2. ゲートの結果（ユニット 823 件・E2E 49 件・`pnpm size` の初期ロード・`pnpm depcheck`・`pnpm licenses`）
3. fps の前後の比較の表（Task 10）
4. E2E の実測（Task 9 Step 4 の c0・c1 − c0・c2 − c1）
5. 計画で決めたこと 1〜17 のうち、実装の中で変えたもの（無ければ「無し」）
6. 手動確認の結果（Task 11 Step 5）

レビューの指摘は、この計画の書式で追加の Task（12 以降）として足し、同じブランチで直す。

---

## 計画の見直し（自己レビュー）

- **spec の網羅**: §3.1〜§3.6（Task 3・4・9）、§4.1〜§4.3（Task 5・9）、§5.1（Task 2・7）、§5.2 の 2D（Task 7・9）と 3D（Task 8・9）、§5.3（Task 6・7・8）、§6（Task 1・10、各 Task の `pnpm size`）、§7.1（Task 2〜8）、§7.2（Task 9。重なった ○ の並びはユニット〈`reduceClick`・`MarkerInfoPopover`〉で確かめ、E2E では探さない）、§7.3（Task 11 Step 5）、§8（Task 11）。must-fix M1（3D は canvas を使わずシェーダで描く。Task 8）、M2（3D の t1 < t2。Task 9）、推奨 R2（`confirm` の no-op。Task 3）、R3（FlowSolver の近傍の表。Task 2 のテスト）、R4（`setWater(null)` で消す。Task 7・9）、R5（discard と塗りを同じ `v_outflow` で。Task 8）、軽微 m1（3D のクリックと垂直強調。Task 9）、m2（型違いは null。Task 6）、m3（同じ座標の 2 つの ○。`sortMarkers` が id で分ける。Task 3）、m4・m7（沿岸を fps に含める。Task 1・10）、m6（決定的な幅優先探索。Task 2）
- **spec と違えたところ**（PR の「spec との差異」に書く）: §5.1 の「メインスレッドで作る」「メッセージを変えない」→ Worker で作り `TerrainPayload.outflow` で送る（冒頭の「spec からの逸脱」、計画で決めたこと 1）、§3.3 の数値の引き先（計画で決めたこと 3）、§5.2 の uniform の数（`u_outflowColor` を足す。5）、§6 の「超えたら転送を絞る」を最初から行う（7）、§4.1 の `InfoOutlined` を自作の形にする（12）
- **型と名前の一貫**: `OutflowCells { mask, nearest, band }` と `TerrainPayload.outflow`（Task 2 → 7・8）、`MarkerRef`（Task 3 → 4）、`MarkerInfoRow`（Task 4）、`WATER_LAYER_IDS.outflow`（Task 7 → 9）、`WaterOutflow { nearest, rgb, opacity, minDepthM }`（Task 8 の renderer と `outflowLayerSpec`）、`showOutflowCells`（保存値）/`showOutflow`（`View3dInit`・`WaterLayerOptions`）/`setOutflowVisible`（2D の `WaterOverlay`・`SimulationSession`）/`setShowOutflow`（3D の `View3d`・`WaterLayer`・`View3dLike`）
- **まだ確かめていない前提**（実行の中で確かめ、外れたら分岐に従う）: フィクスチャに表示対象の窪地があること（Task 9 Step 4）、E2E の流出の画素のしきい値（Task 9 Step 4 で実測に合わせる）、`createSvgIcon` の子に複数の要素を渡せること（Task 5。渡せなければ `SvgIcon` に `<path>` を 1 本〈丸と i を 1 つの d で描く〉にする）、jsdom が `style.backgroundColor` の #rrggbb を `rgb(…)` に直すこと（Task 4・6。直さなければ期待値を `#1565c0` の形にする）
