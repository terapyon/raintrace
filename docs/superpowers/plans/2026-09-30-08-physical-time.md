# Spec 08 物理時間の降雨と水の流れ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** シミュレーションに物理時間を持たせる。流れの式を 4 近傍の局所慣性式（θ 重み付け・Manning の摩擦・適応的な dt）に替え、雨を「時間雨量 × 継続時間」（円または範囲全体）で時間刻みごとに降らせ、経過時間・降雨の状態・累積雨量・流出の速さを表示し、再生速度を実時間の倍率にする（spec 08、R08-1〜R08-12、§13.1 の N1〜N10、§13.2 の Q1 = (a)）。

**Architecture:** エンジン（`src/simulation/`）は面（セルの境）に単位幅流量 `qx`・`qy` を置く staggered grid で、1 step は「面の流量の更新（`updateFaceFlows`）→ 正値の制限（`limitOutflows`）→ 水深の更新（`applyFaceFlows`）→ 雨の投入 → 走査範囲の更新」。dt はエンジンが毎 step 決め（`timeStep`。雨の終わりで切る）、`StepStats` に経過時間・dt・降雨の状態・累積雨量・流出の速さ・停止の理由を載せる。窪地解析（Priority-Flood）は 4 近傍にし、D8 の流向は 8 近傍のまま。Worker のスケジューラは step 数ではなくシミュレーションの時刻を目標に回し（実時間の倍率）、frame に実際の倍率を載せる。UI は雨の入力（時間雨量・継続時間・範囲全体）と、統計の新しい行・停止の文言を持ち、URL（`mmh`・`dur`・`all`）と localStorage（`schemaVersion: 2`、v1 は雨量だけを既定に戻す）を改める。

**Tech Stack:** spec 01〜07 の構成（Vite 8.2.2、React 19、MUI 9、zustand 5、MapLibre GL 6.6.0、three 0.185.1、TypeScript 6、Vitest 4、fast-check 4.9.0、Playwright 1.62、Biome）。**依存は足さない**

**Spec:** `docs/superpowers/specs/2026-09-29-08-physical-time-design.md`（承認 b119f47。M0 の結果〈§12.1〉と裁定〈§13.1 の N1〜N10、§13.2 の Q1 = (a)〉を 6f6906d まで反映。これが正）。数値の生データはハンドオフの `.handoff/08-m0-report.md`（gitignore）、試作は `scripts/proto-08/`（`li.ts` が §3 の式の参照実装。構造は流用するが、spec と違う所は spec に従う。**計画の最後〈Task 19〉に消す**）。レビューの記録は `.handoff/08-spec-review-1.md`。書式と慣習は `docs/superpowers/plans/2026-09-29-07-explanations.md`（以下「07 の計画」）

**前提:** ブランチ `feat/08-physical-time`（6f6906d。`feat/07-explanations`〈ba9cc26、承認済み・未 push〉の上に積んだ spec 08 と M0 の試作のコミット）。本計画の Task 1 はその次のコミットから。計画そのものはコーディネーターがコミットする。**ブランチは 1 本、PR は最後に 1 つ（base は `feat/07-explanations`）**。マイルストーン M1〜M5（spec §11。M0 は済み）の最後の Task の後に、レビュー役のチェックポイントを置く。push と PR はユーザーが行う（07 を先に push し、その後に 08。PR の本文は gitignore の `.handoff/08-physical-time-pr.md` に下書きする）

**spec の既知の食い違い（コーディネーターが spec から消す、2026-09-30）:** §9.1 の表の「満水との一致」の行に「止め方は上の平衡のテストの止め方。」（0.1 mm/h）と「止め方は上の満水との一致の形（水深の変化 < 3 mm/h …）」の 2 文がある。**正しいのは後者（3 mm/h・地形ごとの `manningN`・入れ子の窪地は 12 × 12）**。本計画は後者で書く。

## Global Constraints

- Node 24、pnpm 12.1.0。**依存を足さない**。`pnpm-workspace.yaml` の `minimumReleaseAge: 14400`・`minimumReleaseAgeStrict: true`（10 日のクールダウン）は変えない。`pnpm install` が lockfile を書き換えたら止めて知らせる
- 書式と lint は Biome（2 スペース、シングルクォート、セミコロンなし、行幅 100）。**画面に出す文字列は `src/ui/strings.ts` にだけ置く**（tech-spec §9.4）。コメントとテスト名は日本語。利用者に見える文はすべて日本語
- 層の規則（tech-spec §4.2、`.dependency-cruiser.mjs`）:
  - `src/simulation/`・`src/dem/`・`src/shared/` は相対 import に `.ts` を付ける。simulation・dem は純粋（自ディレクトリの外に依存しない。`console`・`performance` も使わない）
  - `src/renderer/`・`src/state/`・`src/shared/` は simulation・dem から**型だけ**を import する。`src/map/`（テストを除く）は simulation・shared から**型だけ**
  - ui から simulation の**値**を import しない（07 と同じ。停止の上限「6 時間」などの文言は `strings.ts` に書き、定数の名前をコメントで示す）
  - Worker（`src/workers/`）は simulation・dem・shared と `src/workers/` 以外を import しない（simulation の値は import してよい。`ARROW_MIN_VELOCITY_M_PER_S` など）
  - **dependency-cruiser の規則は足さない・変えない**。エントリから届かないモジュールを作らない（`not-reachable-from-entry`）。そのため、新しい流れの式は `src/simulation/FlowSolver.ts` に足し（Task 3。モジュールはすでに届く）、新しいファイルは作らない
  - 循環 import を作らない
- 大きな配列を React の state・props・context、zustand のストアに載せない（tech-spec §2 原則 2）
- `src/simulation/` は `tsconfig.sim.json` で `noUncheckedIndexedAccess: false`（添字に `!`・`??` を付けない）。ほかの層とテストは `true`（テストでは `?? 0` などで受ける）
- **単体テストに実時間（壁時計）の判定を書かない**（07 の教訓）。時間はシミュレーションの秒（`timeS`）と step 数で見る。スケジューラのテストは偽の時計だけを使う。テストの時間の上限（vitest の timeout）は判定ではないので置いてよい
- **§9.1 の満水との一致の許容は後から黙って緩めない**（M0 の承認の軽微 m2、コーディネーター 2026-09-30）。池の外の最大水深（試作 3.36 mm）の許容 5 mm に対する余裕は小さい。本物のエンジンで外れたら、**許容を広げる前に止め方の閾値（3 mm/h → 2 mm/h）か `manningN` を動かし**、動かした値と実測を報告に書いてレビュー役に渡す。許容（池 1 cm・池の外 5 mm）を変えるのはレビュー役とコーディネーターの裁定の後だけ（Task 6）
- **各 Task の終わりのゲート**: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
  - ユニットテストは計画の作成時点で **826 件・88 ファイル**（2026-09-30 に `pnpm test` で確認）。各 Task の報告に件数を書く
  - **E2E は各マイルストーンの最後の Task（Task 9・11・14）と Task 19 で回す**: `pnpm build && pnpm exec playwright test --project=chromium`（ポート 4173、**フォアグラウンド**）。計画の作成時点で **49 件**（`pnpm exec playwright test --list --project=chromium`）。途中の Task では回さない（計画で決めたこと 23）
  - 実行時のコード（`src/` の本番の経路）を変えた Task ではバンドルも見る: `pnpm build && pnpm size`。**初期ロードの上限 500 KB**。計画の作成時点の値は **422.6 KB**（07 の最終、`docs/perf/2026-09-29-outflow.md`）。Task 1 の Step 1 で取り直す。1 Task で +3 KB を超えたら原因を報告に書く
- カバレッジの閾値（`vitest.config.ts`）: `src/simulation/**` 90%、`src/dem/**` 85%、`src/state/**` 80%（変えない）
- **計測の実行**（Task 1・9・16）: Node のベンチマークは `pnpm bench:engine`。ブラウザの計測は `pnpm build:perf` の後に `pnpm perf:fps …`（`playwright.perf.config.ts`、**ポート 4175**、実 GPU の headless Chrome、workers 1）。**E2E（4173）と同時に回さない**。計測どうしも同時に回さない。**10 分を超える実行はバックグラウンドで回して終わりを待つ**（Bash の上限は 10 分）。計測の後は `pnpm build` で `dist` を通常のビルドに戻す。要約は `docs/perf/<Task 1 の実行日>-physical-time.md` にコミットし、生の JSON は gitignore の `.handoff/08-perf/` に置く。機器の仕様（`nproc`・`nvidia-smi --query-gpu=name,driver_version --format=csv,noheader`・その日の `uptime` の load average）を添える
- **性能の基準は置かない**（R08-9）。記録だけで、見積もり（spec §7.2）との差を書く。判定・「遅ければ知らせる」はしない
- 1 Task 1 コミット。コミットメッセージは日本語で、末尾に `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` を付ける（下の各 Task のコミット例では省略しているが、必ず付ける）。push はしない
- 【手動・ユーザー】の手順は、実装役がユーザーに直接送らない。コントローラーに渡し、コントローラーがユーザーに送る

## Review Focus

spec が明示していないが、使う人に最も効きそうな入力・状態（多い順）。各行のテストを担当の Task に足してある。

1. **範囲の端・海で切れる円の雨と、無効セルのある範囲全体の雨（沿岸）**: 投入の総量は、円なら `I·T·πr²·|S|/|C|`（R04-8 の割合）、範囲全体なら `I·T·有効セル数·A`（無効セルには降らない）。Task 8 の「降雨の総量」に西の端で切れる円と、無効セルを含む範囲全体の雨を足した
2. **実行の途中で Reset → もう一度開始**: 経過時間・雨の登録・流量・スケジューラの目標の時刻がすべて 0 から始まり、前の実行の目標で一気に進まない。Task 5（エンジンの `reset`）と Task 10（スケジューラの `rewind`）にテストを足した
3. **「最速」から「実時間」へ切り替える**: 「最速」で進んだ分の目標が残って、切り替えた直後に一気に進むことはない（`setSpeed` は目標を今の時刻に戻す）。Task 10 にテストを足した
4. **URL に古い `mm` と新しい `mmh` が両方ある（手で継ぎ足した共有 URL）**: `mmh` を使い、`mm` は読まず、次に URL を書くときに消える。Task 12 にテストを足した
5. **「範囲全体に降らせる」をオンにしたまま、半径の欄に不正な値が入っている**: 半径の検証をしないので開始でき、保存値の半径は壊れない（前の有効な値のまま）。オフに戻すと欄のエラーが出て開始できない。Task 12 にテストを足した

## 計画で決めたこと（spec と指示に無い細部）

レビュー役とコーディネーターが確かめられるよう、ここにまとめる。

1. **Task の順序と、古い満水との一致のテストの一時的な削除**: 窪地解析の 4 近傍化（Task 2）を先に入れると、8 近傍の旧エンジンと 4 近傍の `F` を比べる旧 `fillMatch.test.ts` は意味を失い、実際に落ちる（計画の作成時に試して確かめた: 「凹凸と無効セル」で `H` が `F` を 2 cm 下回る）。そこで **Task 2 で旧 `fillMatch.test.ts` を消し、Task 6 で 4 近傍の `F` と局所慣性式で書き直す**。間の Task 3〜5 では満水との一致のテストが無い
2. **新しい流れの式は、まず `FlowSolver.ts` に旧い式と並べて足す**（Task 3）。新しいファイルはエントリから届かない（`not-reachable-from-entry`）ので作らない。旧い式（`solveStep`・`computeFlowVectors`・`FLOW_K`・`NEIGHBOR_WEIGHT`）は Task 5 のエンジンの差し替えで消し、`NEIGHBOR_DX`・`NEIGHBOR_DY` を 4 近傍の面の表（北・西・東・南）にする（spec §3.7、レビュー 1 の R1）
3. **M1 の間の暫定の橋渡し**: Task 5 で `RainfallInput` の形が変わるが、UI の雨の入力は M3 で替える。それまで `SimulationSession.start(amountMm, radiusM)` は `{ intensityMmPerH: amountMm, durationS: 0, wholeRange: false }`（今までと同じく開始のときに一度に置く）を送る。Task 12 で消す
4. **自動停止の判定を `stopReason !== null` にするのは Task 5**（`StepStats` の形が変わる Task）。スケジューラの時間の扱い（倍率）とそのテストの書き直しは Task 10
5. **`durationS = 0` の雨**（spec §4.2 の「開始のときに一度に置く。テスト用」）: `intensityMmPerH` を「一度に置く雨の量（mm）」と読む。`raining` は常に false、`rainDepthMm` はその量（mm）、雨の終わりの時刻 `T_rain` は 0（雨の後の上限 6 時間は開始から数える）
6. **`reset` は地形と窪地の一覧を残し、雨の登録を消す**。spec §9.3 の「地形と雨の登録は残らない」は、今の `reset`（地形を残す。Worker は開始のたびに `reset` してから雨を置く）と合わないので、「雨の登録は残らない」と読んだ
7. **正値の制限で水をすべて出すセル**（spec §3.5 の「最後の面に残りを渡してちょうど 0」）: 試作 `li.ts` と同じく、そのセルの新しい水深を「入ってくる量だけ」にして自分の水をちょうど 0 にする（出る面の流量は `h_i / out_i` 倍に縮めたもの）。質量の誤差は倍精度の丸めの桁（M0 で 1e-13 m³ 以下）
8. **雨の終わりの step の時刻は `T_rain` をそのまま代入する**（`t + (T_rain − t)` は丸めで `T_rain` に戻らないことがある）。spec §9.3 の「その step の `timeS` が継続時間にちょうど等しい」を満たすため
9. **雨の投入**: 各 step の水深の更新の後に、登録したセルに `ρ·dt` を足す。円と範囲全体を同じ形（セルの一覧と速さ）で持ち、範囲全体はすべての有効セルの一覧にする（`planRainSchedule`。Task 4）。範囲全体の雨で有効セルが 1 つも無ければ `NoElevationAtRainCenterError`
10. **θ 重み付けの両隣の読み方**: グリッドの端の面の隣は `q_f` 自身、走査範囲の外の隣の面は保存されている値（§3.8 の不変条件で 0）をそのまま読む。spec §3.2 と同じ結果になる（試作は走査範囲の端で `q_f` 自身を使っていたが、その面は必ず乾いていて 0 になるので、結果は変わらない）
11. **テスト用のエンジンの口**（`SimulationEngine` のインターフェースには足さず、`TsSimulationEngine` だけに置く）: `setInitialWater(depth)`（静水の保存、重力波）、`faceFlows()`（`qx`・`qy`・`hfx`・`hfy` の読み取り。フルード数・有限・走査範囲の外の確かめ）、`scanWindow()`
12. **`EngineOptions` の検証**: `manningN`・`settleVelocityMPerS` が有限で 0 以上でなければ `RangeError`
13. **`cap` の停止のテスト**: spec の例「摩擦を極端に小さくした静振」は θ 重み付けで数分で収まる（M0）ので、`settleVelocityMPerS: 0`（`EngineOptions`）で「止まらない条件」を作る
14. **平衡のテストの止め方**（spec §9.1）はテストの補助関数 `runUntilQuiet(engine, 閾値, 上限の step)`（`fixtures.test-support.ts`）。雨の後に `waterDepth()` の前後の差の最大 ÷ `dtS` が閾値未満で止め、上限の step で届かなければ例外。閾値は `QUIET_EQUILIBRIUM_M_PER_S`（0.1 mm/h）と `QUIET_FILL_M_PER_S`（3 mm/h）
15. **満水との一致の時間**: 各テストの timeout を 30,000 ms にし、Task 6 で `--reporter=verbose` の時間（単独のファイル）を測る。1 つでも 750 ms（× 40 で 30 秒）を超えたら、その地形だけ `fillMatch.slow.test.ts`（timeout 120,000 ms）に移す（spec §9.1）
16. **§9.3 の物理のテストは新しいファイル `src/simulation/physics.test.ts`**（Task 8）。「降雨の総量」は全部の組み合わせ（3 × 3 × 3 × 4 = 108 通り）ではなく、各値を 1 回以上使う 9 通り（重い組は短い継続時間）＋ Review Focus 1 の 2 通り。地形は雨の円より少し広い平らな床を高さ 10 m の壁で囲み、走査範囲を広げない
17. **スケジューラ**（Task 10）: (a) `play` の直後の最初の tick は 1 tick 分（1/60 秒）の実時間を進めたとみなす（どの倍率でも最初の tick で 1 step 以上回す。今の「1x の最初の tick は 1 step」と同じ）、(b) `setSpeed` は目標の時刻を今の時刻に戻す（越えた分・貯めた分を捨てる）、(c) `rewind()` を足し、Runner の `suspend`（開始・Reset・地形の差し替え）で呼ぶ、(d) 既定の速度 `DEFAULT_PLAYBACK_SPEED = 60` を `src/shared/protocol.ts` に置き、Worker と `simulationStore` が使う
18. **速度の文言**: `strings.playback.speedValue(1)` は「実時間」、ほかは「10 倍」「60 倍」「600 倍」（spec §6.2）
19. **継続時間の入力は MUI の `NativeSelect`**（spec の「選択（`Select`）」）。`Select` は `Menu`・`Popover` を静的に読み、ui のチャンクを押し上げる（`RainfallControls.tsx` の `NumberField` のコメントと同じ理由）。`NativeSelect` はブラウザの `<select>` なので、キーボード（上下の矢印）でも選べる
20. **`PlaybackStatus` の `'settled'` は「自動で止まった」状態の名前のまま**（`settled` でも `cap` でも）。文言は `stats.stopReason` で出し分ける。cap の Alert は `severity="info"`、settled は `success`
21. **統計の並び**（spec §6.2 は項目だけ）: 経過時間・降雨・累積雨量・Step・投入水量・領域内の水量・領域外流出量（ツールチップ）・流出の速さ・最大水深・湛水面積・実行速度。累積雨量は「降った量 / 総量」をどちらも mm の整数に**切り捨て**（`16.67 mm` の総量で雨の後に「16 mm / 17 mm」と食い違わないよう、同じ丸めにする）。実際の倍率は四捨五入の整数
22. **降雨の状態と総量の出どころ**: `simulationStore` に今の実行の雨 `run: { intensityMmPerH, durationS } | null` を持たせ、`started(run)` で入れる（統計の `timeS`・`raining`・`rainDepthMm` と合わせて残り時間と総量を出す）
23. **E2E のゲートはマイルストーンの最後**: 雨の形（M1）・速度（M2）・URL と表示（M3）が段階的に変わり、E2E の期待値は M3 の最後（Task 14）でまとめて直す。M1・M2 の最後の E2E は、それぞれの段階の挙動（M1 は一度に置く雨、M2 は新しい速度）で通ることを確かめる
24. **07 の帯の E2E のしきい値の決め直し**（spec §9.4）: 3 回回して `logMeasured` の実測を読み、`OUTFLOW_MIN_PX = floor(3 回の c1 − c0 の最小 ÷ 4)`、`OUTFLOW_GROWTH_PX = floor(3 回の c2 − c1 の最小 ÷ 4)`（どちらも `OUTFLOW_NOISE_PX` の 3 倍 = 90 より大きいこと）。3D の t1 は、60 倍で再生しながら帯の画素数が `OUTFLOW_MIN_PX` を超えるまで待って一時停止する（範囲全体の雨は 1 step が 1 秒前後で、1 step ずつ進めると t1 までの往復が長い）。t1 から t2 は「1 step 進める」を `T2_STEPS` 回（最初 60）。c2 − c1 が 90 以下なら `T2_STEPS` を 180 にして測り直し、それでも増えなければ止めてコーディネーターに渡す（07 の M2 を弱めない）
25. **E2E の 10 番**（範囲全体の雨、spec §9.4）: 「実時間」で開始してすぐ一時停止し、「1 step 進める」で進める。乾いた地形の最初の数 step は dt = 1 秒なので、投入水量 ÷（step 数 × 100 mm/h ÷ 3.6e6）が範囲の有効セルの面積になる。渋谷の 500 m の範囲（無効セルなし）では 200,000〜280,000 m² に入ることを確かめる（範囲の一辺はセルの格子で約 505 m）
26. **計測の口**（Task 15）: `PerfParams.speed`（`speed=1|10|60|600|max`、既定 `max`）、`capMs` の上限を 1,800,000 → 7,200,000 ms、`durationMs`（`ms=`）の上限を 60,000 → 1,800,000 ms（steps の窓 10 分のため）、`StepsReport` に停止の理由・経過時間（シミュレーション）・実際の倍率・dt の中央値と最小（10 Hz の統計の標本）を足し、`minutesAt1x` を外す
27. **fps の「前」**（spec §7.3 の「08 の前〈ba9cc26〉と後を同じ日に測る」）: 07 と同じく一時的な worktree（`git worktree add ../raintrace-08-before ba9cc26`）で `pnpm build:perf` して、古い `mm=500` で測る。終わったら worktree を消す
28. **M4 の計測の上限と範囲**（R08-9。判定しないので、時間で打ち切る）: 1 回の実行の上限 60 分（`RAINTRACE_STEPS_CAP_MS=3600000`）。範囲全体の雨は 500 m を 3 地点、1000 m は渋谷だけ（見積もりで 1 回 2〜4 時間。上限で打ち切った値を「打ち切り」として記録）。1 step の中央値・p95 の行（全面を濡らす雨）は 500 m・1000 m の 3 地点で、窓 10 分（`until=window`）。開始から停止までの行とは別に取る
29. **記録のファイル**: `docs/perf/<Task 1 の実行日>-physical-time.md` を Task 1 で作り（Node のベンチの「前」）、Task 9（Node のベンチの「後」）と Task 16（ブラウザ）で書き足す
30. **Node のベンチマーク**（`scripts/bench-engine.ts`、Task 9）: 03 §5 の 512 × 512 の合成地形に、100 mm/h × 1 時間の 3 つの雨（半径 10 m・100 m・範囲全体）。停止か上限の step 数まで回し、step 数・1 step の中央値と p95・停止の理由・経過時間・dt の最小・中央値・最大・最大水深・質量誤差・所要を出す
31. **`RainfallInput` の検証**は `planRainSchedule`（Task 4）: 時間雨量・継続時間が有限で 0 以上、`wholeRange` が真偽値でなければ `RangeError`（Worker に届く値を信用しない。04 の A7 と同じ）
32. **計測のファイルの URL の書き換え**: spec §9.4 の表の 4 か所（`fps.perf.ts`・`shots.perf.ts`）に加え、`water.perf.ts` の `mm: '500'` も `mmh: '250', dur: '120'` にする（`mm` は読まれなくなるため）。`steps.perf.ts` は Task 15 で雨の組ごと作り直す
33. **E2E の 9 番の継続時間**: `<select>` に焦点を置いて上矢印を 3 回（1 時間 → 10 分）。Linux の Chromium では閉じたままの `<select>` の値が矢印キーで変わる
34. **M1 の旧 `properties.test.ts` の扱い**: Task 5 では最小の直し（雨の形の変換と、局所慣性式では成り立たない最大値原理のテストの削除）にとどめ、Task 7 で §9.2 の形に書き直す

## ファイル構成

| ファイル | 責務 | Task |
|---|---|---|
| `docs/perf/<実行日>-physical-time.md` | Node のベンチ（前・後）とブラウザの記録（§7.3） | 1・9・16 |
| `src/simulation/terrain/neighbors.ts`・`analyzeDepressions.ts`（+ test） | 窪地解析の 4 近傍（D8 は 8 近傍のまま） | 2 |
| `src/simulation/constants.ts`（+ test） | §3.12 の定数。`FLOW_THRESHOLD_M` → `DRY_DEPTH_M`、`DIFFUSION_C` の削除 | 3・5 |
| `src/simulation/FlowSolver.ts`（+ test） | 4 近傍の局所慣性式（面の表・面の流量・正値の制限・水深の更新・dt・流速） | 3・5 |
| `src/simulation/Rainfall.ts`（+ test） | 雨の予定（`planRainSchedule`） | 4・5 |
| `src/simulation/types.ts`、`TsSimulationEngine.ts`（+ test）、`WaterGrid.ts`（+ test） | エンジンの差し替え（§5.1） | 5 |
| `src/simulation/testing/fixtures.test-support.ts` | `runUntilStopped`・`runUntilQuiet`・`instantRain` | 5 |
| `src/simulation/scenarios.test.ts`・`spillEvents.test.ts`・`properties.test.ts` | §9.1 の 4 ケースと平衡水位、越流、性質（Task 5 は最小の直し） | 5・7 |
| `src/simulation/fillMatch.test.ts`（削除 → 新規） | 満水との一致（4 近傍の F） | 2・6 |
| `src/simulation/physics.test.ts`（新規） | §9.3 の降雨・Manning の斜面・重力波・段差・自動停止 | 8 |
| `src/simulation/outflowCells.ts`（+ test） | マスクの期待値を 4 近傍に（Task 5）、`mask` を送らない（Task 11） | 5・11 |
| `scripts/bench-engine.ts` | Node のベンチ（新しい雨の形・停止の理由・dt の分布） | 5・9 |
| `src/workers/simulationRunner.ts`（+ test）、`playbackScheduler.ts`（+ test）、`flowArrows.ts`（+ test）、`terrainResult.ts`（+ test） | Worker（`setRainfall`・時間の倍率・実際の倍率・矢印の下限・`mask` の削除） | 5・10・11 |
| `src/shared/protocol.ts` | `PlaybackSpeed`・`DEFAULT_PLAYBACK_SPEED`・`FrameMessage.simSecondsPerSecond`・`OutflowCells` の形 | 10・11 |
| `src/bridge/SimulationClient.ts`（+ test）、`fakeWorker.test-support.ts` | `FrameView.simSecondsPerSecond`、偽物の統計 | 5・10 |
| `src/state/persistedSettings.ts`・`settingsStore.ts`・`urlState.ts`（+ test） | `schemaVersion: 2`、v1 の読み替え、`mmh`・`dur`・`all` | 12 |
| `src/state/simulationStore.ts`（+ test）、`src/state/displayStats.test-support.ts`（新規） | 実際の倍率・今の実行の雨・越流の `timeS` | 5・10・13 |
| `src/ui/validation.ts`・`format.ts`・`strings.ts`（+ test） | 入力の検証・書式・文言 | 10・12・13 |
| `src/ui/components/RainfallControls.tsx`・`ControlsSection.tsx`（+ test）・`PlaybackControls.tsx`・`StatisticsPanel.tsx`（+ test）・`SpillNotices.tsx`（+ test 新規） | 雨の入力・速度・統計・停止と越流の文言 | 5・10・12・13 |
| `src/ui/simulationSession.ts`（+ test）、`terrainSession.ts`、`perfHook.ts`・`perfWater.ts`・`perfSteps.ts`・`perfReports.ts`・`perfParams.ts`（+ test） | つなぎと計測の口 | 5・12・13・15 |
| `src/map/WaterOverlay.test.ts`、`src/ui/simulationSession.test.ts` | `OutflowCells` の偽物から `mask` を外す | 11 |
| `tests/e2e/simulation.spec.ts`・`view3d.spec.ts`・`explanations.spec.ts`・`smoke.spec.ts` | §9.4 の E2E | 10・14 |
| `tests/perf/fps.perf.ts`・`shots.perf.ts`・`water.perf.ts`・`steps.perf.ts` | 計測の URL と steps の組 | 14・15 |
| `specs/tech-spec.md`、`docs/superpowers/specs/*`（overview・02・03・04・06・07・08） | §8 の文書の改訂 | 17・18 |
| `scripts/proto-08/`（削除） | M0 の試作 | 19 |

## spec 08 との対応（再同期用）

| spec 08 | Task |
|---|---|
| §3.1〜§3.6 局所慣性式・dt・乾湿・正値・フルード数・境界 | 3・5 |
| §3.7 4 近傍（面の表、窪地解析、マスクの期待値、D8 は変えない） | 2・5 |
| §3.8 走査範囲（面の不変条件） | 3・5・7 |
| §3.9 自動停止（R08-6、Q1 = (a)） | 5・8・10・13 |
| §3.10 流れのベクトル（m/s、矢印の下限） | 3・5・8・11 |
| §3.12 定数・`EngineOptions` | 3・5 |
| §4.1〜§4.3 降雨（時間刻みごと、範囲全体） | 4・5・8・12 |
| §5.1 エンジンのインターフェース | 5 |
| §5.2 メッセージ | 10 |
| §5.3 `mask` の削除（偽物 3 つ） | 11 |
| §6.1 再生速度（実時間の倍率） | 10 |
| §6.2 統計と文言（停止 2 つ、越流、1000 m の注意書き） | 12・13 |
| §6.3 入力の検証 | 12 |
| §6.4 URL と localStorage（N1〜N4） | 12 |
| §6.5 07 の表示（ツールチップ、コメント） | 11・13 |
| §7.3 記録（R08-9、N7） | 1・9・15・16 |
| §8 文書 | 17・18 |
| §9.1 平衡（止め方・許容・満水との一致） | 5・6 |
| §9.2 性質 | 7 |
| §9.3 個別 | 3・4・5・8・10・11・12・13 |
| §9.4 E2E と計測の URL | 14 |
| §9.5 手動確認 | 19 |
| §10 完了条件 | 19 |
| §11 進め方（M1〜M5、レビュー） | 各マイルストーンの最後のチェックポイント |

---

# M1: エンジンと窪地解析（spec §11 の M1）

### Task 1: 変更前の記録（Node のベンチマークと初期ロード。spec §7.3 の「08 の前の同じスクリプトの値」、計画で決めたこと 29）

**Files:**
- Create: `docs/perf/<実行日>-physical-time.md`（`<実行日>` は `date +%F`。以後の Task もこのファイルに書き足す）

**Interfaces:**
- Consumes: 今の `scripts/bench-engine.ts`（8 近傍の拡散式、`pnpm bench:engine`）
- Produces: 記録のファイル（Task 9・16 が書き足す）

- [ ] **Step 1: 初期ロードとテストの件数の基準を取り直す**

Run: `pnpm build && pnpm size`
Expected: `初期ロード: 422.6 KB`（±0.1 KB）。違えば、その値を以後の基準として報告に書く

Run: `pnpm test`
Expected: `Test Files  88 passed (88)`・`Tests  826 passed (826)`

- [ ] **Step 2: 今のエンジンのベンチマークを回す（「前」。数分）**

Run: `nproc && nvidia-smi --query-gpu=name,driver_version --format=csv,noheader && uptime && node --version && git rev-parse --short HEAD && pnpm bench:engine 100000`
Expected: 表が 2 行（`半径 10m・100mm`、`半径 100m・100mm`）。列は step 数・中央値・p95・平衡までの step・最大水深・質量誤差・所要

- [ ] **Step 3: 記録のファイルを作る**

`docs/perf/<実行日>-physical-time.md`:

```markdown
# spec 08: 物理時間の降雨と水の流れの性能の記録（<実行日>〜）

- 対応: spec 08 §7.3（R08-9: 性能の基準は置かず、記録だけにする）、計画 `docs/superpowers/plans/2026-09-30-08-physical-time.md` Task 1・9・16
- 機器: <nproc>、<nvidia-smi の行>、Node <version>。load average は各節に書く
- 比べる相手: 08 の前（Node は下の「前」、ブラウザは 06 の tech-spec §14.1 と 07 の `docs/perf/2026-09-29-outflow.md`）と spec §7.2 の見積もり

## Node のベンチマーク（`pnpm bench:engine`）

### 前（<コミット>。8 近傍の拡散式。雨は一度に置く 100 mm。load average <uptime の値>）

<Step 2 の表をそのまま貼る>
```

- [ ] **Step 4: コミット**

```bash
git add docs/perf/<実行日>-physical-time.md
git commit -m "spec 08 Task 1: 変更前のエンジンの Node のベンチマークを記録する"
```

---

### Task 2: 窪地解析を 4 近傍にする（spec §3.7・§9.3「窪地解析（4 近傍）」、R08-2、N9、計画で決めたこと 1）

**Files:**
- Modify: `src/simulation/terrain/neighbors.ts`
- Modify: `src/simulation/terrain/analyzeDepressions.ts`
- Modify: `src/simulation/terrain/analyzeDepressions.test.ts`
- Delete: `src/simulation/fillMatch.test.ts`（Task 6 で書き直す）

**Interfaces:**
- Consumes: なし
- Produces:
  - `NEIGHBOR4_DX: readonly number[]`・`NEIGHBOR4_DY: readonly number[]`（`neighbors.ts`。東・南・西・北）
  - `analyzeDepressions(grid, criteria?)` の起点の判定と走査が 4 近傍になる（型は変わらない）。`fill`・`labels`・`depressions` は 4 近傍の Priority-Flood の値（Task 6・7 が満水の水面 `F₄` として使う）
  - `d8FlowDirection` は変えない（8 近傍の `NEIGHBOR_DX`・`NEIGHBOR_DY` のまま）

- [ ] **Step 1: 失敗するテストを書く**

`src/simulation/terrain/analyzeDepressions.test.ts` の import に `d8FlowDirection` を足す:

```ts
import { d8FlowDirection } from './d8FlowDirection.ts'
```

ファイルの末尾に足す:

```ts
describe('4 近傍の窪地解析（spec 08 §3.7、R08-2）', () => {
  it('斜めにだけ低い所へ抜ける窪地は、4 近傍では窪地になり、spill 標高は 4 近傍の値（8 近傍なら斜めに抜けて窪地にならない）', () => {
    // (2,2) の 1 は、斜め（南東）の (3,3) の 0 を経て、さらに斜めの角 (4,4) の 0（グリッドの端）へ抜ける。
    // 上下左右はすべて 5 なので、水は上下左右の面を通ってしか動けない 4 近傍では 5 まで溜まる
    const grid = gridFromRows([
      [5, 5, 5, 5, 5],
      [5, 5, 5, 5, 5],
      [5, 5, 1, 5, 5],
      [5, 5, 5, 0, 5],
      [5, 5, 5, 5, 0],
    ])
    const { depressions, fill, labels } = analyzeDepressions(grid)
    expect(labels[indexOf(grid, 2, 2)]).not.toBe(0)
    expect(fill[indexOf(grid, 2, 2)]).toBe(5)
    const pit = depressions.find((d) => d.pitIndex === indexOf(grid, 2, 2))
    expect(pit?.spillElevation).toBe(5)
    // (3,3) も上下左右は 5 なので、4 近傍では別の窪地になる（(2,2) とは斜めにしか接しない）
    expect(labels[indexOf(grid, 3, 3)]).not.toBe(0)
    expect(labels[indexOf(grid, 3, 3)]).not.toBe(labels[indexOf(grid, 2, 2)])
  })

  it('無効セルに斜めにだけ接するセルは起点にならない（上下左右で接するセルは起点）', () => {
    const grid = gridFromRows([
      [5, 5, 5, 5, 5, 5],
      [5, 5, 5, 5, 5, 5],
      [5, 5, null, 5, 5, 5],
      [5, 5, 5, 1, 5, 5],
      [5, 5, 5, 5, 5, 5],
      [5, 5, 5, 5, 5, 5],
    ])
    const { depressions } = analyzeDepressions(grid)
    // (3,3) は無効セル (2,2) に斜めにだけ接する。起点にならないので、周りの 5 まで溜まる窪地になる
    expect(depressions).toHaveLength(1)
    expect(depressions[0]).toMatchObject({
      pitIndex: indexOf(grid, 3, 3),
      spillElevation: 5,
      cellCount: 1,
    })
  })

  it('D8 の流向は 8 近傍のまま（斜めの最急の向きを指す。窪地の中から斜めに外を指す矢印を受け入れる。レビュー 1 の m4）', () => {
    const grid = gridFromRows([
      [5, 5, 5, 5, 5],
      [5, 5, 5, 5, 5],
      [5, 5, 1, 5, 5],
      [5, 5, 5, 0, 5],
      [5, 5, 5, 5, 0],
    ])
    // 東から時計回りの 8 近傍（neighbors.ts）の 2 番目 = 南東。D8 の番号は index + 1
    expect(d8FlowDirection(grid)[indexOf(grid, 2, 2)]).toBe(2)
  })
})
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `pnpm vitest run src/simulation/terrain/analyzeDepressions.test.ts`
Expected: FAIL（1 つ目: `labels[(2,2)]` が 0、2 つ目: `depressions` の長さが 0）。3 つ目は PASS

- [ ] **Step 3: 4 近傍の表を足し、窪地解析だけがそれを使う**

`src/simulation/terrain/neighbors.ts` の末尾に足す:

```ts
/**
 * 4 近傍の固定の順序（東から時計回り: 東・南・西・北）。y は南向きが正。窪地解析（Priority-Flood）だけが使う
 * （spec 08 §3.7、R08-2。水の計算〈FlowSolver の面の表〉と同じく上下左右だけでつなぐ）。D8 の流向は地形の表示なので、
 * 上の 8 近傍の表のまま
 */
export const NEIGHBOR4_DX: readonly number[] = [1, 0, -1, 0]
export const NEIGHBOR4_DY: readonly number[] = [0, 1, 0, -1]
```

`src/simulation/terrain/analyzeDepressions.ts`:

- import を `import { NEIGHBOR4_DX, NEIGHBOR4_DY } from './neighbors.ts'` に替える
- `analyzeDepressions` の説明の「起点は、グリッドの端のセルと、無効セルに隣接するセル（03 の境界の扱い R03-2 と揃える）」を「起点は、グリッドの端のセルと、無効セルに上下左右で接するセル（水の計算の仮想セル〈R03-2、spec 08 §3.6〉と揃える）。近傍は 4 近傍（spec 08 §3.7、R08-2）」に替える
- 起点の判定の行を次にする:

```ts
      for (let k = 0; k < 4 && !seed; k++) seed = !isValid(x + NEIGHBOR4_DX[k], y + NEIGHBOR4_DY[k])
```

- 走査のループを次にする:

```ts
    for (let k = 0; k < 4; k++) {
      const nx = cx + NEIGHBOR4_DX[k]
      const ny = cy + NEIGHBOR4_DY[k]
```

- [ ] **Step 4: 旧い満水との一致のテストを消す（計画で決めたこと 1）**

Run: `git rm src/simulation/fillMatch.test.ts`

（8 近傍の拡散式の水と 4 近傍の `F` を比べるテストは意味を失い、実際に落ちる。Task 6 で局所慣性式と 4 近傍の `F` で書き直す）

- [ ] **Step 5: テストが通ることを確かめる**

Run: `pnpm vitest run src/simulation/terrain`
Expected: PASS（既存の窪地解析のテスト〈単一の窪地・峠・端と無効セル・同じ標高の縁・Float32 の丸め〉も 4 近傍のまま通る。計画の作成時に試して確かめた）

- [ ] **Step 6: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 826 − 3（旧 `fillMatch` の 3 件）+ 3 = 826 件・87 ファイル

- [ ] **Step 7: コミット**

```bash
git add src/simulation/terrain/neighbors.ts src/simulation/terrain/analyzeDepressions.ts src/simulation/terrain/analyzeDepressions.test.ts
git commit -m "spec 08 Task 2: 窪地解析を 4 近傍にする（D8 は 8 近傍のまま）。旧い満水との一致のテストは Task 6 で書き直す"
```

---
### Task 3: 4 近傍の局所慣性式の関数と定数を足す（spec §3.1〜§3.6・§3.8・§3.10・§3.12、計画で決めたこと 2・7・10）

旧い 8 近傍の式（`solveStep` など）は Task 5 まで残し、新しい関数を**並べて**足す（エンジンはまだ旧い式を使う）。

**Files:**
- Modify: `src/simulation/constants.ts`
- Modify: `src/simulation/constants.test.ts`
- Modify: `src/simulation/FlowSolver.ts`（ファイルの末尾に足す）
- Modify: `src/simulation/FlowSolver.test.ts`（ファイルの末尾に足す）

**Interfaces:**
- Consumes: なし
- Produces（Task 5 のエンジンが使う。`src/simulation/FlowSolver.ts`）:
  - `FACE_INNER = 0`・`FACE_VIRTUAL_BEFORE = 1`・`FACE_VIRTUAL_AFTER = 2`・`FACE_CLOSED = 3`
  - `interface Faces { width; height; qx: Float64Array; qy: Float64Array; hfx: Float64Array; hfy: Float64Array; kindX: Uint8Array; kindY: Uint8Array; drained: Uint8Array; rowOld: Float64Array }`
  - `createFaces(width: number, height: number, validMask: Uint8Array): Faces`
  - `clearFaces(f: Faces): void`
  - `timeStep(hMax: number, uMax: number, cellSizeM: number): number`
  - `updateFaceFlows(t: TerrainArrays, h: Float64Array, win: ScanWindow, f: Faces, dt: number, cellSizeM: number, manningN: number): void`
  - `limitOutflows(t: TerrainArrays, h: Float64Array, win: ScanWindow, f: Faces, dt: number, cellSizeM: number): void`
  - `applyFaceFlows(t: TerrainArrays, h: Float64Array, next: Float64Array, win: ScanWindow, f: Faces, dt: number, cellSizeM: number): number`（仮想セルへ出た Σq、m²/s）
  - `faceVelocityMax(win: ScanWindow, f: Faces): number`
  - `clearFacesOutside(f: Faces, before: ScanWindow, after: ScanWindow): void`
  - `cellVelocities(t: TerrainArrays, h: Float64Array, win: ScanWindow, f: Faces, out?: FlowVectors): FlowVectors`
  - 定数（`src/simulation/constants.ts`）: `DRY_DEPTH_M = 1e-5`・`GRAVITY = 9.81`・`MANNING_N = 0.03`・`CFL_ALPHA = 0.5`・`THETA = 0.8`・`DT_MAX_S = 1`・`FROUDE_MAX = 1`・`SETTLE_VELOCITY_M_PER_S = 0.01`・`SETTLE_CAP_S = 21_600`・`ARROW_MIN_VELOCITY_M_PER_S = 0.005`

- [ ] **Step 1: 定数のテストを書く**

`src/simulation/constants.test.ts` の import に `ARROW_MIN_VELOCITY_M_PER_S`・`CFL_ALPHA`・`DRY_DEPTH_M`・`DT_MAX_S`・`FROUDE_MAX`・`GRAVITY`・`MANNING_N`・`SETTLE_CAP_S`・`SETTLE_VELOCITY_M_PER_S`・`THETA` を足し、末尾に足す:

```ts
describe('局所慣性式の定数（spec 08 §3.12）', () => {
  it('表の値と一致する', () => {
    expect(GRAVITY).toBe(9.81)
    expect(MANNING_N).toBe(0.03)
    expect(CFL_ALPHA).toBe(0.5)
    expect(THETA).toBe(0.8)
    expect(DT_MAX_S).toBe(1)
    expect(DRY_DEPTH_M).toBe(1e-5)
    expect(FROUDE_MAX).toBe(1)
    expect(SETTLE_VELOCITY_M_PER_S).toBe(0.01)
    expect(SETTLE_CAP_S).toBe(6 * 3600)
    expect(ARROW_MIN_VELOCITY_M_PER_S).toBe(0.005)
  })

  it('α は θ 重み付けの 2 次元の安定の上限 √(θ/2) より小さい（M0 の U2）', () => {
    expect(CFL_ALPHA).toBeLessThan(Math.sqrt(THETA / 2))
  })
})
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run src/simulation/constants.test.ts`
Expected: FAIL（`GRAVITY` などが export されていない）

- [ ] **Step 3: 定数を足す**

`src/simulation/constants.ts` の先頭の説明を「許容誤差・閾値・流れの式の定数（tech-spec §6.6、spec 03 §3.11、spec 08 §3.12）。値を変えるときは tech-spec も改訂する」にし、`DIFFUSION_C` の定義の後に足す（`FLOW_THRESHOLD_M`・`DIFFUSION_C` は Task 5 で消す）:

```ts
/**
 * 面を通れる水の深さ h_f の閾値（m）。これ以下の面の流量は 0（spec 08 §3.4）。R03-3 の θ（水面差の閾値）を
 * 「面を通れる水深の閾値」に読み替えたもの。値は同じ 1e-5 m
 */
export const DRY_DEPTH_M = 1e-5

/** 重力加速度（m/s²） */
export const GRAVITY = 9.81

/** Manning の粗度係数（s/m^(1/3)。R08-3 で全体に 1 つの値に固定。テストは EngineOptions で差し替える） */
export const MANNING_N = 0.03

/** 時間刻みの係数 α。dt = min(DT_MAX_S, α·Δx / max(√(g·h_max), u_max))（spec 08 §3.3。M0 で 0.7 から下げた） */
export const CFL_ALPHA = 0.5

/** de Almeida ほか（2012）の θ 重み付け（spec 08 §3.2。M0 で採用。EngineOptions には出さない） */
export const THETA = 0.8

/** 時間刻みの上限（s。spec 08 §3.3。降り始めの表示の細かさを決める） */
export const DT_MAX_S = 1

/** フルード数の上限。|q| ≤ FROUDE_MAX·h_f·√(g·h_f)（spec 08 §3.5） */
export const FROUDE_MAX = 1

/** 自動停止: 雨が終わっていて、すべての面の流速がこれ未満なら settled（m/s。R08-6、§13.2 の Q1 = (a)） */
export const SETTLE_VELOCITY_M_PER_S = 0.01

/** 自動停止の上限: 雨がやんでからこの時間（s）で止める（6 時間。R08-6） */
export const SETTLE_CAP_S = 21_600

/** 水の流れの矢印を出す流速の下限（m/s。spec 08 §3.10） */
export const ARROW_MIN_VELOCITY_M_PER_S = 0.005
```

- [ ] **Step 4: 定数のテストが通ることを確かめる**

Run: `pnpm vitest run src/simulation/constants.test.ts`
Expected: PASS

- [ ] **Step 5: 局所慣性式の関数の失敗するテストを書く**

`src/simulation/FlowSolver.test.ts` の import を次にする（旧い import は Task 5 で整理する）:

```ts
import { describe, expect, it } from 'vitest'
import {
  CFL_ALPHA,
  DT_MAX_S,
  FLOW_THRESHOLD_M,
  FROUDE_MAX,
  GRAVITY,
  MANNING_N,
  THETA,
} from './constants.ts'
import {
  applyFaceFlows,
  cellVelocities,
  clearFacesOutside,
  computeFlowVectors,
  createFaces,
  createScratch,
  edgeOutflowCandidates,
  FACE_CLOSED,
  FACE_INNER,
  FACE_VIRTUAL_AFTER,
  FACE_VIRTUAL_BEFORE,
  FLOW_K,
  type Faces,
  faceVelocityMax,
  interiorOutflowCandidates,
  limitOutflows,
  type ScanWindow,
  solveStep,
  type TerrainArrays,
  timeStep,
  updateFaceFlows,
} from './FlowSolver.ts'
```

ファイルの末尾に足す:

```ts
/** 走査範囲をグリッド全体にする */
const whole = (t: TerrainArrays): ScanWindow => ({ x0: 0, y0: 0, x1: t.width, y1: t.height })

/** 標高と水深から、面の流量を 1 回だけ更新した面を返す（Δx = 1 m） */
function facesAfter(
  t: TerrainArrays,
  h: Float64Array,
  dt: number,
  setup: (f: Faces) => void = () => {},
): Faces {
  const f = createFaces(t.width, t.height, t.validMask)
  setup(f)
  updateFaceFlows(t, h, whole(t), f, dt, 1, MANNING_N)
  return f
}

describe('createFaces（spec 08 §3.1・§3.6）', () => {
  it('面の数は東西 (W+1)×H・南北 W×(H+1)。グリッドの外・無効セルとの面は仮想、両側とも仮想なら閉じる', () => {
    // 3 × 2。(1, 0) が無効セル
    const t = flat(3, 2, [1])
    const f = createFaces(3, 2, t.validMask)
    expect(f.qx.length).toBe(8)
    expect(f.qy.length).toBe(9)
    // 行 0 の東西の面: 外|(0,0)、(0,0)|無効、無効|(2,0)、(2,0)|外
    expect(Array.from(f.kindX.subarray(0, 4))).toEqual([
      FACE_VIRTUAL_BEFORE,
      FACE_VIRTUAL_AFTER,
      FACE_VIRTUAL_BEFORE,
      FACE_VIRTUAL_AFTER,
    ])
    // 行 1 の東西の面: 全部有効
    expect(Array.from(f.kindX.subarray(4, 8))).toEqual([
      FACE_VIRTUAL_BEFORE,
      FACE_INNER,
      FACE_INNER,
      FACE_VIRTUAL_AFTER,
    ])
    // 南北の面の行 0（北端）。x = 1 は外|無効で閉じる
    expect(Array.from(f.kindY.subarray(0, 3))).toEqual([
      FACE_VIRTUAL_BEFORE,
      FACE_CLOSED,
      FACE_VIRTUAL_BEFORE,
    ])
    // 行 1（行 0 と行 1 の境）。x = 1 は無効|(1,1)
    expect(Array.from(f.kindY.subarray(3, 6))).toEqual([
      FACE_INNER,
      FACE_VIRTUAL_BEFORE,
      FACE_INNER,
    ])
    // 行 2（南端）
    expect(Array.from(f.kindY.subarray(6, 9))).toEqual([
      FACE_VIRTUAL_AFTER,
      FACE_VIRTUAL_AFTER,
      FACE_VIRTUAL_AFTER,
    ])
  })
})

describe('timeStep（spec 08 §3.3）', () => {
  it('水が無ければ DT_MAX_S', () => {
    expect(timeStep(0, 0, 0.98)).toBe(DT_MAX_S)
  })

  it('α·Δx / √(g·h_max)。浅いうちは DT_MAX_S で頭打ち', () => {
    expect(timeStep(0.5, 0, 0.98)).toBe((CFL_ALPHA * 0.98) / Math.sqrt(GRAVITY * 0.5))
    expect(timeStep(1e-3, 0, 0.98)).toBe(DT_MAX_S)
  })

  it('前の step の面の流速が √(g·h_max) より大きければ、それで決める', () => {
    expect(timeStep(0.5, 10, 0.98)).toBe((CFL_ALPHA * 0.98) / 10)
  })
})

describe('updateFaceFlows（spec 08 §3.2・§3.4〜§3.6）', () => {
  it('平らな水面は、底の凹凸によらず内側の面で流れない（静水を保つ。well-balanced）', () => {
    // 4 × 3。標高は 1/4 m の刻み（二進で割り切れる）、水面はどこも 1 m
    const t = flat(4, 3)
    t.elevation.set([0, 0.25, 0.5, 0.125, 0.75, 0, 0.375, 0.5, 0.25, 0.625, 0, 0.125])
    const h = Float64Array.from(t.elevation, (z) => 1 - z)
    const f = facesAfter(t, h, 0.1)
    for (let i = 0; i < f.qx.length; i++) if (f.kindX[i] === FACE_INNER) expect(f.qx[i]).toBe(0)
    for (let i = 0; i < f.qy.length; i++) if (f.kindY[i] === FACE_INNER) expect(f.qy[i]).toBe(0)
  })

  it('面を通れる水深 h_f が DRY_DEPTH_M 以下なら 0（水の無い高いセルへは上らない）', () => {
    // 西は標高 0・水深 0.1、東は標高 0.5・水深 0: h_f = max(0.1, 0.5) − max(0, 0.5) = 0
    const t = flat(2, 1)
    t.elevation[1] = 0.5
    const f = facesAfter(t, Float64Array.of(0.1, 0), 0.1)
    expect(f.qx[1]).toBe(0)
    expect(f.hfx[1]).toBe(0)
  })

  it('水面差のある 2 セルの最初の step は q = −g·h_f·dt·(η_東 − η_西)/Δx（前の流量が 0 なので摩擦は効かない）', () => {
    const t = flat(2, 1)
    const f = facesAfter(t, Float64Array.of(0.3, 0.1), 0.1)
    expect(f.hfx[1]).toBeCloseTo(0.3, 15)
    expect(f.qx[1]).toBeCloseTo(-GRAVITY * 0.1 * 0.3 * (0.1 - 0.3), 15)
  })

  it('前の流量は θ 重み付けで両隣と平均し、Manning の摩擦で弱める（平らな水面）', () => {
    // 3 × 1、水深 0.2 の平らな水面。面 1 に 0.05、面 2 に 0.02 の前の流量（東向き）
    const t = flat(3, 1)
    const f = facesAfter(t, Float64Array.of(0.2, 0.2, 0.2), 0.1, (faces) => {
      faces.qx.set([0, 0.05, 0.02, 0])
    })
    // 面 1 の西隣は面 0（前の値 0）、東隣は面 2（前の値 0.02。この step で更新する前の値）
    const q0 = THETA * 0.05 + ((1 - THETA) / 2) * (0 + 0.02)
    const friction = 1 + (GRAVITY * 0.1 * MANNING_N * MANNING_N * 0.05) / 0.2 ** (7 / 3)
    expect(f.qx[1]).toBeCloseTo(q0 / friction, 14)
  })

  it('フルード数の上限: |q| ≤ FROUDE_MAX·h_f·√(g·h_f)', () => {
    const t = flat(2, 1)
    const f = facesAfter(t, Float64Array.of(2, 0), 1)
    expect(f.qx[1]).toBeCloseTo(FROUDE_MAX * 2 * Math.sqrt(GRAVITY * 2), 12)
  })

  it('仮想セルとの面は外向きにだけ流す（両隣の運動量で内向きになっても 0 にする）', () => {
    // 2 × 1 の平らな水面。面 1 に大きな東向きの前の流量。θ 重み付けで西端の面 0 は東向き（仮想セルから内向き）になる
    const t = flat(2, 1)
    const f = facesAfter(t, Float64Array.of(0.2, 0.2), 0.01, (faces) => {
      faces.qx[1] = 1
    })
    expect(f.qx[0]).toBe(0)
    // 東端の面 2 は外向き（東向き）なので残る
    expect(f.qx[2]).toBeGreaterThan(0)
  })

  it('θ 重み付けの両隣は、この step で更新する前の値を使う（先に更新した面の新しい値を読まない）', () => {
    const next = random(7)
    const t = flat(7, 5)
    for (let i = 0; i < 35; i++) t.elevation[i] = next()
    const h = Float64Array.from({ length: 35 }, () => 0.05 + next() * 0.3)
    const f = createFaces(7, 5, t.validMask)
    for (let i = 0; i < f.qx.length; i++) f.qx[i] = f.kindX[i] === FACE_INNER ? next() - 0.5 : 0
    for (let i = 0; i < f.qy.length; i++) f.qy[i] = f.kindY[i] === FACE_INNER ? next() - 0.5 : 0
    const oldX = f.qx.slice()
    const oldY = f.qy.slice()
    updateFaceFlows(t, h, whole(t), f, 0.05, 1, MANNING_N)
    // 古い値だけから 1 面ずつ計算した値と比べる（内側の面）
    const expected = (qOld: number, left: number, right: number, hf: number, dEta: number) => {
      let q = THETA * qOld + ((1 - THETA) / 2) * (left + right) - GRAVITY * 0.05 * hf * dEta
      if (qOld !== 0) q /= 1 + (GRAVITY * 0.05 * MANNING_N ** 2 * Math.abs(qOld)) / hf ** (7 / 3)
      const cap = FROUDE_MAX * hf * Math.sqrt(GRAVITY * hf)
      return Math.max(-cap, Math.min(cap, q))
    }
    for (let y = 0; y < 5; y++) {
      for (let x = 1; x < 7; x++) {
        const i = y * 8 + x
        const a = y * 7 + x - 1
        const ea = (t.elevation[a] ?? 0) + (h[a] ?? 0)
        const eb = (t.elevation[a + 1] ?? 0) + (h[a + 1] ?? 0)
        const hf =
          Math.max(ea, eb) - Math.max(t.elevation[a] ?? 0, t.elevation[a + 1] ?? 0)
        if (hf <= FLOW_THRESHOLD_M) continue
        const want = expected(oldX[i] ?? 0, oldX[i - 1] ?? 0, oldX[i + 1] ?? 0, hf, eb - ea)
        expect(Math.abs((f.qx[i] ?? 0) - want)).toBeLessThanOrEqual(1e-14)
      }
    }
    for (let y = 1; y < 5; y++) {
      for (let x = 0; x < 7; x++) {
        const i = y * 7 + x
        const a = i - 7
        const ea = (t.elevation[a] ?? 0) + (h[a] ?? 0)
        const eb = (t.elevation[i] ?? 0) + (h[i] ?? 0)
        const hf = Math.max(ea, eb) - Math.max(t.elevation[a] ?? 0, t.elevation[i] ?? 0)
        if (hf <= FLOW_THRESHOLD_M) continue
        const want = expected(oldY[i] ?? 0, oldY[i - 7] ?? 0, oldY[i + 7] ?? 0, hf, eb - ea)
        expect(Math.abs((f.qy[i] ?? 0) - want)).toBeLessThanOrEqual(1e-14)
      }
    }
  })
})

describe('limitOutflows・applyFaceFlows（spec 08 §3.2・§3.5）', () => {
  it('出る量が水深を超えるセルは出る面を縮め、自分の水をちょうど 0 にする。質量は保存する', () => {
    const t = flat(3, 1)
    const h = Float64Array.of(0, 0.01, 0)
    const f = createFaces(3, 1, t.validMask)
    f.qx.set([0, -1, 1, 0])
    limitOutflows(t, h, whole(t), f, 0.1, 1)
    expect(f.drained[1]).toBe(1)
    expect(0.1 * (-(f.qx[1] ?? 0) + (f.qx[2] ?? 0))).toBeCloseTo(0.01, 15)
    const next = new Float64Array(3)
    const outflow = applyFaceFlows(t, h, next, whole(t), f, 0.1, 1)
    expect(next[1]).toBe(0)
    expect((next[0] ?? 0) + (next[2] ?? 0)).toBeCloseTo(0.01, 15)
    expect(outflow).toBe(0)
  })

  it('足りているセルは縮めない（drained は 0）', () => {
    const t = flat(3, 1)
    const h = Float64Array.of(0, 1, 0)
    const f = createFaces(3, 1, t.validMask)
    f.qx.set([0, -1, 1, 0])
    limitOutflows(t, h, whole(t), f, 0.1, 1)
    expect(f.drained[1]).toBe(0)
    expect(Array.from(f.qx)).toEqual([0, -1, 1, 0])
  })

  it('仮想セルへ出た流量の合計 Σq を返す（× Δx × dt が流出量）', () => {
    const t = flat(1, 1)
    const h = Float64Array.of(0.5)
    const f = createFaces(1, 1, t.validMask)
    f.qx.set([-0.2, 0.3])
    limitOutflows(t, h, whole(t), f, 0.1, 1)
    const next = new Float64Array(1)
    expect(applyFaceFlows(t, h, next, whole(t), f, 0.1, 1)).toBeCloseTo(0.5, 15)
    expect(next[0]).toBeCloseTo(0.5 - 0.1 * 0.5, 15)
  })
})

describe('faceVelocityMax・clearFacesOutside・cellVelocities（spec 08 §3.8〜§3.10）', () => {
  it('faceVelocityMax は走査範囲の面の |q| / h_f の最大（端の仮想セルとの面を含む）', () => {
    const t = flat(2, 1)
    const f = facesAfter(t, Float64Array.of(0.3, 0.1), 0.1)
    let want = 0
    for (let i = 0; i < f.qx.length; i++) {
      if (f.qx[i] !== 0) want = Math.max(want, Math.abs(f.qx[i] ?? 0) / (f.hfx[i] ?? 1))
    }
    for (let i = 0; i < f.qy.length; i++) {
      if (f.qy[i] !== 0) want = Math.max(want, Math.abs(f.qy[i] ?? 0) / (f.hfy[i] ?? 1))
    }
    expect(want).toBeGreaterThan(0)
    expect(faceVelocityMax(whole(t), f)).toBe(want)
    expect(faceVelocityMax({ x0: 0, y0: 0, x1: 0, y1: 0 }, f)).toBe(0)
  })

  it('clearFacesOutside は前の走査範囲の面のうち、新しい走査範囲に入らない面だけを 0 にする', () => {
    const f = createFaces(4, 4, new Uint8Array(16).fill(1))
    f.qx.fill(1)
    f.qy.fill(1)
    clearFacesOutside(f, { x0: 0, y0: 0, x1: 4, y1: 4 }, { x0: 1, y0: 1, x1: 3, y1: 3 })
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x <= 4; x++) {
        const inside = y >= 1 && y < 3 && x >= 1 && x <= 3
        expect(f.qx[y * 5 + x]).toBe(inside ? 1 : 0)
      }
    }
    for (let y = 0; y <= 4; y++) {
      for (let x = 0; x < 4; x++) {
        const inside = y >= 1 && y <= 3 && x >= 1 && x < 3
        expect(f.qy[y * 4 + x]).toBe(inside ? 1 : 0)
      }
    }
    // 新しい走査範囲が空なら、前の走査範囲の面はすべて 0
    f.qx.fill(1)
    clearFacesOutside(f, { x0: 0, y0: 0, x1: 4, y1: 4 }, { x0: 0, y0: 0, x1: 0, y1: 0 })
    expect(Array.from(f.qx).every((q) => q === 0)).toBe(true)
  })

  it('cellVelocities はセルの両側の面の流量の平均 ÷ 水深（m/s）。乾いたセルは 0。出力の配列を使い回す', () => {
    const t = flat(2, 2)
    const f = createFaces(2, 2, t.validMask)
    const h = Float64Array.of(0.5, 0, 0, 0)
    // セル (0,0) の西の面 0.1、東の面 0.3、北の面 −0.2、南の面 0
    f.qx[0] = 0.1
    f.qx[1] = 0.3
    f.qy[0] = -0.2
    const out = { x: new Float32Array(4).fill(9), y: new Float32Array(4).fill(9) }
    const v = cellVelocities(t, h, whole(t), f, out)
    expect(v).toBe(out)
    expect(v.x[0]).toBeCloseTo((0.1 + 0.3) / 2 / 0.5, 6)
    expect(v.y[0]).toBeCloseTo((-0.2 + 0) / 2 / 0.5, 6)
    expect(Array.from(v.x.subarray(1))).toEqual([0, 0, 0])
    expect(cellVelocities(t, h, whole(t), f, { x: new Float32Array(1), y: new Float32Array(1) }).x.length).toBe(4)
  })
})
```

（`random` は同じファイルの「内側のセルの近傍の添字」の describe の中にある。ファイルの先頭の `flat` の後に、同じ mulberry32 の `random` をファイルの最上位に移し、その describe の中の定義を消す）

- [ ] **Step 6: 失敗することを確かめる**

Run: `pnpm vitest run src/simulation/FlowSolver.test.ts`
Expected: FAIL（`createFaces` などが export されていない）

- [ ] **Step 7: 関数を足す**

`src/simulation/FlowSolver.ts` の constants の import を次にする:

```ts
import {
  CFL_ALPHA,
  DIFFUSION_C,
  DRY_DEPTH_M,
  DT_MAX_S,
  FLOW_THRESHOLD_M,
  FROUDE_MAX,
  GRAVITY,
  THETA,
} from './constants.ts'
```

ファイルの末尾に足す:

```ts
// ---------------------------------------------------------------------------------------------
// 4 近傍の局所慣性式（spec 08 §3。Bates, Horritt & Fewtrell 2010、de Almeida ほか 2012 の θ 重み付け）。
// 流量は面（セルとセルの境）に置く（staggered grid）。面の走査は行優先の固定の順で、結果は決定的

/** 面の両側とも有効セル */
export const FACE_INNER = 0
/**
 * 西（南北の面では北）の側が仮想セル。仮想セル（グリッドの外・無効セル）は流出元と同じ標高で水深 0
 * （R03-2、spec 08 §3.6）
 */
export const FACE_VIRTUAL_BEFORE = 1
/** 東（南北の面では南）の側が仮想セル */
export const FACE_VIRTUAL_AFTER = 2
/** 両側とも仮想セル（流れない） */
export const FACE_CLOSED = 3

/** 面の状態（spec 08 §3.1）。エンジンが 1 つ持ち、使い回す */
export interface Faces {
  width: number
  height: number
  /** 東西の面の単位幅流量（m²/s。東向きが正）。(width + 1) × height。面 (x, y) はセル (x − 1, y) と (x, y) の境 */
  qx: Float64Array
  /** 南北の面の単位幅流量（m²/s。南向きが正）。width × (height + 1)。面 (x, y) はセル (x, y − 1) と (x, y) の境 */
  qy: Float64Array
  /** この step の始めの状態の面の h_f（m）。乾いた面は 0。流速の集計に使う */
  hfx: Float64Array
  hfy: Float64Array
  kindX: Uint8Array
  kindY: Uint8Array
  /** 正値の制限で水をすべて出したセル（その step だけの印） */
  drained: Uint8Array
  /** θ 重み付けで使う、1 つ上の行の南北の面の更新する前の q（列ごと） */
  rowOld: Float64Array
}

export function createFaces(width: number, height: number, validMask: Uint8Array): Faces {
  const valid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && validMask[y * width + x] !== 0
  const kind = (before: boolean, after: boolean): number =>
    before && after
      ? FACE_INNER
      : after
        ? FACE_VIRTUAL_BEFORE
        : before
          ? FACE_VIRTUAL_AFTER
          : FACE_CLOSED
  const kindX = new Uint8Array((width + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x <= width; x++) kindX[y * (width + 1) + x] = kind(valid(x - 1, y), valid(x, y))
  }
  const kindY = new Uint8Array(width * (height + 1))
  for (let y = 0; y <= height; y++) {
    for (let x = 0; x < width; x++) kindY[y * width + x] = kind(valid(x, y - 1), valid(x, y))
  }
  return {
    width,
    height,
    qx: new Float64Array((width + 1) * height),
    qy: new Float64Array(width * (height + 1)),
    hfx: new Float64Array((width + 1) * height),
    hfy: new Float64Array(width * (height + 1)),
    kindX,
    kindY,
    drained: new Uint8Array(width * height),
    rowOld: new Float64Array(width),
  }
}

/** 流量をすべて 0 に戻す（reset） */
export function clearFaces(f: Faces): void {
  f.qx.fill(0)
  f.qy.fill(0)
  f.hfx.fill(0)
  f.hfy.fill(0)
}

/**
 * 次の step の時間刻み（spec 08 §3.3）。hMax はこの step の始めの最大水深、uMax は前の step の面の流速の最大。
 * 水が無ければ DT_MAX_S。雨の終わりで切るのはエンジン（TsSimulationEngine.step）
 */
export function timeStep(hMax: number, uMax: number, cellSizeM: number): number {
  const c = Math.max(Math.sqrt(GRAVITY * hMax), uMax)
  return c > 0 ? Math.min(DT_MAX_S, (CFL_ALPHA * cellSizeM) / c) : DT_MAX_S
}

/**
 * 走査範囲の中の面の流量を 1 step 進める（spec 08 §3.2・§3.4〜§3.6）。h は step の始めの水深で、読むだけ。
 * 走査範囲は列 [x0, x1)・行 [y0, y1) のセルで、東西の面は行 y0..y1 − 1 の面 x0..x1、南北の面は行 y0..y1 の
 * 列 x0..x1 − 1。範囲の外の面の q は 0（§3.8 の不変条件）。θ 重み付けの両隣は、この step で更新する前の値を使う:
 * 西（北）の隣は更新する前に取っておいた値、東（南）の隣はまだ更新していない値。グリッドの端の面の隣は q 自身、
 * 走査範囲の外の隣の面は保存されている値（0）をそのまま読む（計画で決めたこと 10）
 */
export function updateFaceFlows(
  t: TerrainArrays,
  h: Float64Array,
  win: ScanWindow,
  f: Faces,
  dt: number,
  cellSizeM: number,
  manningN: number,
): void {
  const { width, height, elevation: z } = t
  const { qx, qy, hfx, hfy, kindX, kindY, rowOld } = f
  const { x0, y0, x1, y1 } = win
  if (x0 >= x1) return
  const w1 = width + 1
  const gdtdx = (GRAVITY * dt) / cellSizeM
  const gdtn2 = GRAVITY * dt * manningN * manningN
  const fr2g = FROUDE_MAX * FROUDE_MAX * GRAVITY
  const half = (1 - THETA) / 2
  // 東西の面
  for (let y = y0; y < y1; y++) {
    const rowC = y * width
    const rowF = y * w1
    let prevOld = 0
    for (let x = x0; x <= x1; x++) {
      const i = rowF + x
      const qOld = qx[i]
      const left = x === 0 ? qOld : x > x0 ? prevOld : qx[i - 1]
      prevOld = qOld
      const kind = kindX[i]
      if (kind === FACE_CLOSED) {
        qx[i] = 0
        hfx[i] = 0
        continue
      }
      const a = rowC + x - 1
      const b = rowC + x
      let za: number
      let ha: number
      let zb: number
      let hb: number
      if (kind === FACE_VIRTUAL_BEFORE) {
        zb = z[b]
        hb = h[b]
        za = zb
        ha = 0
      } else if (kind === FACE_VIRTUAL_AFTER) {
        za = z[a]
        ha = h[a]
        zb = za
        hb = 0
      } else {
        za = z[a]
        ha = h[a]
        zb = z[b]
        hb = h[b]
      }
      const ea = za + ha
      const eb = zb + hb
      const hf = (ea > eb ? ea : eb) - (za > zb ? za : zb)
      if (hf <= DRY_DEPTH_M) {
        qx[i] = 0
        hfx[i] = 0
        continue
      }
      hfx[i] = hf
      const right = x === width ? qOld : qx[i + 1]
      let q = THETA * qOld + half * (left + right) - gdtdx * hf * (eb - ea)
      if (qOld !== 0) q /= 1 + (gdtn2 * (qOld < 0 ? -qOld : qOld)) / (hf * hf * Math.cbrt(hf))
      // フルード数の上限: |q| > FR·h_f·√(g·h_f) ⇔ q² > FR²·g·h_f³（平方根は上限が効くときだけ求める）
      if (q * q > fr2g * hf * hf * hf) {
        const cap = FROUDE_MAX * hf * Math.sqrt(GRAVITY * hf)
        q = q > 0 ? cap : -cap
      }
      // 仮想セルは水を持たないので、内向きの流量は 0 に切る（§3.6）
      if ((kind === FACE_VIRTUAL_BEFORE && q > 0) || (kind === FACE_VIRTUAL_AFTER && q < 0)) q = 0
      qx[i] = q
    }
  }
  // 南北の面。北の隣の面の更新する前の値は rowOld に取っておく
  for (let y = y0; y <= y1; y++) {
    const rowF = y * width
    for (let x = x0; x < x1; x++) {
      const i = rowF + x
      const qOld = qy[i]
      const above = y === 0 ? qOld : y > y0 ? rowOld[x] : qy[i - width]
      rowOld[x] = qOld
      const kind = kindY[i]
      if (kind === FACE_CLOSED) {
        qy[i] = 0
        hfy[i] = 0
        continue
      }
      const a = i - width
      const b = i
      let za: number
      let ha: number
      let zb: number
      let hb: number
      if (kind === FACE_VIRTUAL_BEFORE) {
        zb = z[b]
        hb = h[b]
        za = zb
        ha = 0
      } else if (kind === FACE_VIRTUAL_AFTER) {
        za = z[a]
        ha = h[a]
        zb = za
        hb = 0
      } else {
        za = z[a]
        ha = h[a]
        zb = z[b]
        hb = h[b]
      }
      const ea = za + ha
      const eb = zb + hb
      const hf = (ea > eb ? ea : eb) - (za > zb ? za : zb)
      if (hf <= DRY_DEPTH_M) {
        qy[i] = 0
        hfy[i] = 0
        continue
      }
      hfy[i] = hf
      const below = y === height ? qOld : qy[i + width]
      let q = THETA * qOld + half * (above + below) - gdtdx * hf * (eb - ea)
      if (qOld !== 0) q /= 1 + (gdtn2 * (qOld < 0 ? -qOld : qOld)) / (hf * hf * Math.cbrt(hf))
      if (q * q > fr2g * hf * hf * hf) {
        const cap = FROUDE_MAX * hf * Math.sqrt(GRAVITY * hf)
        q = q > 0 ? cap : -cap
      }
      if ((kind === FACE_VIRTUAL_BEFORE && q > 0) || (kind === FACE_VIRTUAL_AFTER && q < 0)) q = 0
      qy[i] = q
    }
  }
}

/**
 * 正値の制限（spec 08 §3.5）。セル i から出る面の流量の合計 dt·Σ(出る向きの q)/Δx が h_i を超えるなら、
 * i から出る面の q に h_i / out_i を掛け、drained に印を付ける。どの面も出る向きのセルは 1 つだけなので、
 * 縮めても両側の増減は一致する。縮めた q を次の step の q として持つ
 */
export function limitOutflows(
  t: TerrainArrays,
  h: Float64Array,
  win: ScanWindow,
  f: Faces,
  dt: number,
  cellSizeM: number,
): void {
  const { width, validMask } = t
  const { qx, qy, drained } = f
  const w1 = width + 1
  const k = dt / cellSizeM
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      drained[i] = 0
      if (validMask[i] === 0) continue
      const fw = y * w1 + x
      const fe = fw + 1
      const fn = i
      const fs = i + width
      const qw = qx[fw]
      const qe = qx[fe]
      const qn = qy[fn]
      const qs = qy[fs]
      const out =
        k * ((qw < 0 ? -qw : 0) + (qe > 0 ? qe : 0) + (qn < 0 ? -qn : 0) + (qs > 0 ? qs : 0))
      if (out <= h[i]) continue
      const s = h[i] / out
      if (qw < 0) qx[fw] = qw * s
      if (qe > 0) qx[fe] = qe * s
      if (qn < 0) qy[fn] = qn * s
      if (qs > 0) qy[fs] = qs * s
      drained[i] = 1
    }
  }
}

/**
 * 水深を更新する（spec 08 §3.2 の h'）。走査範囲の有効セルの next に書く（呼ぶ前の next は 0。WaterGrid の不変条件）。
 * 水をすべて出したセル（drained）は入ってくる量だけにし、自分の水はちょうど 0 にする（§3.5。計画で決めたこと 7）。
 * 丸めで負になった水深は 0 にする。戻り値は仮想セルへ出た流量の合計 Σq（m²/s）。× Δx × dt が流出量（m³）
 */
export function applyFaceFlows(
  t: TerrainArrays,
  h: Float64Array,
  next: Float64Array,
  win: ScanWindow,
  f: Faces,
  dt: number,
  cellSizeM: number,
): number {
  const { width, validMask } = t
  const { qx, qy, kindX, kindY, drained } = f
  const w1 = width + 1
  const k = dt / cellSizeM
  let outflow = 0
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      if (validMask[i] === 0) continue
      const fw = y * w1 + x
      const fe = fw + 1
      const fn = i
      const fs = i + width
      const qw = qx[fw]
      const qe = qx[fe]
      const qn = qy[fn]
      const qs = qy[fs]
      let v: number
      if (drained[i] === 1) {
        v = k * ((qw > 0 ? qw : 0) - (qe < 0 ? qe : 0) + (qn > 0 ? qn : 0) - (qs < 0 ? qs : 0))
      } else {
        v = h[i] + k * (qw - qe + qn - qs)
        if (v < 0) v = 0
      }
      if (kindX[fw] === FACE_VIRTUAL_BEFORE && qw < 0) outflow -= qw
      if (kindX[fe] === FACE_VIRTUAL_AFTER && qe > 0) outflow += qe
      if (kindY[fn] === FACE_VIRTUAL_BEFORE && qn < 0) outflow -= qn
      if (kindY[fs] === FACE_VIRTUAL_AFTER && qs > 0) outflow += qs
      next[i] = v
    }
  }
  return outflow
}

/** 走査範囲の面の流速 |q| / h_f の最大（m/s）。h_f はこの step の始めの値（spec 08 §3.3 の u_max、§3.9 の停止） */
export function faceVelocityMax(win: ScanWindow, f: Faces): number {
  const { width, qx, qy, hfx, hfy } = f
  const { x0, y0, x1, y1 } = win
  if (x0 >= x1) return 0
  const w1 = width + 1
  let u = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * w1 + x
      const q = qx[i]
      if (q === 0) continue
      const v = (q < 0 ? -q : q) / hfx[i]
      if (v > u) u = v
    }
  }
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x
      const q = qy[i]
      if (q === 0) continue
      const v = (q < 0 ? -q : q) / hfy[i]
      if (v > u) u = v
    }
  }
  return u
}

/**
 * 走査範囲が before から after に変わったとき、before の面のうち after の面に入らないものの q を 0 にする
 * （spec 08 §3.8 の不変条件: 走査範囲の外の面の q は 0）。after が before より広がった分の面は、もともと 0
 */
export function clearFacesOutside(f: Faces, before: ScanWindow, after: ScanWindow): void {
  if (before.x0 >= before.x1) return
  const { width, qx, qy } = f
  const w1 = width + 1
  const empty = after.x0 >= after.x1
  for (let y = before.y0; y < before.y1; y++) {
    const rowInside = !empty && y >= after.y0 && y < after.y1
    for (let x = before.x0; x <= before.x1; x++) {
      if (rowInside && x >= after.x0 && x <= after.x1) continue
      qx[y * w1 + x] = 0
    }
  }
  for (let y = before.y0; y <= before.y1; y++) {
    const rowInside = !empty && y >= after.y0 && y <= after.y1
    for (let x = before.x0; x < before.x1; x++) {
      if (rowInside && x >= after.x0 && x < after.x1) continue
      qy[y * width + x] = 0
    }
  }
}

/**
 * 各セルの中心の流速（m/s。x は東、y は南が正。spec 08 §3.10）: 両側の面の流量の平均 ÷ 水深。水深が DRY_DEPTH_M
 * 以下のセルと走査範囲の外は 0。out を渡すと（大きさが合えば）それを 0 で埋めて書き、返す（使い回し。spec 06 §5.2）
 */
export function cellVelocities(
  t: TerrainArrays,
  h: Float64Array,
  win: ScanWindow,
  f: Faces,
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
  const { qx, qy } = f
  const w1 = width + 1
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      const d = h[i]
      if (d <= DRY_DEPTH_M) continue
      const fw = y * w1 + x
      vx[i] = (qx[fw] + qx[fw + 1]) / 2 / d
      vy[i] = (qy[i] + qy[i + width]) / 2 / d
    }
  }
  return out !== undefined && vx === out.x ? out : { x: vx, y: vy }
}
```

- [ ] **Step 8: テストが通ることを確かめる**

Run: `pnpm vitest run src/simulation/FlowSolver.test.ts src/simulation/constants.test.ts`
Expected: PASS

- [ ] **Step 9: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（`src/simulation/**` 90% を保つ。新しい関数はすべてこの Task のテストが通る）。ユニット 826 + 19 件（845 件）

- [ ] **Step 10: コミット**

```bash
git add src/simulation/constants.ts src/simulation/constants.test.ts src/simulation/FlowSolver.ts src/simulation/FlowSolver.test.ts
git commit -m "spec 08 Task 3: 4 近傍の局所慣性式の関数と定数を足す（エンジンは Task 5 で差し替える）"
```

---
### Task 4: 雨の予定（時間雨量 × 継続時間、円と範囲全体。spec §4.1〜§4.3、計画で決めたこと 5・9・31）

**Files:**
- Modify: `src/simulation/Rainfall.ts`
- Modify: `src/simulation/Rainfall.test.ts`

**Interfaces:**
- Consumes: `planRainfall`（既存。R03-4・R04-8 の円の雨）
- Produces（Task 5 のエンジンが使う）:
  - `interface CircleRainfall { x: number; y: number; radiusM: number; amountMm: number }`（`planRainfall` の引数の型。今の `RainfallInput` と同じ形）
  - `interface TimedRainfall { x; y; radiusM; intensityMmPerH; durationS; wholeRange }`（Task 5 で `types.ts` の `RainfallInput` に移して消す）
  - `interface RainSchedule { cells: Int32Array; rateMPerS: number; endS: number; instantDepthM: number; x0; y0; x1; y1 }`
  - `planRainSchedule(rain: TimedRainfall, validMask: Uint8Array, meta: TerrainMeta): RainSchedule`

- [ ] **Step 1: 失敗するテストを書く**

`src/simulation/Rainfall.test.ts` の import を `import { NoElevationAtRainCenterError, planRainfall, planRainSchedule, type TimedRainfall } from './Rainfall.ts'` にし、末尾に足す:

```ts
describe('planRainSchedule（spec 08 §4.2・§4.3）', () => {
  const circle = (overrides: Partial<TimedRainfall> = {}): TimedRainfall => ({
    x: 2.5,
    y: 2.5,
    radiusM: 1,
    intensityMmPerH: 100,
    durationS: 3600,
    wholeRange: false,
    ...overrides,
  })

  it('円の雨: セルは planRainfall と同じで、各セルの水深の増える速さ ρ は 1 時間の雨の水深 ÷ 3600', () => {
    const schedule = planRainSchedule(circle(), mask5(), META_5)
    const oneHour = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 100 }, mask5(), META_5)
    expect(Array.from(schedule.cells)).toEqual(Array.from(oneHour.cells))
    expect(schedule.rateMPerS).toBe(oneHour.depthM / 3600)
    expect(schedule.endS).toBe(3600)
    expect(schedule.instantDepthM).toBe(0)
    expect([schedule.x0, schedule.y0, schedule.x1, schedule.y1]).toEqual([1, 1, 4, 4])
    // 1 時間分の投入量 ρ × 3600 × |S| × A は、πr² × 100 mm（円がすべて有効）
    expect(schedule.rateMPerS * 3600 * schedule.cells.length).toBeCloseTo(oneHour.volumeM3, 15)
  })

  it('円が無効セルで切れても、各セルの水深の増える速さは円がすべて有効な場合と同じ（R04-8）', () => {
    const full = planRainSchedule(circle(), mask5(), META_5)
    const cut = planRainSchedule(circle(), mask5([12]), META_5)
    expect(cut.cells.length).toBe(4)
    expect(cut.rateMPerS).toBeCloseTo(full.rateMPerS, 18)
  })

  it('範囲全体の雨: すべての有効セルに I = 時間雨量 / 1000 / 3600（m/s）。無効セルには降らない', () => {
    const schedule = planRainSchedule(
      circle({ wholeRange: true, intensityMmPerH: 360 }),
      mask5([0, 24]),
      META_5,
    )
    expect(schedule.cells.length).toBe(23)
    expect(Array.from(schedule.cells)).not.toContain(0)
    expect(schedule.rateMPerS).toBe(360 / 1000 / 3600)
    expect([schedule.x0, schedule.y0, schedule.x1, schedule.y1]).toEqual([0, 0, 5, 5])
  })

  it('範囲全体の雨は円の中心・半径を見ない（中心が範囲の外でもよい）', () => {
    const schedule = planRainSchedule(
      circle({ wholeRange: true, x: -100, y: -100, radiusM: 1e9 }),
      mask5(),
      META_5,
    )
    expect(schedule.cells.length).toBe(25)
  })

  it('durationS = 0 は開始のときに一度に置く: intensityMmPerH を雨の量（mm）として各セルの水深にする', () => {
    const instant = planRainSchedule(circle({ durationS: 0 }), mask5(), META_5)
    const amount = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 100 }, mask5(), META_5)
    expect(instant.instantDepthM).toBe(amount.depthM)
    expect(instant.rateMPerS).toBe(0)
    expect(instant.endS).toBe(0)
    const whole = planRainSchedule(circle({ durationS: 0, wholeRange: true }), mask5(), META_5)
    expect(whole.instantDepthM).toBe(0.1)
  })

  it('範囲全体の雨で有効セルが 1 つも無ければ NoElevationAtRainCenterError', () => {
    expect(() =>
      planRainSchedule(circle({ wholeRange: true }), new Uint8Array(25), META_5),
    ).toThrow(NoElevationAtRainCenterError)
  })

  it.each<[string, Partial<TimedRainfall>]>([
    ['時間雨量が負', { intensityMmPerH: -1 }],
    ['時間雨量が NaN', { intensityMmPerH: Number.NaN }],
    ['継続時間が負', { durationS: -1 }],
    ['継続時間が無限', { durationS: Number.POSITIVE_INFINITY }],
    ['範囲全体が真偽値でない', { wholeRange: 1 as unknown as boolean }],
  ])('不正な雨（%s）は RangeError（Worker に届く値を信用しない）', (_, overrides) => {
    expect(() => planRainSchedule(circle(overrides), mask5(), META_5)).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run src/simulation/Rainfall.test.ts`
Expected: FAIL（`planRainSchedule` が export されていない）

- [ ] **Step 3: 実装する**

`src/simulation/Rainfall.ts`:

- 先頭の説明を「降雨の投入先と水深の計算（spec 03 §3.6、R03-4、spec 08 §4）」にする
- import を `import type { TerrainMeta } from './types.ts'` にする（`RainfallInput` は使わなくなる）
- `NoElevationAtRainCenterError` の後に足す:

```ts
/** 円の雨（R03-4・R04-8）。amountMm は各セルに置く雨の量（mm） */
export interface CircleRainfall {
  /** グリッドの北西端から東向きの距離（m） */
  x: number
  /** グリッドの北西端から南向きの距離（m） */
  y: number
  radiusM: number
  amountMm: number
}

/** 時間雨量 × 継続時間の雨（spec 08 §4.1〜§4.3）。Task 5 で types.ts の RainfallInput に移す */
export interface TimedRainfall {
  x: number
  y: number
  /** 円の半径（m）。wholeRange のときは使わない */
  radiusM: number
  /** 時間雨量（mm/h）。durationS = 0 のときは一度に置く雨の量（mm） */
  intensityMmPerH: number
  /** 継続時間（s）。0 は開始のときに一度に置く（テスト用） */
  durationS: number
  /** 範囲全体に降らせる（R08-4） */
  wholeRange: boolean
}

/** 登録した雨（spec 08 §4.2）。エンジンは雨の間、各 step の終わりに cells へ rateMPerS × dt を足す */
export interface RainSchedule {
  /** 雨を足すセル（行優先の昇順）。範囲全体の雨はすべての有効セル */
  cells: Int32Array
  /** 各セルの水深の増える速さ ρ（m/s）。durationS = 0 なら 0 */
  rateMPerS: number
  /** 雨の終わりの時刻 T_rain（s）。durationS と同じ */
  endS: number
  /** durationS = 0 のとき、開始のときに一度に置く各セルの水深（m）。それ以外は 0 */
  instantDepthM: number
  /** cells の外接矩形（列 [x0, x1)、行 [y0, y1)） */
  x0: number
  y0: number
  x1: number
  y1: number
}
```

- `planRainfall` の引数の型を `rain: CircleRainfall` にする（本体は変えない）
- ファイルの末尾に足す:

```ts
/**
 * 雨の予定を作る（spec 08 §4.2・§4.3）。円の雨のセルと割合は planRainfall（R03-4・R04-8）のままで、各セルの
 * 水深の増える速さ ρ = I·πr² / (|C|·A)（円がすべて有効なら ≈ I）。範囲全体の雨はすべての有効セルに I。
 * durationS = 0 は intensityMmPerH を「一度に置く雨の量（mm）」と読む（計画で決めたこと 5）
 */
export function planRainSchedule(
  rain: TimedRainfall,
  validMask: Uint8Array,
  meta: TerrainMeta,
): RainSchedule {
  const { intensityMmPerH, durationS, wholeRange } = rain
  if (!Number.isFinite(intensityMmPerH) || intensityMmPerH < 0) {
    throw new RangeError(`時間雨量が不正です: ${intensityMmPerH}`)
  }
  if (!Number.isFinite(durationS) || durationS < 0) {
    throw new RangeError(`継続時間が不正です: ${durationS}`)
  }
  if (typeof wholeRange !== 'boolean') {
    throw new RangeError(`範囲全体の指定が不正です: ${String(wholeRange)}`)
  }
  // 1 時間降り続けたとき（durationS = 0 なら一度に置くとき）の各セルの水深（m）
  let depthM: number
  let cells: Int32Array
  let box: { x0: number; y0: number; x1: number; y1: number }
  if (wholeRange) {
    const { width, height } = meta
    const list: number[] = []
    let x0 = width
    let y0 = height
    let x1 = 0
    let y1 = 0
    for (let i = 0; i < validMask.length; i++) {
      if (validMask[i] === 0) continue
      list.push(i)
      const cx = i % width
      const cy = (i - cx) / width
      if (cx < x0) x0 = cx
      if (cx + 1 > x1) x1 = cx + 1
      if (cy < y0) y0 = cy
      if (cy + 1 > y1) y1 = cy + 1
    }
    if (list.length === 0) throw new NoElevationAtRainCenterError()
    cells = Int32Array.from(list)
    depthM = intensityMmPerH / 1000
    box = { x0, y0, x1, y1 }
  } else {
    const plan = planRainfall(
      { x: rain.x, y: rain.y, radiusM: rain.radiusM, amountMm: intensityMmPerH },
      validMask,
      meta,
    )
    cells = plan.cells
    depthM = plan.depthM
    box = { x0: plan.x0, y0: plan.y0, x1: plan.x1, y1: plan.y1 }
  }
  const instant = durationS === 0
  return {
    cells,
    rateMPerS: instant ? 0 : depthM / 3600,
    endS: durationS,
    instantDepthM: instant ? depthM : 0,
    ...box,
  }
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `pnpm vitest run src/simulation/Rainfall.test.ts`
Expected: PASS（既存の `planRainfall` のテストも。引数の型が `CircleRainfall` に変わっても形は同じ）

- [ ] **Step 5: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。ユニット 845 + 11 件（856 件）

- [ ] **Step 6: コミット**

```bash
git add src/simulation/Rainfall.ts src/simulation/Rainfall.test.ts
git commit -m "spec 08 Task 4: 雨の予定（時間雨量 × 継続時間、円と範囲全体）を足す"
```

---
### Task 5: エンジンを局所慣性式に差し替える（spec §3・§4.2〜§4.3・§5.1、§9.3 の「既存のテストの書き直し」「境界」「reset」、計画で決めたこと 2〜8・11〜14・34）

エンジンのインターフェースが変わるので、呼び出し側（Worker・メイン・テストの偽物・ベンチマーク）も同じ Task で合わせる（型が変わるとゲートの `pnpm typecheck` が通らないため）。**UI の雨はまだ一度に置く**（計画で決めたこと 3）。

**Files:**
- Modify: `src/simulation/types.ts`、`constants.ts`（+ test）、`FlowSolver.ts`（+ test）、`Rainfall.ts`（+ test）、`WaterGrid.ts`（+ test）
- Modify（全体を置き換える）: `src/simulation/TsSimulationEngine.ts`、`TsSimulationEngine.test.ts`、`scenarios.test.ts`
- Modify: `src/simulation/testing/fixtures.test-support.ts`、`spillEvents.test.ts`、`properties.test.ts`、`outflowCells.test.ts`
- Modify: `src/workers/simulationRunner.ts`（+ test）、`src/workers/playbackScheduler.ts`、`playbackScheduler.test.ts`、`flowArrows.test.ts`
- Modify: `src/bridge/SimulationClient.test.ts`、`src/bridge/fakeWorker.test-support.ts`
- Create: `src/state/displayStats.test-support.ts`
- Modify: `src/state/simulationStore.test.ts`
- Modify: `src/ui/simulationSession.ts`（+ test）、`src/ui/components/StatisticsPanel.tsx`（+ test）、`src/ui/components/ControlsSection.test.tsx`
- Modify: `scripts/bench-engine.ts`

**Interfaces:**
- Consumes: Task 3 の `FlowSolver.ts` の関数と定数、Task 4 の `planRainSchedule`・`RainSchedule`
- Produces:
  - `RainfallInput { x; y; radiusM; intensityMmPerH; durationS; wholeRange }`（`src/simulation/types.ts`。spec §5.1）
  - `type StopReason = 'settled' | 'cap'`、`StepStats` に `timeS`・`dtS`・`raining`・`rainDepthMm`・`outflowRateM3PerS`・`stopReason: StopReason | null`、`SimulationEvent.timeS`
  - `SimulationEngine.setRainfall(rain: RainfallInput): void`（`addRainfall` を置き換える）
  - `EngineOptions { scanMode?; manningN?; settleVelocityMPerS? }`
  - `TsSimulationEngine` のテスト用の口: `setInitialWater(depth: Float64Array): void`、`faceFlows(): { qx; qy; hfx; hfy }`、`scanWindow(): ScanWindow`
  - `NEIGHBOR_DX = Int8Array.of(0, -1, 1, 0)`・`NEIGHBOR_DY = Int8Array.of(-1, 0, 0, 1)`（北・西・東・南の面の表。07 の `outflowCells.ts` が読む）
  - `DRY_DEPTH_M`（`FLOW_THRESHOLD_M` と `DIFFUSION_C` は消える）
  - テストの補助（`fixtures.test-support.ts`）: `runUntilStopped(engine, maxSteps): StepStats`、`runUntilQuiet(engine, maxRateMPerS, maxSteps): StepStats`、`QUIET_EQUILIBRIUM_M_PER_S`、`QUIET_FILL_M_PER_S`、`instantRain(center: { x; y }, radiusM, amountMm): RainfallInput`、`wetSurfaceRange(t, w, minDepthM = 0)`
  - `displayStats(overrides?: Partial<DisplayStats>): DisplayStats`（`src/state/displayStats.test-support.ts`。UI のテストが使う）

- [ ] **Step 1: エンジンの新しいテストを書く（全体を置き換える）**

`src/simulation/TsSimulationEngine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CFL_ALPHA,
  DT_MAX_S,
  GRAVITY,
  MANNING_N,
  massTolerance,
  SETTLE_VELOCITY_M_PER_S,
} from './constants.ts'
import { NoElevationAtRainCenterError } from './Rainfall.ts'
import { TsSimulationEngine } from './TsSimulationEngine.ts'
import {
  buildTerrain,
  cellCenter,
  cone,
  engineOn,
  instantRain,
  sameBits,
  walledBasin,
} from './testing/fixtures.test-support.ts'
import type { RainfallInput } from './types.ts'

/** 円の雨（時間雨量 × 継続時間） */
function circle(
  x: number,
  y: number,
  radiusM: number,
  intensityMmPerH: number,
  durationS: number,
): RainfallInput {
  return { x, y, radiusM, intensityMmPerH, durationS, wholeRange: false }
}

describe('loadTerrain', () => {
  it('loadTerrain の前に呼ぶとエラー', () => {
    const engine = new TsSimulationEngine()
    expect(() => engine.step()).toThrow('loadTerrain を先に呼んでください')
    expect(() => engine.waterDepth()).toThrow('loadTerrain を先に呼んでください')
  })

  it('配列の長さ・グリッドの大きさ・セルの大きさが不正なら RangeError', () => {
    const engine = new TsSimulationEngine()
    const z = new Float32Array(6)
    const m = new Uint8Array(6)
    expect(() => engine.loadTerrain(z, m, { width: 2, height: 2, cellSizeM: 1 })).toThrow(
      RangeError,
    )
    expect(() => engine.loadTerrain(z, m, { width: 0, height: 6, cellSizeM: 1 })).toThrow(
      RangeError,
    )
    expect(() => engine.loadTerrain(z, m, { width: 3, height: 2, cellSizeM: 0 })).toThrow(
      RangeError,
    )
  })

  it('標高とマスクを複製して持つ（呼び出し側が後で書き換えても影響しない）', () => {
    const t = walledBasin(5, 0, 10)
    const engine = engineOn(t)
    t.elevation.fill(-100)
    engine.setRainfall(instantRain(cellCenter(2, 2, 1), 0.4, 100))
    let stats = engine.step()
    for (let n = 0; n < 200; n++) stats = engine.step()
    expect(stats.outflowWater).toBe(0)
  })
})

describe('EngineOptions（spec 08 §3.12）', () => {
  it('既定は MANNING_N と SETTLE_VELOCITY_M_PER_S。差し替えられる', () => {
    const engine = new TsSimulationEngine()
    expect(engine.manningN).toBe(MANNING_N)
    expect(engine.settleVelocityMPerS).toBe(SETTLE_VELOCITY_M_PER_S)
    const custom = new TsSimulationEngine({ manningN: 0.1, settleVelocityMPerS: 0 })
    expect(custom.manningN).toBe(0.1)
    expect(custom.settleVelocityMPerS).toBe(0)
  })

  it.each([-0.01, Number.NaN, Number.POSITIVE_INFINITY])(
    'manningN・settleVelocityMPerS が有限で 0 以上でなければ RangeError（%s）',
    (value) => {
      expect(() => new TsSimulationEngine({ manningN: value })).toThrow(RangeError)
      expect(() => new TsSimulationEngine({ settleVelocityMPerS: value })).toThrow(RangeError)
    },
  )
})

describe('setRainfall（spec 08 §4.2）', () => {
  it('継続時間のある雨は登録するだけで、最初の step までは水を置かない', () => {
    const engine = engineOn(buildTerrain(20, 20, 1, () => 0))
    engine.setRainfall(circle(10, 10, 3, 100, 600))
    expect(engine.waterDepth().every((d) => d === 0)).toBe(true)
    const s = engine.step()
    expect(s.totalWater).toBeGreaterThan(0)
    expect(s.raining).toBe(true)
  })

  it('durationS = 0 は開始のときに一度に置く（量は intensityMmPerH の mm）。雨は降っていない扱い', () => {
    const engine = engineOn(buildTerrain(250, 250, 1, () => 0))
    engine.setRainfall(instantRain({ x: 125, y: 125 }, 10, 100))
    const expected = (Math.PI * 100 * 100) / 1000
    const placed = engine.waterDepth().reduce((a, d) => a + d, 0)
    expect(Math.abs(placed - expected) / expected).toBeLessThanOrEqual(1e-12)
    const s = engine.step()
    expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
    expect(s.raining).toBe(false)
    expect(s.rainDepthMm).toBe(100)
  })

  it('2 回目の登録は前の登録を置き換える', () => {
    const engine = engineOn(buildTerrain(20, 20, 1, () => 0))
    engine.setRainfall(circle(10, 10, 3, 100, 600))
    engine.setRainfall(circle(10, 10, 3, 300, 1200))
    const s = engine.step()
    expect(s.rainDepthMm).toBeCloseTo((300 * s.timeS) / 3600, 12)
  })

  it('降雨中心に標高データが無ければエラーで、水も統計も変えない', () => {
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    expect(() => engine.setRainfall(instantRain({ x: 2.5, y: 2.5 }, 0.4, 10))).toThrow(
      NoElevationAtRainCenterError,
    )
    const s = engine.step()
    expect(s.totalWater).toBe(0)
    expect(s.rainDepthMm).toBe(0)
  })

  it('範囲全体の雨はすべての有効セルに同じ速さで降り、無効セルには降らない', () => {
    // 6 × 5・セル 2 m、(0, 0) だけ無効。360 mm/h は 1e-4 m/s。乾いた地形の最初の step の dt は DT_MAX_S
    const t = buildTerrain(6, 5, 2, (x, y) => (x === 0 && y === 0 ? Number.NaN : 0))
    const engine = engineOn(t)
    engine.setRainfall({
      x: 0,
      y: 0,
      radiusM: 1,
      intensityMmPerH: 360,
      durationS: 600,
      wholeRange: true,
    })
    const s = engine.step()
    const w = engine.waterDepth()
    expect(w[0]).toBe(0)
    for (let i = 1; i < 30; i++) expect(w[i]).toBeCloseTo(1e-4 * DT_MAX_S, 15)
    expect(s.totalWater).toBeCloseTo(1e-4 * DT_MAX_S * 29 * 4, 12)
  })
})

describe('step の統計（spec 08 §5.1）', () => {
  it('雨も水も無ければ dt は DT_MAX_S で、流れも無いので settled（stopReason は settled）', () => {
    const s = engineOn(walledBasin(5, 0, 10)).step()
    expect(s).toEqual({
      step: 1,
      totalWater: 0,
      storedWater: 0,
      outflowWater: 0,
      maxDepth: 0,
      floodedArea: 0,
      settled: true,
      massError: 0,
      events: [],
      timeS: DT_MAX_S,
      dtS: DT_MAX_S,
      raining: false,
      rainDepthMm: 0,
      outflowRateM3PerS: 0,
      stopReason: 'settled',
    })
  })

  it('経過時間は dt の和。乾いた地形に降り始めた最初の step の dt は DT_MAX_S', () => {
    const engine = engineOn(buildTerrain(20, 20, 1, () => 0))
    engine.setRainfall(circle(10, 10, 3, 100, 600))
    let t = 0
    for (let n = 0; n < 5; n++) {
      const s = engine.step()
      if (n === 0) expect(s.dtS).toBe(DT_MAX_S)
      t += s.dtS
      expect(s.timeS).toBe(t)
    }
  })

  it('一度に置いた水の最初の step の dt は α·Δx / √(g·h_max)', () => {
    const engine = engineOn(walledBasin(7, 0, 10))
    engine.setRainfall(instantRain(cellCenter(3, 3, 1), 0.4, 1000))
    const h = engine.waterDepth()[3 * 7 + 3] ?? 0
    expect(engine.step().dtS).toBe((CFL_ALPHA * 1) / Math.sqrt(GRAVITY * h))
  })

  it('投入量・貯留量・最大水深・質量誤差。閉じた盆地では流出 0', () => {
    const engine = engineOn(walledBasin(7, 0, 10))
    // 中央のセル 1 つに π × 0.4² × 1 m³ ≈ 0.503 m³
    engine.setRainfall(instantRain(cellCenter(3, 3, 1), 0.4, 1000))
    const v = Math.PI * 0.16
    for (let n = 0; n < 50; n++) {
      const s = engine.step()
      expect(s.totalWater).toBeCloseTo(v, 12)
      expect(s.outflowWater).toBe(0)
      expect(s.outflowRateM3PerS).toBe(0)
      expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
      expect(s.maxDepth).toBeGreaterThan(0)
    }
  })
})

describe('境界と無効セル（spec 08 §3.6・§9.3）', () => {
  it('端のセルの水は流出し、outflowWater と流出の速さ（× dt）に入る', () => {
    // セル 2 m の平面。角のセル (0, 0) にだけ水を置く
    const engine = engineOn(buildTerrain(3, 3, 2, () => 0))
    engine.setRainfall(instantRain({ x: 1, y: 1 }, 0.5, 1000))
    const s = engine.step()
    expect(s.outflowWater).toBeGreaterThan(0)
    expect(s.outflowRateM3PerS * s.dtS).toBeCloseTo(s.outflowWater, 12)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
  })

  it('無効セルに上下左右で接するセルの水も流出し、無効セルは水を持たない', () => {
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    engine.setRainfall(instantRain(cellCenter(1, 2, 1), 0.4, 1000))
    const s = engine.step()
    expect(s.outflowWater).toBeGreaterThan(0)
    expect(engine.waterDepth()[2 * 5 + 2]).toBe(0)
  })

  it('無効セルに斜めにだけ接するセルからは流出しない（4 近傍）', () => {
    // (1, 1) は無効セル (2, 2) と斜めにだけ接する。最初の step で濡れているのは (1, 1) だけ
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    engine.setRainfall(instantRain(cellCenter(1, 1, 1), 0.4, 1000))
    expect(engine.step().outflowWater).toBe(0)
  })
})

describe('flowVectors（spec 08 §3.10）', () => {
  it('面の流量が 0 の間（最初の step の前）はすべて 0。東へ下る斜面では 1 step 後に濡れたセルが東を向く（m/s）', () => {
    const engine = engineOn(buildTerrain(15, 9, 1, (x) => (14 - x) * 0.2))
    engine.setRainfall(instantRain(cellCenter(5, 4, 1), 2, 50))
    const before = engine.flowVectors()
    expect(before.x.every((v) => v === 0)).toBe(true)
    engine.step()
    const w = engine.waterDepth()
    const v = engine.flowVectors()
    let moving = 0
    for (let i = 0; i < w.length; i++) {
      if ((w[i] ?? 0) === 0) {
        expect([v.x[i], v.y[i]]).toEqual([0, 0])
        continue
      }
      if ((v.x[i] ?? 0) > Math.abs(v.y[i] ?? 0)) moving++
    }
    expect(moving).toBeGreaterThan(0)
  })

  it('同じ配列を使い回し、呼ぶたびに今の状態で書き直す（新しいエンジンの値と同じ）', () => {
    const t = buildTerrain(15, 9, 1, (x) => (14 - x) * 0.2)
    const rain = instantRain(cellCenter(5, 4, 1), 2, 50)
    const a = engineOn(t)
    a.setRainfall(rain)
    const first = a.flowVectors()
    for (let n = 0; n < 20; n++) a.step()
    const second = a.flowVectors()
    expect(second.x).toBe(first.x)
    expect(second.y).toBe(first.y)
    const fresh = engineOn(t)
    fresh.setRainfall(rain)
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
})

describe('reset（spec 08 §9.3、計画で決めたこと 6）', () => {
  it('水・流量・経過時間・統計を戻し、雨の登録を消す。地形は残す（以降は新しいエンジンとビット単位で同じ）', () => {
    const t = cone(9, 0.1, 5)
    const rain = circle(4.5, 4.5, 1.5, 200, 120)
    const a = engineOn(t)
    const b = engineOn(t)
    a.setRainfall(rain)
    for (let n = 0; n < 50; n++) a.step()
    a.reset()
    expect(a.waterDepth().every((d) => d === 0)).toBe(true)
    const { qx, qy } = a.faceFlows()
    expect(qx.every((q) => q === 0) && qy.every((q) => q === 0)).toBe(true)
    // 雨の登録は残らない（登録せずに回しても水は増えない）
    const idle = a.step()
    expect(idle).toMatchObject({ step: 1, totalWater: 0, timeS: DT_MAX_S, rainDepthMm: 0 })
    a.reset()
    a.setRainfall(rain)
    b.setRainfall(rain)
    for (let n = 0; n < 30; n++) expect(a.step()).toEqual(b.step())
    expect(sameBits(a.waterDepth(), b.waterDepth())).toBe(true)
  })
})

describe('テスト用の口（計画で決めたこと 11）', () => {
  it('setInitialWater は水深を置いて走査範囲を全体にし、投入量に数える。無効セルや負の水深は RangeError', () => {
    const t = buildTerrain(3, 3, 2, (x, y) => (x === 0 && y === 0 ? Number.NaN : 0))
    const engine = engineOn(t)
    const depth = new Float64Array(9).fill(0.1)
    depth[0] = 0
    engine.setInitialWater(depth)
    expect(engine.scanWindow()).toEqual({ x0: 0, y0: 0, x1: 3, y1: 3 })
    expect(engine.step().totalWater).toBeCloseTo(0.1 * 8 * 4, 12)
    const bad = new Float64Array(9)
    bad[0] = 0.1
    expect(() => engineOn(t).setInitialWater(bad)).toThrow(RangeError)
    expect(() => engineOn(t).setInitialWater(new Float64Array(9).fill(-1))).toThrow(RangeError)
    expect(() => engineOn(t).setInitialWater(new Float64Array(4))).toThrow(RangeError)
  })
})
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run src/simulation/TsSimulationEngine.test.ts`
Expected: FAIL（`setRainfall`・`instantRain` などが無い。型の誤りで読み込めない）

- [ ] **Step 3: 型を改める**

`src/simulation/types.ts` の `RainfallInput`・`SimulationEvent`・`StepStats`・`SimulationEngine` を次に置き換える（`TerrainMeta` は変えない。先頭の説明に「spec 08 §5.1」を足す）:

```ts
/** 雨（spec 08 §4.1〜§4.3、§5.1）。時間雨量 × 継続時間で、円か範囲全体に降らせる */
export interface RainfallInput {
  /** グリッドの北西端から東向きの距離（m） */
  x: number
  /** グリッドの北西端から南向きの距離（m） */
  y: number
  /** 円の半径（m）。wholeRange のときは使わない */
  radiusM: number
  /** 時間雨量（mm/h）。durationS = 0 のときは一度に置く雨の量（mm） */
  intensityMmPerH: number
  /** 継続時間（s）。0 は開始のときに一度に置く（テスト用。UI からは選べない） */
  durationS: number
  /** 範囲全体に降らせる（R08-4） */
  wholeRange: boolean
}

export interface SimulationEvent {
  /** 窪地の最低点の水位が spill 標高 − 1cm に達した（base-spec §21） */
  type: 'spill'
  step: number
  /** 経過時間（s） */
  timeS: number
  depressionId: number
  spillElevation: number
}

/** 自動停止の理由（spec 08 §3.9）。settled は水の動きがほぼ止まった、cap は雨がやんでから上限の時間に達した */
export type StopReason = 'settled' | 'cap'

export interface StepStats {
  /** 実行済みの step 数（base-spec §33 の「Step N」） */
  step: number
  /** 累積の投入水量（m³） */
  totalWater: number
  /** 領域内にある現在の水量 Σ h × A（m³） */
  storedWater: number
  /** 累積の領域外流出量（m³） */
  outflowWater: number
  /** 最大水深（m） */
  maxDepth: number
  /** 水深が描画閾値（1cm）以上のセルの面積（m²） */
  floodedArea: number
  /** この step の終わりの時点で雨が終わっていて、すべての面の流速が停止の流速未満（spec 08 §3.9）。雨の間は常に false */
  settled: boolean
  /** totalWater − storedWater − outflowWater（m³） */
  massError: number
  /** この step で起きた越流イベント */
  events: SimulationEvent[]
  /** 経過時間（s）。降雨の開始が 0 */
  timeS: number
  /** この step の時間刻み（s） */
  dtS: number
  /** この step の終わりの時点で雨が降っている */
  raining: boolean
  /** 累積雨量（mm）= 時間雨量 × min(t, T_rain) / 3600。durationS = 0 の雨は置いた量 */
  rainDepthMm: number
  /** この step の流出量 ÷ dtS（m³/s）。統計の「流出の速さ」（spec 08 §6.2） */
  outflowRateM3PerS: number
  /** 自動停止の理由。止める条件に当たらなければ null（spec 08 §3.9、R08-6） */
  stopReason: StopReason | null
}

export interface SimulationEngine {
  loadTerrain(elevation: Float32Array, validMask: Uint8Array, meta: TerrainMeta): void
  /**
   * 雨を登録する（spec 08 §4.2）。reset の後、最初の step の前に 1 回呼ぶ。2 回目は前の登録を置き換える。
   * 雨の間は各 step の終わりに投入する。durationS = 0 はここで一度に置く
   */
  setRainfall(rain: RainfallInput): void
  step(): StepStats
  /** 水・流量・経過時間・統計・越流の通知済みの記録を戻し、雨の登録を消す。地形と窪地の一覧は残す */
  reset(): void
  /**
   * 内部の水深配列。呼び出し側は読み取り専用として扱い、転送バッファへのコピー元にのみ使う。
   * step() のたびに別の配列に入れ替わるので、step() の後は呼び直す
   */
  waterDepth(): Float64Array
  /** 越流イベントの判定に使う窪地（実装 spec 02 の地形解析の結果） */
  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void
  /**
   * 各セルの中心の流速（m/s。x は東、y は南が正。spec 08 §3.10）。水の流れの矢印用。
   * 戻り値の配列はエンジンが使い回し、次の flowVectors()・loadTerrain で上書きされる。呼び出し側はすぐに読み切る
   */
  flowVectors(): { x: Float32Array; y: Float32Array }
}
```

- [ ] **Step 4: 定数・Rainfall・FlowSolver・WaterGrid の旧い部分を片付ける**

`src/simulation/constants.ts`:
- `FLOW_THRESHOLD_M` と `DIFFUSION_C` の定義を消す
- `DEPTH_EPSILON_M` の説明を「水深・水面の比較の許容値 epsilon（m）。面を通れる水深の閾値 DRY_DEPTH_M と同じ値」にする

`src/simulation/constants.test.ts`:
- import から `DIFFUSION_C`・`FLOW_THRESHOLD_M` を消す
- 「表の値と一致する」（tech-spec §6.6）の `expect(FLOW_THRESHOLD_M).toBe(1e-5)` を `expect(DRY_DEPTH_M).toBe(1e-5)` にする
- 「水深の比較許容値は流れの閾値 θ と同じ値」を `it('水深の比較許容値は面を通れる水深の閾値と同じ値', () => { expect(DEPTH_EPSILON_M).toBe(DRY_DEPTH_M) })` にする
- 「エンジンの定数（spec 03 §3.11）」の `expect(DIFFUSION_C).toBe(0.5)` の行を消す

`src/simulation/Rainfall.ts`:
- import を `import type { RainfallInput, TerrainMeta } from './types.ts'` にする
- `TimedRainfall` の定義を消し、`planRainSchedule(rain: RainfallInput, …)` にする

`src/simulation/Rainfall.test.ts`: import の `type TimedRainfall` を消し、`import type { RainfallInput, TerrainMeta } from './types.ts'` にして、`TimedRainfall` を `RainfallInput` に置き換える（`sed -i 's/TimedRainfall/RainfallInput/g' src/simulation/Rainfall.test.ts` の後に import を整える）

`src/simulation/FlowSolver.ts`:
- 先頭の説明を次に置き換える:

```ts
/**
 * 1 step 分の水移動の計算（spec 08 §3。4 近傍の局所慣性式）。エンジンの内部モジュールで、外部には公開しない。
 * 流量は面（セルとセルの境）に置き、面の走査は行優先の固定の順（結果を決定的にする）。02 の地形解析
 * （src/simulation/terrain/）は東から時計回りの順序を使う。どちらも決定的にするための固定の順序で、
 * 揃える必要は無いので、意図的に別の順序を使っている
 */
```

- constants の import を `import { CFL_ALPHA, DRY_DEPTH_M, DT_MAX_S, FROUDE_MAX, GRAVITY, THETA } from './constants.ts'` にする
- `NEIGHBOR_DX`・`NEIGHBOR_DY` を次に置き換え、`NEIGHBOR_WEIGHT`・`FLOW_K`・`UNIT_X`・`UNIT_Y` を消す:

```ts
/**
 * 4 近傍の面の表（北・西・東・南。spec 08 §3.7、R08-2）。y は南向きが正。07 の流出の縁のマスク
 * （outflowCells.ts）はこの表を import する（レビュー 1 の R1）
 */
export const NEIGHBOR_DX = Int8Array.of(0, -1, 1, 0)
export const NEIGHBOR_DY = Int8Array.of(-1, 0, 0, 1)
```

- `Scratch`・`createScratch`・`StepFlow`・`outflowCandidates`・`edgeOutflowCandidates`・`interiorOutflowCandidates`・`solveStep`・`computeFlowVectors` を消す。`TerrainArrays`・`ScanWindow`・`FlowVectors`（説明を「流れのベクトル（x は東が正、y は南が正。m/s）」にする）と Task 3 で足した関数は残す。Task 3 で足した区切りのコメント（`// ---…` と「4 近傍の局所慣性式…」の 2 行）は、先頭の説明と重なるので消す

`src/simulation/FlowSolver.test.ts`:
- 旧い describe（`solveStep（spec 03 §3.2・§3.3）`・`computeFlowVectors（spec 03 §3.9）`・`内側のセルの近傍の添字（03 の軽微 8、spec 06 §5.2）`）を消す（`random` は Task 3 でファイルの最上位に移してある）
- import から `computeFlowVectors`・`createScratch`・`edgeOutflowCandidates`・`FLOW_K`・`interiorOutflowCandidates`・`solveStep` を消し、`FLOW_THRESHOLD_M` を `DRY_DEPTH_M` に替える（`sed -i 's/FLOW_THRESHOLD_M/DRY_DEPTH_M/g' src/simulation/FlowSolver.test.ts`）
- ファイルの先頭に足す:

```ts
describe('面の表（spec 08 §3.7、レビュー 1 の R1）', () => {
  it('NEIGHBOR_DX・NEIGHBOR_DY は 4 近傍（北・西・東・南）', () => {
    expect(Array.from(NEIGHBOR_DX)).toEqual([0, -1, 1, 0])
    expect(Array.from(NEIGHBOR_DY)).toEqual([-1, 0, 0, 1])
  })
})
```

（import に `NEIGHBOR_DX`・`NEIGHBOR_DY` を足す）

`src/simulation/WaterGrid.ts`:
- `beginStep` を消す（局所慣性式は走査範囲の有効セルの next をすべて書くので、写しは要らない）
- 先頭の説明の「W と W'」を「h と h'」に、`endStep` の説明の根拠 (2) を「(2) 水の出どころは h > 0 のセルだけで、水は 1 step に面を 1 つ越えるだけ（上下左右の周囲 1 セル。spec 08 §3.7）」にする。雨のセルは雨の登録のときに `include` するので走査範囲の中にある、の 1 文を足す

`src/simulation/WaterGrid.test.ts`: 「beginStep は走査範囲の W を W' に写す」のテストを消し、残りのテストの `g.beginStep()` の行を消す

- [ ] **Step 5: エンジンを置き換える**

`src/simulation/TsSimulationEngine.ts`（全体）:

```ts
/**
 * SimulationEngine の TypeScript 実装（tech-spec §6.2、spec 08 §3〜§5.1）。4 近傍の局所慣性式で、
 * 時間刻み dt はエンジンが毎 step 決める
 */
import {
  MANNING_N,
  SETTLE_CAP_S,
  SETTLE_VELOCITY_M_PER_S,
  SPILL_TOLERANCE_M,
} from './constants.ts'
import {
  applyFaceFlows,
  cellVelocities,
  clearFaces,
  clearFacesOutside,
  createFaces,
  type Faces,
  type FlowVectors,
  faceVelocityMax,
  limitOutflows,
  type ScanWindow,
  type TerrainArrays,
  timeStep,
  updateFaceFlows,
} from './FlowSolver.ts'
import { planRainSchedule, type RainSchedule } from './Rainfall.ts'
import type {
  RainfallInput,
  SimulationEngine,
  SimulationEvent,
  StepStats,
  StopReason,
  TerrainMeta,
} from './types.ts'
import { WaterGrid } from './WaterGrid.ts'

/** 'bbox': 濡れたセルの外接矩形だけを走査する（既定）。'full': 全セルを走査する（比較用） */
export type ScanMode = 'bbox' | 'full'

export interface EngineOptions {
  scanMode?: ScanMode
  /** Manning の粗度係数（既定 MANNING_N。テストで摩擦を変えるため。R08-3 の値は UI から変えない） */
  manningN?: number
  /** 自動停止の面の流速（m/s。既定 SETTLE_VELOCITY_M_PER_S。テストで止まらない条件を作るため） */
  settleVelocityMPerS?: number
}

interface Depression {
  id: number
  pitIndex: number
  spillElevation: number
}

interface Loaded {
  terrain: TerrainArrays
  meta: TerrainMeta
  grid: WaterGrid
  faces: Faces
}

/** 登録した雨と、その時間雨量（累積雨量の計算に使う） */
type Rain = RainSchedule & { intensityMmPerH: number }

const isNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0

export class TsSimulationEngine implements SimulationEngine {
  readonly scanMode: ScanMode
  readonly manningN: number
  readonly settleVelocityMPerS: number
  private loaded: Loaded | null = null
  private depressions: Depression[] = []
  private notified = new Uint8Array(0)
  private rain: Rain | null = null
  private stepCount = 0
  private totalWater = 0
  private outflowWater = 0
  private timeS = 0
  /** この step の始めの最大水深（前の step の endStep の値。spec 08 §3.3） */
  private hMax = 0
  /** 前の step の面の流速の最大（spec 08 §3.3） */
  private uMax = 0
  /** flowVectors の出力（使い回す。loadTerrain で捨てる。spec 06 §5.2） */
  private flow: FlowVectors | undefined = undefined

  constructor(options: EngineOptions = {}) {
    this.scanMode = options.scanMode ?? 'bbox'
    this.manningN = options.manningN ?? MANNING_N
    this.settleVelocityMPerS = options.settleVelocityMPerS ?? SETTLE_VELOCITY_M_PER_S
    if (!isNonNegative(this.manningN)) {
      throw new RangeError(`粗度係数が不正です: ${this.manningN}`)
    }
    if (!isNonNegative(this.settleVelocityMPerS)) {
      throw new RangeError(`停止の流速が不正です: ${this.settleVelocityMPerS}`)
    }
  }

  loadTerrain(elevation: Float32Array, validMask: Uint8Array, meta: TerrainMeta): void {
    const { width, height, cellSizeM } = meta
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new RangeError(`グリッドの大きさが不正です: ${width} × ${height}`)
    }
    if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
      throw new RangeError(`セルの大きさが不正です: ${cellSizeM}`)
    }
    const n = width * height
    if (elevation.length !== n || validMask.length !== n) {
      throw new RangeError(
        `配列の長さがグリッドと合いません: 標高 ${elevation.length}、マスク ${validMask.length}、セル数 ${n}`,
      )
    }
    const mask = validMask.slice()
    this.loaded = {
      terrain: { width, height, elevation: elevation.slice(), validMask: mask },
      meta: { width, height, cellSizeM },
      grid: new WaterGrid(width, height, this.scanMode === 'full'),
      faces: createFaces(width, height, mask),
    }
    this.depressions = []
    this.notified = new Uint8Array(0)
    this.flow = undefined
    this.rain = null
    this.resetCounters()
  }

  setRainfall(rain: RainfallInput): void {
    const { terrain, meta, grid } = this.require()
    const plan = planRainSchedule(rain, terrain.validMask, meta)
    this.rain = { ...plan, intensityMmPerH: rain.intensityMmPerH }
    grid.include(plan.x0, plan.y0, plan.x1, plan.y1)
    if (plan.instantDepthM > 0) {
      for (const i of plan.cells) {
        grid.current[i] += plan.instantDepthM
        if (grid.current[i] > this.hMax) this.hMax = grid.current[i]
      }
      this.totalWater += plan.instantDepthM * plan.cells.length * meta.cellSizeM * meta.cellSizeM
    }
  }

  /**
   * テスト用（計画で決めたこと 11。SimulationEngine には無い）: 各セルに水深を足し、走査範囲を全体にして、
   * 投入量に数える。無効セルに水を置く・負や有限でない水深・長さの違いは RangeError
   */
  setInitialWater(depth: Float64Array): void {
    const { terrain, meta, grid } = this.require()
    if (depth.length !== grid.current.length) {
      throw new RangeError(`水深の配列の長さがグリッドと合いません: ${depth.length}`)
    }
    let sum = 0
    for (let i = 0; i < depth.length; i++) {
      const d = depth[i]
      if (!isNonNegative(d)) throw new RangeError(`水深が不正です: セル ${i}、${d}`)
      if (d === 0) continue
      if (terrain.validMask[i] === 0) throw new RangeError(`無効セル ${i} に水は置けません`)
      grid.current[i] += d
      if (grid.current[i] > this.hMax) this.hMax = grid.current[i]
      sum += d
    }
    grid.include(0, 0, terrain.width, terrain.height)
    this.totalWater += sum * meta.cellSizeM * meta.cellSizeM
  }

  step(): StepStats {
    const { terrain, meta, grid, faces } = this.require()
    const dx = meta.cellSizeM
    const area = dx * dx
    const rain = this.rain
    const rainEnd = rain === null ? 0 : rain.endS
    const raining = rain !== null && this.timeS < rainEnd
    let dt = timeStep(this.hMax, this.uMax, dx)
    // 雨の終わりで切る（spec 08 §3.3）。投入の総量が 強度 × 継続時間 に一致する
    const endsNow = raining && this.timeS + dt >= rainEnd
    if (endsNow) dt = rainEnd - this.timeS
    const before: ScanWindow = { x0: grid.x0, y0: grid.y0, x1: grid.x1, y1: grid.y1 }
    updateFaceFlows(terrain, grid.current, grid, faces, dt, dx, this.manningN)
    limitOutflows(terrain, grid.current, grid, faces, dt, dx)
    const outflowQ = applyFaceFlows(terrain, grid.current, grid.next, grid, faces, dt, dx)
    if (raining && rain !== null) {
      // 雨のセルは登録のときに走査範囲に含め、降っている間は濡れているので範囲に残る（spec 08 §4.2）
      const add = rain.rateMPerS * dt
      for (const i of rain.cells) grid.next[i] += add
      this.totalWater += add * rain.cells.length * area
    }
    const uMax = faceVelocityMax(grid, faces)
    const summary = grid.endStep()
    clearFacesOutside(faces, before, grid)
    this.stepCount++
    // 雨の終わりの step は T_rain をそのまま入れる（t + (T_rain − t) は丸めで T_rain に戻らないことがある）
    this.timeS = endsNow ? rainEnd : this.timeS + dt
    this.hMax = summary.maxDepth
    this.uMax = uMax
    const outflowM3 = outflowQ * dx * dt
    this.outflowWater += outflowM3
    const storedWater = summary.depthSum * area
    const rainingAfter = rain !== null && this.timeS < rainEnd
    const settled = !rainingAfter && uMax < this.settleVelocityMPerS
    const stopReason: StopReason | null = settled
      ? 'settled'
      : !rainingAfter && this.timeS - rainEnd >= SETTLE_CAP_S
        ? 'cap'
        : null
    return {
      step: this.stepCount,
      totalWater: this.totalWater,
      storedWater,
      outflowWater: this.outflowWater,
      maxDepth: summary.maxDepth,
      floodedArea: summary.floodedCells * area,
      settled,
      massError: this.totalWater - storedWater - this.outflowWater,
      events: this.detectSpills(terrain.elevation, grid.current),
      timeS: this.timeS,
      dtS: dt,
      raining: rainingAfter,
      rainDepthMm: this.rainDepthMm(),
      outflowRateM3PerS: outflowM3 / dt,
      stopReason,
    }
  }

  reset(): void {
    const { grid, faces } = this.require()
    grid.clear()
    clearFaces(faces)
    this.notified.fill(0)
    this.rain = null
    this.resetCounters()
  }

  waterDepth(): Float64Array {
    return this.require().grid.current
  }

  /** テスト用（計画で決めたこと 11）: 面の流量と、この step の始めの h_f。読み取り専用として扱う */
  faceFlows(): { qx: Float64Array; qy: Float64Array; hfx: Float64Array; hfy: Float64Array } {
    const { qx, qy, hfx, hfy } = this.require().faces
    return { qx, qy, hfx, hfy }
  }

  /** テスト用（計画で決めたこと 11）: 今の走査範囲 */
  scanWindow(): ScanWindow {
    const { x0, y0, x1, y1 } = this.require().grid
    return { x0, y0, x1, y1 }
  }

  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void {
    const { terrain } = this.require()
    const n = terrain.width * terrain.height
    for (const d of list) {
      if (!Number.isInteger(d.pitIndex) || d.pitIndex < 0 || d.pitIndex >= n) {
        throw new RangeError(`窪地 ${d.id} の最低点のセル番号が範囲外です: ${d.pitIndex}`)
      }
      if (terrain.validMask[d.pitIndex] !== 1) {
        throw new RangeError(`窪地 ${d.id} の最低点が無効セルです: ${d.pitIndex}`)
      }
      if (!Number.isFinite(d.spillElevation)) {
        throw new RangeError(`窪地 ${d.id} の spill 標高が有限ではありません: ${d.spillElevation}`)
      }
    }
    this.depressions = list.map(({ id, pitIndex, spillElevation }) => ({
      id,
      pitIndex,
      spillElevation,
    }))
    this.notified = new Uint8Array(list.length)
  }

  flowVectors(): { x: Float32Array; y: Float32Array } {
    const { terrain, grid, faces } = this.require()
    this.flow = cellVelocities(terrain, grid.current, grid, faces, this.flow)
    return this.flow
  }

  /** 累積雨量（mm）。durationS = 0 の雨は置いた量（計画で決めたこと 5） */
  private rainDepthMm(): number {
    const rain = this.rain
    if (rain === null) return 0
    if (rain.endS === 0) return rain.intensityMmPerH
    return (rain.intensityMmPerH * Math.min(this.timeS, rain.endS)) / 3600
  }

  /** まだ通知していない窪地のうち、最低点の水面標高が spill 標高 − 1cm に達したもの（R03-6。spec 08 §6.2 で変えない） */
  private detectSpills(elevation: Float32Array, w: Float64Array): SimulationEvent[] {
    const events: SimulationEvent[] = []
    for (let k = 0; k < this.depressions.length; k++) {
      if (this.notified[k] !== 0) continue
      const d = this.depressions[k]
      // 最低点が乾いている窪地は溢れていない。深さが越流の余裕（1cm）以下の窪地が、雨なしで通知されるのを防ぐ
      if (
        w[d.pitIndex] > 0 &&
        elevation[d.pitIndex] + w[d.pitIndex] >= d.spillElevation - SPILL_TOLERANCE_M
      ) {
        this.notified[k] = 1
        events.push({
          type: 'spill',
          step: this.stepCount,
          timeS: this.timeS,
          depressionId: d.id,
          spillElevation: d.spillElevation,
        })
      }
    }
    return events
  }

  private resetCounters(): void {
    this.stepCount = 0
    this.totalWater = 0
    this.outflowWater = 0
    this.timeS = 0
    this.hMax = 0
    this.uMax = 0
  }

  private require(): Loaded {
    if (this.loaded === null) throw new Error('loadTerrain を先に呼んでください')
    return this.loaded
  }
}
```

- [ ] **Step 6: テストの補助を改める**

`src/simulation/testing/fixtures.test-support.ts`:
- import に `import type { RainfallInput, StepStats, TerrainMeta } from '../types.ts'` を使う（`RainfallInput` を足す）
- `runUntilSettled` を消し、次を足す:

```ts
/** stopReason（settled・cap）が付くまで step を回し、最後の統計を返す。maxSteps で届かなければ例外 */
export function runUntilStopped(engine: TsSimulationEngine, maxSteps: number): StepStats {
  for (let n = 0; n < maxSteps; n++) {
    const stats = engine.step()
    if (stats.stopReason !== null) return stats
  }
  throw new Error(`${maxSteps} step で止まりませんでした`)
}

/** 平衡のテストの止め方の閾値（spec 08 §9.1）: 水深の変化 0.1 mm/h（m/s） */
export const QUIET_EQUILIBRIUM_M_PER_S = 0.1 / 1000 / 3600

/** 満水との一致の止め方の閾値（spec 08 §9.1）: 水深の変化 3 mm/h（m/s） */
export const QUIET_FILL_M_PER_S = 3 / 1000 / 3600

/**
 * 平衡のテストの止め方（spec 08 §9.1。UI の停止〈§3.9〉とは別）: 雨が終わった後、流れによる水深の変化の最大
 * max |Δh| / dtS が maxRateMPerS 未満になった step の統計を返す。maxSteps で届かなければ例外
 */
export function runUntilQuiet(
  engine: TsSimulationEngine,
  maxRateMPerS: number,
  maxSteps: number,
): StepStats {
  for (let n = 0; n < maxSteps; n++) {
    const before = engine.waterDepth().slice()
    const stats = engine.step()
    if (stats.raining) continue
    const after = engine.waterDepth()
    let change = 0
    for (let i = 0; i < after.length; i++) {
      const d = Math.abs(after[i] - before[i])
      if (d > change) change = d
    }
    if (change / stats.dtS < maxRateMPerS) return stats
  }
  throw new Error(`${maxSteps} step で水深の変化が ${maxRateMPerS} m/s 未満になりませんでした`)
}

/** 開始のときに一度に置く円の雨（durationS = 0。amountMm の雨を置く。計画で決めたこと 5） */
export function instantRain(
  center: { x: number; y: number },
  radiusM: number,
  amountMm: number,
): RainfallInput {
  return {
    x: center.x,
    y: center.y,
    radiusM,
    intensityMmPerH: amountMm,
    durationS: 0,
    wholeRange: false,
  }
}
```

- `wetSurfaceRange` を次に置き換える（水深が `minDepthM` 以下のセルを除く。既定 0 なら今までと同じ）:

```ts
/** 水深が minDepthM を超えるセルの数と、その水面標高 Z + h の最小・最大（minDepthM の既定 0 は濡れたセルすべて） */
export function wetSurfaceRange(
  t: Terrain,
  w: Float64Array,
  minDepthM = 0,
): { cells: number; min: number; max: number } {
  let cells = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < w.length; i++) {
    if (w[i] <= minDepthM) continue
    const h = t.elevation[i] + w[i]
    cells++
    if (h < min) min = h
    if (h > max) max = h
  }
  return { cells, min, max }
}
```

- `outletDistances` を消す（旧い満水との一致のテストだけが使っていた）

- [ ] **Step 7: §9.1 の 4 ケースと平衡水位を書き直す（全体を置き換える）**

`src/simulation/scenarios.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SURFACE_ELEVATION_TOLERANCE_M } from './constants.ts'
import {
  buildTerrain,
  cellCenter,
  centroidX,
  cone,
  engineOn,
  instantRain,
  levelForVolume,
  maxWetElevation,
  QUIET_EQUILIBRIUM_M_PER_S,
  runUntilQuiet,
  twoBasins,
  walledBasin,
  wetSurfaceRange,
} from './testing/fixtures.test-support.ts'
import type { SimulationEvent } from './types.ts'

/** 平衡のテストの摩擦（spec 08 §9.1。n = 0.03 では排水の慣性で池の水位が下がったまま残る地形がある） */
const EQUILIBRIUM = { manningN: 0.1 } as const
/** 水面が平らかを見るセルの水深の下限（斜面に残る 0.1 mm 以下の膜を除く。spec 08 §9.1） */
const FILM_M = 1e-4
/** 平衡のテストの上限の step 数（spec 08 §9.1） */
const MAX_STEPS = 1_000_000

describe('base-spec §47 の 4 ケースと平衡水位（spec 08 §9.1）', () => {
  it('平面: 縁で囲んだ平らな盆地に一度に置いた水が広がり、止めた後の水面の最大と最小の差が 1cm 以内', () => {
    // 12 × 12（床 10 × 10 = 100m²、縁 10m）。約 12.6m³ を床の北西寄りに置く
    const t = walledBasin(12, 0, 10)
    const engine = engineOn(t, EQUILIBRIUM)
    engine.setRainfall(instantRain(cellCenter(3, 3, 1), 2, 1000))
    const stats = runUntilQuiet(engine, QUIET_EQUILIBRIUM_M_PER_S, MAX_STEPS)
    const r = wetSurfaceRange(t, engine.waterDepth(), FILM_M)
    expect(r.cells).toBe(100)
    expect(r.max - r.min).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(stats.outflowWater).toBe(0)
  })

  it('傾斜面: 重心が下り方向へ移り、置いた位置より 1cm 以上高い標高のセルは水を得ない（慣性で上る分を 1cm まで許す）', () => {
    // 東へ 1 セルにつき 0.2m 下る斜面。雨の深さ（約 5cm）は 1 セルの高低差より小さい
    const t = buildTerrain(40, 41, 1, (x) => (39 - x) * 0.2)
    const engine = engineOn(t)
    engine.setRainfall(instantRain(cellCenter(10, 20, 1), 3, 50))
    const zTop = maxWetElevation(t, engine.waterDepth())
    const start = centroidX(t, engine.waterDepth())
    for (let n = 0; n < 30; n++) {
      engine.step()
      expect(maxWetElevation(t, engine.waterDepth())).toBeLessThanOrEqual(zTop + 0.01)
    }
    expect(centroidX(t, engine.waterDepth())).toBeGreaterThan(start + 1)
  })

  it('単純窪地: 窪地の外に置いた水が窪地に集まり、止めた後の水面が 1cm 以内で平ら', () => {
    // すり鉢（中心 (10, 10)、勾配 0.1）。雨は中心から 6 セル東の斜面に置く
    const t = cone(21, 0.1, 5)
    const engine = engineOn(t, EQUILIBRIUM)
    engine.setRainfall(instantRain(cellCenter(16, 10, 1), 1.5, 200))
    const stats = runUntilQuiet(engine, QUIET_EQUILIBRIUM_M_PER_S, MAX_STEPS)
    const w = engine.waterDepth()
    const r = wetSurfaceRange(t, w, FILM_M)
    expect(r.max - r.min).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(w[10 * 21 + 10]).toBeGreaterThan(0.1)
    expect(w[10 * 21 + 16]).toBeLessThanOrEqual(FILM_M)
    expect(stats.outflowWater).toBe(0)
  })

  it('越流: 峠でつながった 2 つの窪地の一方に容量を超える水を置くと、越流イベントが 1 回だけ出て（経過時間つき）、もう一方が水を得る', () => {
    // 西の盆地 A（床 14 × 9 = 126m²）と東の盆地 B を、高さ 1m の峠でつなぐ。A の峠までの容量は 126m³。
    // A の最低点（床は平らなので、どのセルでもよい）は北西の角のセル (1, 1) とし、雨の円の外に置く
    const t = twoBasins(1)
    const engine = engineOn(t)
    engine.setDepressions([
      { id: 1, pitIndex: 1 * 31 + 1, spillElevation: 1 },
      { id: 2, pitIndex: 5 * 31 + 23, spillElevation: 1 },
    ])
    // 中心 (7, 5)・半径 4m に約 150.8m³（A の容量を約 25m³ 超える。B は約 0.2m までしか満ちない）
    engine.setRainfall(instantRain(cellCenter(7, 5, 1), 4, 3000))
    expect(engine.waterDepth()[1 * 31 + 1]).toBe(0)
    const events: SimulationEvent[] = []
    for (let n = 0; n < 3000; n++) events.push(...engine.step().events)
    expect(events.map((e) => e.depressionId)).toEqual([1])
    expect(events[0]?.step).toBeGreaterThan(1)
    expect(events[0]?.timeS).toBeGreaterThan(0)
    const w = engine.waterDepth()
    let inB = 0
    for (let y = 1; y < 10; y++) for (let x = 16; x < 30; x++) inB += w[y * 31 + x] ?? 0
    expect(inB).toBeGreaterThan(1)
  })

  it('平衡水位: 縁に囲まれた窪地に体積 V の水を入れると、止めた後の水面標高が理論値と 1cm 以内で一致', () => {
    const t = cone(21, 0.1, 5)
    const engine = engineOn(t, EQUILIBRIUM)
    const volume = 20
    const amountMm = (volume * 1000) / (Math.PI * 9)
    engine.setRainfall(instantRain(cellCenter(10, 10, 1), 3, amountMm))
    const stats = runUntilQuiet(engine, QUIET_EQUILIBRIUM_M_PER_S, MAX_STEPS)
    const level = levelForVolume(t, volume)
    const r = wetSurfaceRange(t, engine.waterDepth(), FILM_M)
    expect(Math.abs(r.min - level)).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(Math.abs(r.max - level)).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(stats.outflowWater).toBe(0)
  })
})
```

- [ ] **Step 8: 越流・性質・流出の縁のテストを新しい形に合わせる**

`src/simulation/spillEvents.test.ts`:
- import を `import { buildTerrain, cellCenter, engineOn, instantRain, walledBasin } from './testing/fixtures.test-support.ts'` にする
- `rainOnFloor` の本体の `engine.addRainfall({ ...cellCenter(3, 3, 1), radiusM: 2.9, amountMm })` を `engine.setRainfall(instantRain(cellCenter(3, 3, 1), 2.9, amountMm))` に、`rainOnCorner` の本体を `engine.setRainfall(instantRain(cellCenter(1, 1, 1), 0.4, amountMm))` にする
- 「届いた step で 1 回だけ通知し、その後は通知しない」を次に置き換える:

```ts
  it('届いた step で 1 回だけ通知し（経過時間つき）、その後は通知しない', () => {
    const engine = setup()
    rainOnCorner(engine, 0.35)
    const events: SimulationEvent[] = []
    let reachedAt = -1
    let reachedTimeS = -1
    for (let n = 0; n < 3000; n++) {
      const s = engine.step()
      events.push(...s.events)
      const h = (BASIN.elevation[PIT] ?? 0) + (engine.waterDepth()[PIT] ?? 0)
      if (reachedAt < 0 && h >= SPILL - SPILL_TOLERANCE_M) {
        reachedAt = s.step
        reachedTimeS = s.timeS
      }
    }
    expect(reachedAt).toBeGreaterThan(1)
    expect(events).toEqual([
      { type: 'spill', step: reachedAt, timeS: reachedTimeS, depressionId: 7, spillElevation: SPILL },
    ])
  })
```

（「雨が窪地の端に局所的に溜まって…」は、局所慣性式でも最低点の水面が 0.20 m までしか上がらず 0.29 m に届かないことを計画の作成時に試作で確かめた。そのまま残す）

`src/simulation/properties.test.ts`（最小の直し。Task 7 で全体を書き直す）:
- `scenarioArb` の `rain: { x: …, y: …, radiusM: …, amountMm: r.amountMm }` を `rain: { x: …, y: …, radiusM: …, intensityMmPerH: r.amountMm, durationS: 0, wholeRange: false }` にする（一度に置く雨）
- `run` の中の `engine.addRainfall(r.rain)` を `engine.setRainfall(r.rain)` にする
- `maxPrincipleViolation` と「局所的な最大値原理」のテストを消す（局所慣性式では成り立たない。spec §1.1・§9.2）
- `packStats` の `fields` を 13 にし、並べる値の最後に `s.timeS, s.dtS, s.raining ? 1 : 0, s.rainDepthMm, s.outflowRateM3PerS` を足す（`stopReason` は `toStrictEqual` で比べる）

`src/simulation/outflowCells.test.ts`: 「内側の無効セルの周り（斜めを含む）が 1 になり、無効セルそのものは 0」を次に置き換える（マスクは FlowSolver の表に従って 4 近傍になる。spec §3.7）:

```ts
  it('内側の無効セルの上下左右が 1 になり（斜めは 0。FlowSolver の面の表が 4 近傍。spec 08 §3.7）、無効セルそのものは 0', () => {
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
      '1001001',
      '1010101',
      '1001001',
      '1000001',
      '1111111',
    ])
  })
```

- [ ] **Step 9: Worker を新しいエンジンに合わせる**

`src/workers/simulationRunner.ts`:
- `ZERO_STATS` の最後に `timeS: 0, dtS: 0, raining: false, rainDepthMm: 0, outflowRateM3PerS: 0, stopReason: null,` を足す
- `start` の `this.engine.addRainfall(rain)` を `this.engine.setRainfall(rain)` に、その前のコメントの「addRainfall を試す前に」を「setRainfall を試す前に」にする

`src/workers/playbackScheduler.ts` の `tick` の自動停止の判定を次にする（時間の倍率は Task 10）:

```ts
      if (last.stopReason !== null) {
        // 自動停止（settled・cap。spec 08 §3.9・§6.1）の後に回しても何も変わらないので、自動で止める
        this.running = false
        break
      }
```

`src/workers/playbackScheduler.test.ts` の `stats` を次にする（テストの名前と期待値は Task 10 で書き直す）:

```ts
function stats(step: number, settled: boolean): StepStats {
  return {
    step,
    totalWater: 0,
    storedWater: 0,
    outflowWater: 0,
    maxDepth: 0,
    floodedArea: 0,
    settled,
    massError: 0,
    events: [],
    timeS: step,
    dtS: 1,
    raining: false,
    rainDepthMm: 0,
    outflowRateM3PerS: 0,
    stopReason: settled ? 'settled' : null,
  }
}
```

`src/workers/simulationRunner.test.ts`:
- `const RAIN = { x: 2.5, y: 2.5, radiusM: 1, amountMm: 100 }` を `const RAIN: RainfallInput = { x: 2.5, y: 2.5, radiusM: 1, intensityMmPerH: 100, durationS: 0, wholeRange: false }` にし、`import type { RainfallInput } from '../simulation/types'` を足す
- 「表示なら [列, 行, 方位, 大きさ] を送り…」の雨を `rain: { x: 1.5, y: 1.5, radiusM: 0.4, intensityMmPerH: 1000, durationS: 0, wholeRange: false },` にし、その後の `h.runner.handle({ type: 'step' })` と `h.returnAll()` の 2 行を次に替える（局所慣性式は面の流量が 0 から始まるので、中央のセル (2, 2) に流れが届くまで 3 step 進める）:

```ts
    for (let n = 0; n < 3; n++) {
      h.runner.handle({ type: 'step' })
      h.returnAll()
    }
```

- 2 か所の `stats.settled).toBe(true)` を `stats.stopReason).toBe('settled')` にする（テストの名前の「平衡に達すると」は「自動停止（settled）すると」にする）

`src/workers/flowArrows.test.ts`: import に `instantRain` を足し、最後のテストの `engine.addRainfall({ x: 4.5, y: 4.5, radiusM: 0.4, amountMm: 100 })` を次の 2 行にする（面の流量は 1 step 後に立つ）:

```ts
    engine.setRainfall(instantRain({ x: 4.5, y: 4.5 }, 0.4, 100))
    engine.step()
```

テストの名前の「置いた水の矢印は」を「置いた水の 1 step 後の矢印は」にする

- [ ] **Step 10: メインのつなぎ（暫定の橋渡し）と偽物を合わせる**

`src/ui/simulationSession.ts`:
- `start` の `this.client.start({ x, y, radiusM, amountMm }, this.runId)` を次にする（計画で決めたこと 3）:

```ts
    // M1 の暫定（計画で決めたこと 3）: 雨量 amountMm を開始のときに一度に置く。Task 12 で時間雨量・継続時間にする
    this.client.start(
      { x, y, radiusM, intensityMmPerH: amountMm, durationS: 0, wholeRange: false },
      this.runId,
    )
```

- `onFrame` の `if (stats.settled) {` を `if (stats.stopReason !== null) {` に、`if (stats.settled && state.status === 'paused')` を `if (stats.stopReason !== null && state.status === 'paused')` にし、そこのコメントの「settled でも」を「自動停止でも」にする

`src/ui/simulationSession.test.ts`:
- start の期待値の `amountMm: 100,` を `intensityMmPerH: 100,\n        durationS: 0,\n        wholeRange: false,` にする
- `statsAt(40, { settled: true })` と `statsAt(12, { settled: true })` を `statsAt(40, { settled: true, stopReason: 'settled' })`・`statsAt(12, { settled: true, stopReason: 'settled' })` にする
- 越流イベントの `{ type: 'spill' as const, step: 9, depressionId: 4, spillElevation: 12.7 }` に `timeS: 30,` を足す（ストアの一覧の期待値は Task 13 まで変えない）

`src/bridge/fakeWorker.test-support.ts` の `statsAt` の既定に `timeS: step, dtS: 1, raining: false, rainDepthMm: 0, outflowRateM3PerS: 0, stopReason: null,` を足す（`events: []` の後、`...overrides` の前）

`src/bridge/SimulationClient.test.ts`: `{ x: 1, y: 2, radiusM: 10, amountMm: 100 }` を `{ x: 1, y: 2, radiusM: 10, intensityMmPerH: 100, durationS: 3600, wholeRange: false }` に、`{ x: 0, y: 0, radiusM: 1, amountMm: 1 }` を `{ x: 0, y: 0, radiusM: 1, intensityMmPerH: 1, durationS: 3600, wholeRange: false }` にする

`src/state/displayStats.test-support.ts`（新規）:

```ts
import type { DisplayStats } from './simulationStore'

/** テスト用: 画面に出す統計。既定はすべて 0（Step 0・雨なし・止まっていない）。必要な項目だけ上書きする */
export function displayStats(overrides: Partial<DisplayStats> = {}): DisplayStats {
  return {
    step: 0,
    totalWater: 0,
    storedWater: 0,
    outflowWater: 0,
    maxDepth: 0,
    floodedArea: 0,
    settled: false,
    massError: 0,
    timeS: 0,
    dtS: 0,
    raining: false,
    rainDepthMm: 0,
    outflowRateM3PerS: 0,
    stopReason: null,
    ...overrides,
  }
}
```

`src/state/simulationStore.test.ts`:
- `const stats = (step: number): DisplayStats => ({ … })` を `const stats = (step: number): DisplayStats => displayStats({ step, totalWater: 31.4, storedWater: 31.4, maxDepth: 0.1, floodedArea: 300 })` にし、`import { displayStats } from './displayStats.test-support'` を足す
- 2 か所の `addSpills([{ type: 'spill', step: …, depressionId: …, spillElevation: … }])` の各イベントに `timeS: 0,` を足す

`src/ui/components/StatisticsPanel.tsx` の `ZERO` の最後に `timeS: 0, dtS: 0, raining: false, rainDepthMm: 0, outflowRateM3PerS: 0, stopReason: null,` を足す（統計の行は Task 13 で改める）

`src/ui/components/StatisticsPanel.test.tsx`: `setStats({ step: 1234, … }, 59.6)` の統計を `displayStats({ step: 1234, totalWater: (Math.PI * 100 * 100) / 1000, storedWater: 0.456, outflowWater: 13.24, maxDepth: 0.4321, floodedArea: 82.4 })` にし、`import { displayStats } from '../../state/displayStats.test-support'` を足す

`src/ui/components/ControlsSection.test.tsx`: `settledAt` を `const settledAt = (step: number): DisplayStats => displayStats({ step, totalWater: 1, storedWater: 1, settled: true, stopReason: 'settled' })` にし、import を足す

`scripts/bench-engine.ts`（Task 9 で出力を作り直す。ここではコンパイルが通るようにだけ直す）:
- `engine.addRainfall(rain)` を `engine.setRainfall(rain)` に、2 か所の `last.settled` を `last.stopReason !== null`（`last?.settled ? …` は `last?.stopReason ? …`）にする
- 2 つの雨を `{ ...center, radiusM: 10, intensityMmPerH: 100, durationS: 0, wholeRange: false }`・`{ ...center, radiusM: 100, intensityMmPerH: 100, durationS: 0, wholeRange: false }` にする

- [ ] **Step 11: テストが通ることを確かめる**

Run: `pnpm vitest run src/simulation src/workers src/bridge src/state src/ui`
Expected: PASS。`scenarios.test.ts` の平衡の 3 件は、試作で 1,741〜7,404 step（`n = 0.1`、spec §9.1）。落ちたら数値（step 数・`r.max − r.min`・水深）を報告に書いて止める（許容を変えない）

- [ ] **Step 12: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。`pnpm depcheck` で `Faces` などの型の import が規則に触れないこと。ユニットの件数を報告に書く

Run: `pnpm build && pnpm size`
Expected: 初期ロードは Task 1 の値と同じ（エンジンは Worker のチャンク）。Worker のチャンクの大きさの差を報告に書く

- [ ] **Step 13: コミット**

```bash
git add -A src/simulation src/workers src/bridge src/state src/ui scripts/bench-engine.ts
git commit -m "spec 08 Task 5: エンジンを 4 近傍の局所慣性式に差し替える（UI の雨は M3 まで一度に置く）"
```

---
### Task 6: 満水との一致を 4 近傍の F と局所慣性式で書き直す（spec §9.1 の表、M0 の承認の軽微 m2、計画で決めたこと 1・15）

**Files:**
- Create: `src/simulation/fillMatch.test.ts`（Task 2 で消したものの置き換え）
- 条件付きで Create: `src/simulation/fillMatch.slow.test.ts`（Step 4 の分岐）

**Interfaces:**
- Consumes: `analyzeDepressions`（Task 2。4 近傍の `fill`・`labels`）、`runUntilQuiet`・`QUIET_FILL_M_PER_S`（Task 5）、`EngineOptions.manningN`
- Produces: なし（テストだけ）

- [ ] **Step 1: テストを書く**

`src/simulation/fillMatch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { analyzeDepressions } from './terrain/analyzeDepressions.ts'
import {
  buildTerrain,
  engineOn,
  QUIET_FILL_M_PER_S,
  runUntilQuiet,
  type Terrain,
} from './testing/fixtures.test-support.ts'

/** 池のセル（4 近傍の Priority-Flood で窪地に入るセル）の |H − F| の許容（tech-spec §6.6 の目標。spec 08 §9.1） */
const POND_TOLERANCE_M = 0.01
/**
 * 池の外の有効セルの水深の許容（spec 08 §9.1）。止め方 3 mm/h の後も、緩い斜面には mm の膜が残る
 * （試作の最大 3.36 mm）。本物の不一致（1 cm 以上）は捕まえる。**後から黙って緩めない**（M0 の承認の軽微 m2。
 * 外れたら先に止め方の閾値か manningN を動かし、レビュー役に渡す）
 */
const OUTSIDE_TOLERANCE_M = 0.005
/** 上限の step 数（spec 08 §9.1。試作では 6,708〜32,646 step） */
const MAX_STEPS = 1_000_000

/** 地形と摩擦（spec 08 §9.1 の表。n は地形ごとに選んだ。凹凸は n = 0.03 だと排水の慣性で池の水位が F より約 17 mm 下がる） */
const TERRAINS: [string, Terrain, number][] = [
  [
    '凹凸（24 × 24、セル 1 m、n = 0.05）',
    buildTerrain(24, 24, 1, (x, y) => 10 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 0.02 * x),
    0.05,
  ],
  [
    '凹凸と無効セル（24 × 20、セル 3.9 m、n = 0.03）',
    buildTerrain(24, 20, 3.9, (x, y) =>
      x >= 9 && x <= 11 && y >= 8 && y <= 10
        ? Number.NaN
        : 10 + 0.8 * Math.sin(x * 0.9) * Math.sin(y * 0.8),
    ),
    0.03,
  ],
  [
    '入れ子の窪地（12 × 12、セル 1 m、東の縁に高さ 1.5 m の切れ目、n = 0.03）',
    buildTerrain(12, 12, 1, (x, y) => {
      if (x === 0 || y === 0 || x === 11 || y === 11) return x === 11 && y === 6 ? 1.5 : 3
      const bowl = 0.1 * Math.hypot(x - 5.5, y - 5.5)
      const pitA = Math.hypot(x - 3.5, y - 3.5) < 1.5 ? -0.5 : 0
      const pitB = Math.hypot(x - 8, y - 7.5) < 1.6 ? -0.3 : 0
      return bowl + pitA + pitB
    }),
    0.03,
  ],
]

describe('満水との一致（spec 08 §9.1、4 近傍の analyzeDepressions）', () => {
  it.each(TERRAINS)(
    '%s: 範囲全体に 2 m を一度に置き、水深の変化が 3 mm/h 未満になった水面が 4 近傍の F と一致する',
    (_, t, manningN) => {
      const { fill, labels } = analyzeDepressions({
        elevation: t.elevation,
        validMask: t.validMask,
        ...t.meta,
      })
      const engine = engineOn(t, { manningN })
      engine.setRainfall({
        x: 0,
        y: 0,
        radiusM: 1,
        intensityMmPerH: 2000,
        durationS: 0,
        wholeRange: true,
      })
      runUntilQuiet(engine, QUIET_FILL_M_PER_S, MAX_STEPS)
      const w = engine.waterDepth()
      let pond = 0
      let outside = 0
      let pondCells = 0
      let outsideCells = 0
      for (let i = 0; i < w.length; i++) {
        if ((t.validMask[i] ?? 0) === 0) continue
        const d = w[i] ?? 0
        expect(d).toBeGreaterThanOrEqual(0)
        if ((labels[i] ?? 0) !== 0) {
          pond = Math.max(pond, Math.abs((t.elevation[i] ?? 0) + d - (fill[i] ?? 0)))
          pondCells++
        } else {
          outside = Math.max(outside, d)
          outsideCells++
        }
      }
      expect(pondCells).toBeGreaterThan(0)
      expect(outsideCells).toBeGreaterThan(0)
      expect(pond).toBeLessThanOrEqual(POND_TOLERANCE_M)
      expect(outside).toBeLessThanOrEqual(OUTSIDE_TOLERANCE_M)
    },
    30_000,
  )
})
```

- [ ] **Step 2: 回して、実測を控える**

Run: `pnpm vitest run src/simulation/fillMatch.test.ts --reporter=verbose`
Expected: 3 件とも PASS。各テストの所要（ms）を報告に書く。試作の素の Node（spec §9.1 の表）は 0.50・0.19・0.28 秒、池の `|H − F|` の最大 4.69・4.20・3.62 mm、池の外の最大 3.36・3.03・2.60 mm

実測の `pond`・`outside`・step 数も報告に書くため、一時的に `console.log(label, pond, outside)` を足して 1 回回し、控えたら消す（コミットに残さない）。

- [ ] **Step 3: 許容を外れたときの分岐（M0 の承認の軽微 m2。許容は変えない）**

池の外（`outside`）か池（`pond`）が許容を外れたら:
1. 外れた地形だけ、止め方を `2 / 1000 / 3600`（2 mm/h。試作の池の外 2.16〜2.48 mm）にしたテストを試す。`fixtures.test-support.ts` に定数を足さず、`fillMatch.test.ts` の中で `const QUIET_FILL_STRICT_M_PER_S = 2 / 1000 / 3600` として、その地形の行に閾値の列を足す（`TERRAINS` の要素を `[名前, 地形, n, 閾値]` にする）
2. それでも外れたら `manningN` を 0.1 にして試す
3. どちらでも外れたら、テストを直さずに止め、実測（`pond`・`outside`・step 数・時間）を報告に書いてコントローラーに渡す（レビュー役とコーディネーターの裁定を待つ）

1・2 で通したときも、変えた閾値・`n` と実測を報告に書き、M1 のチェックポイントでレビュー役に渡す。**`POND_TOLERANCE_M`・`OUTSIDE_TOLERANCE_M` の値は変えない**。

- [ ] **Step 4: 時間の確かめ（spec §9.1。計画で決めたこと 15）**

Step 2 の verbose の所要のうち、750 ms（× 40 で 30 秒。カバレッジと並列の下の見込み）を超える地形があれば、その地形の行を `fillMatch.test.ts` の `TERRAINS` から外し、同じ中身の `src/simulation/fillMatch.slow.test.ts`（地形はその行だけ、`it.each` の timeout を 120_000 に、describe の名前の末尾に「（重い地形。spec 08 §9.1）」）に移す。超える地形が無ければ、このステップは何もしない（報告に「分けなかった」と書く）。

カバレッジの計測の下の所要は、Step 5 のゲートの `pnpm test:coverage` の出力（ファイルごとの所要）から `fillMatch.test.ts` の行を控え、報告と M1 の記録（Task 9）に書く（spec §9.1 の「CI の計測の結果は M1 の記録に書く」。GitHub Actions の所要は、ユーザーが push した後の CI で確かめる）

- [ ] **Step 5: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

- [ ] **Step 6: コミット**

```bash
git add src/simulation/fillMatch.test.ts
# Step 4 で分けたときだけ
git add src/simulation/fillMatch.slow.test.ts
git commit -m "spec 08 Task 6: 満水との一致を 4 近傍の F と局所慣性式で書き直す（止め方 3 mm/h、地形ごとの n）"
```

---

### Task 7: 性質のテストを §9.2 の形に書き直す（spec §9.2、レビュー 1 の M2、M0 の U7、計画で決めたこと 34）

**Files:**
- Modify（全体を置き換える）: `src/simulation/properties.test.ts`

**Interfaces:**
- Consumes: `TsSimulationEngine` の `setRainfall`・`setInitialWater`・`faceFlows`・`scanWindow`（Task 5）、`analyzeDepressions`（Task 2）、定数 `CFL_ALPHA`・`DT_MAX_S`・`GRAVITY`
- Produces: なし（テストだけ）

- [ ] **Step 1: テストを書く（全体を置き換える）**

`src/simulation/properties.test.ts`:

```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { CFL_ALPHA, DT_MAX_S, GRAVITY, massTolerance } from './constants.ts'
import { analyzeDepressions } from './terrain/analyzeDepressions.ts'
import type { ScanMode, TsSimulationEngine } from './TsSimulationEngine.ts'
import { buildTerrain, engineOn, sameBits, type Terrain } from './testing/fixtures.test-support.ts'
import type { RainfallInput, StepStats } from './types.ts'

const MAX_SIDE = 16
const KINDS = ['flat', 'slope', 'pits', 'bumpy', 'cliff'] as const

/**
 * 標高と水面を 1/256 m の格子に載せる（spec 08 §9.2 (b)）。|値| < 2^15 m なら、Float32 の標高・η0 − Z・Z + h が
 * すべて丸めなしで表せ、静水の保存をビット単位で確かめられる
 */
const snap = (v: number): number => Math.round(v * 256) / 256

/**
 * 地形: 平坦・斜面・複数の窪地・ランダムな凹凸・1 セルで 3 m 下がる段差（擁壁・崖）に、無効セルを混ぜる
 * （spec 08 §9.2）。標高は 1/256 m の格子に載せる
 */
const terrainArb: fc.Arbitrary<Terrain> = fc
  .record({
    width: fc.integer({ min: 3, max: MAX_SIDE }),
    height: fc.integer({ min: 3, max: MAX_SIDE }),
    cellSizeM: fc.constantFrom(0.98, 3.9, 7.8),
    kind: fc.constantFrom(...KINDS),
    a: fc.double({ min: -1, max: 1, noNaN: true }),
    b: fc.double({ min: -1, max: 1, noNaN: true }),
    cliffX: fc.integer({ min: 1, max: MAX_SIDE - 1 }),
    noise: fc.array(fc.integer({ min: 0, max: 1000 }), {
      minLength: MAX_SIDE * MAX_SIDE,
      maxLength: MAX_SIDE * MAX_SIDE,
    }),
    invalidPercent: fc.constantFrom(0, 0, 10, 30),
  })
  .map(({ width, height, cellSizeM, kind, a, b, cliffX, noise, invalidPercent }) => {
    const cliff = Math.min(cliffX, width - 1)
    const t = buildTerrain(width, height, cellSizeM, (x, y) => {
      const i = y * width + x
      if ((noise[(i * 7919) % noise.length] ?? 0) % 100 < invalidPercent) return Number.NaN
      switch (kind) {
        case 'flat':
          return 10
        case 'slope':
          return snap(10 + a * x + b * y)
        case 'pits':
          return snap(10 + (Math.abs(a) + 0.2) * Math.sin(x * 1.3) * Math.cos(y * 1.1))
        case 'bumpy':
          return snap(10 + ((noise[i] ?? 0) / 1000) * (Math.abs(b) * 5 + 0.01))
        case 'cliff':
          return snap(x < cliff ? 13 + 0.01 * (cliff - x) : 10 + 0.01 * (width - x))
      }
    })
    // 有効セルが 1 つも無い地形は降雨できないので、左上を有効にする
    if (t.validMask.every((v) => v === 0)) {
      t.validMask[0] = 1
      t.elevation[0] = 10
    }
    return t
  })

interface Scenario {
  terrain: Terrain
  rain: RainfallInput
  steps: number
}

/** 雨: 一度に置くもの（durationS = 0）と、継続時間のあるもの（強さ・時間・範囲全体をランダム） */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    terrain: terrainArb,
    steps: fc.integer({ min: 1, max: 200 }),
    cell: fc.nat(),
    radiusCells: fc.double({ min: 0.1, max: 8, noNaN: true }),
    intensityMmPerH: fc.integer({ min: 1, max: 300 }),
    durationS: fc.constantFrom(0, 3.5, 30, 120, 600),
    wholeRange: fc.boolean(),
  })
  .map(({ terrain, steps, cell, radiusCells, intensityMmPerH, durationS, wholeRange }) => {
    const valid: number[] = []
    terrain.validMask.forEach((v, i) => {
      if (v !== 0) valid.push(i)
    })
    const { width, height, cellSizeM } = terrain.meta
    // 降雨中心は有効セルの中心に置く（「降雨中心に標高データがありません」にしない）。半径の上限は planRainfall の検査
    const c = valid[cell % valid.length] ?? 0
    return {
      terrain,
      steps,
      rain: {
        x: ((c % width) + 0.5) * cellSizeM,
        y: (Math.floor(c / width) + 0.5) * cellSizeM,
        radiusM: Math.min(radiusCells, width + height) * cellSizeM,
        intensityMmPerH,
        durationS,
        wholeRange,
      },
    }
  })

/** シナリオを実行し、各 step の後に onStep を呼ぶ。before は step の前の水深の複製 */
function run(
  s: Scenario,
  scanMode: ScanMode,
  onStep: (engine: TsSimulationEngine, stats: StepStats, before: Float64Array) => void,
): TsSimulationEngine {
  const engine = engineOn(s.terrain, { scanMode })
  engine.setRainfall(s.rain)
  for (let n = 0; n < s.steps; n++) {
    const before = engine.waterDepth().slice()
    const stats = engine.step()
    onStep(engine, stats, before)
  }
  return engine
}

/** 統計の数値を Float64Array に詰める。sameBits で +0 と −0 まで区別して比べるため */
function packStats(list: StepStats[]): Float64Array {
  const fields = 13
  const out = new Float64Array(list.length * fields)
  list.forEach((s, n) => {
    out.set(
      [
        s.step,
        s.totalWater,
        s.storedWater,
        s.outflowWater,
        s.maxDepth,
        s.floodedArea,
        s.settled ? 1 : 0,
        s.massError,
        s.timeS,
        s.dtS,
        s.raining ? 1 : 0,
        s.rainDepthMm,
        s.outflowRateM3PerS,
      ],
      n * fields,
    )
  })
  return out
}

const allFinite = (a: Float64Array): boolean => a.every((v) => Number.isFinite(v))

describe('性質のテスト（spec 08 §9.2、tech-spec §11.3）', () => {
  it('質量保存: 各 step で |massError| ≤ totalWater × 1e-9', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (_, stats) => {
          expect(Math.abs(stats.massError)).toBeLessThanOrEqual(massTolerance(stats.totalWater))
        })
      }),
    )
  })

  it('非負・有限: すべての step で h ≥ 0、h・qx・qy が有限（NaN・∞ が無い）', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (engine) => {
          const w = engine.waterDepth()
          expect(w.every((d) => d >= 0 && Number.isFinite(d))).toBe(true)
          const { qx, qy } = engine.faceFlows()
          expect(allFinite(qx) && allFinite(qy)).toBe(true)
        })
      }),
    )
  })

  it('時間刻み: dtS ≤ DT_MAX_S、dtS ≤ α·Δx / √(g·h_max)（step の前の最大水深）。雨の終わりをまたぐ step は無い', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const dx = s.terrain.meta.cellSizeM
        const end = s.rain.durationS
        let previous = 0
        run(s, 'bbox', (_, stats, before) => {
          expect(stats.dtS).toBeGreaterThan(0)
          expect(stats.dtS).toBeLessThanOrEqual(DT_MAX_S)
          let hMax = 0
          for (const d of before) if (d > hMax) hMax = d
          if (hMax > 0) {
            expect(stats.dtS).toBeLessThanOrEqual(
              ((CFL_ALPHA * dx) / Math.sqrt(GRAVITY * hMax)) * (1 + 1e-12),
            )
          }
          if (end > 0) expect(previous < end && stats.timeS > end).toBe(false)
          previous = stats.timeS
        })
      }),
    )
  })

  it('決定性: 同じ入力を 2 回実行すると h・qx・qy がビット単位で一致する', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const a = run(s, 'bbox', () => {})
        const b = run(s, 'bbox', () => {})
        expect(sameBits(a.waterDepth(), b.waterDepth())).toBe(true)
        expect(sameBits(a.faceFlows().qx, b.faceFlows().qx)).toBe(true)
        expect(sameBits(a.faceFlows().qy, b.faceFlows().qy)).toBe(true)
      }),
    )
  })

  it("走査範囲: scanMode 'bbox' と 'full' で h・qx・qy と統計がビット単位で一致する", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const statsFull: StepStats[] = []
        const full = run(s, 'full', (_, stats) => statsFull.push(stats))
        const statsBbox: StepStats[] = []
        const bbox = run(s, 'bbox', (_, stats) => statsBbox.push(stats))
        expect(sameBits(bbox.waterDepth(), full.waterDepth())).toBe(true)
        expect(sameBits(bbox.faceFlows().qx, full.faceFlows().qx)).toBe(true)
        expect(sameBits(bbox.faceFlows().qy, full.faceFlows().qy)).toBe(true)
        expect(sameBits(packStats(statsBbox), packStats(statsFull))).toBe(true)
        expect(statsBbox).toStrictEqual(statsFull)
      }),
    )
  })

  it('走査範囲の外: すべての step の後で、範囲の外の h・qx・qy が 0（spec 08 §3.8 の不変条件）', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const { width, height } = s.terrain.meta
        run(s, 'bbox', (engine) => {
          const { x0, y0, x1, y1 } = engine.scanWindow()
          const empty = x0 >= x1
          const w = engine.waterDepth()
          const { qx, qy } = engine.faceFlows()
          // expect をセルごとに呼ぶと遅いので、外れた数を数えて最後に 1 回だけ比べる
          let outside = 0
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const inside = !empty && x >= x0 && x < x1 && y >= y0 && y < y1
              if (!inside && w[y * width + x] !== 0) outside++
            }
            for (let x = 0; x <= width; x++) {
              const inside = !empty && y >= y0 && y < y1 && x >= x0 && x <= x1
              if (!inside && qx[y * (width + 1) + x] !== 0) outside++
            }
          }
          for (let y = 0; y <= height; y++) {
            for (let x = 0; x < width; x++) {
              const inside = !empty && y >= y0 && y <= y1 && x >= x0 && x < x1
              if (!inside && qy[y * width + x] !== 0) outside++
            }
          }
          expect(outside).toBe(0)
        })
      }),
    )
  })

  it('静水の保存: h = max(0, min(η0, F₄) − Z) を置き、雨なしで回しても h がビット単位で変わらない（Z・η0 は 1/256 m の格子。レビュー 1 の M2）', () => {
    const staticArb = fc.record({
      terrain: terrainArb,
      level: fc.double({ min: 0, max: 1, noNaN: true }),
      steps: fc.integer({ min: 1, max: 100 }),
      full: fc.boolean(),
    })
    fc.assert(
      fc.property(staticArb, ({ terrain: t, level, steps, full }) => {
        const { fill } = analyzeDepressions({
          elevation: t.elevation,
          validMask: t.validMask,
          ...t.meta,
        })
        let lo = Number.POSITIVE_INFINITY
        let hi = Number.NEGATIVE_INFINITY
        t.validMask.forEach((v, i) => {
          if (v === 0) return
          lo = Math.min(lo, t.elevation[i] ?? 0)
          hi = Math.max(hi, t.elevation[i] ?? 0)
        })
        // 任意の水面標高 η0（格子に載せる）。4 近傍の満水の水面 F₄ で切ると、端・無効セルにつながる所は乾いたまま
        const eta0 = snap(lo + level * (hi - lo + 1))
        const h0 = new Float64Array(t.elevation.length)
        for (let i = 0; i < h0.length; i++) {
          if ((t.validMask[i] ?? 0) === 0) continue
          h0[i] = Math.max(0, Math.min(eta0, fill[i] ?? 0) - (t.elevation[i] ?? 0))
        }
        const engine = engineOn(t, { scanMode: full ? 'full' : 'bbox' })
        engine.setInitialWater(h0)
        for (let n = 0; n < steps; n++) engine.step()
        expect(sameBits(engine.waterDepth(), h0)).toBe(true)
      }),
    )
  })
})
```

- [ ] **Step 2: 回す**

Run: `pnpm vitest run src/simulation/properties.test.ts`
Expected: PASS（7 件）。落ちたら fast-check の反例（種と縮めた入力）を報告に書いて止める。とくに「走査範囲」「静水の保存」が落ちたら、エンジンの θ 重み付けの隣の読み方（計画で決めたこと 10）か、面の不変条件の片付け（`clearFacesOutside`）を疑う

- [ ] **Step 3: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

- [ ] **Step 4: コミット**

```bash
git add src/simulation/properties.test.ts
git commit -m "spec 08 Task 7: 性質のテストを §9.2 の形に書き直す（段差・継続時間のある雨・静水の保存・走査範囲の外）"
```

---
### Task 8: §9.3 の物理のテスト（降雨の総量・雨の終わり・平らな盆地・Manning の斜面・重力波・段差・自動停止・流出の速さ。spec §9.3、Review Focus 1、計画で決めたこと 13・16）

**Files:**
- Create: `src/simulation/physics.test.ts`

**Interfaces:**
- Consumes: `TsSimulationEngine`（Task 5。`setRainfall`・`setInitialWater`・`faceFlows`・`flowVectors`・`EngineOptions`）、`planRainfall`、定数 `FROUDE_MAX`・`GRAVITY`・`MANNING_N`・`SETTLE_CAP_S`・`massTolerance`
- Produces: なし（テストだけ）

- [ ] **Step 1: テストを書く**

`src/simulation/physics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FROUDE_MAX, GRAVITY, MANNING_N, massTolerance, SETTLE_CAP_S } from './constants.ts'
import { planRainfall } from './Rainfall.ts'
import type { TsSimulationEngine } from './TsSimulationEngine.ts'
import {
  buildTerrain,
  cellCenter,
  cone,
  engineOn,
  type Terrain,
  walledBasin,
} from './testing/fixtures.test-support.ts'
import type { RainfallInput, StepStats } from './types.ts'

/** 時間雨量（mm/h）を m/s にする */
const mmhToMps = (mmh: number): number => mmh / 1000 / 3600

/** 範囲全体の雨（中心・半径は使わない） */
const wholeRange = (intensityMmPerH: number, durationS: number): RainfallInput => ({
  x: 0,
  y: 0,
  radiusM: 1,
  intensityMmPerH,
  durationS,
  wholeRange: true,
})

/** 雨が終わる step まで回し、その統計を返す */
function runRain(engine: TsSimulationEngine, maxSteps = 1_000_000): StepStats {
  for (let n = 0; n < maxSteps; n++) {
    const s = engine.step()
    if (!s.raining) return s
  }
  throw new Error(`${maxSteps} step で雨が終わりませんでした`)
}

/**
 * 降雨の総量のテストの地形: 範囲 250 m 四方、雨の円より 2 セル広い平らな床（標高 0）を高さ 10 m の壁で囲む。
 * 水は床に留まり、走査範囲が円の近くに留まる（計画で決めたこと 16）
 */
function floorFor(cellSizeM: number, radiusM: number): Terrain {
  const n = Math.ceil(250 / cellSizeM)
  const inner = radiusM + 2 * cellSizeM
  return buildTerrain(n, n, cellSizeM, (x, y) =>
    Math.hypot((x + 0.5) * cellSizeM - 125, (y + 0.5) * cellSizeM - 125) <= inner ? 0 : 10,
  )
}

describe('降雨の総量（spec 08 §4.2・§9.3）', () => {
  // [セルの大きさ（m）, 半径（m）, 時間雨量（mm/h）, 継続時間（s）]。各値を 1 回以上使い、重い組は短い継続時間にする。
  // 600.5 秒は dt（乾いた床では 1 秒）が継続時間を割り切らない組
  const CASES: [number, number, number, number][] = [
    [0.98, 1, 300, 3600],
    [0.98, 10, 1, 21_600],
    [0.98, 100, 100, 600],
    [3.9, 1, 100, 21_600],
    [3.9, 10, 300, 600.5],
    [3.9, 100, 1, 3600],
    [7.8, 1, 300, 21_600],
    [7.8, 10, 100, 3600],
    [7.8, 100, 300, 600],
  ]

  it.each(CASES)(
    'セル %f m・半径 %f m・%f mm/h・%f 秒: 雨が終わった時点の投入量が I·T·πr² と相対 1e-12 以内',
    (cellSizeM, radiusM, mmh, durationS) => {
      const engine = engineOn(floorFor(cellSizeM, radiusM))
      engine.setRainfall({ x: 125, y: 125, radiusM, intensityMmPerH: mmh, durationS, wholeRange: false })
      const s = runRain(engine)
      const expected = mmhToMps(mmh) * durationS * Math.PI * radiusM * radiusM
      expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
      expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
    },
    30_000,
  )

  it('円がグリッドの西の端で切れると、総量は I·T·πr²·|S|/|C|（R04-8。Review Focus 1）', () => {
    const t = buildTerrain(250, 250, 1, () => 0)
    const engine = engineOn(t)
    engine.setRainfall({ x: 0, y: 125, radiusM: 10, intensityMmPerH: 100, durationS: 3600, wholeRange: false })
    const s = runRain(engine)
    // 1 mm の雨の投入量（πr²·0.001·|S|/|C|）× 100 mm/h × 1 時間
    const perMm = planRainfall({ x: 0, y: 125, radiusM: 10, amountMm: 1 }, t.validMask, t.meta)
    const expected = perMm.volumeM3 * 100
    expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
    expect(expected).toBeLessThan(mmhToMps(100) * 3600 * Math.PI * 100 * 0.6)
  })

  it('無効セル（海）のある範囲全体の雨の総量は I·T·有効セル数·A（無効セルには降らない。Review Focus 1）', () => {
    const t = buildTerrain(30, 30, 2, (x) => (x < 5 ? Number.NaN : 0.01 * x))
    const engine = engineOn(t)
    engine.setRainfall(wholeRange(100, 600))
    const s = runRain(engine)
    let valid = 0
    for (const v of t.validMask) valid += v
    const expected = mmhToMps(100) * 600 * valid * 4
    expect(valid).toBe(25 * 30)
    expect(Math.abs(s.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
  })
})

describe('雨の終わり（spec 08 §3.3・§9.3）', () => {
  it('最後の step で raining が false になり、その step の timeS は継続時間にちょうど等しく、rainDepthMm は総量。その後は投入しない', () => {
    const engine = engineOn(cone(21, 0.1, 5))
    const durationS = 600.5
    engine.setRainfall({ ...cellCenter(10, 10, 1), radiusM: 3, intensityMmPerH: 100, durationS, wholeRange: false })
    let s: StepStats
    do {
      s = engine.step()
      if (s.raining) expect(s.timeS).toBeLessThan(durationS)
    } while (s.raining)
    expect(s.timeS).toBe(durationS)
    expect(s.rainDepthMm).toBe((100 * durationS) / 3600)
    const after = engine.step()
    expect(after.raining).toBe(false)
    expect(after.rainDepthMm).toBe(s.rainDepthMm)
    expect(after.totalWater).toBe(s.totalWater)
  })
})

describe('平らな盆地と流出の速さ（spec 08 §4.3・§9.3）', () => {
  it('縁で囲んだ平らな盆地に範囲全体の雨 100 mm/h × 2 時間: 雨の終わりに盆地の水深は平らで 0.2 m 以上、流出は縁に降った量以下。Σ 流出の速さ × dt = 領域外流出量', () => {
    // 30 × 30・セル 1 m、縁（外周 1 セル）は高さ 5 m の有効セル。範囲全体の雨は縁にも降り、その大半は盆地へ、
    // 一部はグリッドの外へ流れる（盆地の水深は 0.2 m ちょうどにはならない。試作 0.22882 m。spec 08 §9.3）
    const size = 30
    const engine = engineOn(walledBasin(size, 0, 5))
    engine.setRainfall(wholeRange(100, 7200))
    let bySteps = 0
    let s: StepStats
    do {
      s = engine.step()
      bySteps += s.outflowRateM3PerS * s.dtS
    } while (s.raining)
    const w = engine.waterDepth()
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const d = w[y * size + x] ?? 0
        min = Math.min(min, d)
        max = Math.max(max, d)
      }
    }
    expect(max - min).toBeLessThanOrEqual(1e-6)
    expect(min).toBeGreaterThanOrEqual(0.2)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(s.totalWater * 1e-12)
    expect(s.outflowWater).toBeLessThanOrEqual(mmhToMps(100) * 7200 * (4 * size - 4))
    expect(s.outflowWater).toBeGreaterThan(0)
    expect(Math.abs(bySteps - s.outflowWater)).toBeLessThanOrEqual(s.outflowWater * 1e-12)
  })
})

describe('斜面の定常流（Manning。spec 08 §9.3、M0 の U5）', () => {
  it(
    '幅 20 セル・長さ 100 m・勾配 0.01 に範囲全体の雨 100 mm/h: 流出は I × 面積と 1%、中央 10 列の水深は壁の分を足した等流と 3%、' +
      '95% に達する時刻は運動波の到達時間と 30%、流速は下り向きで等流の流速と 10% 以内',
    () => {
      const n = MANNING_N
      const S = 0.01
      const W = 20
      const I = mmhToMps(100)
      // 上端（行 0）と両側（列 0・21）は高さ 1 m の壁（有効セル）。下端（行 100 の先）はグリッドの端（仮想セル）
      const t = buildTerrain(W + 2, 101, 1, (x, y) => {
        const z = 1 + S * (100 - y)
        return x === 0 || x === W + 1 || y === 0 ? z + 1 : z
      })
      const engine = engineOn(t)
      engine.setRainfall(wholeRange(100, 6 * 3600))
      // 雨は壁にも降るので、定常の流出は範囲全体の有効セルの面積で比べる
      const expectedQ = I * (W + 2) * 101
      const te = ((100 * n) / (Math.sqrt(S) * I ** (2 / 3))) ** (3 / 5)
      // 下端から 10 m 上の行。上端の壁の外側の縁からの距離 x は行の中心で 91.5 m（上端の壁 1 m を含む）
      const row = 91
      let t95: number | null = null
      let outSum = 0
      let timeSum = 0
      let depthSum = 0
      let s: StepStats
      do {
        s = engine.step()
        if (t95 === null && s.outflowRateM3PerS >= 0.95 * expectedQ) t95 = s.timeS
        if (s.timeS > 2 * 3600) {
          const w = engine.waterDepth()
          let d = 0
          for (let x = 6; x <= 15; x++) d += w[row * (W + 2) + x] ?? 0
          outSum += s.outflowRateM3PerS * s.dtS
          depthSum += (d / 10) * s.dtS
          timeSum += s.dtS
        }
      } while (s.timeS < 3 * 3600)
      expect(Math.abs(outSum / timeSum - expectedQ) / expectedQ).toBeLessThanOrEqual(0.01)
      // 壁に降って斜面へ流れ込む分を q に足す: q = I·x·(W + 2)/W（断面の水深は列によらず一様。M0 の R2）
      const q = (I * (row + 0.5) * (W + 2)) / W
      const hm = ((n * q) / Math.sqrt(S)) ** (3 / 5)
      expect(Math.abs(depthSum / timeSum - hm) / hm).toBeLessThanOrEqual(0.03)
      expect(t95).not.toBeNull()
      expect(Math.abs((t95 ?? 0) - te) / te).toBeLessThanOrEqual(0.3)
      // 流れのベクトル（m/s。spec 08 §3.10）: 中央の列は下り（南）向きで、等流の流速 h^(2/3)·√S / n と 10% 以内
      const w = engine.waterDepth()
      const v = engine.flowVectors()
      for (let x = 6; x <= 15; x++) {
        const i = row * (W + 2) + x
        const u = ((w[i] ?? 0) ** (2 / 3) * Math.sqrt(S)) / n
        const vy = v.y[i] ?? 0
        expect(vy).toBeGreaterThan(0)
        expect(Math.abs(v.x[i] ?? 0)).toBeLessThan(0.1 * vy)
        expect(Math.abs(vy - u) / u).toBeLessThanOrEqual(0.1)
      }
    },
    60_000,
  )
})

describe('重力波の速さ（spec 08 §3.2・§9.3）', () => {
  it('平らな水面（深さ 0.5 m）に 1 cm の段差を置くと、段差は √(g·h) の速さで伝わる（到達時刻が 20% 以内）', () => {
    // 201 × 3・セル 1 m の水路。行 0・2 と両端（列 0・200）は高さ 10 m の壁。列 1〜99 は 0.51 m、列 100〜199 は 0.5 m
    const W = 201
    const t = buildTerrain(W, 3, 1, (x, y) => (y !== 1 || x === 0 || x === W - 1 ? 10 : 0))
    const h = new Float64Array(W * 3)
    for (let x = 1; x < W - 1; x++) h[W + x] = x < 100 ? 0.51 : 0.5
    const engine = engineOn(t)
    engine.setInitialWater(h)
    // 段差から 50.5 m 先（列 150 の中心）に、段差の高さの 1/4（2.5 mm）が届いた時刻
    let arrival: number | null = null
    for (let n = 0; n < 5000 && arrival === null; n++) {
      const s = engine.step()
      if ((engine.waterDepth()[W + 150] ?? 0) > 0.5025) arrival = s.timeS
    }
    const expected = 50.5 / Math.sqrt(GRAVITY * 0.5)
    expect(arrival).not.toBeNull()
    expect(Math.abs((arrival ?? 0) - expected) / expected).toBeLessThanOrEqual(0.2)
  })
})

describe('急な段差（spec 08 §3.5・§9.3、M0 の U5）', () => {
  it('1 セルで 3 m 下がる段差に 300 mm/h × 30 分: NaN・負の水深が出ず、どの面もフルード数の上限を越えない。質量は保存する', () => {
    const t = buildTerrain(60, 20, 1, (x) => (x < 30 ? 3 + 0.01 * (30 - x) : 0.01 * (60 - x)))
    const engine = engineOn(t)
    engine.setRainfall(wholeRange(300, 1800))
    let badDepth = 0
    let worstFroude = 0
    let s: StepStats
    do {
      s = engine.step()
      for (const d of engine.waterDepth()) if (!(Number.isFinite(d) && d >= 0)) badDepth++
      const { qx, qy, hfx, hfy } = engine.faceFlows()
      const check = (q: Float64Array, hf: Float64Array): void => {
        for (let i = 0; i < q.length; i++) {
          const v = q[i] ?? 0
          if (v === 0) continue
          const f = hf[i] ?? 0
          const ratio = Math.abs(v) / (f * Math.sqrt(GRAVITY * f))
          if (!(ratio <= worstFroude)) worstFroude = ratio
        }
      }
      check(qx, hfx)
      check(qy, hfy)
    } while (s.timeS < 3600)
    expect(badDepth).toBe(0)
    expect(worstFroude).toBeLessThanOrEqual(FROUDE_MAX * (1 + 1e-12))
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
  }, 30_000)
})

describe('自動停止（spec 08 §3.9・§9.3、R08-6、Q1 = (a)）', () => {
  // グリッドの端・無効セルに接せず、段差の無い閉じた盆地（雨は壁に降らない円。レビュー 1 の R1 の再レビュー）
  const BASINS: [string, Terrain, number][] = [
    ['平らな床の盆地（20 × 20）', walledBasin(20, 0, 10), 10],
    ['すり鉢（21 × 21、勾配 0.1）', cone(21, 0.1, 5), 10.5],
    ['すり鉢（21 × 21、勾配 0.02）', cone(21, 0.02, 5), 10.5],
  ]

  it.each(BASINS)(
    '%s: 雨の間は settled にならず、雨の後に settled（stopReason = settled）で止まる',
    (_, t, center) => {
      const engine = engineOn(t)
      engine.setRainfall({ x: center, y: center, radiusM: 4, intensityMmPerH: 100, durationS: 600, wholeRange: false })
      let s: StepStats | null = null
      for (let n = 0; n < 100_000; n++) {
        s = engine.step()
        if (s.raining) {
          expect(s.settled).toBe(false)
          expect(s.stopReason).toBeNull()
        }
        if (s.stopReason !== null) break
      }
      expect(s?.stopReason).toBe('settled')
      expect(s?.settled).toBe(true)
      expect(s?.timeS ?? 0).toBeGreaterThan(600)
    },
    30_000,
  )

  it('止まらない条件（停止の流速 0）では、雨がやんでから SETTLE_CAP_S で cap になる（計画で決めたこと 13）', () => {
    const engine = engineOn(walledBasin(8, 0, 10), { settleVelocityMPerS: 0 })
    engine.setRainfall({ ...cellCenter(4, 4, 1), radiusM: 2, intensityMmPerH: 100, durationS: 600, wholeRange: false })
    let previous: StepStats | null = null
    let s: StepStats | null = null
    for (let n = 0; n < 200_000; n++) {
      s = engine.step()
      if (s.stopReason !== null) break
      previous = s
    }
    expect(s?.stopReason).toBe('cap')
    expect(s?.settled).toBe(false)
    expect((s?.timeS ?? 0) - 600).toBeGreaterThanOrEqual(SETTLE_CAP_S)
    expect((previous?.timeS ?? 0) - 600).toBeLessThan(SETTLE_CAP_S)
  }, 30_000)
})
```

- [ ] **Step 2: 回す**

Run: `pnpm vitest run src/simulation/physics.test.ts --reporter=verbose`
Expected: PASS。試作（M0）の値: 平らな盆地の水深 0.22882 m・差 6e-8 m、斜面の流出の差 0.000%・水深 +0.57%・95% の到達 513 秒（t_e 511 秒）、重力波の到達 22.8 秒（見込み 22.8 秒）、自動停止は雨の後 308〜2,002 step。実測（到達時刻・水深の差・停止までの step）と各テストの所要を報告に書く。落ちたら数値を報告に書いて止める（許容を変えない）

- [ ] **Step 3: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。`physics.test.ts` の所要（カバレッジの下）を報告に書く

- [ ] **Step 4: コミット**

```bash
git add src/simulation/physics.test.ts
git commit -m "spec 08 Task 8: §9.3 の物理のテスト（降雨の総量・雨の終わり・平らな盆地・Manning の斜面・重力波・段差・自動停止）"
```

---
### Task 9: Node のベンチマークを新しい雨の形にし、記録する。M1 の E2E（spec §7.1・§7.3 の Node の行・§11 の M1、計画で決めたこと 29・30）

**Files:**
- Modify（全体を置き換える）: `scripts/bench-engine.ts`
- Modify: `docs/perf/<Task 1 の実行日>-physical-time.md`

**Interfaces:**
- Consumes: `TsSimulationEngine`（Task 5）
- Produces: 記録の「後」の節（Task 16 と M1 のチェックポイントが読む）

- [ ] **Step 1: ベンチマークを書き直す**

`scripts/bench-engine.ts`（全体）:

```ts
/**
 * エンジンのベンチマーク（spec 03 §5、spec 08 §7.3）。Node 24 で直接実行する（型注釈は Node が取り除く）:
 *
 *   pnpm bench:engine [上限の step 数（既定 100000）]
 *
 * 512 × 512 の合成地形（窪地と斜面を含む）に、100 mm/h × 1 時間の雨（半径 10 m・100 m・範囲全体）を降らせ、
 * 自動停止（settled・cap）か上限の step 数まで回す。step 数、1 step の所要時間の中央値と p95、停止の理由、
 * 経過時間（シミュレーションの時間）、dt の最小・中央値・最大を Markdown の表で出す。計時はこのスクリプトで行う
 * （src/simulation は performance を参照できない）。CI のゲートにはしない。性能の基準は置かない（R08-9）
 */
import { TsSimulationEngine } from '../src/simulation/TsSimulationEngine.ts'
import type { RainfallInput, StepStats } from '../src/simulation/types.ts'

const SIZE = 512
const CELL_M = 0.98

/** 窪地: [中心の列, 中心の行, 深さ（m）, 広がり σ（セル）] */
const PITS: [number, number, number, number][] = [
  [256, 256, 3, 40],
  [120, 140, 2, 25],
  [400, 120, 1.5, 30],
  [150, 400, 2.5, 35],
  [380, 380, 1, 20],
]

/** 東へ 1% で下る斜面に、ガウス形の窪地 5 つと小さな凹凸を重ねた地形 */
function syntheticElevation(): Float32Array {
  const elevation = new Float32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let z = 50 - 0.01 * x * CELL_M + 0.05 * Math.sin(x * 0.3) * Math.sin(y * 0.2)
      for (const [cx, cy, depth, sigma] of PITS) {
        z -= depth * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma))
      }
      elevation[y * SIZE + x] = z
    }
  }
  return elevation
}

/** 昇順に並べた配列の p 分位点（最近傍法） */
function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[i] ?? Number.NaN
}

/** シミュレーションの秒を「h:mm:ss」にする */
function clock(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function run(label: string, elevation: Float32Array, rain: RainfallInput, maxSteps: number): void {
  const engine = new TsSimulationEngine()
  const validMask = new Uint8Array(SIZE * SIZE).fill(1)
  engine.loadTerrain(elevation, validMask, { width: SIZE, height: SIZE, cellSizeM: CELL_M })
  engine.setRainfall(rain)
  const times: number[] = []
  const dts: number[] = []
  let last: StepStats | null = null
  let rainEndStep: number | null = null
  const started = performance.now()
  for (let n = 0; n < maxSteps; n++) {
    const t0 = performance.now()
    last = engine.step()
    times.push(performance.now() - t0)
    dts.push(last.dtS)
    if (rainEndStep === null && !last.raining) rainEndStep = last.step
    if (last.stopReason !== null) break
  }
  const seconds = (performance.now() - started) / 1000
  times.sort((a, b) => a - b)
  dts.sort((a, b) => a - b)
  const stop = last?.stopReason ?? `未到達（上限 ${maxSteps}）`
  const cells = [
    label,
    String(times.length),
    String(rainEndStep ?? '—'),
    percentile(times, 0.5).toFixed(3),
    percentile(times, 0.95).toFixed(3),
    stop,
    clock(last?.timeS ?? 0),
    (dts[0] ?? Number.NaN).toFixed(3),
    percentile(dts, 0.5).toFixed(3),
    (dts.at(-1) ?? Number.NaN).toFixed(3),
    (last?.maxDepth ?? 0).toFixed(3),
    (last?.massError ?? 0).toExponential(2),
    seconds.toFixed(1),
  ]
  console.log(`| ${cells.join(' | ')} |`)
}

const maxSteps = Number(process.argv[2] ?? 100_000)
if (!(Number.isInteger(maxSteps) && maxSteps > 0)) {
  console.error('usage: node scripts/bench-engine.ts [上限の step 数（正の整数）]')
  process.exit(1)
}
const elevation = syntheticElevation()
const center = { x: 256.5 * CELL_M, y: 256.5 * CELL_M }
const hour = { intensityMmPerH: 100, durationS: 3600 }

console.log(`Node ${process.version}、${SIZE} × ${SIZE}、セル ${CELL_M}m、上限 ${maxSteps} step`)
console.log('')
console.log(
  '| 降雨 | step 数 | 雨の終わりの step | 中央値（ms） | p95（ms） | 停止 | 経過（h:mm:ss） | dt 最小（s） | dt 中央値（s） | dt 最大（s） | 最大水深（m） | 質量誤差（m³） | 所要（秒） |',
)
console.log('|---|---:|---:|---:|---:|---|---|---:|---:|---:|---:|---:|---:|')
run('半径 10m・100mm/h × 1 時間', elevation, { ...center, radiusM: 10, ...hour, wholeRange: false }, maxSteps)
run('半径 100m・100mm/h × 1 時間', elevation, { ...center, radiusM: 100, ...hour, wholeRange: false }, maxSteps)
run('範囲全体・100mm/h × 1 時間', elevation, { ...center, radiusM: 10, ...hour, wholeRange: true }, maxSteps)
```

- [ ] **Step 2: 型と書式を確かめる**

Run: `pnpm format && pnpm lint && pnpm typecheck`
Expected: すべて成功

- [ ] **Step 3: ベンチマークを回す（「後」。バックグラウンド。範囲全体は 1 step 20 ms 前後 × 上限 100,000 step の見込みで 30 分を超えうる）**

Run（バックグラウンド）: `uptime && git rev-parse --short HEAD && pnpm bench:engine 100000 > .handoff/08-perf/bench-after.md 2>&1; uptime >> .handoff/08-perf/bench-after.md`（先に `mkdir -p .handoff/08-perf`）
Expected: 表が 3 行。停止の欄は `settled`・`cap`・`未到達（上限 100000）` のどれか。質量誤差は 1e-6 m³ の桁以下

- [ ] **Step 4: 記録に書き足す**

`docs/perf/<Task 1 の実行日>-physical-time.md` の「## Node のベンチマーク」の「### 前」の後に足す:

```markdown
### 後（<コミット>。4 近傍の局所慣性式。雨は 100 mm/h × 1 時間。load average <前後の uptime>）

<Step 3 の表をそのまま貼る>

- 1 step の中央値の前後の比: 半径 10 m <後 ÷ 前>、半径 100 m <後 ÷ 前>（前の雨は一度に置く 100 mm で、雨の形が違うので参考）
- spec §7.1 の見込み（M0 の試作で今のエンジンの約 2.1〜2.3 倍、範囲全体の 500 m で 20.7〜23.0 ms）との差: <書く。外れた理由が分かれば書く>
- spec §7.2 の見積もり（半径 10 m・100 m は 7 時間〈上限〉で止まる、step 数 52,721〜258,061、dt 0.085〜0.48 s）との差: <書く。合成地形は実 DEM と違うので参考>

### テストの所要（spec §9.1。Task 6・8）

- 満水との一致（`fillMatch.test.ts`）: 単独の verbose <3 地形の ms>、カバレッジの下 <ms>。`fillMatch.slow.test.ts` に分けたか: <分けた地形 / 分けなかった>
- 物理のテスト（`physics.test.ts`）: カバレッジの下 <ms>
```

- [ ] **Step 5: M1 の E2E（M1 の段階の挙動: UI の雨はまだ一度に置く。速度は 0.25x〜4x のまま）**

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 49 passed。落ちたテストがあれば、その名前・画面の値・`logMeasured` の実測（07 の帯のテスト）を報告に書く。07 の帯のしきい値（`explanations.spec.ts`）が新しい流れの式で外れた場合だけ、`logMeasured` の実測を 3 回読み、計画で決めたこと 24 の規則でしきい値を直してこの Task に含める（M3 の Task 14 で雨の形を替えるときに決め直す）。それ以外の失敗は直さずに止め、コントローラーに渡す

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下。Task 1 との差を報告に書く

- [ ] **Step 6: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

- [ ] **Step 7: コミット**

```bash
git add scripts/bench-engine.ts docs/perf/<Task 1 の実行日>-physical-time.md
# Step 5 で 07 の帯のしきい値を直したときだけ
git add tests/e2e/explanations.spec.ts
git commit -m "spec 08 Task 9: Node のベンチマークを新しい雨の形にし、変更後を記録する"
```

---

## レビュー役のチェックポイント（M1。Task 9 の後）

実装役は Task 9 の報告に次をまとめ、コントローラーがレビュー役に渡す。**承認まで M2 に進まない**。

1. `git log --oneline 6f6906d..HEAD`（Task 1〜9 の 9 コミット）と `git diff --stat 6f6906d..HEAD`
2. ゲートの結果（ユニットの件数・E2E 49 件・`pnpm size`・`pnpm depcheck`）
3. §9.1 の実測: 平衡の 3 ケースの step 数と `r.max − r.min`、満水との一致の 3 地形の `pond`・`outside`・step 数・所要（Task 6 Step 3 で閾値か `n` を動かしたなら、その値と理由）。`fillMatch.slow.test.ts` に分けたか
4. §9.3 の実測（Task 8 Step 2）と Node のベンチマークの前後の表（Task 9）、§7.1・§7.2 の見積もりとの差
5. 計画で決めたこと 1〜16 のうち、実装の中で変えたもの（無ければ「無し」）
6. M1 の E2E で直したもの（07 の帯のしきい値など。無ければ「無し」）

レビューの指摘は、この計画の書式で追加の Task（20 以降）として足し、同じブランチで直す。

---

# M2: Worker・メッセージ・スケジューラ（spec §11 の M2）

### Task 10: 再生速度を実時間の倍率にする（スケジューラ・メッセージ・速度の選択肢。spec §5.2・§6.1・§9.3「スケジューラ」、R08-5、Review Focus 2・3、計画で決めたこと 17・18）

**Files:**
- Modify: `src/shared/protocol.ts`
- Modify（全体を置き換える）: `src/workers/playbackScheduler.ts`、`src/workers/playbackScheduler.test.ts`
- Modify: `src/workers/simulationRunner.ts`（+ test）
- Modify: `src/bridge/SimulationClient.ts`、`src/bridge/fakeWorker.test-support.ts`
- Modify: `src/state/simulationStore.ts`（+ test）
- Modify: `src/ui/components/PlaybackControls.tsx`、`src/ui/strings.ts`
- Modify: `tests/e2e/smoke.spec.ts`、`tests/e2e/explanations.spec.ts`

**Interfaces:**
- Consumes: `StepStats.timeS`・`stopReason`（Task 5）
- Produces:
  - `type PlaybackSpeed = 1 | 10 | 60 | 600 | 'max'`、`DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 60`（`src/shared/protocol.ts`）
  - `FrameMessage.simSecondsPerSecond: number`、`FrameView.simSecondsPerSecond: number`（Task 13 がストアへ入れる）
  - `SchedulerPorts.sendFrame(stats, stepsPerSecond, simSecondsPerSecond): boolean`
  - `PlaybackScheduler` の `simSecondsPerSecond`（getter）・`rewind(): void`
  - `strings.playback.speedValue(speed: number): string`（1 は「実時間」、ほかは「N 倍」）

- [ ] **Step 1: スケジューラの失敗するテストを書く（全体を置き換える）**

`src/workers/playbackScheduler.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYBACK_SPEED, type PlaybackSpeed } from '../shared/protocol'
import type { StepStats, StopReason } from '../simulation/types'
import { PlaybackScheduler, TICK_BUDGET_MS, TICK_INTERVAL_MS } from './playbackScheduler'

interface Options {
  /** 1 step で進める偽の時計（ms） */
  stepMs?: number
  /** 1 step の dt（シミュレーションの秒） */
  dtS?: number
  /** この step 数で自動停止する */
  stopAt?: number
  stopReason?: StopReason
  buffers?: number
  speed?: PlaybackSpeed
}

function stats(step: number, timeS: number, stopReason: StopReason | null): StepStats {
  return {
    step,
    totalWater: 0,
    storedWater: 0,
    outflowWater: 0,
    maxDepth: 0,
    floodedArea: 0,
    settled: stopReason === 'settled',
    massError: 0,
    events: [],
    timeS,
    dtS: 1,
    raining: false,
    rainDepthMm: 0,
    outflowRateM3PerS: 0,
    stopReason,
  }
}

/**
 * 偽の時計とタイマー。step は時計を stepMs 進め、シミュレーションの時刻を dtS 進め、stopAt 回目で stopReason を返す。
 * frame は buffers 枚まで送れ、returnBuffer で 1 枚戻る。restartEngine はエンジンの reset（時刻 0 から）の代わり
 */
function harness({
  stepMs = 0,
  dtS = 1,
  stopAt = Number.POSITIVE_INFINITY,
  stopReason = 'settled',
  buffers = Number.POSITIVE_INFINITY,
  speed = DEFAULT_PLAYBACK_SPEED,
}: Options = {}) {
  const clock = { now: 0 }
  let steps = 0
  let simTime = 0
  let free = buffers
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const frames: {
    step: number
    stopReason: StopReason | null
    stepsPerSecond: number
    simSecondsPerSecond: number
  }[] = []
  const stepsPerTick: number[] = []
  const scheduler = new PlaybackScheduler({
    now: () => clock.now,
    setTimer: (run, delayMs) => {
      const id = nextId++
      timers.set(id, { at: clock.now + delayMs, run })
      return id
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
    step: () => {
      clock.now += stepMs
      steps++
      simTime += dtS
      return stats(steps, simTime, steps >= stopAt ? stopReason : null)
    },
    sendFrame: (s, stepsPerSecond, simSecondsPerSecond) => {
      if (free <= 0) return false
      free--
      frames.push({ step: s.step, stopReason: s.stopReason, stepsPerSecond, simSecondsPerSecond })
      return true
    },
  })
  scheduler.setSpeed(speed)
  /** 最も早いタイマーを 1 つ動かす（時計をその時刻まで進める）。無ければ何もしない */
  const tick = (): void => {
    let first: [number, { at: number; run: () => void }] | undefined
    for (const entry of timers) if (first === undefined || entry[1].at < first[1].at) first = entry
    if (first === undefined) return
    timers.delete(first[0])
    clock.now = Math.max(clock.now, first[1].at)
    const before = steps
    first[1].run()
    stepsPerTick.push(steps - before)
  }
  return {
    scheduler,
    frames,
    stepsPerTick,
    timers,
    clock,
    steps: () => steps,
    simTime: () => simTime,
    ticks: (n: number) => {
      for (let k = 0; k < n; k++) tick()
    },
    returnBuffer: () => {
      free++
      scheduler.bufferReturned()
    },
    restartEngine: () => {
      steps = 0
      simTime = 0
    },
  }
}

describe('PlaybackScheduler: 実時間の倍率（spec 08 §6.1、R08-5）', () => {
  it.each([1, 10, 60, 600] as const)(
    '%s 倍: 実時間 1 秒（60 tick）で、シミュレーションはおよそ倍率の秒だけ進む（越えるのは最大 1 step の dt）',
    (speed) => {
      const dtS = 0.25
      const h = harness({ speed, dtS })
      h.scheduler.play()
      h.ticks(60)
      expect(h.simTime()).toBeGreaterThanOrEqual(speed - dtS)
      expect(h.simTime()).toBeLessThanOrEqual(speed + dtS)
    },
  )

  it('play の直後の最初の tick は 1 tick 分（1/60 秒）の実時間を進めたとみなし、1 step 以上回す（計画で決めたこと 17）', () => {
    const h = harness({ speed: 1, dtS: 1 })
    h.scheduler.play()
    h.ticks(1)
    expect(h.stepsPerTick).toEqual([1])
  })

  it('目標を越える 1 step は許し、越えた分は次の tick から差し引く（実時間の再生で dt 1 秒なら約 1 秒に 1 step）', () => {
    const h = harness({ speed: 1, dtS: 1 })
    h.scheduler.play()
    h.ticks(59)
    expect(h.steps()).toBe(1)
    h.ticks(3)
    expect(h.steps()).toBe(2)
  })

  it('速度を変えると、目標を今の時刻に戻す（越えた分・貯めた分を捨てる。Review Focus 3）', () => {
    const h = harness({ speed: 'max', stepMs: 1, dtS: 1 })
    h.scheduler.play()
    h.ticks(2)
    const before = h.simTime()
    h.scheduler.setSpeed(1)
    h.ticks(1)
    // 1 倍に切り替えた直後の tick は、1/60 秒ぶんの目標で 1 step だけ
    expect(h.simTime() - before).toBe(1)
  })

  it('rewind で時刻と目標を 0 に戻す（開始・Reset・地形の差し替え。前の実行の目標で一気に進まない。Review Focus 2）', () => {
    const h = harness({ speed: 60, dtS: 1 })
    h.scheduler.play()
    h.ticks(10)
    expect(h.simTime()).toBeGreaterThan(5)
    h.scheduler.pause()
    h.scheduler.rewind()
    h.restartEngine()
    h.scheduler.play()
    h.ticks(1)
    // 60 倍の最初の tick は目標 1 秒なので 1 step（dt 1 秒）。rewind しないと前の実行の時刻が目標に残る
    expect(h.stepsPerTick.at(-1)).toBe(1)
  })
})

describe('PlaybackScheduler: 時間予算', () => {
  it('12ms を使い切ったら打ち切る。目標に届かなかった分は次の tick へ繰り越さない', () => {
    // 600 倍は 1 tick に 10 秒の目標。1 step 5ms なので 3 step で予算を使い切る
    const h = harness({ speed: 600, stepMs: 5, dtS: 1 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([3, 3])
    expect(h.simTime()).toBe(6)
  })

  it('「最速」は目標を持たず、時間予算だけで回す', () => {
    const h = harness({ speed: 'max', stepMs: 1 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([TICK_BUDGET_MS, TICK_BUDGET_MS])
  })

  it('1 step が予算を超えても、1 tick に少なくとも 1 step は回す', () => {
    const h = harness({ speed: 'max', stepMs: 20 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([1, 1])
  })

  it('次の tick は、1/60 秒からその tick の所要時間を引いた後。所要時間が 1/60 秒を超えたらすぐ', () => {
    const fast = harness({ speed: 60, stepMs: 5, dtS: 1 })
    fast.scheduler.play()
    fast.ticks(1)
    expect([...fast.timers.values()][0]?.at).toBeCloseTo(TICK_INTERVAL_MS, 9)
    const slow = harness({ speed: 'max', stepMs: 20 })
    slow.scheduler.play()
    slow.ticks(1)
    expect([...slow.timers.values()][0]?.at).toBe(20)
  })

  it('実行速度（step／秒）と実際の倍率（シミュレーションの秒／実時間の秒）を 1 秒の窓で測り、frame に付ける', () => {
    // 60 倍・dt 0.5 秒: 1 tick に 2 step、1 秒に約 120 step・約 60 秒（最初の窓は play の直後の 1 tick 分を含むので
    // 61 tick ぶん。窓の端の丸めで 1 tick 前後する）
    const h = harness({ speed: 60, dtS: 0.5 })
    h.scheduler.play()
    h.ticks(70)
    expect(h.scheduler.stepsPerSecond).toBeGreaterThan(115)
    expect(h.scheduler.stepsPerSecond).toBeLessThan(125)
    expect(h.scheduler.simSecondsPerSecond).toBeGreaterThan(58)
    expect(h.scheduler.simSecondsPerSecond).toBeLessThan(63)
    expect(h.frames.at(-1)?.stepsPerSecond).toBe(h.scheduler.stepsPerSecond)
    expect(h.frames.at(-1)?.simSecondsPerSecond).toBe(h.scheduler.simSecondsPerSecond)
  })

  it('計算が追いつかないときの実際の倍率は、倍率より小さい（誤りにはしない。spec 08 §6.1）', () => {
    // 600 倍・1 step 5ms・dt 1 秒: 1 tick に 3 step しか回らず、1 秒に約 180 秒しか進まない
    const h = harness({ speed: 600, stepMs: 5, dtS: 1 })
    h.scheduler.play()
    h.ticks(70)
    expect(h.scheduler.simSecondsPerSecond).toBeGreaterThan(150)
    expect(h.scheduler.simSecondsPerSecond).toBeLessThan(200)
  })
})

describe('PlaybackScheduler: frame（tech-spec §5.2）', () => {
  it('返却済みのバッファが無ければ frame を見送り、返却されたら最新の統計で送る', () => {
    const h = harness({ buffers: 1 })
    h.scheduler.play()
    h.ticks(3)
    expect(h.frames.map((f) => f.step)).toEqual([1])
    h.returnBuffer()
    expect(h.frames.map((f) => f.step)).toEqual([1, 3])
  })

  it('step の無い tick（実時間・dt 1 秒の 2〜59 tick 目）では frame を送らない', () => {
    const h = harness({ speed: 1, dtS: 1 })
    h.scheduler.play()
    h.ticks(10)
    expect(h.frames.map((f) => f.step)).toEqual([1])
  })

  it('discardPending で保留中の frame を捨てる（reset・地形の差し替え）', () => {
    const h = harness({ buffers: 0 })
    h.scheduler.play()
    h.ticks(1)
    h.scheduler.discardPending()
    h.returnBuffer()
    expect(h.frames).toEqual([])
  })
})

describe('PlaybackScheduler: 自動停止（spec 08 §3.9・§6.1）', () => {
  it.each(['settled', 'cap'] as const)(
    '%s の step で止まり、タイマーを残さない。その frame はバッファが返却され次第送る',
    (reason) => {
      const h = harness({ buffers: 0, stopAt: 3, stopReason: reason })
      h.scheduler.play()
      h.ticks(10)
      expect(h.steps()).toBe(3)
      expect(h.scheduler.isRunning).toBe(false)
      expect(h.timers.size).toBe(0)
      expect(h.frames).toEqual([])
      h.returnBuffer()
      expect(h.frames).toEqual([
        { step: 3, stopReason: reason, stepsPerSecond: 0, simSecondsPerSecond: 0 },
      ])
    },
  )

  it('1 tick の途中で止まったら、その tick の残りの step を回さない', () => {
    const h = harness({ speed: 600, stopAt: 2 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([2])
  })
})

describe('PlaybackScheduler: 一時停止と Step', () => {
  it('pause でタイマーを外し、play で再開する', () => {
    const h = harness({ speed: 60, dtS: 1 })
    h.scheduler.play()
    h.ticks(2)
    h.scheduler.pause()
    expect(h.timers.size).toBe(0)
    h.ticks(3)
    expect(h.steps()).toBe(2)
    h.scheduler.play()
    h.ticks(1)
    expect(h.steps()).toBe(3)
  })

  it('stepOnce は一時停止中だけ 1 step（その時の dt）進めて frame を送る。再生中は何もしない', () => {
    const h = harness()
    h.scheduler.stepOnce()
    expect(h.steps()).toBe(1)
    expect(h.frames.map((f) => f.step)).toEqual([1])
    h.scheduler.play()
    h.scheduler.stepOnce()
    expect(h.steps()).toBe(1)
  })

  it('一時停止中の Step で進んだ時刻から再開する（目標は再開の時刻から数える）', () => {
    const h = harness({ speed: 1, dtS: 1 })
    for (let n = 0; n < 5; n++) h.scheduler.stepOnce()
    h.scheduler.play()
    h.ticks(1)
    // 目標は 5 + 1/60 秒。時刻 5 から 1 step で 6
    expect(h.simTime()).toBe(6)
  })
})

describe('PlaybackScheduler: 止めたら実行速度と実際の倍率を 0 に戻す', () => {
  it('pause で 0 にし、その後の Step の frame も 0', () => {
    const h = harness({ speed: 60, dtS: 0.5 })
    h.scheduler.play()
    h.ticks(70)
    expect(h.scheduler.stepsPerSecond).toBeGreaterThan(100)
    h.scheduler.pause()
    expect(h.scheduler.stepsPerSecond).toBe(0)
    expect(h.scheduler.simSecondsPerSecond).toBe(0)
    h.scheduler.stepOnce()
    expect(h.frames.at(-1)?.stepsPerSecond).toBe(0)
    expect(h.frames.at(-1)?.simSecondsPerSecond).toBe(0)
  })

  it('再開（play）の最初の 1 秒の frame は、前の再生の値ではなく 0', () => {
    const h = harness({ speed: 60, dtS: 0.5 })
    h.scheduler.play()
    h.ticks(70)
    h.scheduler.pause()
    h.scheduler.play()
    h.ticks(1)
    expect(h.scheduler.stepsPerSecond).toBe(0)
    expect(h.frames.at(-1)?.simSecondsPerSecond).toBe(0)
  })

  it('自動停止したら 0 にし、停止の frame にも 0 を載せる', () => {
    const h = harness({ speed: 60, dtS: 0.5, stopAt: 200 })
    h.scheduler.play()
    h.ticks(99)
    expect(h.frames.at(-1)?.stepsPerSecond).toBeGreaterThan(100)
    h.ticks(1)
    expect(h.scheduler.isRunning).toBe(false)
    expect(h.frames.at(-1)).toEqual({
      step: 200,
      stopReason: 'settled',
      stepsPerSecond: 0,
      simSecondsPerSecond: 0,
    })
  })
})

describe('PlaybackScheduler: 1 step の所要時間（計測用の onStepTime。spec 06 §3）', () => {
  /** step ごとに時計を stepMs[k] 進める。play の直後の tick を 1 回だけ回す。stopAt 回目で自動停止する */
  function timed(
    stepMs: readonly number[],
    speed: PlaybackSpeed,
    withTiming: boolean,
    stopAt = Number.POSITIVE_INFINITY,
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
        return stats(k, k, k >= stopAt ? 'settled' : null)
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

  it('実時間: 目標に届いてループを抜けた最後の step は、実行速度の窓の now() で閉じる', () => {
    const t = timed([7], 1, true)
    expect(t.steps()).toBe(1)
    expect(t.times).toEqual([7])
  })

  it('自動停止した tick の最後の step も数える', () => {
    const t = timed([2, 6], 'max', true, 2)
    expect(t.steps()).toBe(2)
    expect(t.times).toEqual([2, 6])
  })

  it('now() の呼び出し回数は onStepTime の有無で変わらない（タイマーの呼び出しを増やさない）', () => {
    // play 1 + tick の開始 1 + 予算の判定 4 + 実行速度の窓 1 + 次の tick の予約 1 = 8（「最速」・5・3・4 ms）
    expect(timed([5, 3, 4], 'max', true).nowCalls()).toBe(8)
    expect(timed([5, 3, 4], 'max', false).nowCalls()).toBe(8)
    // play 1 + tick の開始 1 + 予算の判定 1 + 実行速度の窓 1 + 次の tick の予約 1 = 5（実時間）
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

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run src/workers/playbackScheduler.test.ts`
Expected: FAIL（`DEFAULT_PLAYBACK_SPEED`・`rewind`・`simSecondsPerSecond` が無い、`PlaybackSpeed` に 60 が無い）

- [ ] **Step 3: メッセージを改める**

`src/shared/protocol.ts`:
- `PlaybackSpeed` を次に置き換える:

```ts
/**
 * 再生速度（spec 08 §6.1、R08-5）。数は実時間の倍率（1 は実時間、60 は実時間 1 秒でシミュレーションの 1 分）。
 * 'max' は「最速」（目標を持たず、時間予算だけで回す）
 */
export type PlaybackSpeed = 1 | 10 | 60 | 600 | 'max'

/** 既定の再生速度（60 倍。spec 08 §6.1）。Worker のスケジューラと、メインの再生のストアの初期値 */
export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 60
```

- `FrameMessage` の `stepsPerSecond: number` の後に足し、説明の段落に「simSecondsPerSecond は実際の倍率（実時間 1 秒あたりに進んだシミュレーションの秒。spec 08 §6.1）」を足す:

```ts
  simSecondsPerSecond: number
```

- [ ] **Step 4: スケジューラを置き換える**

`src/workers/playbackScheduler.ts`（全体）:

```ts
import { DEFAULT_PLAYBACK_SPEED, type PlaybackSpeed } from '../shared/protocol'
import type { StepStats } from '../simulation/types'

/** tick の目標の周期（毎秒 60 回）と、1 tick の時間予算（spec 04 §5.2、R04-5） */
export const TICK_INTERVAL_MS = 1000 / 60
export const TICK_BUDGET_MS = 12
/** 実行速度（step／秒）と実際の倍率を測る窓 */
export const RATE_WINDOW_MS = 1000

/** スケジューラが使う時計・タイマー・エンジン・送信。テストでは偽物に差し替える */
export interface SchedulerPorts {
  now(): number
  setTimer(run: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
  /** エンジンを 1 step 進める */
  step(): StepStats
  /**
   * frame を送る。返却済みのバッファが無くて送れなければ false（新しいバッファは確保しない）。
   * stepsPerSecond は step／秒、simSecondsPerSecond は実時間 1 秒あたりに進んだシミュレーションの秒（実際の倍率）
   */
  sendFrame(stats: StepStats, stepsPerSecond: number, simSecondsPerSecond: number): boolean
  /**
   * 計測用（spec 06 §3。計測用のビルドの Worker だけが渡す）。tick の中の 1 step の所要時間（ms）。
   * 時間は tick がすでに読んでいる now() の差で求め、now() の呼び出し回数を増やさない。stepOnce の 1 step は数えない
   */
  onStepTime?: (ms: number) => void
}

/**
 * 再生ループのスケジューラ（spec 04 §5.2、spec 08 §6.1）。純粋なクラスで、時計とタイマーを注入する。
 * 速度は実時間の倍率: tick ごとに「倍率 × 前の tick からの実時間の経過」を目標の時刻に足し、シミュレーションの時刻が
 * 目標に届くまで step を回す（目標を越えるのは最大 1 step の dt。越えた分は次の tick から差し引く）。「最速」は目標を
 * 持たない。どちらも時間予算で打ち切り、届かなかった分は繰り越さない。予算を残して tick を終える
 * （その間に pause・returnBuffer を処理できる）
 */
export class PlaybackScheduler {
  private readonly ports: SchedulerPorts
  private speed: PlaybackSpeed = DEFAULT_PLAYBACK_SPEED
  private timer: unknown = null
  private running = false
  private pending: StepStats | null = null
  /** 最後に見た統計の経過時間（s） */
  private simTime = 0
  /** 倍率の再生で、この時刻まで進める（s） */
  private target = 0
  /** 前の tick（play の直後は 1 tick 前とみなした時刻）の now() */
  private lastTickAt = 0
  private windowStart = 0
  private windowSteps = 0
  private windowSimSeconds = 0
  private rate = 0
  private simRate = 0

  constructor(ports: SchedulerPorts) {
    this.ports = ports
  }

  get isRunning(): boolean {
    return this.running
  }

  get stepsPerSecond(): number {
    return this.rate
  }

  /** 実際の倍率（実時間 1 秒あたりに進んだシミュレーションの秒） */
  get simSecondsPerSecond(): number {
    return this.simRate
  }

  /** 速度を変える。目標を今の時刻に戻す（越えた分・貯めた分を捨てる。計画で決めたこと 17） */
  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed
    this.target = this.simTime
  }

  /** 時刻と目標を 0 に戻す（エンジンの reset・地形の差し替えと一緒に呼ぶ） */
  rewind(): void {
    this.simTime = 0
    this.target = 0
  }

  /** 再生を始める（再開も同じ）。最初の tick はすぐに回し、1 tick 分の実時間を進めたとみなす */
  play(): void {
    if (this.running) return
    this.running = true
    this.rate = 0
    this.simRate = 0
    const now = this.ports.now()
    this.windowStart = now
    this.windowSteps = 0
    this.windowSimSeconds = 0
    this.lastTickAt = now - TICK_INTERVAL_MS
    this.target = this.simTime
    this.schedule(0)
  }

  /** 止める。止まっている間の frame（Step・Reset・矢印の切り替え）の実行速度と実際の倍率は 0 */
  pause(): void {
    this.running = false
    this.rate = 0
    this.simRate = 0
    if (this.timer !== null) {
      this.ports.clearTimer(this.timer)
      this.timer = null
    }
  }

  /** 一時停止中に 1 step（その時の dt）進め、その結果を送る。再生中は何もしない */
  stepOnce(): void {
    if (this.running) return
    this.offer(this.ports.step())
  }

  /** 送る統計を示す。バッファが無ければ保留し、返却を待つ（自動停止の frame も必ず届く）。時刻は統計から取る */
  offer(stats: StepStats): void {
    this.simTime = stats.timeS
    this.pending = stats
    this.flush()
  }

  /** バッファが返却された。保留中の frame があれば送る */
  bufferReturned(): void {
    this.flush()
  }

  /** 保留中の frame を捨てる（reset・地形の差し替え） */
  discardPending(): void {
    this.pending = null
  }

  private flush(): void {
    if (this.pending === null) return
    if (this.ports.sendFrame(this.pending, this.rate, this.simRate)) this.pending = null
  }

  private schedule(delayMs: number): void {
    this.timer = this.ports.setTimer(() => this.tick(), delayMs)
  }

  private tick(): void {
    this.timer = null
    if (!this.running) return
    const start = this.ports.now()
    const speed = this.speed
    if (speed !== 'max') this.target += (speed * (start - this.lastTickAt)) / 1000
    this.lastTickAt = start
    const onStepTime = this.ports.onStepTime
    const simBefore = this.simTime
    let steps = 0
    let last: StepStats | null = null
    // 計測中の step の始まり（その直前に読んだ now()）。step の後に最初に読む now() で閉じる。NaN は計測中でない
    let stepStart = Number.NaN
    // 先に予算を調べるので、1 step が予算を超えても 1 tick に 1 step は回る
    while (speed === 'max' || this.simTime < this.target) {
      const now = this.ports.now()
      if (onStepTime !== undefined && !Number.isNaN(stepStart)) onStepTime(now - stepStart)
      stepStart = Number.NaN
      if (now - start >= TICK_BUDGET_MS) {
        // 時間予算で目標に届かなかった分は繰り越さない（spec 08 §6.1）
        if (speed !== 'max') this.target = this.simTime
        break
      }
      stepStart = now
      last = this.ports.step()
      this.simTime = last.timeS
      steps++
      if (last.stopReason !== null) {
        // 自動停止（settled・cap。spec 08 §3.9）の後に回しても何も変わらないので、自動で止める
        this.running = false
        break
      }
    }
    const measuredAt = this.measure(steps, this.simTime - simBefore)
    // 目標か自動停止でループを抜けた最後の step は、実行速度の窓で読んだ now() で閉じる
    if (onStepTime !== undefined && !Number.isNaN(stepStart)) onStepTime(measuredAt - stepStart)
    // 自動停止したら実行速度と実際の倍率は 0（停止の frame と、その後の表示に再生中の値を載せない）
    if (!this.running) {
      this.rate = 0
      this.simRate = 0
    }
    if (last !== null) this.offer(last)
    if (this.running) {
      this.schedule(Math.max(0, TICK_INTERVAL_MS - (this.ports.now() - start)))
    }
  }

  /** 実行速度と実際の倍率の窓を進める。読んだ now() を返す（tick が最後の step の時間を閉じるのに使う） */
  private measure(steps: number, simSeconds: number): number {
    this.windowSteps += steps
    this.windowSimSeconds += simSeconds
    const now = this.ports.now()
    const elapsed = now - this.windowStart
    if (elapsed >= RATE_WINDOW_MS) {
      this.rate = (this.windowSteps * 1000) / elapsed
      this.simRate = (this.windowSimSeconds * 1000) / elapsed
      this.windowStart = now
      this.windowSteps = 0
      this.windowSimSeconds = 0
    }
    return now
  }
}
```

- [ ] **Step 5: スケジューラのテストが通ることを確かめる**

Run: `pnpm vitest run src/workers/playbackScheduler.test.ts`
Expected: PASS

- [ ] **Step 6: Runner・メイン・UI を合わせる**

`src/workers/simulationRunner.ts`:
- コンストラクタの `sendFrame: (stats, stepsPerSecond) => this.sendFrame(stats, stepsPerSecond)` を `sendFrame: (stats, stepsPerSecond, simSecondsPerSecond) => this.sendFrame(stats, stepsPerSecond, simSecondsPerSecond)` にする
- `suspend` を次にする:

```ts
  /** 再生を止め、保留中の frame を捨て、時刻を 0 に戻す（開始・Reset・新しい地点の読み込み・地形の差し替え。エンジンも 0 から） */
  suspend(): void {
    this.scheduler.pause()
    this.scheduler.discardPending()
    this.scheduler.rewind()
  }
```

- `sendFrame(stats: StepStats, stepsPerSecond: number)` を `sendFrame(stats: StepStats, stepsPerSecond: number, simSecondsPerSecond: number)` にし、`post` の frame に `stepsPerSecond,` の後に `simSecondsPerSecond,` を足す

`src/workers/simulationRunner.test.ts`:
- `setSpeed` の `speed: 4` を `speed: 600` にする（2 か所）
- 「start で雨を置いて再生し、frame の水深は…」の `h.runner.handle({ type: 'start', … })` の前に `h.runner.handle({ type: 'setSpeed', speed: 1 })` を足す（実時間の最初の tick は 1 step）
- 「バッファが 2 枚とも手元に無ければ frame を見送り、返却されると最新の状態で送る」を次にする（60 倍は 1 tick に 1〜2 step なので、step の番号ではなく、見送った後に最新のものを送ることを見る）:

```ts
  it('バッファが 2 枚とも手元に無ければ frame を見送り、返却されると最新の状態で送る', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(6)
    expect(h.frames()).toHaveLength(2)
    const sent = h.frames()[1]?.step ?? 0
    h.returnAll()
    expect(h.frames()).toHaveLength(3)
    expect(h.frames()[2]?.step ?? 0).toBeGreaterThan(sent)
  })
```

- `describe('SimulationRunner: 再生と frame…')` に足す:

```ts
  it('frame に実際の倍率（simSecondsPerSecond）を載せる。再生の最初の 1 秒は 0', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(1)
    expect(h.frames()[0]?.simSecondsPerSecond).toBe(0)
  })
```

`src/bridge/SimulationClient.ts`: `FrameView` に `simSecondsPerSecond: number` を足し（説明「実際の倍率。FrameMessage と同じ」）、`receiveFrame` の `frame` に `simSecondsPerSecond: message.simSecondsPerSecond,` を足す

`src/bridge/fakeWorker.test-support.ts` の `frameMessage` の既定に `simSecondsPerSecond: 0,` を足す（`stepsPerSecond: 60,` の後）

`src/state/simulationStore.ts`: `import { DEFAULT_PLAYBACK_SPEED, type PlaybackSpeed, type SimFailureReason } from '../shared/protocol'` にし、初期値の `speed: 1,` を `speed: DEFAULT_PLAYBACK_SPEED,` にする

`src/state/simulationStore.test.ts`: 「既定は idle・1x・統計なし」を「既定は idle・60 倍・統計なし」にし、期待値の `speed: 1` を `speed: 60` に、「reset で統計・越流・エラーを消す。速度は残す」の `setSpeed(4)` と `speed: 4` を `setSpeed(600)`・`speed: 600` にする

`src/ui/strings.ts` の `playback`:

```ts
    speed: '速度',
    /** 実時間の倍率（spec 08 §6.2）。1 は「実時間」 */
    speedValue: (speed: number) => (speed === 1 ? '実時間' : `${speed} 倍`),
    max: '最速',
```

`src/ui/components/PlaybackControls.tsx`: `const SPEEDS: readonly PlaybackSpeed[] = [1, 10, 60, 600, 'max']` にし、説明に「速度は実時間の倍率（spec 08 §6.1）」を足す

`tests/e2e/smoke.spec.ts` の 2 か所の `strings.playback.speedValue(0.25)` を `strings.playback.speedValue(10)` にする（「10 倍」。テストは Button・ToggleButton の文字が大文字にならないことを見る）

`tests/e2e/explanations.spec.ts` の `strings.playback.speedValue(0.25)` を `strings.playback.speedValue(1)` にする（「実時間」。開始してすぐ一時停止するための遅い速度。Task 14 で書き直す）

- [ ] **Step 7: テストが通ることを確かめる**

Run: `pnpm vitest run src/workers src/bridge src/state src/ui`
Expected: PASS（`ControlsSection.test.tsx` の「速度は『最速』を含めて選べる」もそのまま通る）

- [ ] **Step 8: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

Run: `pnpm build && pnpm size`
Expected: 初期ロードの差は +0.1 KB 以下（文言と定数）

- [ ] **Step 9: コミット**

```bash
git add src/shared/protocol.ts src/workers src/bridge src/state src/ui tests/e2e/smoke.spec.ts tests/e2e/explanations.spec.ts
git commit -m "spec 08 Task 10: 再生速度を実時間の倍率にし、frame に実際の倍率を載せる"
```

---
### Task 11: 矢印の下限と単位（m/s）、`TerrainPayload.outflow` から `mask` を外す。M2 の E2E（spec §3.10・§5.3・§6.5 の表の 1 行目、N8、レビュー 1 の m3）

**Files:**
- Modify: `src/workers/flowArrows.ts`（+ test）、`src/workers/terrainResult.ts`（+ test）
- Modify: `src/shared/protocol.ts`
- Modify: `src/simulation/outflowCells.ts`（+ test）
- Modify: `src/map/WaterOverlay.test.ts`、`src/ui/simulationSession.test.ts`

**Interfaces:**
- Consumes: `ARROW_MIN_VELOCITY_M_PER_S`（Task 3）、`flowVectors()` の m/s（Task 5）
- Produces:
  - `interface OutflowCells { nearest: Int32Array; band: Int32Array }`（`mask` を外す。`outflowBoundaryMask` は export のまま、テストが直接呼ぶ）
  - `thinFlowArrows` は流速が `ARROW_MIN_VELOCITY_M_PER_S` 未満のセルを出さない

- [ ] **Step 1: 失敗するテストを書く**

`src/workers/flowArrows.test.ts` の `describe` の中に足す:

```ts
  it('流速が ARROW_MIN_VELOCITY_M_PER_S（0.005 m/s）未満のセルは出さない（ほとんど止まった水に矢印を出さない。spec 08 §3.10）', () => {
    // 4 × 1・セル 1 m・間隔 1 m。0.0049 と 0.0049（南）は出さず、0.0051 と 0.01 は出す
    const vx = Float32Array.of(0.0049, 0.0051, 0.01, 0)
    const vy = Float32Array.of(0, 0, 0, 0.0049)
    const arrows = thinFlowArrows(vx, vy, 4, 1, 1, 1)
    const columns: number[] = []
    for (let k = 0; k < arrows.length; k += 4) columns.push(arrows[k] ?? -1)
    expect(columns).toEqual([1, 2])
  })
```

`src/simulation/outflowCells.test.ts` の `describe('buildOutflowCells')`:
- 「band は nearest が 0 以上のセルの添字の昇順の一覧」の最後の `expect(cells.mask.length).toBe(n * n)` を次の 2 行にする:

```ts
    // マスクは送らない（メインで読まれていない。spec 08 §5.3、N8）
    expect(Object.keys(cells).sort()).toEqual(['band', 'nearest'])
```

- 「全部無効なら、マスクも帯も空で…」の `expect(Array.from(cells.mask).every((v) => v === 0)).toBe(true)` を `expect(Array.from(outflowBoundaryMask(new Uint8Array(n * n), n, n)).every((v) => v === 0)).toBe(true)` にする

`src/workers/terrainResult.test.ts`:
- `makeOutflow` の `mask: Uint8Array.from([1, 1, 1, 0]),` の行を消す
- 「transfer は payload の…」のテストの名前の「流出の表の mask・nearest・band」を「流出の表の nearest・band（mask は送らない。spec 08 §5.3）」にし、期待値の `outflow.mask.buffer,` の行を消す

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run src/workers/flowArrows.test.ts src/simulation/outflowCells.test.ts src/workers/terrainResult.test.ts`
Expected: FAIL（矢印に 0.0049 の列 0 が出る、`buildOutflowCells` の結果に `mask` がある、`makeOutflow` の型の誤り）

- [ ] **Step 3: 実装する**

`src/workers/flowArrows.ts`:
- 先頭に `import { ARROW_MIN_VELOCITY_M_PER_S } from '../simulation/constants'` を足す
- 説明を「水の流れの矢印（spec 04 §5.1、base-spec §32、spec 08 §3.10）。flowVectors()（m/s）を spacingM ごとに間引き、流速が ARROW_MIN_VELOCITY_M_PER_S 以上のセルだけを [列, 行, 方位（度）, 大きさ（m/s）] の並びにする（局所慣性式では、ほとんど止まった水にも微小な流速が残るため）。…」にする
- `if (magnitude === 0) continue` を `if (!(magnitude >= ARROW_MIN_VELOCITY_M_PER_S)) continue` にする
- コメントの「FlowSolver のベクトルは y が南向きが正（NEIGHBOR_DY）」を「エンジンの流速は y が南向きが正」にする

`src/shared/protocol.ts` の `FrameMessage` の説明の「大きさ（m／step）」を「大きさ（m/s。spec 08 §3.10）」にする

`src/simulation/outflowCells.ts`:
- 先頭の説明の「そのため『近傍にグリッドの外か無効セルを含む有効セル』は、水深が θ を超えればその step に必ず外へ流す」を「そのため『上下左右にグリッドの外か無効セルを含む有効セル』は、面を通れる水深が DRY_DEPTH_M を超えれば、その step に必ず外へ流す（spec 08 §3.6）」に、「（08 で流れが 4 近傍になれば、マスクも一緒に変わる。推奨 R3）」を「（spec 08 で 4 近傍の面の表になった。R08-2）」にする
- `OutflowCells` から `mask` の項目を消し、説明に「マスク（outflowBoundaryMask）は nearest を作るためだけに使い、メインへは送らない（メインは nearest と band だけを読む。spec 08 §5.3、N8）」を足す
- `buildOutflowCells` の `return { mask, nearest, band }` を `return { nearest, band }` にする

`src/workers/terrainResult.ts`: transfer の `outflow.mask.buffer as ArrayBuffer,` の行を消し、説明の「流出の表」を「流出の表（nearest・band。spec 08 §5.3 で mask は外した）」にする

`src/map/WaterOverlay.test.ts` の `OUTFLOW` の `mask: Uint8Array.of(1, 1, 0, 0),` の行を消す

`src/ui/simulationSession.test.ts` の `terrain` の `outflow` の `mask: new Uint8Array(geo.size * geo.size),` の行を消す

- [ ] **Step 4: テストが通ることを確かめる**

Run: `pnpm vitest run src/workers src/simulation/outflowCells.test.ts src/map src/ui`
Expected: PASS（Task 5 で 3 step 進めるようにした Runner の矢印のテストも、中央のセルの流速が 0.005 m/s 以上で通る。通らなければ step 数と中央のセルの流速を報告に書き、step を 5 に増やす）

- [ ] **Step 5: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

Run: `pnpm build && pnpm size`
Expected: 初期ロードは変わらない（±0.1 KB）

- [ ] **Step 6: M2 の E2E（UI の雨はまだ一度に置く。速度は新しい選択肢）**

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 49 passed。落ちたら直さずに止め、テストの名前と画面の値を報告に書く

- [ ] **Step 7: コミット**

```bash
git add src/workers src/shared/protocol.ts src/simulation/outflowCells.ts src/simulation/outflowCells.test.ts src/map/WaterOverlay.test.ts src/ui/simulationSession.test.ts
git commit -m "spec 08 Task 11: 矢印を 0.005 m/s 以上に絞り（単位 m/s）、TerrainPayload.outflow から mask を外す"
```

---

## レビュー役のチェックポイント（M2。Task 11 の後）

1. `git log --oneline <M1 の承認のコミット>..HEAD`（Task 10・11）と `git diff --stat`
2. ゲートの結果（ユニットの件数・E2E 49 件・`pnpm size`）
3. スケジューラの決めごと（計画で決めたこと 17: 最初の tick、`setSpeed`、`rewind`、既定の 60 倍）を実装の中で変えたか
4. `TerrainPayload.outflow` の転送から外れた大きさ（1000 m で約 1 MB。spec §5.3）

---

# M3: UI・文言・入力・URL・localStorage（spec §11 の M3）

### Task 12: 雨の設定（保存値 v2・URL・入力の検証・入力欄・開始）（spec §4.1・§6.3・§6.4、R08-7・R08-8、N1〜N4、Review Focus 4・5、計画で決めたこと 3・19・31）

M1 の暫定の橋渡し（一度に置く雨）をここで外し、画面の雨を「時間雨量 × 継続時間」にする。

**Files:**
- Modify（全体を置き換える）: `src/state/persistedSettings.ts`、`src/state/persistedSettings.test.ts`、`src/state/urlState.ts`、`src/state/settingsStore.test.ts`
- Modify: `src/state/settingsStore.ts`、`src/state/urlState.test.ts`
- Modify: `src/ui/validation.ts`（+ test）、`src/ui/strings.ts`
- Modify（全体を置き換える）: `src/ui/components/RainfallControls.tsx`、`src/ui/components/ControlsSection.tsx`、`src/ui/components/ControlsSection.test.tsx`
- Modify: `src/ui/simulationSession.ts`（+ test）、`src/ui/terrainSession.ts`、`src/ui/perfHook.ts`、`src/ui/perfWater.ts`、`src/ui/perfSteps.ts`、`src/ui/perfReports.ts`
- Modify: `tests/e2e/simulation.spec.ts`（型が通るように名前だけ。中身は Task 14）

**Interfaces:**
- Consumes: `RainfallInput`（Task 5）
- Produces:
  - `DURATIONS_MIN = [10, 20, 30, 60, 120, 180, 360] as const`、`type DurationMin`、`INTENSITY_MM_PER_H = { min: 1, max: 300 }`、`interface RainfallSettings { intensityMmPerH; durationMin: DurationMin; radiusM; wholeRange }`、`DEFAULT_RAINFALL`、`isValidIntensityMmPerH(value: unknown): value is number`、`isDurationMin(value: unknown): value is DurationMin`、`PersistedSettings.schemaVersion: 2`（`src/state/persistedSettings.ts`）
  - `UrlView`・`UrlWrite`・`UrlSettings` に `intensityMmPerH`・`durationMin`・`wholeRange`（`amountMm` を外す）
  - `parseIntensityMmPerH(text: string): number | null`（`src/ui/validation.ts`。`parseAmountMm` を外す）
  - `PlaybackActions.start(rain: RainfallSettings): void`、`SimulationSession.start(rain: RainfallSettings): void`（`durationS = durationMin × 60`）
  - `strings.rainfall`: `intensity`・`intensitySlider`・`intensityError`・`duration`・`durationValue(minutes)`・`wholeRange`（`amount`・`amountSlider`・`amountError` を外す）、`rangeSizeHeavyHint` の新しい文

- [ ] **Step 1: 保存値のテストを書く（全体を置き換える）**

`src/state/persistedSettings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  ARROW_SPACINGS,
  clampArrowSpacing,
  DEFAULT_SETTINGS,
  DURATIONS_MIN,
  INTENSITY_MM_PER_H,
  isDurationMin,
  isValidIntensityMmPerH,
  parsePersistedSettings,
} from './persistedSettings'

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

/** v0.2.0 が保存した値（schemaVersion 1、showOutflowCells が無い。注意事項は了解済み） */
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
  map: { basemap: 'photo', theme: 'dark' },
  disclaimerAcknowledgedAt: '2026-09-20T01:02:03.000Z',
}

/** 07 が保存した値（schemaVersion 1、showOutflowCells あり） */
const V07 = { ...V020, display: { ...V020.display, showOutflowCells: false } }

/** 08 が保存する値（schemaVersion 2） */
const V2 = {
  ...DEFAULT_SETTINGS,
  rainfall: { intensityMmPerH: 250, durationMin: 120, radiusM: 40, wholeRange: true },
  disclaimerAcknowledgedAt: '2026-09-30T00:00:00.000Z',
}

describe('雨の設定の形（spec 08 §4.1・§6.3・§6.4）', () => {
  it('既定は 100 mm/h・1 時間・半径 10 m・範囲全体オフ。schemaVersion は 2', () => {
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(2)
    expect(DEFAULT_SETTINGS.rainfall).toEqual({
      intensityMmPerH: 100,
      durationMin: 60,
      radiusM: 10,
      wholeRange: false,
    })
  })

  it('時間雨量は 1〜300 の整数、継続時間は 10・20・30・60・120・180・360 分', () => {
    expect(INTENSITY_MM_PER_H).toEqual({ min: 1, max: 300 })
    expect(DURATIONS_MIN).toEqual([10, 20, 30, 60, 120, 180, 360])
    for (const ok of [1, 100, 300]) expect(isValidIntensityMmPerH(ok)).toBe(true)
    for (const bad of [0, 301, 1.5, '100', Number.NaN]) expect(isValidIntensityMmPerH(bad)).toBe(false)
    expect(isDurationMin(120)).toBe(true)
    for (const bad of [45, '60', 0]) expect(isDurationMin(bad)).toBe(false)
  })

  it('v2 の保存値はそのまま読む', () => {
    expect(parsePersistedSettings(V2)).toEqual(V2)
  })

  it.each<[string, Record<string, unknown>]>([
    ['v0.2.0（showOutflowCells なし）', V020],
    ['07（showOutflowCells あり）', V07],
    ['雨量が欠けている', { ...V020, rainfall: { radiusM: 30 } }],
    ['雨量が範囲外', { ...V020, rainfall: { amountMm: 5000, radiusM: 30 } }],
    ['雨量が文字列', { ...V020, rainfall: { amountMm: '120', radiusM: 30 } }],
  ])(
    'v1（%s）は雨量を読まず、時間雨量・継続時間・範囲全体を既定にする。半径と、ほかの設定（注意事項の了解を含む）は残す（R08-8、N1）',
    (_, saved) => {
      const parsed = parsePersistedSettings(saved)
      expect(parsed?.schemaVersion).toBe(2)
      expect(parsed?.rainfall).toEqual({
        intensityMmPerH: 100,
        durationMin: 60,
        radiusM: 30,
        wholeRange: false,
      })
      expect(parsed?.disclaimerAcknowledgedAt).toBe('2026-09-20T01:02:03.000Z')
      expect(parsed?.area).toEqual({ sizeM: 500 })
      expect(parsed?.map).toEqual({ basemap: 'photo', theme: 'dark' })
      expect(parsed?.display.verticalExaggeration).toBe(2)
    },
  )

  it('v1 の showOutflowCells は、欠けていれば true、あればその値（spec 07 §5.3）', () => {
    expect(parsePersistedSettings(V020)?.display.showOutflowCells).toBe(true)
    expect(parsePersistedSettings(V07)?.display.showOutflowCells).toBe(false)
  })

  it.each<[string, Record<string, unknown>]>([
    ['半径が欠けている', { ...V020, rainfall: { amountMm: 120 } }],
    ['半径が範囲の半分を超える', { ...V020, rainfall: { amountMm: 120, radiusM: 251 } }],
    ['範囲の大きさが候補に無い', { ...V020, area: { sizeM: 300 } }],
    ['ベースマップが候補に無い', { ...V020, map: { basemap: 'satellite', theme: 'dark' } }],
    ['表示の流出が真偽値でない', { ...V020, display: { ...V020.display, showOutflowCells: 'yes' } }],
  ])('v1 で雨量以外（%s）が不正なら、今までどおり全体を捨てる（null。N2）', (_, saved) => {
    expect(parsePersistedSettings(saved)).toBeNull()
  })

  it.each<[string, unknown]>([
    ['時間雨量 0', { ...V2.rainfall, intensityMmPerH: 0 }],
    ['時間雨量 301', { ...V2.rainfall, intensityMmPerH: 301 }],
    ['時間雨量が整数でない', { ...V2.rainfall, intensityMmPerH: 1.5 }],
    ['時間雨量が文字列', { ...V2.rainfall, intensityMmPerH: '100' }],
    ['継続時間が選択肢に無い', { ...V2.rainfall, durationMin: 45 }],
    ['継続時間が欠けている', { intensityMmPerH: 100, radiusM: 10, wholeRange: false }],
    ['範囲全体が真偽値でない', { ...V2.rainfall, wholeRange: 'yes' }],
    ['v1 の形のまま', { amountMm: 100, radiusM: 10 }],
  ])('v2 で雨の設定が不正（%s）なら全体を捨てる（null）', (_, rainfall) => {
    expect(parsePersistedSettings({ ...V2, rainfall })).toBeNull()
  })

  it.each<[string, unknown]>([
    ['3', 3],
    ['無い', undefined],
    ['文字列の 2', '2'],
  ])('schemaVersion が 1・2 以外（%s）なら null', (_, schemaVersion) => {
    expect(parsePersistedSettings({ ...V2, schemaVersion })).toBeNull()
  })
})

describe('display.showOutflowCells（spec 07 §5.3、軽微 m2）', () => {
  it('既定はオン', () => {
    expect(DEFAULT_SETTINGS.display.showOutflowCells).toBe(true)
  })

  it.each<[string, unknown]>([
    ['文字列', 'yes'],
    ['null', null],
    ['数', 1],
  ])('型が違えば（%s）全体を捨てる（null）', (_, value) => {
    expect(
      parsePersistedSettings({ ...V2, display: { ...V2.display, showOutflowCells: value } }),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: 保存値を置き換える**

`src/state/persistedSettings.ts`（全体）:

```ts
/** localStorage に保存する UI 設定（tech-spec §8.3）。検証は型ガードを手で書く（spec 04 §7） */

export const SETTINGS_KEY = 'raintrace.settings'

export const RANGE_SIZES = [250, 500, 1000] as const
export type RangeSizeM = (typeof RANGE_SIZES)[number]
export const ARROW_SPACINGS = [10, 20] as const
export const VERTICAL_EXAGGERATIONS = [1, 2, 5, 10] as const
export const WATER_PALETTES = ['stepped', 'continuous'] as const
export const BASEMAPS = ['std', 'pale', 'photo'] as const
export type Basemap = (typeof BASEMAPS)[number]
export const THEME_MODES = ['light', 'dark', 'system'] as const
export type ThemeMode = (typeof THEME_MODES)[number]
/** 継続時間の選択肢（分。spec 08 §4.1、R08-7） */
export const DURATIONS_MIN = [10, 20, 30, 60, 120, 180, 360] as const
export type DurationMin = (typeof DURATIONS_MIN)[number]

/** 入力の範囲（spec 08 §4.1・§6.3、R08-7。半径は R04-6 のまま） */
export const INTENSITY_MM_PER_H = { min: 1, max: 300 } as const
export const RADIUS_MIN_M = 1
export const maxRadiusM = (sizeM: RangeSizeM): number => sizeM / 2

/** 雨の設定（spec 08 §6.4） */
export interface RainfallSettings {
  /** 時間雨量（mm/h）。1〜300 の整数 */
  intensityMmPerH: number
  durationMin: DurationMin
  /** 円の半径（m）。範囲全体に降らせる間は使わないが、値は残す */
  radiusM: number
  /** 範囲全体に降らせる（R08-4） */
  wholeRange: boolean
}

export interface PersistedSettings {
  schemaVersion: 2
  rainfall: RainfallSettings
  area: { sizeM: RangeSizeM }
  display: {
    verticalExaggeration: (typeof VERTICAL_EXAGGERATIONS)[number]
    waterDepthPalette: (typeof WATER_PALETTES)[number]
    /** 水の流れの矢印（spec 04 §6.2） */
    showFlowVectors: boolean
    /** 水の流れと地形の流向の矢印の間隔（計画で決めたこと 10） */
    flowVectorSpacingM: (typeof ARROW_SPACINGS)[number]
    /** 流出しているセルの表示（spec 07 §5.3）。v0.2.0 の保存値には無いので、欠けていれば true で補う */
    showOutflowCells: boolean
  }
  map: { basemap: Basemap; theme: ThemeMode }
  disclaimerAcknowledgedAt: string | null
}

/** 既定の雨（100 mm/h × 1 時間、半径 10 m、円。spec 08 §4.1。総量は 04 の既定の 100 mm と同じ） */
export const DEFAULT_RAINFALL: RainfallSettings = {
  intensityMmPerH: 100,
  durationMin: 60,
  radiusM: 10,
  wholeRange: false,
}

export const DEFAULT_SETTINGS: PersistedSettings = {
  schemaVersion: 2,
  rainfall: DEFAULT_RAINFALL,
  area: { sizeM: 500 },
  display: {
    verticalExaggeration: 2,
    waterDepthPalette: 'stepped',
    showFlowVectors: true,
    flowVectorSpacingM: 10,
    showOutflowCells: true,
  },
  map: { basemap: 'pale', theme: 'system' },
  disclaimerAcknowledgedAt: null,
}

export function isValidIntensityMmPerH(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= INTENSITY_MM_PER_H.min &&
    value <= INTENSITY_MM_PER_H.max
  )
}

export function isDurationMin(value: unknown): value is DurationMin {
  return DURATIONS_MIN.includes(value as DurationMin)
}

export function isValidRadiusM(value: unknown, sizeM: RangeSizeM): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= RADIUS_MIN_M &&
    value <= maxRadiusM(sizeM)
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const oneOf = <T>(list: readonly T[], value: unknown): value is T => list.includes(value as T)

/**
 * 矢印の間隔の保存値・perfHook が渡す値（5・10・20）。5 は選べる値から外れたが（R06-11 の裁定）、
 * 保存済みの値と計測だけの URL（arrowsM=5）からは今も届きうるので、検証の入力の型に残す
 */
const ARROW_SPACING_INPUTS = [5, ...ARROW_SPACINGS] as const

/**
 * 矢印の間隔を選べる値に丸める。5（選択肢から外れた値）は 10 として読む（移行）。
 * ARROW_SPACING_INPUTS で検証した後の値だけを渡す（parsePersistedSettings と perfHook.ts が呼ぶ。R06-11）
 */
export function clampArrowSpacing(
  value: (typeof ARROW_SPACING_INPUTS)[number],
): (typeof ARROW_SPACINGS)[number] {
  return value === 5 ? 10 : value
}

/**
 * 保存値を検証する（tech-spec §8.3、spec 08 §6.4）。返すのは常に schemaVersion 2 の形。
 * - schemaVersion 2: すべての項目を検証し、どれかが欠けるか不正なら null（呼び出し側が既定値に戻す）
 * - schemaVersion 1（v0.2.0・07）: 雨量（amountMm）は読まず、時間雨量・継続時間・範囲全体を既定にする
 *   （R08-8、N1）。半径（radiusM）は R04-6 の検証を通れば残す。雨量以外の項目は今までと同じ規則で検証し、
 *   不正なら null（N2）
 * - それ以外の schemaVersion: null
 * どちらの版でも、欠けた showOutflowCells は true で補い（spec 07）、矢印の間隔 5 は 10 に読む（R06-11）
 */
export function parsePersistedSettings(value: unknown): PersistedSettings | null {
  if (!isRecord(value)) return null
  const version = value.schemaVersion
  if (version !== 1 && version !== 2) return null
  const { rainfall, area, display, map, disclaimerAcknowledgedAt } = value
  if (!isRecord(rainfall) || !isRecord(area) || !isRecord(display) || !isRecord(map)) return null
  const { sizeM } = area
  if (!oneOf(RANGE_SIZES, sizeM)) return null
  const { radiusM } = rainfall
  if (!isValidRadiusM(radiusM, sizeM)) return null
  let rain: RainfallSettings
  if (version === 2) {
    const { intensityMmPerH, durationMin, wholeRange } = rainfall
    if (
      !isValidIntensityMmPerH(intensityMmPerH) ||
      !isDurationMin(durationMin) ||
      typeof wholeRange !== 'boolean'
    ) {
      return null
    }
    rain = { intensityMmPerH, durationMin, radiusM, wholeRange }
  } else {
    // v1: 雨量は読み替えない（R08-8）。雨量だけを既定に戻し、半径は残す（N1）
    rain = { ...DEFAULT_RAINFALL, radiusM }
  }
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
  const { basemap, theme } = map
  if (!oneOf(BASEMAPS, basemap) || !oneOf(THEME_MODES, theme)) return null
  if (
    disclaimerAcknowledgedAt !== null &&
    (typeof disclaimerAcknowledgedAt !== 'string' ||
      Number.isNaN(Date.parse(disclaimerAcknowledgedAt)))
  ) {
    return null
  }
  return {
    schemaVersion: 2,
    rainfall: rain,
    area: { sizeM },
    display: {
      verticalExaggeration,
      waterDepthPalette,
      showFlowVectors,
      flowVectorSpacingM: clampArrowSpacing(flowVectorSpacingM),
      showOutflowCells,
    },
    map: { basemap, theme },
    disclaimerAcknowledgedAt,
  }
}
```

- [ ] **Step 3: 設定のストアと URL**

`src/state/settingsStore.ts`:
- import を `DEFAULT_SETTINGS, isDurationMin, isValidIntensityMmPerH, isValidRadiusM, maxRadiusM, type DurationMin, type PersistedSettings, parsePersistedSettings, type RainfallSettings, type RangeSizeM, SETTINGS_KEY` にする（`isValidAmountMm` を外す）
- `UrlSettings` を次にする:

```ts
/** URL から読んだ値（tech-spec §3.3、spec 08 §6.4）。無い・読めない項目は null */
export interface UrlSettings {
  sizeM: RangeSizeM | null
  intensityMmPerH: number | null
  durationMin: DurationMin | null
  wholeRange: boolean | null
  radiusM: number | null
}
```

- `SettingsActions.setRainfall` の引数の型を `rainfall: RainfallSettings` にする
- `applyUrl` を次にする:

```ts
        applyUrl: ({ sizeM, intensityMmPerH, durationMin, wholeRange, radiusM }) =>
          set((s) => {
            const size = sizeM ?? s.area.sizeM
            return {
              area: { sizeM: size },
              rainfall: {
                intensityMmPerH: isValidIntensityMmPerH(intensityMmPerH)
                  ? intensityMmPerH
                  : s.rainfall.intensityMmPerH,
                durationMin: isDurationMin(durationMin) ? durationMin : s.rainfall.durationMin,
                wholeRange: typeof wholeRange === 'boolean' ? wholeRange : s.rainfall.wholeRange,
                radiusM: isValidRadiusM(radiusM, size)
                  ? radiusM
                  : clampRadius(s.rainfall.radiusM, size),
              },
            }
          }),
```

- `partialize` の `schemaVersion: 1` を `schemaVersion: 2` にする。`merge` の説明に「v1 は雨量だけを既定に戻して読む（spec 08 §6.4）。保存するときは常に v2 の形」を足す

`src/state/urlState.ts`（全体）:

```ts
import {
  type DurationMin,
  INTENSITY_MM_PER_H,
  isDurationMin,
  isValidIntensityMmPerH,
  maxRadiusM,
  RADIUS_MIN_M,
  RANGE_SIZES,
  type RangeSizeM,
} from './persistedSettings'

/**
 * 共有できる URL（tech-spec §3.3、spec 08 §6.4）: lat・lon・z・size・mmh・dur・all・r。
 * 古い URL の mm（総量の雨量）は読まない（R08-8、N3。無いものとして扱い、雨は保存値になる）
 */
export interface UrlView {
  point: { lon: number; lat: number } | null
  zoom: number | null
  sizeM: RangeSizeM | null
  intensityMmPerH: number | null
  durationMin: DurationMin | null
  wholeRange: boolean | null
  radiusM: number | null
}

/** URL に書く値。size・mmh・dur・all・r は地点があるときだけ書く */
export interface UrlWrite {
  point: { lon: number; lat: number } | null
  zoom: number | null
  sizeM: RangeSizeM
  intensityMmPerH: number
  durationMin: DurationMin
  wholeRange: boolean
  radiusM: number
}

/**
 * 管理するキー。古い mm は読まないが、ここに残して、次に URL を書くときに消す（spec 08 §6.4、N3）
 */
const MANAGED_KEYS = ['lat', 'lon', 'z', 'size', 'mm', 'mmh', 'dur', 'all', 'r'] as const

// Web Mercator（MapLibre）が扱える緯度の範囲。これを超えると地図の座標に変換できない
const MERCATOR_LAT_LIMIT = 85.051129

function readNumber(params: URLSearchParams, key: string, min: number, max: number): number | null {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : null
}

export function parseUrlView(search: string): UrlView {
  const params = new URLSearchParams(search)
  // 日本の対応範囲の外でも、地図が扱える緯度なら地点として読む（Worker が out-of-range を返す。クリックと同じ扱い）
  const lat = readNumber(params, 'lat', -MERCATOR_LAT_LIMIT, MERCATOR_LAT_LIMIT)
  const lon = readNumber(params, 'lon', -180, 180)
  const size = readNumber(params, 'size', 0, Number.POSITIVE_INFINITY)
  const intensity = readNumber(params, 'mmh', INTENSITY_MM_PER_H.min, INTENSITY_MM_PER_H.max)
  const duration = readNumber(params, 'dur', 0, Number.POSITIVE_INFINITY)
  const all = params.get('all')
  return {
    point: lat !== null && lon !== null ? { lat, lon } : null,
    zoom: readNumber(params, 'z', 0, 22),
    sizeM: RANGE_SIZES.find((s) => s === size) ?? null,
    intensityMmPerH: isValidIntensityMmPerH(intensity) ? intensity : null,
    durationMin: isDurationMin(duration) ? duration : null,
    wholeRange: all === '1' ? true : all === '0' ? false : null,
    // 範囲の半分との照合は、範囲の大きさが決まる設定のストア（applyUrl）で行う
    radiusM: readNumber(params, 'r', RADIUS_MIN_M, maxRadiusM(1000)),
  }
}

/**
 * URL のクエリを作る（先頭の ? を含む。何も無ければ空文字）。管理しないパラメータは残す。
 * all はオフでも 0 を書く（共有した URL を開いた人の保存値で、円と範囲全体が入れ替わらないようにする。N4）
 */
export function formatUrlView(currentSearch: string, view: UrlWrite): string {
  const params = new URLSearchParams(currentSearch)
  for (const key of MANAGED_KEYS) params.delete(key)
  if (view.point !== null) {
    params.set('lat', view.point.lat.toFixed(6))
    params.set('lon', view.point.lon.toFixed(6))
  }
  // 小数点以下の末尾の 0 だけを落とす（'16.10' → '16.1'、'10.00' → '10'、'0.00' → '0'。空にはならない）
  if (view.zoom !== null) params.set('z', view.zoom.toFixed(2).replace(/\.?0+$/, ''))
  if (view.point !== null) {
    params.set('size', String(view.sizeM))
    params.set('mmh', String(view.intensityMmPerH))
    params.set('dur', String(view.durationMin))
    params.set('all', view.wholeRange ? '1' : '0')
    params.set('r', String(view.radiusM))
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}
```

`src/ui/terrainSession.ts` の `writeUrl` の `amountMm: rainfall.amountMm,` を次の 3 行にする:

```ts
      intensityMmPerH: rainfall.intensityMmPerH,
      durationMin: rainfall.durationMin,
      wholeRange: rainfall.wholeRange,
```

- [ ] **Step 4: 設定のストアと URL のテストを直す**

`src/state/urlState.test.ts`:
- 読むテストの期待値の `amountMm: null,` を 3 行にする: `sed -i 's/^      amountMm: null,$/      intensityMmPerH: null,\n      durationMin: null,\n      wholeRange: null,/' src/state/urlState.test.ts`
- 「size・mm・r を読む（tech-spec §3.3）」と「size は 250・500・1000 だけ、mm は…」の 2 つを次に置き換える:

```ts
  it('size・mmh・dur・all・r を読む（spec 08 §6.4）', () => {
    expect(parseUrlView('?mmh=50&dur=120&all=1&r=20.5&size=250')).toMatchObject({
      sizeM: 250,
      intensityMmPerH: 50,
      durationMin: 120,
      wholeRange: true,
      radiusM: 20.5,
    })
    expect(parseUrlView('?all=0').wholeRange).toBe(false)
  })

  it('mmh は 1〜300 の整数、dur は選択肢の分、all は 0・1、size は 250・500・1000、r は 1〜500。ほかは読まない', () => {
    expect(parseUrlView('?mmh=0&dur=45&all=yes&r=abc&size=300')).toMatchObject({
      sizeM: null,
      intensityMmPerH: null,
      durationMin: null,
      wholeRange: null,
      radiusM: null,
    })
    expect(parseUrlView('?mmh=1.5&dur=60.5&r=501')).toMatchObject({
      intensityMmPerH: null,
      durationMin: null,
      radiusM: null,
    })
    expect(parseUrlView('?mmh=301').intensityMmPerH).toBeNull()
  })

  it('古い mm は読まない（無いものとして扱う。R08-8、N3）。mm と mmh が両方あれば mmh だけを読む（Review Focus 4）', () => {
    expect(parseUrlView('?mm=50&r=20')).toMatchObject({ intensityMmPerH: null, radiusM: 20 })
    expect(parseUrlView('?mm=50&mmh=80').intensityMmPerH).toBe(80)
  })
```

- `describe('formatUrlView')` を次に置き換える:

```ts
describe('formatUrlView', () => {
  const view = {
    sizeM: 500 as const,
    intensityMmPerH: 100,
    durationMin: 120 as const,
    wholeRange: false,
    radiusM: 10,
  }

  it('lat・lon は小数 6 桁、z は小数 2 桁、size・mmh・dur・all・r を書く（all はオフでも 0。N4）。ほかのパラメータは残す', () => {
    expect(
      formatUrlView('?foo=1', {
        ...view,
        point: { lat: 35.68123456, lon: 139.7671234 },
        zoom: 16.123,
      }),
    ).toBe('?foo=1&lat=35.681235&lon=139.767123&z=16.12&size=500&mmh=100&dur=120&all=0&r=10')
    expect(
      formatUrlView('', { ...view, wholeRange: true, point: { lat: 1, lon: 2 }, zoom: null }),
    ).toContain('all=1')
  })

  it('古い mm は書くときに消える（N3。Review Focus 4）', () => {
    expect(
      formatUrlView('?mm=50&mmh=80', { ...view, point: { lat: 1, lon: 2 }, zoom: null }),
    ).not.toMatch(/[?&]mm=/)
  })

  it('z の末尾の 0 は落とす', () => {
    expect(formatUrlView('', { ...view, point: null, zoom: 10 })).toBe('?z=10')
  })

  it('z が 0 でも空にせず z=0 と書く', () => {
    expect(formatUrlView('', { ...view, point: null, zoom: 0 })).toBe('?z=0')
    expect(formatUrlView('', { ...view, point: null, zoom: 0.001 })).toBe('?z=0')
  })

  it('地点が無ければ lat・lon・size・mm・mmh・dur・all・r を消す', () => {
    expect(
      formatUrlView('?lat=1&lon=2&size=500&mm=5&mmh=5&dur=60&all=1&r=3&z=5', {
        ...view,
        point: null,
        zoom: 5,
      }),
    ).toBe('?z=5')
    expect(formatUrlView('?lat=1&lon=2', { ...view, point: null, zoom: null })).toBe('')
  })
})
```

`src/state/settingsStore.test.ts`（全体を置き換える）:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from './memoryStorage.test-support'
import { DEFAULT_SETTINGS, type PersistedSettings, SETTINGS_KEY } from './persistedSettings'
import { createSettingsStore, safeLocalStorage } from './settingsStore'

afterEach(() => {
  vi.unstubAllGlobals()
})

const saved = (patch: Partial<PersistedSettings> = {}): Record<string, string> => ({
  [SETTINGS_KEY]: JSON.stringify({ ...DEFAULT_SETTINGS, ...patch }),
})

function persisted(storage: { data: Map<string, string> }): unknown {
  return JSON.parse(storage.data.get(SETTINGS_KEY) ?? 'null')
}

const RAIN = { intensityMmPerH: 80, durationMin: 30, radiusM: 15, wholeRange: false } as const

/** URL に何も無いときの applyUrl の引数 */
const NO_URL = {
  sizeM: null,
  intensityMmPerH: null,
  durationMin: null,
  wholeRange: null,
  radiusM: null,
} as const

describe('settingsStore（tech-spec §8.3）', () => {
  it('保存が無ければ既定値', () => {
    const store = createSettingsStore(memoryStorage())
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
  })

  it('保存された値を読み込む', () => {
    const store = createSettingsStore(memoryStorage(saved({ rainfall: RAIN })))
    expect(store.getState().rainfall).toEqual(RAIN)
  })

  it('変更は §8.3 の形（schemaVersion 2）のまま保存する（zustand の { state, version } で包まない）', () => {
    const storage = memoryStorage()
    const store = createSettingsStore(storage)
    const rainfall = { intensityMmPerH: 200, durationMin: 120, radiusM: 30, wholeRange: true } as const
    store.getState().setRainfall(rainfall)
    store.getState().acknowledgeDisclaimer('2026-09-12T00:00:00.000Z')
    expect(persisted(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      rainfall,
      disclaimerAcknowledgedAt: '2026-09-12T00:00:00.000Z',
    })
  })

  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Record<string, unknown>
  it.each<[string, unknown]>([
    ['schemaVersion が 3', { ...base, schemaVersion: 3 }],
    ['schemaVersion が無い', { ...base, schemaVersion: undefined }],
    ['時間雨量 0', { ...base, rainfall: { ...RAIN, intensityMmPerH: 0 } }],
    ['時間雨量が整数でない', { ...base, rainfall: { ...RAIN, intensityMmPerH: 1.5 } }],
    ['継続時間が選択肢に無い', { ...base, rainfall: { ...RAIN, durationMin: 45 } }],
    ['半径が範囲の半分を超える', { ...base, rainfall: { ...RAIN, radiusM: 251 } }],
    ['範囲の大きさが候補に無い', { ...base, area: { sizeM: 300 } }],
    [
      '垂直強調が候補に無い',
      { ...base, display: { ...DEFAULT_SETTINGS.display, verticalExaggeration: 3 } },
    ],
    [
      '矢印の表示が真偽値でない',
      { ...base, display: { ...DEFAULT_SETTINGS.display, showFlowVectors: 'yes' } },
    ],
    [
      '流出の表示が真偽値でない',
      { ...base, display: { ...DEFAULT_SETTINGS.display, showOutflowCells: 'yes' } },
    ],
    [
      '矢印の間隔が候補にも 5 にも無い',
      { ...base, display: { ...DEFAULT_SETTINGS.display, flowVectorSpacingM: 15 } },
    ],
    ['ベースマップが候補に無い', { ...base, map: { basemap: 'satellite', theme: 'system' } }],
    ['免責の了解が日時でない', { ...base, disclaimerAcknowledgedAt: 'yesterday' }],
    ['配列', []],
    ['null', null],
  ])('不正な値（%s）は既定値に戻す', (_, value) => {
    const store = createSettingsStore(memoryStorage({ [SETTINGS_KEY]: JSON.stringify(value) }))
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
  })

  it('JSON として読めない値も既定値に戻す', () => {
    const store = createSettingsStore(memoryStorage({ [SETTINGS_KEY]: '{' }))
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
  })

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

  it('範囲を小さくすると、半径を範囲の半分に収める（保存値が常に正しい形になる）', () => {
    const store = createSettingsStore(
      memoryStorage(saved({ area: { sizeM: 1000 }, rainfall: { ...RAIN, radiusM: 400 } })),
    )
    store.getState().setAreaSize(250)
    expect(store.getState().rainfall.radiusM).toBe(125)
  })

  it('v0.2.0・07 の保存値（schemaVersion 1）を読むと、雨量だけ既定に戻り、半径・注意事項の了解・表示は残る。次に変えたとき v2 で保存する（spec 08 §6.4、N1・N2）', () => {
    const { showOutflowCells: _, ...display } = DEFAULT_SETTINGS.display
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({
        ...DEFAULT_SETTINGS,
        schemaVersion: 1,
        rainfall: { amountMm: 80, radiusM: 15 },
        display,
        map: { basemap: 'photo', theme: 'dark' },
        disclaimerAcknowledgedAt: '2026-09-20T01:02:03.000Z',
      }),
    })
    const store = createSettingsStore(storage)
    expect(store.getState().disclaimerAcknowledgedAt).toBe('2026-09-20T01:02:03.000Z')
    expect(store.getState().rainfall).toEqual({ ...DEFAULT_SETTINGS.rainfall, radiusM: 15 })
    expect(store.getState().map).toEqual({ basemap: 'photo', theme: 'dark' })
    expect(store.getState().display.showOutflowCells).toBe(true)
    store.getState().setMap({ theme: 'light' })
    expect(persisted(storage)).toMatchObject({
      schemaVersion: 2,
      rainfall: { ...DEFAULT_SETTINGS.rainfall, radiusM: 15 },
    })
  })
})

describe('URL と localStorage の優先順位（tech-spec §3.3、spec 08 §6.4）', () => {
  it('両方にある項目は URL が勝ち、その値を保存する', () => {
    const storage = memoryStorage(saved({ area: { sizeM: 1000 }, rainfall: RAIN }))
    const store = createSettingsStore(storage)
    store.getState().applyUrl({
      ...NO_URL,
      intensityMmPerH: 50,
      durationMin: 120,
      wholeRange: true,
      radiusM: 20,
    })
    const rainfall = { intensityMmPerH: 50, durationMin: 120, wholeRange: true, radiusM: 20 }
    expect(store.getState()).toMatchObject({ area: { sizeM: 1000 }, rainfall })
    expect(persisted(storage)).toMatchObject({ rainfall })
  })

  it('URL に無い項目は保存値のまま（古い mm だけの URL では雨は保存値。N3）', () => {
    const store = createSettingsStore(memoryStorage(saved({ rainfall: RAIN })))
    store.getState().applyUrl({ ...NO_URL, radiusM: 20 })
    expect(store.getState().rainfall).toEqual({ ...RAIN, radiusM: 20 })
  })

  it('URL の不正な値は無視して保存値を使う。URL の size に合わない半径は範囲の半分に収める', () => {
    const store = createSettingsStore(
      memoryStorage(saved({ area: { sizeM: 1000 }, rainfall: { ...RAIN, radiusM: 300 } })),
    )
    store.getState().applyUrl({ ...NO_URL, sizeM: 250, intensityMmPerH: 0, radiusM: 200 })
    expect(store.getState()).toMatchObject({
      area: { sizeM: 250 },
      rainfall: { ...RAIN, radiusM: 125 },
    })
  })
})

describe('safeLocalStorage（spec 04 §10）', () => {
  it('window が無い（テストの node）ときは、読めば無し、書いても投げない', () => {
    const store = createSettingsStore(safeLocalStorage())
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
    expect(() => store.getState().setRainfall(RAIN)).not.toThrow()
  })

  it('localStorage の読み書きが投げる環境（プライベートモードなど）でも動作を続ける', () => {
    const fail = (): never => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('window', { localStorage: { getItem: fail, setItem: fail, removeItem: fail } })
    const store = createSettingsStore(safeLocalStorage())
    expect(store.getState()).toMatchObject(DEFAULT_SETTINGS)
    expect(() => store.getState().setMap({ basemap: 'photo' })).not.toThrow()
    expect(store.getState().map.basemap).toBe('photo')
  })
})
```

- [ ] **Step 5: 入力の検証と文言**

`src/ui/validation.ts`: import を `import { isValidIntensityMmPerH, isValidRadiusM, type RangeSizeM } from '../state/persistedSettings'` にし、`parseAmountMm` を次に置き換える:

```ts
/** 時間雨量（1〜300 mm/h の整数）。範囲外・数でなければ null（spec 08 §6.3） */
export function parseIntensityMmPerH(text: string): number | null {
  const trimmed = text.trim()
  if (!INTEGER.test(trimmed)) return null
  const value = Number(trimmed)
  return isValidIntensityMmPerH(value) ? value : null
}
```

`src/ui/validation.test.ts`: import を `parseIntensityMmPerH` にし、最初の `it.each` を次にする:

```ts
  it.each([
    ['1', 1],
    ['300', 300],
    [' 100 ', 100],
    ['0', null],
    ['301', null],
    ['1.5', null],
    ['', null],
    ['abc', null],
    ['1e2', null],
    ['-5', null],
  ])('時間雨量 %j は %s（spec 08 §6.3）', (text, expected) => {
    expect(parseIntensityMmPerH(text)).toBe(expected)
  })
```

`src/ui/strings.ts` の `rainfall` を次にする:

```ts
  rainfall: {
    title: '降雨',
    intensity: '時間雨量（mm/h）',
    intensitySlider: '時間雨量のスライダー',
    intensityError: '1〜300 の整数で入力してください',
    duration: '継続時間',
    /** 継続時間の選択肢（spec 08 §4.1）: 60 分未満は「N 分」、以上は「N 時間」 */
    durationValue: (minutes: number) => (minutes < 60 ? `${minutes} 分` : `${minutes / 60} 時間`),
    wholeRange: '範囲全体に降らせる',
    radius: '半径（m）',
    radiusSlider: '半径のスライダー',
    radiusError: (maxM: number) => `1〜${maxM} m の範囲で入力してください`,
    rangeSize: '範囲の大きさ',
    rangeSizeValue: (sizeM: number) => `${sizeM} m`,
    // 1000 m は計算に時間がかかる（tech-spec §14.1、spec 08 §7.2）。ユーザー裁定（2026-09-18、M6）: 選択肢は残し、注意書きを出す
    rangeSizeHeavyHint:
      '範囲 1000 m は計算に時間がかかることがあります（雨を範囲全体に降らせると特に）。',
  },
```

- [ ] **Step 6: 雨の入力欄のテストを書く（全体を置き換える）**

`src/ui/components/ControlsSection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaybackSpeed } from '../../shared/protocol'
import { displayStats } from '../../state/displayStats.test-support'
import { memoryStorage } from '../../state/memoryStorage.test-support'
import type { RainfallSettings } from '../../state/persistedSettings'
import { createSettingsStore } from '../../state/settingsStore'
import { createSimulationStore, type DisplayStats } from '../../state/simulationStore'
import { strings } from '../strings'
import { ControlsSection } from './ControlsSection'

afterEach(cleanup)

function setup({ hasTerrain = true } = {}) {
  const settings = createSettingsStore(memoryStorage())
  const simulation = createSimulationStore()
  const actions = {
    start: vi.fn((_rain: RainfallSettings) => simulation.getState().started()),
    pause: vi.fn(() => simulation.getState().paused()),
    resume: vi.fn(() => simulation.getState().resumed()),
    step: vi.fn(),
    reset: vi.fn(() => simulation.getState().reset()),
    setSpeed: vi.fn((speed: PlaybackSpeed) => simulation.getState().setSpeed(speed)),
  }
  const onReload = vi.fn()
  render(
    <ControlsSection
      settings={settings}
      simulation={simulation}
      hasTerrain={hasTerrain}
      actions={actions}
      onReload={onReload}
    />,
  )
  return { settings, simulation, actions, onReload, user: userEvent.setup() }
}

const intensity = () => screen.getByLabelText(strings.rainfall.intensity) as HTMLInputElement
const duration = () => screen.getByLabelText(strings.rainfall.duration) as HTMLSelectElement
const wholeRange = () => screen.getByLabelText(strings.rainfall.wholeRange) as HTMLInputElement
const radius = () => screen.getByLabelText(strings.rainfall.radius) as HTMLInputElement
const primary = () =>
  screen.getByRole('button', {
    name: new RegExp(
      `^(${strings.playback.start}|${strings.playback.pause}|${strings.playback.resume})$`,
    ),
  }) as HTMLButtonElement
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement

/** 自動停止の統計（step だけを変える） */
const settledAt = (step: number): DisplayStats =>
  displayStats({ step, totalWater: 1, storedWater: 1, settled: true, stopReason: 'settled' })

async function replace(
  user: ReturnType<typeof userEvent.setup>,
  input: HTMLInputElement,
  text: string,
) {
  await user.clear(input)
  if (text !== '') await user.type(input, text)
}

describe('ControlsSection: 雨の入力と検証（spec 08 §4.1・§6.3、R08-7）', () => {
  it.each([
    ['1', true],
    ['300', true],
    ['0', false],
    ['301', false],
    ['1.5', false],
    ['', false],
  ])('時間雨量 %j で開始できる: %s', async (text, ok) => {
    const { user } = setup()
    await replace(user, intensity(), text)
    expect(primary().disabled).toBe(!ok)
  })

  it.each([
    ['1', true],
    ['250', true],
    ['0.9', false],
    ['250.5', false],
  ])('範囲 500 m で半径 %j なら開始できる: %s', async (text, ok) => {
    const { user } = setup()
    await replace(user, radius(), text)
    expect(primary().disabled).toBe(!ok)
  })

  it('範囲を 250 m にすると半径の上限は 125 m', async () => {
    const { user } = setup()
    await user.click(button(strings.rainfall.rangeSizeValue(250)))
    await replace(user, radius(), '126')
    expect(primary().disabled).toBe(true)
    expect(screen.getByText(strings.rainfall.radiusError(125))).toBeTruthy()
    await replace(user, radius(), '125')
    expect(primary().disabled).toBe(false)
  })

  it('範囲 1000 m を選ぶと注意書きを出す。ほかの大きさでは出ない（spec 08 §6.2 の文）', async () => {
    const { user } = setup()
    expect(screen.queryByText(strings.rainfall.rangeSizeHeavyHint)).toBeNull()
    await user.click(button(strings.rainfall.rangeSizeValue(1000)))
    expect(screen.getByText(strings.rainfall.rangeSizeHeavyHint)).toBeTruthy()
    await user.click(button(strings.rainfall.rangeSizeValue(500)))
    expect(screen.queryByText(strings.rainfall.rangeSizeHeavyHint)).toBeNull()
  })

  it('範囲外の時間雨量は入力欄にエラーを出し、有効な値だけを設定に保存する', async () => {
    const { user, settings } = setup()
    await replace(user, intensity(), '80')
    expect(settings.getState().rainfall.intensityMmPerH).toBe(80)
    await replace(user, intensity(), '0')
    expect(screen.getByText(strings.rainfall.intensityError)).toBeTruthy()
    expect(settings.getState().rainfall.intensityMmPerH).toBe(80)
  })

  it('継続時間は 7 つの選択肢から選び、設定に保存する（既定は 1 時間）', async () => {
    const { user, settings } = setup()
    expect(duration().value).toBe('60')
    expect(Array.from(duration().options).map((o) => o.textContent)).toEqual([
      '10 分',
      '20 分',
      '30 分',
      '1 時間',
      '2 時間',
      '3 時間',
      '6 時間',
    ])
    await user.selectOptions(duration(), '120')
    expect(settings.getState().rainfall.durationMin).toBe(120)
  })

  it('範囲全体に降らせるをオンにすると半径の欄と半径のスライダーが無効になり、設定に保存する', async () => {
    const { user, settings } = setup()
    expect(wholeRange().checked).toBe(false)
    await user.click(wholeRange())
    expect(settings.getState().rainfall.wholeRange).toBe(true)
    expect(radius().disabled).toBe(true)
    expect(
      (screen.getByRole('slider', { name: strings.rainfall.radiusSlider }) as HTMLInputElement)
        .disabled,
    ).toBe(true)
  })

  it('範囲全体に降らせる間は半径を検証しない: 不正な半径でも開始でき、保存値の半径は前の有効な値のまま。オフに戻すとエラーで開始できない（Review Focus 5）', async () => {
    const { user, settings, actions } = setup()
    await replace(user, radius(), '0')
    expect(primary().disabled).toBe(true)
    await user.click(wholeRange())
    expect(primary().disabled).toBe(false)
    expect(screen.queryByText(strings.rainfall.radiusError(250))).toBeNull()
    await user.click(primary())
    expect(actions.start).toHaveBeenCalledWith({
      intensityMmPerH: 100,
      durationMin: 60,
      radiusM: 10,
      wholeRange: true,
    })
    expect(settings.getState().rainfall.radiusM).toBe(10)
    await user.click(button(strings.playback.pause))
    await user.click(button(strings.playback.reset))
    await user.click(wholeRange())
    expect(primary().disabled).toBe(true)
    expect(screen.getByText(strings.rainfall.radiusError(250))).toBeTruthy()
  })

  it('地形が無ければ開始できない', () => {
    setup({ hasTerrain: false })
    expect(primary().disabled).toBe(true)
  })

  it('開始の後はリセットするまで雨の入力（時間雨量・継続時間・範囲全体・半径）を変えられない', async () => {
    const { user } = setup()
    await user.click(primary())
    expect(intensity().disabled).toBe(true)
    expect(duration().disabled).toBe(true)
    expect(wholeRange().disabled).toBe(true)
    expect(radius().disabled).toBe(true)
    await user.click(button(strings.playback.pause))
    await user.click(button(strings.playback.reset))
    expect(intensity().disabled).toBe(false)
  })
})

describe('ControlsSection: 再生の操作', () => {
  it('キーボードだけで、時間雨量・半径の入力から開始・一時停止・リセットまで操作できる（tech-spec §9.5）', async () => {
    const { user, actions } = setup()
    await user.tab()
    expect(document.activeElement).toBe(intensity())
    await user.keyboard('{Control>}a{/Control}120')
    for (let n = 0; n < 20 && document.activeElement !== radius(); n++) await user.tab()
    expect(document.activeElement).toBe(radius())
    await user.keyboard('{Control>}a{/Control}15')
    for (let n = 0; n < 20 && document.activeElement !== primary(); n++) await user.tab()
    expect(document.activeElement).toBe(primary())
    await user.keyboard('{Enter}')
    expect(actions.start).toHaveBeenCalledWith({
      intensityMmPerH: 120,
      durationMin: 60,
      radiusM: 15,
      wholeRange: false,
    })
    // 同じボタンが「一時停止」になり、焦点は外れない
    expect(document.activeElement?.textContent).toBe(strings.playback.pause)
    await user.keyboard('{Enter}')
    expect(actions.pause).toHaveBeenCalledTimes(1)
    const reset = button(strings.playback.reset)
    for (let n = 0; n < 20 && document.activeElement !== reset; n++) await user.tab()
    await user.keyboard('{Enter}')
    expect(actions.reset).toHaveBeenCalledTimes(1)
  })

  it('一時停止中だけ 1 step 進められる。速度は「実時間」から「最速」まで選べる', async () => {
    const { user, actions } = setup()
    expect(button(strings.playback.step).disabled).toBe(true)
    await user.click(primary())
    await user.click(button(strings.playback.pause))
    await user.click(button(strings.playback.step))
    expect(actions.step).toHaveBeenCalledTimes(1)
    await user.click(button(strings.playback.speedValue(1)))
    expect(actions.setSpeed).toHaveBeenCalledWith(1)
    await user.click(button(strings.playback.max))
    expect(actions.setSpeed).toHaveBeenCalledWith('max')
  })

  it('自動停止したら停止の文言を出す', () => {
    const { simulation } = setup()
    // React 19 では、act の外のストアの変更はすぐには DOM に出ない（useSyncExternalStore の更新を待つ）
    act(() => {
      simulation.getState().started()
      simulation.getState().settle(settledAt(123), 60)
    })
    expect(screen.getByTestId('settled')).toBeTruthy()
  })

  it('自動停止したら、主ボタンと「1 step 進める」は押せず、「リセット」だけを押せる', async () => {
    const { user, simulation } = setup()
    await user.click(primary())
    act(() => simulation.getState().settle(settledAt(40), 60))
    expect(primary().disabled).toBe(true)
    expect(button(strings.playback.step).disabled).toBe(true)
    expect(button(strings.playback.reset).disabled).toBe(false)
  })

  it('Worker の異常終了では「再読み込み」を出し、押すと範囲を読み込み直す', async () => {
    const { user, simulation, onReload } = setup()
    act(() => simulation.getState().failed('worker'))
    expect(screen.getByText(strings.simErrors.worker)).toBeTruthy()
    expect(primary().disabled).toBe(true)
    await user.click(button(strings.playback.reload))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('降雨中心に標高データが無ければ、その旨を出す（spec 04 §10）', () => {
    const { simulation } = setup()
    act(() => simulation.getState().failed('no-elevation-at-rain-center'))
    expect(screen.getByText(strings.simErrors['no-elevation-at-rain-center'])).toBeTruthy()
  })
})
```

- [ ] **Step 7: 失敗することを確かめる**

Run: `pnpm vitest run src/state src/ui/validation.test.ts src/ui/components/ControlsSection.test.tsx`
Expected: FAIL（`parsePersistedSettings` が v1 の雨を読み替えない、入力欄のラベルが無いなど）。persistedSettings・settingsStore・urlState・validation は Step 2〜5 で実装済みなら PASS し、ControlsSection だけ FAIL

- [ ] **Step 8: 雨の入力欄と開始を実装する**

`src/ui/components/RainfallControls.tsx`（全体）:

```tsx
import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import NativeSelect from '@mui/material/NativeSelect'
import OutlinedInput from '@mui/material/OutlinedInput'
import Slider from '@mui/material/Slider'
import Switch from '@mui/material/Switch'
import { useId } from 'react'
import {
  DURATIONS_MIN,
  type DurationMin,
  INTENSITY_MM_PER_H,
  isDurationMin,
  RADIUS_MIN_M,
} from '../../state/persistedSettings'
import { strings } from '../strings'

interface Props {
  intensityText: string
  radiusText: string
  durationMin: DurationMin
  wholeRange: boolean
  maxRadiusM: number
  intensityInvalid: boolean
  radiusInvalid: boolean
  /** 開始の後はリセットするまで入力できない（spec 04 §3） */
  disabled: boolean
  onIntensityChange: (text: string) => void
  onDurationChange: (minutes: DurationMin) => void
  onWholeRangeChange: (on: boolean) => void
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
        slotProps={{
          input: {
            inputMode,
            ...(helperText === undefined ? {} : { 'aria-describedby': helperId }),
          },
        }}
      />
      {helperText === undefined ? null : (
        <FormHelperText id={helperId}>{helperText}</FormHelperText>
      )}
    </FormControl>
  )
}

/**
 * 継続時間（spec 08 §4.1）。ブラウザの select（NativeSelect）にする。MUI の Select は Menu・Popover を静的に読み、
 * ui のチャンクを押し上げる（NumberField と同じ理由。計画で決めたこと 19）。キーボードの上下の矢印でも選べる
 */
function DurationField(props: {
  value: DurationMin
  disabled: boolean
  onChange: (minutes: DurationMin) => void
}) {
  const id = useId()
  return (
    <FormControl size="small" variant="outlined" disabled={props.disabled}>
      <InputLabel htmlFor={id} shrink>
        {strings.rainfall.duration}
      </InputLabel>
      <NativeSelect
        value={props.value}
        input={<OutlinedInput label={strings.rainfall.duration} notched />}
        inputProps={{ id }}
        onChange={(event) => {
          const minutes = Number(event.target.value)
          if (isDurationMin(minutes)) props.onChange(minutes)
        }}
      >
        {DURATIONS_MIN.map((minutes) => (
          <option key={minutes} value={minutes}>
            {strings.rainfall.durationValue(minutes)}
          </option>
        ))}
      </NativeSelect>
    </FormControl>
  )
}

/**
 * 雨（spec 08 §4.1、base-spec §10）: 時間雨量（入力欄とスライダー）・継続時間（選択）・範囲全体に降らせる（スイッチ）・
 * 半径（入力欄とスライダー。範囲全体の間は無効）
 */
export function RainfallControls(props: Props) {
  const { intensityText, radiusText, durationMin, wholeRange, maxRadiusM, disabled } = props
  const sliderValue = (text: string, min: number, max: number): number => {
    const value = Number(text)
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  }
  const radiusDisabled = disabled || wholeRange
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <NumberField
        label={strings.rainfall.intensity}
        value={intensityText}
        disabled={disabled}
        error={props.intensityInvalid}
        helperText={props.intensityInvalid ? strings.rainfall.intensityError : undefined}
        inputMode="numeric"
        onChange={props.onIntensityChange}
      />
      <Slider
        aria-label={strings.rainfall.intensitySlider}
        size="small"
        min={INTENSITY_MM_PER_H.min}
        max={INTENSITY_MM_PER_H.max}
        step={1}
        disabled={disabled}
        value={sliderValue(intensityText, INTENSITY_MM_PER_H.min, INTENSITY_MM_PER_H.max)}
        onChange={(_, value) => props.onIntensityChange(String(value))}
      />
      <DurationField value={durationMin} disabled={disabled} onChange={props.onDurationChange} />
      <FormControlLabel
        disabled={disabled}
        control={
          <Switch
            checked={wholeRange}
            onChange={(_, checked) => props.onWholeRangeChange(checked)}
          />
        }
        label={strings.rainfall.wholeRange}
      />
      <NumberField
        label={strings.rainfall.radius}
        value={radiusText}
        disabled={radiusDisabled}
        error={props.radiusInvalid}
        helperText={props.radiusInvalid ? strings.rainfall.radiusError(maxRadiusM) : undefined}
        inputMode="decimal"
        onChange={props.onRadiusChange}
      />
      <Slider
        aria-label={strings.rainfall.radiusSlider}
        size="small"
        min={RADIUS_MIN_M}
        max={maxRadiusM}
        step={1}
        disabled={radiusDisabled}
        value={sliderValue(radiusText, RADIUS_MIN_M, maxRadiusM)}
        onChange={(_, value) => props.onRadiusChange(String(value))}
      />
    </Box>
  )
}
```

`src/ui/components/ControlsSection.tsx`（全体）:

```tsx
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormHelperText from '@mui/material/FormHelperText'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useId, useState } from 'react'
import { useStore } from 'zustand'
import type { PlaybackSpeed } from '../../shared/protocol'
import {
  maxRadiusM,
  RANGE_SIZES,
  type RainfallSettings,
  type RangeSizeM,
} from '../../state/persistedSettings'
import type { SettingsStore } from '../../state/settingsStore'
import type { SimulationStore } from '../../state/simulationStore'
import { strings } from '../strings'
import { parseIntensityMmPerH, parseRadiusM } from '../validation'
import { PlaybackControls } from './PlaybackControls'
import { RainfallControls } from './RainfallControls'

/** 再生の命令。SimulationSession がそのまま満たす */
export interface PlaybackActions {
  start(rain: RainfallSettings): void
  pause(): void
  resume(): void
  step(): void
  reset(): void
  setSpeed(speed: PlaybackSpeed): void
}

interface Props {
  settings: SettingsStore
  simulation: SimulationStore
  /** 範囲を表示している（読み込みが ready） */
  hasTerrain: boolean
  actions: PlaybackActions
  /** 「再読み込み」: 同じ地点を選び直す（spec 04 §10） */
  onReload: () => void
}

/**
 * 降雨・範囲の大きさ・再生・自動停止とエラーの知らせ。入力中の文字列はここに置き、有効な値だけを
 * 設定のストアに書く（spec 04 の計画で決めたこと 9）。範囲外の値は入力欄にエラーを出し、開始を押せなくする
 * （spec 08 §6.3）。範囲全体に降らせる間は半径を検証しない（開始に渡すのは保存値の半径。Review Focus 5）
 */
export function ControlsSection({ settings, simulation, hasTerrain, actions, onReload }: Props) {
  const rangeSizeHintId = useId()
  const sizeM = useStore(settings, (s) => s.area.sizeM)
  const durationMin = useStore(settings, (s) => s.rainfall.durationMin)
  const wholeRange = useStore(settings, (s) => s.rainfall.wholeRange)
  const status = useStore(simulation, (s) => s.status)
  const speed = useStore(simulation, (s) => s.speed)
  const error = useStore(simulation, (s) => s.error)
  const settledStep = useStore(simulation, (s) =>
    s.status === 'settled' ? (s.stats?.step ?? 0) : null,
  )
  const [intensityText, setIntensityText] = useState(() =>
    String(settings.getState().rainfall.intensityMmPerH),
  )
  const [radiusText, setRadiusText] = useState(() => String(settings.getState().rainfall.radiusM))
  const intensity = parseIntensityMmPerH(intensityText)
  const radiusM = parseRadiusM(radiusText, sizeM)
  const radiusOk = wholeRange || radiusM !== null
  const canStart = hasTerrain && intensity !== null && radiusOk && error !== 'worker'

  const setRainfall = (patch: Partial<RainfallSettings>): void =>
    settings.getState().setRainfall({ ...settings.getState().rainfall, ...patch })
  const onIntensityChange = (text: string): void => {
    setIntensityText(text)
    const value = parseIntensityMmPerH(text)
    if (value !== null) setRainfall({ intensityMmPerH: value })
  }
  const onRadiusChange = (text: string): void => {
    setRadiusText(text)
    const value = parseRadiusM(text, sizeM)
    if (value !== null) setRainfall({ radiusM: value })
  }
  const onSizeChange = (next: RangeSizeM): void => {
    // 設定のストアが半径を新しい範囲の半分に収めるので、入力欄も合わせる。範囲の読み込み直しは TerrainSession
    settings.getState().setAreaSize(next)
    setRadiusText(String(settings.getState().rainfall.radiusM))
  }

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="subtitle2">{strings.rainfall.title}</Typography>
      <RainfallControls
        intensityText={intensityText}
        radiusText={radiusText}
        durationMin={durationMin}
        wholeRange={wholeRange}
        maxRadiusM={maxRadiusM(sizeM)}
        intensityInvalid={intensity === null}
        radiusInvalid={!wholeRange && radiusM === null}
        disabled={status !== 'idle'}
        onIntensityChange={onIntensityChange}
        onDurationChange={(minutes) => setRainfall({ durationMin: minutes })}
        onWholeRangeChange={(on) => setRainfall({ wholeRange: on })}
        onRadiusChange={onRadiusChange}
      />
      <Box>
        <Typography variant="body2" color="text.secondary">
          {strings.rainfall.rangeSize}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          aria-label={strings.rainfall.rangeSize}
          aria-describedby={sizeM === 1000 ? rangeSizeHintId : undefined}
          value={sizeM}
          onChange={(_, value: RangeSizeM | null) => {
            if (value !== null) onSizeChange(value)
          }}
        >
          {RANGE_SIZES.map((size) => (
            <ToggleButton key={size} value={size}>
              {strings.rainfall.rangeSizeValue(size)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {sizeM === 1000 && (
          <FormHelperText id={rangeSizeHintId}>
            {strings.rainfall.rangeSizeHeavyHint}
          </FormHelperText>
        )}
      </Box>
      <Typography variant="subtitle2">{strings.playback.title}</Typography>
      <PlaybackControls
        status={status}
        canStart={canStart}
        speed={speed}
        onStart={() => {
          // 有効な入力だけが設定のストアに入っているので、保存値をそのまま渡す
          if (canStart) actions.start(settings.getState().rainfall)
        }}
        onPause={() => actions.pause()}
        onResume={() => actions.resume()}
        onStep={() => actions.step()}
        onReset={() => actions.reset()}
        onSpeedChange={(value) => actions.setSpeed(value)}
      />
      {settledStep !== null && (
        <Alert severity="success" data-testid="settled">
          {strings.playback.settled(settledStep)}
        </Alert>
      )}
      {error !== null && (
        <Alert
          severity="error"
          data-testid="sim-error"
          action={
            error === 'worker' ? (
              <Button color="inherit" size="small" onClick={onReload}>
                {strings.playback.reload}
              </Button>
            ) : undefined
          }
        >
          {strings.simErrors[error]}
        </Alert>
      )}
    </Box>
  )
}
```

- [ ] **Step 9: 開始のつなぎと計測の口（M1 の暫定の橋渡しを外す）**

`src/ui/simulationSession.ts`: `import type { RainfallSettings } from '../state/persistedSettings'` を足し、`start` を次にする:

```ts
  /** 雨を登録して再生を始める（spec 08 §4.2）。継続時間は分から秒にする */
  start(rain: RainfallSettings): void {
    if (this.terrain === null || this.center === null) return
    const { x, y } = gridPositionM(this.terrain.geo, this.center.lon, this.center.lat)
    this.runId += 1
    this.client.start(
      {
        x,
        y,
        radiusM: rain.radiusM,
        intensityMmPerH: rain.intensityMmPerH,
        durationS: rain.durationMin * 60,
        wholeRange: rain.wholeRange,
      },
      this.runId,
    )
    this.clearWater()
    this.store.getState().started()
  }
```

`src/ui/simulationSession.test.ts`:
- `setup` の前に足す: `const RAIN = { intensityMmPerH: 100, durationMin: 60, radiusM: 10, wholeRange: false } as const`
- `sed -i 's/session.start(100, 10)/session.start(RAIN)/' src/ui/simulationSession.test.ts`
- start の期待値の `rain` を `{ x: …, y: …, radiusM: 10, intensityMmPerH: 100, durationS: 3600, wholeRange: false }` にし、テストの名前に「継続時間は秒にする」を足す

`src/ui/perfHook.ts`: `const { amountMm, radiusM } = settings.getState().rainfall` と `session.simulation.start(amountMm, radiusM)` の 2 行を `session.simulation.start(settings.getState().rainfall)` にする

`src/ui/perfWater.ts`: 同じく `simulation.start(settings.getState().rainfall)` にする（`const { amountMm, radiusM } = …` の行を消す）

`src/ui/perfSteps.ts`: `simulation.start(rainfall.amountMm, rainfall.radiusM)` を `simulation.start(rainfall)` に、`rain: { amountMm: rainfall.amountMm, radiusM: rainfall.radiusM },` を `rain: rainfall,` にする

`src/ui/perfReports.ts`: `import type { RainfallSettings } from '../state/persistedSettings'` を足し、`StepsReport.rain` の型を `RainfallSettings` にする

`tests/e2e/simulation.spec.ts`: 型が通るよう、`strings.rainfall.amount` を `strings.rainfall.intensity` にする（`sed -i 's/strings\.rainfall\.amount/strings.rainfall.intensity/g' tests/e2e/simulation.spec.ts`）。E2E の中身は Task 14 で直す

- [ ] **Step 10: テストが通ることを確かめる**

Run: `pnpm vitest run src/state src/ui`
Expected: PASS

- [ ] **Step 11: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（`src/state/**` 80% を保つ）

Run: `pnpm build && pnpm size`
Expected: 初期ロードの差を報告に書く（`NativeSelect`・`Switch`〈`DisplaySettings` で既に使っている〉・`FormControlLabel` の分。+3 KB を超えたら原因を書く）

- [ ] **Step 12: コミット**

```bash
git add src/state src/ui tests/e2e/simulation.spec.ts
git commit -m "spec 08 Task 12: 雨を時間雨量・継続時間・範囲全体で入れる（保存値 v2、URL の mmh・dur・all）"
```

---
### Task 13: 統計の新しい行と、停止・越流の文言（spec §6.2・§6.5、Q1 = (a)、計画で決めたこと 20〜22）

**Files:**
- Modify: `src/state/simulationStore.ts`（+ test）
- Modify: `src/ui/format.ts`（+ test）、`src/ui/strings.ts`
- Modify（全体を置き換える）: `src/ui/components/StatisticsPanel.tsx`、`src/ui/components/StatisticsPanel.test.tsx`
- Modify: `src/ui/components/ControlsSection.tsx`（+ test）、`src/ui/components/SpillNotices.tsx`
- Create: `src/ui/components/SpillNotices.test.tsx`
- Modify: `src/ui/simulationSession.ts`（+ test）

**Interfaces:**
- Consumes: `StepStats` の `timeS`・`raining`・`rainDepthMm`・`outflowRateM3PerS`・`stopReason`（Task 5）、`FrameView.simSecondsPerSecond`（Task 10）
- Produces:
  - `simulationStore`: `interface RunRain { intensityMmPerH: number; durationS: number }`、状態 `run: RunRain | null`・`simSecondsPerSecond: number`、`started(run?: RunRain)`、`setStats(stats, stepsPerSecond, simSecondsPerSecond = 0)`・`settle(stats, stepsPerSecond, simSecondsPerSecond = 0)`、`SpillNotice.timeS`
  - `src/ui/format.ts`: `formatElapsed(seconds): string`、`formatRainStatus(run, stats): string`、`formatRainDepth(run, rainDepthMm): string`、`formatOutflowRate(m3PerS): string`、`formatPlaybackRate(simSecondsPerSecond, stepsPerSecond): string`
  - `strings.stats`: `elapsed`・`rain`・`rainDepth`・`outflowRate`・`raining(remaining)`・`rainEnded`・`playbackRate(ratio, stepsPerSecond)`、新しい `outflowHelp`。`strings.playback.settled(elapsed)`・`strings.playback.cap(elapsed)`。`strings.spill.started(spillElevation, elapsed)`。`strings.format`: `hoursMinutes`・`minutesSeconds`・`seconds`・`rainDepth`・`cubicMetersPerHour`

- [ ] **Step 1: 書式の失敗するテストを書く**

`src/ui/format.test.ts` の import に `formatElapsed`・`formatOutflowRate`・`formatPlaybackRate`・`formatRainDepth`・`formatRainStatus` と `import { displayStats } from '../state/displayStats.test-support'` を足し、末尾に足す:

```ts
describe('経過時間・降雨・流出の速さ・実行速度の書式（spec 08 §6.2）', () => {
  it('経過時間: 1 時間以上は時・分、1 分以上は分・秒、1 分未満は秒。秒は切り捨て', () => {
    expect(formatElapsed(45.9)).toBe('45秒')
    expect(formatElapsed(0)).toBe('0秒')
    expect(formatElapsed(750)).toBe('12分30秒')
    expect(formatElapsed(60)).toBe('1分0秒')
    expect(formatElapsed(4800)).toBe('1時間20分')
    expect(formatElapsed(8 * 3600 + 59)).toBe('8時間0分')
  })

  it('降雨: 雨の間は残り（経過時間と同じ書式）、終われば「降雨終了」。実行が無ければ「—」', () => {
    const run = { intensityMmPerH: 100, durationS: 3600 }
    expect(formatRainStatus(null, null)).toBe('—')
    expect(formatRainStatus(run, null)).toBe('降雨中（残り 1時間0分）')
    expect(formatRainStatus(run, displayStats({ timeS: 1200, raining: true }))).toBe(
      '降雨中（残り 40分0秒）',
    )
    expect(formatRainStatus(run, displayStats({ timeS: 3600, raining: false }))).toBe('降雨終了')
  })

  it('累積雨量: 「降った量 / 総量」をどちらも mm の整数に切り捨てる（計画で決めたこと 21）', () => {
    expect(formatRainDepth(null, 0)).toBe('—')
    expect(formatRainDepth({ intensityMmPerH: 100, durationS: 7200 }, 60)).toBe('60 mm / 200 mm')
    // 100 mm/h × 10 分 = 16.67 mm。雨の後も「16 mm / 16 mm」で食い違わない
    const tenMinutes = { intensityMmPerH: 100, durationS: 600 }
    expect(formatRainDepth(tenMinutes, (100 * 600) / 3600)).toBe('16 mm / 16 mm')
    expect(formatRainDepth(tenMinutes, 0)).toBe('0 mm / 16 mm')
  })

  it('流出の速さは m³/時（outflowRateM3PerS × 3600。小数 1 桁）', () => {
    expect(formatOutflowRate(12.3 / 3600)).toBe('12.3 m³/時')
    expect(formatOutflowRate(0)).toBe('0.0 m³/時')
  })

  it('実行速度は「実時間の N 倍（M step/秒）」。どちらも四捨五入の整数', () => {
    expect(formatPlaybackRate(27.4, 59.6)).toBe('実時間の 27 倍（60 step/秒）')
    expect(formatPlaybackRate(0, 0)).toBe('実時間の 0 倍（0 step/秒）')
  })
})
```

同じファイルの「湛水面積は m²、実行速度は step／秒、Step は『Step N』」は変えない（`formatStepsPerSecond` は `formatPlaybackRate` の中で使う）。

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run src/ui/format.test.ts`
Expected: FAIL（関数が無い）

- [ ] **Step 3: 文言と書式を実装する**

`src/ui/strings.ts`:
- `playback` の `settled` を次の 2 つに置き換える:

```ts
    /** 自動停止（spec 08 §3.9・§6.2）。settled は水の動きが止まったとき、cap は雨の後の上限で止めたとき */
    settled: (elapsed: string) => `水の動きがほぼ止まりました（経過 ${elapsed}）`,
    // 「6 時間」は SETTLE_CAP_S（src/simulation/constants.ts）。ui は simulation の値を import しないので文で持つ
    cap: (elapsed: string) =>
      `計算の上限（雨がやんでから 6 時間）に達しました（経過 ${elapsed}）`,
```

- `stats` を次にする（`title`・`step`・`total`・`stored`・`outflow`・`outflowHelpLabel`・`maxDepth`・`floodedArea`・`speed` は今のまま）:

```ts
  stats: {
    title: '統計',
    elapsed: '経過時間',
    rain: '降雨',
    rainDepth: '累積雨量',
    step: 'Step',
    total: '投入水量',
    stored: '領域内の水量',
    outflow: '領域外流出量',
    outflowHelpLabel: '領域外流出量の説明',
    outflowHelp:
      '範囲の端や、海などの標高データの無い場所から、外へ流れ出た水の量です。「領域外流出量」は開始からの合計、「流出の速さ」はその時点の 1 時間あたりの量です。下水道・地面への浸み込み・蒸発は考えていません。',
    outflowRate: '流出の速さ',
    maxDepth: '最大水深',
    floodedArea: '湛水面積',
    speed: '実行速度',
    raining: (remaining: string) => `降雨中（残り ${remaining}）`,
    rainEnded: '降雨終了',
    playbackRate: (ratio: string, stepsPerSecond: string) =>
      `実時間の ${ratio} 倍（${stepsPerSecond}）`,
  },
```

- `spill.started` を次にする:

```ts
    started: (spillElevation: string, elapsed: string) =>
      `窪地（spill 標高 ${spillElevation}）から越流が始まりました（経過 ${elapsed}）`,
```

- `format` に足す（`step` の後）:

```ts
    hoursMinutes: (hours: number, minutes: number) => `${hours}時間${minutes}分`,
    minutesSeconds: (minutes: number, seconds: number) => `${minutes}分${seconds}秒`,
    seconds: (seconds: number) => `${seconds}秒`,
    rainDepth: (fallen: number, total: number) => `${fallen} mm / ${total} mm`,
    cubicMetersPerHour: (value: string) => `${value} m³/時`,
```

`src/ui/format.ts`: import に `import type { DisplayStats, RunRain } from '../state/simulationStore'` を足し、`formatStep` の説明を「Step N（base-spec §33。spec 08 で経過時間の行を足した）」にして、末尾に足す:

```ts
/** 経過時間（spec 08 §6.2）: 1 時間以上は時・分、1 分以上は分・秒、1 分未満は秒。秒は切り捨て */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours >= 1) return strings.format.hoursMinutes(hours, minutes)
  if (minutes >= 1) return strings.format.minutesSeconds(minutes, total % 60)
  return strings.format.seconds(total)
}

/** 降雨の状態（spec 08 §6.2）。統計がまだ無いときは、雨の始まり（残りは継続時間） */
export function formatRainStatus(run: RunRain | null, stats: DisplayStats | null): string {
  if (run === null) return strings.format.none
  const timeS = stats?.timeS ?? 0
  const raining = stats === null ? run.durationS > 0 : stats.raining
  return raining ? strings.stats.raining(formatElapsed(run.durationS - timeS)) : strings.stats.rainEnded
}

/** 累積雨量「降った量 / 総量」（spec 08 §6.2）。どちらも mm の整数に切り捨てる（計画で決めたこと 21） */
export function formatRainDepth(run: RunRain | null, rainDepthMm: number): string {
  if (run === null) return strings.format.none
  const total = (run.intensityMmPerH * run.durationS) / 3600
  // 1e-9 は、ちょうど整数になるはずの値が丸めで僅かに下回るのを切り捨てないため
  return strings.format.rainDepth(Math.floor(rainDepthMm + 1e-9), Math.floor(total + 1e-9))
}

/** 流出の速さ（spec 08 §6.2）: outflowRateM3PerS × 3600 の m³/時 */
export const formatOutflowRate = (m3PerS: number): string =>
  strings.format.cubicMetersPerHour((m3PerS * 3600).toFixed(1))

/** 実行速度（spec 08 §6.2）: 実際の倍率と step／秒 */
export const formatPlaybackRate = (simSecondsPerSecond: number, stepsPerSecond: number): string =>
  strings.stats.playbackRate(
    String(Math.round(simSecondsPerSecond)),
    formatStepsPerSecond(stepsPerSecond),
  )
```

`src/state/simulationStore.ts`:
- `SpillNotice` に `timeS: number` を足す
- 足す:

```ts
/** 今の実行の雨（spec 08 §6.2 の降雨の残りと総量に使う。計画で決めたこと 22） */
export interface RunRain {
  intensityMmPerH: number
  /** 継続時間（s） */
  durationS: number
}
```

- `SimulationState` に `/** 実際の倍率（実時間 1 秒あたりに進んだシミュレーションの秒。spec 08 §6.1） */ simSecondsPerSecond: number` と `run: RunRain | null` を足す
- `SimulationActions` の `started(): void` を `started(run?: RunRain): void` に、`setStats(stats: DisplayStats, stepsPerSecond: number): void` を `setStats(stats: DisplayStats, stepsPerSecond: number, simSecondsPerSecond?: number): void` に、`settle` も同じにし、`settle` の説明を「自動で止まった（settled・cap。spec 08 §3.9）」にする
- `PlaybackStatus` の説明に「'settled' は自動で止まった状態（stopReason が settled でも cap でも。計画で決めたこと 20）」を足す
- 初期値と操作を次にする:

```ts
    status: 'idle',
    speed: DEFAULT_PLAYBACK_SPEED,
    stats: null,
    stepsPerSecond: 0,
    simSecondsPerSecond: 0,
    run: null,
    spills: [],
    error: null,
    started: (run) => set({ status: 'running', error: null, run: run ?? null }),
    paused: () => set({ status: 'paused' }),
    resumed: () => set({ status: 'running' }),
    reset: () =>
      set({
        status: 'idle',
        stats: null,
        stepsPerSecond: 0,
        simSecondsPerSecond: 0,
        run: null,
        spills: [],
        error: null,
      }),
    setSpeed: (speed) => set({ speed }),
    setStats: (stats, stepsPerSecond, simSecondsPerSecond = 0) =>
      set({ stats, stepsPerSecond, simSecondsPerSecond }),
    settle: (stats, stepsPerSecond, simSecondsPerSecond = 0) =>
      set({ status: 'settled', stats, stepsPerSecond, simSecondsPerSecond }),
    addSpills: (events) =>
      set((state) => ({
        spills: [
          ...state.spills,
          ...events.map(({ depressionId, spillElevation, step, timeS }) => ({
            depressionId,
            spillElevation,
            step,
            timeS,
          })),
        ],
      })),
    // 失敗した実行の統計を出し続けない（04 のタスク 4 のレビューの裁定 1）。stats: null は「まだ値が無い」と
    // 同じ意味にし、reset と同じ形にする
    failed: (reason) =>
      set({ status: 'idle', error: reason, stats: null, stepsPerSecond: 0, simSecondsPerSecond: 0, run: null }),
```

`src/ui/simulationSession.ts`:
- `StatsUpdate` に `simSecondsPerSecond: number` を足し、`statsThrottle` の反映を `this.store.getState().setStats(u.stats, u.stepsPerSecond, u.simSecondsPerSecond)` にする
- `start` の `this.store.getState().started()` を `this.store.getState().started({ intensityMmPerH: rain.intensityMmPerH, durationS: rain.durationMin * 60 })` にする
- `onFrame` の `const update = { stats, stepsPerSecond: frame.stepsPerSecond }` を `const update = { stats, stepsPerSecond: frame.stepsPerSecond, simSecondsPerSecond: frame.simSecondsPerSecond }` にし、3 か所の `state.settle(stats, frame.stepsPerSecond)`・`state.setStats(stats, frame.stepsPerSecond)` に第 3 引数 `frame.simSecondsPerSecond` を足す

- [ ] **Step 4: 統計の表示のテストを書く（全体を置き換える）**

`src/ui/components/StatisticsPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { displayStats } from '../../state/displayStats.test-support'
import { createSimulationStore } from '../../state/simulationStore'
import { strings } from '../strings'
import { StatisticsPanel } from './StatisticsPanel'

afterEach(cleanup)

const text = (id: string) => screen.getByTestId(id).textContent

describe('StatisticsPanel（base-spec §38、spec 04 §6.3、spec 08 §6.2）', () => {
  it('統計が無ければ 0 と「—」', () => {
    render(<StatisticsPanel simulation={createSimulationStore()} />)
    expect(text('stat-time')).toBe('0秒')
    expect(text('stat-rain-status')).toBe('—')
    expect(text('stat-rain-depth')).toBe('—')
    expect(text('stat-step')).toBe('Step 0')
    expect(text('stat-total')).toBe('0.00 m³')
    expect(text('stat-outflow-rate')).toBe('0.0 m³/時')
    expect(text('stat-speed')).toBe('実時間の 0 倍（0 step/秒）')
  })

  it('各項目を決めた書式で出す', () => {
    const simulation = createSimulationStore()
    simulation.getState().started({ intensityMmPerH: 100, durationS: 7200 })
    simulation.getState().setStats(
      displayStats({
        step: 1234,
        timeS: 4800,
        raining: true,
        rainDepthMm: (100 * 4800) / 3600,
        totalWater: (Math.PI * 100 * 100) / 1000,
        storedWater: 0.456,
        outflowWater: 13.24,
        outflowRateM3PerS: 12.3 / 3600,
        maxDepth: 0.4321,
        floodedArea: 82.4,
      }),
      59.6,
      27.4,
    )
    render(<StatisticsPanel simulation={simulation} />)
    expect(text('stat-time')).toBe('1時間20分')
    expect(text('stat-rain-status')).toBe('降雨中（残り 40分0秒）')
    expect(text('stat-rain-depth')).toBe('133 mm / 200 mm')
    expect(text('stat-step')).toBe('Step 1234')
    expect(text('stat-total')).toBe('31.4 m³')
    expect(text('stat-stored')).toBe('0.46 m³')
    expect(text('stat-outflow')).toBe('13.2 m³')
    expect(text('stat-outflow-rate')).toBe('12.3 m³/時')
    expect(text('stat-max-depth')).toBe('0.43 m')
    expect(text('stat-flooded-area')).toBe('82 m²')
    expect(text('stat-speed')).toBe('実時間の 27 倍（60 step/秒）')
  })

  it('行の並びは 経過時間・降雨・累積雨量・Step・投入水量・領域内の水量・領域外流出量・流出の速さ・最大水深・湛水面積・実行速度（計画で決めたこと 21）', () => {
    render(<StatisticsPanel simulation={createSimulationStore()} />)
    const ids = screen.getAllByTestId(/^stat-/).map((cell) => cell.getAttribute('data-testid'))
    expect(ids).toEqual([
      'stat-time',
      'stat-rain-status',
      'stat-rain-depth',
      'stat-step',
      'stat-total',
      'stat-stored',
      'stat-outflow',
      'stat-outflow-rate',
      'stat-max-depth',
      'stat-flooded-area',
      'stat-speed',
    ])
  })

  it('ツールチップは「領域外流出量」の行にだけ置き、合計と速さの説明を出す（spec 08 §6.5）', async () => {
    render(<StatisticsPanel simulation={createSimulationStore()} />)
    const helps = screen.getAllByRole('button', { name: strings.stats.outflowHelpLabel })
    expect(helps).toHaveLength(1)
    await userEvent.hover(helps[0] as HTMLElement)
    expect((await screen.findByRole('tooltip')).textContent).toBe(strings.stats.outflowHelp)
  })
})
```

- [ ] **Step 5: 統計の表示を置き換える**

`src/ui/components/StatisticsPanel.tsx`（全体）:

```tsx
import IconButton from '@mui/material/IconButton'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import { createSvgIcon } from '@mui/material/utils'
import { useStore } from 'zustand'
import type { DisplayStats, SimulationStore } from '../../state/simulationStore'
import {
  formatArea,
  formatElapsed,
  formatMeters,
  formatOutflowRate,
  formatPlaybackRate,
  formatRainDepth,
  formatRainStatus,
  formatStep,
  formatVolume,
} from '../format'
import { strings } from '../strings'

/**
 * 丸の中の「i」（spec 07 §4.1 の InfoOutlined の代わり。@mui/icons-material は依存に無いので、同じ種類の形を
 * 自作する。07 の計画で決めたこと 12）
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
 * 領域外流出量の説明（spec 07 §4.1、spec 08 §6.5）。キーボードで焦点を移せ（IconButton）、焦点・ホバー・タップ
 * （enterTouchDelay 0）で開く。describeChild で、ボタンの名前は「領域外流出量の説明」、説明文はツールチップにする。
 * 流出の速さの行には付けない（同じ説明を 2 つ置かない）
 */
function OutflowHelp() {
  return (
    <Tooltip
      title={strings.stats.outflowHelp}
      describeChild
      enterTouchDelay={0}
      leaveTouchDelay={5000}
    >
      <IconButton
        size="small"
        aria-label={strings.stats.outflowHelpLabel}
        sx={{ ml: 0.5, p: 0.25 }}
      >
        <InfoIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  )
}

const ZERO: DisplayStats = {
  step: 0,
  totalWater: 0,
  storedWater: 0,
  outflowWater: 0,
  maxDepth: 0,
  floodedArea: 0,
  settled: false,
  massError: 0,
  timeS: 0,
  dtS: 0,
  raining: false,
  rainDepthMm: 0,
  outflowRateM3PerS: 0,
  stopReason: null,
}

/** 統計（base-spec §38、spec 04 §6.3、spec 08 §6.2）。描画内容を文字で補う（tech-spec §9.5） */
export function StatisticsPanel({ simulation }: { simulation: SimulationStore }) {
  const stats = useStore(simulation, (state) => state.stats)
  const run = useStore(simulation, (state) => state.run)
  const rate = useStore(simulation, (state) => state.stepsPerSecond)
  const simRate = useStore(simulation, (state) => state.simSecondsPerSecond)
  const s = stats ?? ZERO
  const rows: [string, string, string][] = [
    [strings.stats.elapsed, formatElapsed(s.timeS), 'stat-time'],
    [strings.stats.rain, formatRainStatus(run, stats), 'stat-rain-status'],
    [strings.stats.rainDepth, formatRainDepth(run, s.rainDepthMm), 'stat-rain-depth'],
    [strings.stats.step, formatStep(s.step), 'stat-step'],
    [strings.stats.total, formatVolume(s.totalWater), 'stat-total'],
    [strings.stats.stored, formatVolume(s.storedWater), 'stat-stored'],
    [strings.stats.outflow, formatVolume(s.outflowWater), 'stat-outflow'],
    [strings.stats.outflowRate, formatOutflowRate(s.outflowRateM3PerS), 'stat-outflow-rate'],
    [strings.stats.maxDepth, formatMeters(s.maxDepth), 'stat-max-depth'],
    [strings.stats.floodedArea, formatArea(s.floodedArea), 'stat-flooded-area'],
    [strings.stats.speed, formatPlaybackRate(simRate, rate), 'stat-speed'],
  ]
  return (
    <Table size="small" aria-label={strings.stats.title}>
      <TableBody>
        {rows.map(([label, value, testId]) => (
          <TableRow key={testId}>
            <TableCell component="th" scope="row" sx={{ pl: 0 }}>
              {label}
              {testId === 'stat-outflow' && <OutflowHelp />}
            </TableCell>
            <TableCell align="right" data-testid={testId} sx={{ pr: 0 }}>
              {value}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 6: 停止と越流の文言**

`src/ui/components/ControlsSection.tsx`:
- import に `import { formatElapsed } from '../format'` を足す
- `settledStep` の `useStore` を次の 2 つに置き換える:

```tsx
  const stopReason = useStore(simulation, (s) =>
    s.status === 'settled' ? (s.stats?.stopReason ?? 'settled') : null,
  )
  const stoppedAt = useStore(simulation, (s) => s.stats?.timeS ?? 0)
```

- 自動停止の `Alert` を次にする（cap は水が止まったのではないので `info`。計画で決めたこと 20）:

```tsx
      {stopReason !== null && (
        <Alert severity={stopReason === 'cap' ? 'info' : 'success'} data-testid="settled">
          {stopReason === 'cap'
            ? strings.playback.cap(formatElapsed(stoppedAt))
            : strings.playback.settled(formatElapsed(stoppedAt))}
        </Alert>
      )}
```

`src/ui/components/ControlsSection.test.tsx`: 「自動停止したら停止の文言を出す」を次の 2 つに置き換える:

```tsx
  it('水の動きが止まって自動停止したら「水の動きがほぼ止まりました（経過 …）」', () => {
    const { simulation } = setup()
    // React 19 では、act の外のストアの変更はすぐには DOM に出ない（useSyncExternalStore の更新を待つ）
    act(() => {
      simulation.getState().started()
      simulation.getState().settle(displayStats({ ...settledAt(123), timeS: 3 * 3600 + 600 }), 60)
    })
    expect(screen.getByText(strings.playback.settled('3時間10分'))).toBeTruthy()
  })

  it('雨の後の上限で止まったら、別の文「計算の上限（雨がやんでから 6 時間）に達しました（経過 …）」（spec 08 §6.2）', () => {
    const { simulation } = setup()
    act(() => {
      simulation.getState().started()
      simulation
        .getState()
        .settle(displayStats({ step: 9, settled: false, stopReason: 'cap', timeS: 8 * 3600 }), 60)
    })
    expect(screen.getByText(strings.playback.cap('8時間0分'))).toBeTruthy()
    expect(screen.queryByText(strings.playback.settled('8時間0分'))).toBeNull()
  })
```

`src/ui/components/SpillNotices.tsx`: import を `import { formatElapsed, formatMeters } from '../format'` にし、`message` を次にする:

```tsx
const message = (spill: SpillNotice): string =>
  strings.spill.started(formatMeters(spill.spillElevation), formatElapsed(spill.timeS))
```

`src/ui/components/SpillNotices.test.tsx`（新規）:

```tsx
// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createSimulationStore } from '../../state/simulationStore'
import { strings } from '../strings'
import { SpillNotices } from './SpillNotices'

afterEach(cleanup)

describe('SpillNotices（spec 08 §6.2）', () => {
  it('越流の通知は経過時間で出す（Step ではなく）', () => {
    const simulation = createSimulationStore()
    render(<SpillNotices simulation={simulation} />)
    act(() =>
      simulation
        .getState()
        .addSpills([{ type: 'spill', step: 42, timeS: 3900, depressionId: 3, spillElevation: 12.7 }]),
    )
    const expected = strings.spill.started('12.70 m', '1時間5分')
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0)
  })
})
```

`src/state/simulationStore.test.ts`:
- 「越流イベントを一覧に足す」の期待値を `[{ depressionId: 2, spillElevation: 12.7, step: 7, timeS: 0 }]` にする（Task 5 で足した `timeS: 0` が一覧に載る）
- 末尾に足す:

```ts
describe('今の実行の雨と実際の倍率（spec 08 §6.1・§6.2）', () => {
  it('started で今の実行の雨を持ち、reset・失敗で消す', () => {
    const store = createSimulationStore()
    store.getState().started({ intensityMmPerH: 100, durationS: 3600 })
    expect(store.getState().run).toEqual({ intensityMmPerH: 100, durationS: 3600 })
    store.getState().reset()
    expect(store.getState().run).toBeNull()
    store.getState().started({ intensityMmPerH: 50, durationS: 600 })
    store.getState().failed('internal')
    expect(store.getState().run).toBeNull()
  })

  it('setStats・settle で実際の倍率を持ち、reset で 0 に戻す', () => {
    const store = createSimulationStore()
    store.getState().setStats(stats(5), 58, 27)
    expect(store.getState().simSecondsPerSecond).toBe(27)
    store.getState().settle(stats(6), 0, 0)
    expect(store.getState().simSecondsPerSecond).toBe(0)
    store.getState().setStats(stats(7), 58, 30)
    store.getState().reset()
    expect(store.getState().simSecondsPerSecond).toBe(0)
  })
})
```

`src/ui/simulationSession.test.ts`:
- start のテストの最後に `expect(store.getState().run).toEqual({ intensityMmPerH: 100, durationS: 3600 })` を足す
- 越流イベントのテストの期待値を `[{ depressionId: 4, spillElevation: 12.7, step: 9, timeS: 30 }]` にする
- `describe` の中に足す:

```ts
  it('frame の実際の倍率（simSecondsPerSecond）をストアへ入れる', () => {
    vi.useFakeTimers()
    const { worker, store, session, terrainId } = setup()
    session.start(RAIN)
    worker.reply(frameMessage(terrainId, 1, { simSecondsPerSecond: 42 }))
    expect(store.getState().simSecondsPerSecond).toBe(42)
  })
```

（`vi.useFakeTimers()` を使う他のテストと同じく、ファイルの `afterEach` で `vi.useRealTimers()` していることを確かめる。無ければこのテストの最後に `vi.useRealTimers()` を足す）

- [ ] **Step 7: テストが通ることを確かめる**

Run: `pnpm vitest run src/state src/ui`
Expected: PASS

- [ ] **Step 8: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

Run: `pnpm build && pnpm size`
Expected: 初期ロードの差を報告に書く

- [ ] **Step 9: コミット**

```bash
git add src/state src/ui
git commit -m "spec 08 Task 13: 統計に経過時間・降雨・累積雨量・流出の速さ・実際の倍率を足し、停止（settled・cap）と越流を経過時間で知らせる"
```

---
### Task 14: E2E と計測の URL を新しい雨にする。M3 の E2E（spec §9.4、R3 の裁定、N7、計画で決めたこと 24・25・32・33）

**Files:**
- Modify: `tests/e2e/simulation.spec.ts`
- Modify: `tests/e2e/view3d.spec.ts`
- Modify: `tests/e2e/explanations.spec.ts`
- Modify: `tests/perf/fps.perf.ts`、`tests/perf/shots.perf.ts`、`tests/perf/water.perf.ts`

**Interfaces:**
- Consumes: 統計の `data-testid`（`stat-time`・`stat-rain-status`・`stat-rain-depth`・`stat-total`・`stat-step`。Task 13）、入力のラベル（`strings.rainfall.intensity`・`duration`・`wholeRange`・`radius`。Task 12）、`strings.stats.raining`・`rainEnded`、`strings.format.seconds`・`rainDepth`
- Produces: なし（E2E 49 − 3 + 5 = 51 件の見込み。下の Step 7 で数える）

- [ ] **Step 1: 降雨と再生の E2E を書き直す（spec §9.4 の 4・5）**

`tests/e2e/simulation.spec.ts`:
- `SHIBUYA` の定義の後に足す:

```ts
/** 「降雨中（残り …）」（spec 08 §6.2） */
const RAINING = new RegExp(strings.stats.raining('.+'))

/** 「60 mm / 200 mm」の降った量（mm） */
async function fallenMm(page: Page): Promise<number> {
  const text = (await page.getByTestId('stat-rain-depth').textContent()) ?? ''
  return Number(/^(\d+) mm/.exec(text)?.[1] ?? Number.NaN)
}

/** 「1234.5 m³」の数 */
async function volumeM3(page: Page): Promise<number> {
  const text = (await page.getByTestId('stat-total').textContent()) ?? ''
  return Number(text.replace(/[^0-9.]/g, ''))
}

/** 一時停止の後、表示中の step が動かなくなるまで待って返す（最後の frame が届くまで） */
async function stableStep(page: Page): Promise<number> {
  const read = async (): Promise<number> =>
    Number(/Step (\d+)/.exec((await page.getByTestId('stat-step').textContent()) ?? '')?.[1])
  let last = -1
  await expect
    .poll(
      async () => {
        const previous = last
        last = await read()
        return last === previous
      },
      { timeout: 10_000, intervals: [300] },
    )
    .toBe(true)
  return last
}

/**
 * 降雨マーカーの下（マーカーの画像の下端が地点）の近くで、水深が 0.00 m でないセルを探して、その画面の位置を返す
 * （セル情報のポップオーバーで読む）。マーカーの画像に当たらないよう、下端より下だけを試す
 */
async function findWetPoint(page: Page): Promise<{ x: number; y: number }> {
  const marker = await page.locator('.maplibregl-marker').boundingBox()
  if (marker === null) throw new Error('マーカーがありません')
  const base = { x: marker.x + marker.width / 2, y: marker.y + marker.height }
  const offsets = [
    [0, 4],
    [20, 4],
    [-20, 4],
    [0, 24],
    [20, 24],
    [-20, 24],
    [0, 44],
    [40, 4],
    [-40, 4],
  ] as const
  for (const [dx, dy] of offsets) {
    const p = { x: base.x + dx, y: base.y + dy }
    await page.mouse.click(p.x, p.y)
    const depth = page.getByTestId('cell-depth')
    await expect(depth).toBeVisible()
    const text = await depth.textContent()
    await page.getByRole('button', { name: strings.cellInfo.close }).click()
    if (text !== '0.00 m') return p
  }
  throw new Error('マーカーの近くに水のあるセルが見つかりません')
}
```

（`import { expect, type Page, test } from '@playwright/test'` にする）

- `describe('降雨と再生（spec 04 §11.2 の 4・5）')` の名前を `'降雨と再生（spec 08 §9.4 の 4・5・10）'` にし、最初のテストを次に置き換える:

```ts
  test('既定の設定（100 mm/h・1 時間・10 m）で開始し、最速にすると経過時間が進んで「降雨中」と出て、雨が終わると「降雨終了」になり、投入水量が「31.4 m³」になる', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const errors = collectErrors(page)
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
    await expect(page.getByTestId('stat-time')).toHaveText(strings.format.seconds(0))
    await page.getByRole('button', { name: strings.playback.max, exact: true }).click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect(page.getByTestId('stat-rain-status')).toHaveText(RAINING)
    await expect(page.getByTestId('stat-time')).not.toHaveText(strings.format.seconds(0))
    await expect(page.getByTestId('stat-rain-status')).toHaveText(strings.stats.rainEnded, {
      timeout: 150_000,
    })
    // 実タイルの範囲は円の中がすべて有効セルなので、I·T·πr² のまま（R04-8）
    await expect(page.getByTestId('stat-total')).toHaveText('31.4 m³')
    await expect(page.getByTestId('stat-rain-depth')).toHaveText(strings.format.rainDepth(100, 100))
    expect(errors).toEqual([])
  })
```

- 「Reset で、投入水量が 0 に、Step が 0 に戻り、もう一度開始すると新しい実行が進む」を次に置き換える:

```ts
  test('Reset で、投入水量・経過時間・Step が 0 に戻り、もう一度開始すると新しい実行が 0 から進む', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    // 半径 50 m に 300 mm/h。60 倍（既定）で 20 mm 以上降るまで回すと、マーカーの近く（findWetPoint が試す
    // 40 px ≒ 40 m 以内）のどこかに 5 mm 以上の水がある（雨の間の斜面の膜と、低い所の溜まり）
    await page.goto(`${SHIBUYA}&mmh=300&dur=60&r=50`)
    await waitTerrain(page)
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect.poll(() => fallenMm(page), { timeout: 120_000 }).toBeGreaterThanOrEqual(20)
    await page.getByRole('button', { name: strings.playback.pause }).click()
    await stableStep(page)
    const firstTotal = await volumeM3(page)
    // ポップオーバー（MUI の Modal）が開いている間はパネルが読み上げの木から外れるので、見たら閉じる
    const wet = await findWetPoint(page)
    await page.getByRole('button', { name: strings.playback.reset }).click()
    await expect(page.getByTestId('stat-total')).toHaveText('0.00 m³')
    await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
    await expect(page.getByTestId('stat-time')).toHaveText(strings.format.seconds(0))
    await expect(page.getByLabel(strings.rainfall.intensity)).toBeEnabled()
    // セル情報は SimulationClient の手元の水深を読む。Worker が reset を処理して step 0 の frame（水深 0）を
    // 送ったときだけ 0 になる（04 の最終レビューの重要な指摘）
    await page.mouse.click(wet.x, wet.y)
    await expect(page.getByTestId('cell-depth')).toHaveText('0.00 m')
    await page.getByRole('button', { name: strings.cellInfo.close }).click()
    // もう一度開始すると、新しい runId の frame が届いて統計が 0 から進む（runId の食い違い・バッファの取りこぼしが
    // あると frame が捨てられ、0 のまま止まる。前の実行の水が残れば、すぐに止めた投入水量が前の値を下回らない）
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect(page.getByTestId('stat-step')).not.toHaveText('Step 0')
    await page.getByRole('button', { name: strings.playback.pause }).click()
    await stableStep(page)
    const secondTotal = await volumeM3(page)
    expect(secondTotal).toBeGreaterThan(0)
    expect(secondTotal).toBeLessThan(firstTotal)
  })

  test('範囲全体の雨をオンにすると半径の欄が無効になり、開始すると投入水量が範囲の有効セルの面積 × 雨量で増えていく（計画で決めたこと 25）', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await page.getByLabel(strings.rainfall.wholeRange).check()
    await expect(page.getByLabel(strings.rainfall.radius)).toBeDisabled()
    // 実時間で開始してすぐ止め、「1 step 進める」で進める（乾いた地形の最初の step の dt は 1 秒）
    await page
      .getByRole('button', { name: strings.playback.speedValue(1), exact: true })
      .click()
    await page.getByRole('button', { name: strings.playback.start }).click()
    await page.getByRole('button', { name: strings.playback.pause }).click()
    let step = await stableStep(page)
    for (let n = 0; n < 5; n++) {
      await page.getByRole('button', { name: strings.playback.step, exact: true }).click()
      step += 1
      await expect(page.getByTestId('stat-step')).toHaveText(`Step ${step}`)
    }
    await expect(page.getByTestId('stat-time')).toHaveText(strings.format.seconds(step))
    // 投入水量 ÷（step 数 × 100 mm/h の 1 秒分）= 雨が降ったセルの面積。渋谷の 500 m の範囲は無効セルが無い
    const area = (await volumeM3(page)) / (step * (100 / 1000 / 3600))
    expect(area).toBeGreaterThan(200_000)
    expect(area).toBeLessThan(280_000)
  })
```

- [ ] **Step 2: URL と設定の E2E を書き直す（spec §9.4 の 7）**

`describe('URL と設定（spec 04 §7）')` の最初の 2 つのテストを次に置き換える:

```ts
  test('?mmh=50&dur=120&all=0&r=20 を付けて開くと、入力欄にその値が入っている（spec 08 §9.4 の 7）', async ({
    page,
  }) => {
    await page.goto(`${SHIBUYA}&mmh=50&dur=120&all=0&r=20`)
    await expect(page.getByLabel(strings.rainfall.intensity)).toHaveValue('50')
    await expect(page.getByLabel(strings.rainfall.duration)).toHaveValue('120')
    await expect(page.getByLabel(strings.rainfall.wholeRange)).not.toBeChecked()
    await expect(page.getByLabel(strings.rainfall.radius)).toHaveValue('20')
    await waitTerrain(page)
    await expect(page).toHaveURL(/size=500&mmh=50&dur=120&all=0&r=20/)
  })

  test('古い ?mm=50&r=20 を付けて開くと、雨は既定（100 mm/h・1 時間）で半径は 20 m になり、URL から mm が消える（R08-8、N3）', async ({
    page,
  }) => {
    await page.goto(`${SHIBUYA}&mm=50&r=20`)
    await expect(page.getByLabel(strings.rainfall.intensity)).toHaveValue('100')
    await expect(page.getByLabel(strings.rainfall.duration)).toHaveValue('60')
    await expect(page.getByLabel(strings.rainfall.radius)).toHaveValue('20')
    await waitTerrain(page)
    await expect(page).toHaveURL(/size=500&mmh=100&dur=60&all=0&r=20/)
    await expect(page).not.toHaveURL(/[?&]mm=/)
  })

  test('変えた時間雨量は localStorage に保存され、URL に無くても次に開いたときに入っている', async ({
    page,
  }) => {
    await page.goto(SHIBUYA)
    await waitTerrain(page)
    await page.getByLabel(strings.rainfall.intensity).fill('80')
    await expect(page).toHaveURL(/mmh=80/)
    await page.goto('/')
    await expect(page.getByLabel(strings.rainfall.intensity)).toHaveValue('80')
  })
```

（この 3 つ目は、今の「変えた雨量は localStorage に保存され…」を置き換える）

- [ ] **Step 3: キーボードの E2E を書き直す（spec §9.4 の 9）**

「キーボードだけで、雨量・半径の入力から Start・Pause・Reset まで操作できる」を次に置き換える:

```ts
test('キーボードだけで、時間雨量・継続時間・範囲全体・半径の入力から開始・一時停止・リセットまで操作できる（spec 08 §9.4 の 9、tech-spec §9.5）', async ({
  page,
  context,
}) => {
  await routeGsi(context)
  await acknowledgeDisclaimer(context)
  await page.goto(SHIBUYA)
  await waitTerrain(page)
  // 起点として時間雨量の入力欄に焦点を置く。ここから先はキーボードだけ
  const intensity = page.getByLabel(strings.rainfall.intensity)
  await intensity.focus()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('120')
  // 継続時間の select で上矢印を 3 回（1 時間 → 10 分。計画で決めたこと 33）
  const duration = page.getByLabel(strings.rainfall.duration)
  await tabTo(page, duration)
  for (let n = 0; n < 3; n++) await page.keyboard.press('ArrowUp')
  await expect(duration).toHaveValue('10')
  // 範囲全体のスイッチは Space でオンにすると半径の欄が無効になり、もう一度 Space でオフに戻す
  const whole = page.getByLabel(strings.rainfall.wholeRange)
  await tabTo(page, whole)
  await page.keyboard.press('Space')
  await expect(whole).toBeChecked()
  await expect(page.getByLabel(strings.rainfall.radius)).toBeDisabled()
  await page.keyboard.press('Space')
  await expect(whole).not.toBeChecked()
  await tabTo(page, page.getByLabel(strings.rainfall.radius))
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.type('15')
  const primary = page.getByRole('button', { name: strings.playback.start })
  await tabTo(page, primary)
  await page.keyboard.press('Enter')
  // 120 mm/h × 10 分 = 総量 20 mm
  await expect(page.getByTestId('stat-rain-depth')).toHaveText(/ \/ 20 mm$/)
  // 同じボタンが「一時停止」になり、焦点は外れない
  await expect(page.getByRole('button', { name: strings.playback.pause })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: strings.playback.resume })).toBeVisible()
  await tabTo(page, page.getByRole('button', { name: strings.playback.reset }))
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('stat-step')).toHaveText('Step 0')
  await expect(page.getByTestId('stat-total')).toHaveText('0.00 m³')
})
```

上矢印で `<select>` の値が変わらない（Step 7 で落ちる）ときは、`for` の行を `await page.keyboard.type('1')`（先頭の文字で「10 分」を選ぶ）に替えて測り直し、報告に書く。

- [ ] **Step 4: 3D の強い雨の E2E の URL（spec §9.4 の表）**

`tests/e2e/view3d.spec.ts` の「3D で強い降雨をすると…」の `page.goto(`${SHIBUYA}&mm=500&r=200`)` を `page.goto(`${SHIBUYA}&mmh=250&dur=120&r=200`)` にし、その上のコメントの「500 mm・半径 200 m」を「250 mm/h × 2 時間（総量 500 mm）・半径 200 m（spec 08 §9.4。同じ総量を 2 時間かけて降らせる）」にする。冠水面積の `expect.poll` の `timeout: 30_000` は、Step 7 で落ちたときだけ 90_000 にし（テストの `setTimeout` も 150_000 に）、しきい値（50,000 m²・0.3）は変えない

- [ ] **Step 5: 07 の帯の E2E を範囲全体の雨にする（R3 の裁定、計画で決めたこと 24）**

`tests/e2e/explanations.spec.ts`:
- `EDGE_RAIN` を次にする:

```ts
/**
 * 範囲全体の雨（250 mm/h × 2 時間 = 総量 500 mm。spec 08 §9.4、R3 の裁定）。縁の全周が同時に濡れ、流出の帯が
 * 決定的に出る（円の雨は縁に届くまでに時間がかかり、07 の「最初の数 step で帯が出る」前提が崩れる）
 */
const EDGE_RAIN = '&mmh=250&dur=120&all=1'
```

- `T1_MAX_STEPS` と `startAndPauseAtOnce` を消す（t1 は再生しながら待つ。計画で決めたこと 24）。`T2_STEPS` を 60 にする
- 「2D: 縁まで雨を置いて再生すると…」のテストの名前の「縁まで雨を置いて」を「範囲全体に雨を降らせて」にし、`test.setTimeout(120_000)` を `180_000` に、`c1` の `expect.poll` の `timeout: 60_000` を `120_000` にする
- 「3D: 流出の帯はカメラを固定したまま…」の、`const c0 = await outflowCount(page, clip)` の次の行から `const s1 = step` までを次に置き換え、`test.setTimeout(150_000)` を `240_000` にする:

```ts
    // t1: 60 倍（既定）で再生しながら、帯が出るまで待って一時停止する（範囲全体の雨は 1 step が 1 秒前後なので、
    // 1 step ずつ進めると t1 までの往復が長い。計画で決めたこと 24）
    await page.getByRole('button', { name: strings.playback.start }).click()
    await expect
      .poll(async () => (await outflowCount(page, clip)) - c0, { timeout: 120_000, intervals: [500] })
      .toBeGreaterThan(OUTFLOW_MIN_PX)
    await page.getByRole('button', { name: strings.playback.pause }).click()
    await expect(page.getByRole('button', { name: strings.playback.resume })).toBeVisible()
    let step = await settledStep(page)
    const pausedStep = step
    await nextFrames(page)
    const c1 = await outflowCount(page, clip)
    expect(c1 - c0).toBeGreaterThan(OUTFLOW_MIN_PX)
    const s1 = step
```

- 定数の説明の実測の文（`OUTFLOW_MIN_PX`・`OUTFLOW_GROWTH_PX`・`T2_STEPS`）は Step 7 の実測で書き直す

- [ ] **Step 6: 計測の URL（spec §9.4 の表、N7、計画で決めたこと 32）**

`tests/perf/fps.perf.ts`:
- `const WATER_RAIN = { mm: '500', r: '50' } as const` を `const WATER_RAIN = { mmh: '250', dur: '120', r: '50' } as const` にし、その上の説明の「（平衡に届かない。…）」の後に「spec 08 から、総量 500 mm を 250 mm/h × 2 時間で降らせる（N7。05〜07 の記録は一度に置いた 500 mm で測ったので、水の広がり方が違う）」を足す
- `outflow-500` の `waterRain: { mm: '500', r: '250' }` を `waterRain: { mmh: '250', dur: '120', r: '250' }` に、`outflow-1000` の `waterRain: { mm: '500', r: '500' }` を `waterRain: { mmh: '250', dur: '120', r: '500' }` にする
- `waterRain` の型の説明の「（mm・r）」を「（mmh・dur・r）」にする

`tests/perf/shots.perf.ts`: `const WATER = { water: '1', mm: '500', r: '50', settle: '20000' }` を `const WATER = { water: '1', mmh: '250', dur: '120', r: '50', settle: '20000' }` にし、コメントの「500mm・半径 50m」を「250 mm/h × 2 時間・半径 50 m」に、「（04 の URL の mm・r）」を「（spec 08 の URL の mmh・dur・r）」にする

`tests/perf/water.perf.ts`: `mm: '500',` を `mmh: '250',\n        dur: '120',` にする

- [ ] **Step 7: E2E を回して、07 の帯のしきい値を決め直す（フォアグラウンド）**

Run: `pnpm build && pnpm exec playwright test --project=chromium tests/e2e/explanations.spec.ts --repeat-each=3`
Expected: 3 回とも、2D の `[実測] 2D {...}` と 3D の `[実測] 3D {...}` が出る。帯のテストが落ちたときも `logMeasured` の前に落ちるので、落ちた場合は一時的に `expect` の前に `logMeasured` を移して実測を取り、戻す

実測から、計画で決めたこと 24 の規則でしきい値を決める:
- `OUTFLOW_MIN_PX = floor(2D・3D の 3 回ずつの c1 − c0 の最小 ÷ 4)`
- `OUTFLOW_GROWTH_PX = floor(3D の 3 回の c2 − c1 の最小 ÷ 4)`
- どちらも `OUTFLOW_NOISE_PX × 3 = 90` より大きいこと。`c2 − c1` が 90 以下なら `T2_STEPS` を 180 にして測り直す。それでも増えなければ止めてコントローラーに渡す（07 の M2 を弱めない）

定数の説明の実測の文を「実測（<実行日>、SwiftShader、範囲全体の 250 mm/h）: 2D の c1 − c0 = <最小>〜<最大>、3D は <最小>〜<最大>」「t1 → t2（<T2_STEPS> step）で c2 − c1 = <最小>〜<最大>」に書き直す。

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: 51 passed（49 − 旧 4・5・7〈URL の 1 件〉・9 の置き換えで数は変わらず、新しく 10 番と「古い mm」の 2 件を足す）。`pnpm exec playwright test --list --project=chromium` の件数を報告に書く

- [ ] **Step 8: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下。Task 1 との差を報告に書く

- [ ] **Step 9: コミット**

```bash
git add tests/e2e tests/perf
git commit -m "spec 08 Task 14: E2E と計測の URL を時間雨量・継続時間にし、07 の帯の E2E を範囲全体の雨で測り直す"
```

---

## レビュー役のチェックポイント（M3。Task 14 の後）

1. `git log --oneline <M2 の承認のコミット>..HEAD`（Task 12〜14）と `git diff --stat`
2. ゲートの結果（ユニットの件数・E2E の件数・`pnpm size` の初期ロードと Task 1 との差）
3. 07 の帯の E2E の実測（3 回）と決め直したしきい値（`OUTFLOW_MIN_PX`・`OUTFLOW_GROWTH_PX`・`T2_STEPS`）
4. 画面の確かめのスクリーンショット（`pnpm build && pnpm preview --port 4173` で開き、渋谷で 100 mm/h × 1 時間を「60 倍」で回した途中と、止まった後の統計のパネル。`.handoff/08-screenshots/` に置く）
5. 計画で決めたこと 19〜25 のうち、実装の中で変えたもの（キーボードの `<select>` の操作を替えたかを含む）

---

# M4: 性能の記録（spec §11 の M4、§7.3。R08-9: 基準は置かない）

### Task 15: 計測の口を 08 の記録の項目に合わせる（spec §7.3、計画で決めたこと 26・28）

**Files:**
- Modify: `src/ui/perfParams.ts`（+ test）、`src/ui/perfSteps.ts`（+ test）、`src/ui/perfReports.ts`
- Modify: `tests/perf/steps.perf.ts`

**Interfaces:**
- Consumes: `simulationStore` の `stats`（`timeS`・`dtS`・`stopReason`。Task 13）、`PlaybackSpeed`（Task 10）
- Produces:
  - `PerfParams.speed: PlaybackSpeed`（URL の `speed=`、既定 `'max'`）。`capMs` の上限 7,200,000、`durationMs` の上限 1,800,000
  - `summarizeDt(samples: readonly number[]): { count: number; medianS: number; minS: number } | null`（`src/ui/perfSteps.ts`）
  - `StepsReport`: `stopped: boolean`（`settled` を置き換える）・`stopReason: StopReason | null`・`simTimeS: number`・`actualRatio: number`・`dt: { count; medianS; minS } | null`。`minutesAt1x` を外す
  - `tests/perf/steps.perf.ts` の雨の組 `r10`・`r100`・`all`・`full`（100 mm/h × 1 時間）と環境変数 `RAINTRACE_STEPS_SPEED`

- [ ] **Step 1: 失敗するテストを書く**

`src/ui/perfParams.test.ts`:
- 「すべての項目を読む」の URL の末尾に `&speed=60` を足し、期待値に `speed: 60,` を足す
- 「無い・不正な項目は既定値…」の URL に `&speed=4` を足し、期待値に `speed: 'max',` を足す
- 末尾に足す:

```ts
describe('speed・cap・ms の範囲（spec 08 §7.3、計画で決めたこと 26）', () => {
  it('speed は 1・10・60・600・max だけを読み、ほかは max', () => {
    for (const speed of ['1', '10', '60', '600']) {
      expect(parsePerfParams(`?probe=steps&speed=${speed}`)?.speed).toBe(Number(speed))
    }
    expect(parsePerfParams('?probe=steps&speed=max')?.speed).toBe('max')
    expect(parsePerfParams('?probe=steps&speed=0.25')?.speed).toBe('max')
  })

  it('cap は 2 時間（7,200,000 ms）まで、ms は 30 分（1,800,000 ms）まで読む', () => {
    expect(parsePerfParams('?probe=steps&cap=3600000')?.capMs).toBe(3_600_000)
    expect(parsePerfParams('?probe=steps&cap=7200001')?.capMs).toBe(300_000)
    expect(parsePerfParams('?probe=steps&ms=600000')?.durationMs).toBe(600_000)
    expect(parsePerfParams('?probe=steps&ms=1800001')?.durationMs).toBe(10_000)
  })
})
```

`src/ui/perfSteps.test.ts`: import を `import { stepLongTaskEntries, summarizeDt } from './perfSteps'` にし、`describe('minutesAt1x…')` を次に置き換える:

```ts
describe('summarizeDt（spec 08 §7.3 の dt の中央値と最小。10 Hz の統計の標本）', () => {
  it('標本が無ければ null', () => {
    expect(summarizeDt([])).toBeNull()
  })

  it('数・中央値（偶数個は下側）・最小', () => {
    expect(summarizeDt([1, 0.5, 0.25, 1])).toEqual({ count: 4, medianS: 0.5, minS: 0.25 })
    expect(summarizeDt([0.3])).toEqual({ count: 1, medianS: 0.3, minS: 0.3 })
  })
})
```

- [ ] **Step 2: 失敗することを確かめる**

Run: `pnpm vitest run src/ui/perfParams.test.ts src/ui/perfSteps.test.ts`
Expected: FAIL（`speed` が無い、`summarizeDt` が無い）

- [ ] **Step 3: 実装する**

`src/ui/perfParams.ts`:
- `import type { PlaybackSpeed } from '../shared/protocol'` を足し、`const PLAYBACK_SPEEDS: readonly PlaybackSpeed[] = [1, 10, 60, 600, 'max']` を足す
- `PerfParams` の `until` の前に足す:

```ts
  /** probe=steps の再生速度（speed=1・10・60・600・max。既定は最速。spec 08 §7.3 の 60 倍での実際の倍率） */
  speed: PlaybackSpeed
```

- `parsePerfParams` の戻り値に `speed: PLAYBACK_SPEEDS.find((s) => String(s) === params.get('speed')) ?? 'max',` を足し、`durationMs: number('ms', 10_000, 1000, 60_000)` を `number('ms', 10_000, 1000, 1_800_000)` に、`capMs: number('cap', 300_000, 1000, 1_800_000)` を `number('cap', 300_000, 1000, 7_200_000)` にする

`src/ui/perfReports.ts`:
- `import type { StopReason } from '../simulation/types'` を足す
- `StepsReport` の `settled: boolean` から `minutesAt1x: number` までを次にする:

```ts
  /**
   * 自動停止（settled・cap。spec 08 §3.9）で止まった。until=settle で計測の上限（capMs）に届いた、
   * または until=window で窓が終わったら false
   */
  stopped: boolean
  /** 自動停止の理由（止まらなければ null） */
  stopReason: StopReason | null
  /** 止まった（または打ち切り・窓の終わりの）時点の step 数。打ち切りは統計の 10Hz の遅れぶん少ないことがある */
  steps: number
  elapsedMs: number
  /** 経過時間（シミュレーションの秒） */
  simTimeS: number
  /** 実際の倍率 = simTimeS ÷ 実時間の秒（spec 08 §6.1・§7.3） */
  actualRatio: number
  /** dt（s）の標本（統計を入れるたび。10Hz）の数・中央値・最小。標本が無ければ null */
  dt: { count: number; medianS: number; minS: number } | null
```

`src/ui/perfSteps.ts`:
- 先頭の説明の「平衡（または cap・窓の終わり）までの step 数・時間」を「自動停止（settled・cap。または計測の上限・窓の終わり）までの step 数・時間・経過時間・dt・実際の倍率」にする
- `STEPS_PER_SECOND_AT_1X` と `minutesAt1x` を消し、足す:

```ts
/** dt（s）の標本の数・中央値（偶数個は下側）・最小（spec 08 §7.3）。標本が無ければ null */
export function summarizeDt(
  samples: readonly number[],
): { count: number; medianS: number; minS: number } | null {
  if (samples.length === 0) return null
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    count: sorted.length,
    medianS: sorted[Math.floor((sorted.length - 1) / 2)] ?? Number.NaN,
    minS: sorted[0] ?? Number.NaN,
  }
}
```

- `waitSettled` の名前を `waitStopped` にし、説明を「自動停止（settled・cap。status が 'settled'）したら true、limitMs を過ぎたら false」にする
- `runStepsProbe` の降雨の開始の部分を次にする:

```ts
  const { rainfall, area } = settings.getState()
  simulation.setSpeed(params.speed)
  const limitMs = params.until === 'settle' ? params.capMs : params.durationMs
  // dt の標本（統計を入れるたび。10Hz）
  const dtSamples: number[] = []
  const offDt = simulation.store.subscribe((state, previous) => {
    if (state.stats !== null && state.stats !== previous.stats) dtSamples.push(state.stats.dtS)
  })
  const start = performance.now()
  simulation.start(rainfall)
  const stopped = await waitStopped(simulation.store, limitMs)
  const elapsedMs = performance.now() - start
  offDt()
  if (!stopped) simulation.pause()
```

- 戻り値の `settled,` を `stopped,` にし、`minutesAt1x: minutesAt1x(steps),` を次にする:

```ts
    stopReason: final?.stopReason ?? null,
    simTimeS: final?.timeS ?? 0,
    actualRatio: elapsedMs > 0 ? (final?.timeS ?? 0) / (elapsedMs / 1000) : 0,
    dt: summarizeDt(dtSamples),
```

`tests/perf/steps.perf.ts`:
- 先頭の説明を「1 step の所要時間と、開始から自動停止までの時間（spec 06 §4.1・§4.2・§5、spec 08 §7.3）」にし、環境変数の説明の `RAINTRACE_STEPS_RAINS（r10,r100,full）` を `RAINTRACE_STEPS_RAINS（r10,r100,all,full）` に、`RAINTRACE_STEPS_OUT_DIR（.handoff/06-perf）` の前に `RAINTRACE_STEPS_SPEED（1・10・60・600・max。既定 max）・` を足す
- `RAINS` を次に置き換える:

```ts
/**
 * 降雨（spec 08 §7.3。どれも 100 mm/h × 1 時間）。all は範囲全体、full は半径を範囲の半分（R04-6 の上限）にして
 * 外接矩形を範囲全体にする円（06 の「全面を濡らす雨」を時間雨量に読み替えたもの。1 step の時間の行に使う）
 */
const RAINS = {
  r10: { label: '半径 10 m・100 mm/h × 1 時間', all: '0', radius: (_size: Size): string => '10' },
  r100: { label: '半径 100 m・100 mm/h × 1 時間', all: '0', radius: (_size: Size): string => '100' },
  all: { label: '範囲全体・100 mm/h × 1 時間', all: '1', radius: (_size: Size): string => '10' },
  full: {
    label: '全面を濡らす雨（半径 = 範囲の半分・100 mm/h × 1 時間）',
    all: '0',
    radius: (size: Size): string => String(Number(size) / 2),
  },
} as const
```

- `windowMs` の定義の後に足す:

```ts
const speedEnv = process.env.RAINTRACE_STEPS_SPEED ?? 'max'
if (!['1', '10', '60', '600', 'max'].includes(speedEnv)) {
  throw new Error(`RAINTRACE_STEPS_SPEED は 1・10・60・600・max のどれか: ${speedEnv}`)
}
```

- `query({ … })` の `mm: RAINS[rain].mm,` を `mmh: '100',\n          dur: '60',\n          all: RAINS[rain].all,` にし、`fallback: '0',` の後に `speed: speedEnv,` を足す
- `formatTable` の見出しの 1 行目の説明に `speed=${speedEnv}` を足し、表の見出しと行を次にする:

```ts
    '| 地点 | 範囲 | 雨 | 3D | 停止 | step | 所要 (s) | 経過 (h:mm:ss) | 実際の倍率 | dt 中央値 (s) | dt 最小 (s) | step／秒 | 1 step 中央値 (ms) | 1 step p95 (ms) | 1 step 最大 (ms) | 長いタスク（数・最大 ms） | 止まっている間の render（2 秒） | 質量誤差 (m³) | DEM（固定・素通し・欠け） |',
    '|---|---|---|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|',
```

```ts
    lines.push(
      `| ${SITES[site].label} | ${size} m | ${RAINS[rain].label} | ${r.view3d} | ${r.stopped ? (r.stopReason ?? '—') : '打ち切り'} | ${r.steps} | ${(r.elapsedMs / 1000).toFixed(1)} | ${clock(r.simTimeS)} | ${r.actualRatio.toFixed(1)} | ${fixed(r.dt?.medianS ?? null, 3)} | ${fixed(r.dt?.minS ?? null, 3)} | ${r.stepsPerSecond.toFixed(0)} | ${fixed(r.stepTimes.medianMs, 2)} | ${fixed(r.stepTimes.p95Ms, 2)} | ${fixed(r.stepTimes.maxMs, 2)} | ${r.longTasks.supported ? `${r.longTasks.count}・${r.longTasks.maxMs.toFixed(0)}` : '未対応'} | ${r.idleRenders} | ${fixed(r.final?.massError ?? null, 6)} | ${dem.fixture}・${dem.passthrough}・${dem.missing} |`,
    )
```

- `fixed` の後に足す:

```ts
/** シミュレーションの秒を「h:mm:ss」にする */
function clock(seconds: number): string {
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
```

- `const name = \`steps-${mode}-${until}\`` を `const name = \`steps-${mode}-${until}-${speedEnv}-${rains.join('-')}-${sizes.join('-')}\`` にする（組ごとに別のファイルに書き、上書きしない）

- [ ] **Step 4: テストが通ることを確かめる**

Run: `pnpm vitest run src/ui/perfParams.test.ts src/ui/perfSteps.test.ts`
Expected: PASS

- [ ] **Step 5: ゲート**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（計測の口は `pnpm build:perf` のときだけビルドに入る。通常のビルドの初期ロードは変わらない）

- [ ] **Step 6: コミット**

```bash
git add src/ui/perfParams.ts src/ui/perfParams.test.ts src/ui/perfSteps.ts src/ui/perfSteps.test.ts src/ui/perfReports.ts tests/perf/steps.perf.ts
git commit -m "spec 08 Task 15: 計測の口に速度・停止の理由・経過時間・dt・実際の倍率を足す"
```

---

### Task 16: §7.3 の記録（spec §7.3・§7.2、R08-9、N6・N7、計画で決めたこと 27〜29）

**判定はしない。**測って `docs/perf/<Task 1 の実行日>-physical-time.md` に並べ、spec §7.2 の見積もりとの差を書く。**E2E（4173）と同時に回さない。10 分を超える実行はバックグラウンドで回す**。全部で 9〜10 時間の見込み（下の各 Step の見込みの和）。複数のセッションに分けてよい（生の JSON は組ごとに別のファイルに残る）。

**Files:**
- Modify: `docs/perf/<Task 1 の実行日>-physical-time.md`
- 生データ（gitignore）: `.handoff/08-perf/`

**Interfaces:**
- Consumes: Task 15 の計測の口、`tests/perf/fps.perf.ts`（Task 14 で URL を直した）
- Produces: 記録（Task 17 の tech-spec §14.1 の追記が読む）

- [ ] **Step 1: 計測用のビルドと機器の記録**

Run: `pnpm build:perf && (nproc; nvidia-smi --query-gpu=name,driver_version --format=csv,noheader; uptime; git rev-parse --short HEAD) > .handoff/08-perf/machine.txt`
Expected: 成功

- [ ] **Step 2: 開始から停止まで（500 m・3 地点・半径 10 m と 100 m。バックグラウンド。見込み 2〜3 時間）**

Run（バックグラウンド）:

```bash
RAINTRACE_STEPS_RAINS=r10,r100 RAINTRACE_STEPS_SIZES=500 RAINTRACE_STEPS_UNTIL=settle \
RAINTRACE_STEPS_CAP_MS=3600000 RAINTRACE_STEPS_SPEED=max RAINTRACE_STEPS_OUT_DIR=.handoff/08-perf \
pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間
```

Expected: `1 passed`。`.handoff/08-perf/steps-2d-settle-max-r10-r100-500.{json,md}` ができる。停止の欄は `cap`（Q1 = (a)。M0 の実測では 6 通りすべて）か `settled`、60 分で届かなければ「打ち切り」

- [ ] **Step 3: 範囲全体の雨（500 m は 3 地点、1000 m は渋谷だけ。バックグラウンド。見込み 3〜4 時間）**

Run（バックグラウンド。2 つを順に）:

```bash
RAINTRACE_STEPS_RAINS=all RAINTRACE_STEPS_SIZES=500 RAINTRACE_STEPS_UNTIL=settle \
RAINTRACE_STEPS_CAP_MS=3600000 RAINTRACE_STEPS_OUT_DIR=.handoff/08-perf \
pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間 && \
RAINTRACE_STEPS_RAINS=all RAINTRACE_STEPS_SIZES=1000 RAINTRACE_STEPS_SITES=shibuya RAINTRACE_STEPS_UNTIL=settle \
RAINTRACE_STEPS_CAP_MS=3600000 RAINTRACE_STEPS_OUT_DIR=.handoff/08-perf \
pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間
```

Expected: 2 回とも `1 passed`。上限で打ち切った行は「打ち切り」のまま記録する（計画で決めたこと 28）

- [ ] **Step 4: 1 step の中央値・p95（全面を濡らす雨、500 m・1000 m・3 地点、窓 10 分。バックグラウンド。見込み 80 分）**

Run（バックグラウンド）:

```bash
RAINTRACE_STEPS_RAINS=full RAINTRACE_STEPS_UNTIL=window RAINTRACE_STEPS_WINDOW_MS=600000 \
RAINTRACE_STEPS_OUT_DIR=.handoff/08-perf pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間
```

Expected: `1 passed`（6 行）

- [ ] **Step 5: 60 倍での実際の倍率（500 m・3 地点・半径 10 m と範囲全体、窓 2 分。見込み 20 分。バックグラウンド）**

Run（バックグラウンド）:

```bash
RAINTRACE_STEPS_RAINS=r10,all RAINTRACE_STEPS_SIZES=500 RAINTRACE_STEPS_UNTIL=window \
RAINTRACE_STEPS_WINDOW_MS=120000 RAINTRACE_STEPS_SPEED=60 RAINTRACE_STEPS_OUT_DIR=.handoff/08-perf \
pnpm perf:fps tests/perf/steps.perf.ts -g 所要時間
```

Expected: `1 passed`。「実際の倍率」の欄が 60 前後（半径 10 m）と、それより小さい値（範囲全体。M0 の見込みで約 9 倍）

- [ ] **Step 6: fps の前後（同じ日に。07 と同じ組と 06 の 1 組。計画で決めたこと 27、N7）**

「前」は一時的な worktree（08 の前 = `ba9cc26`。古い `mm=500` の URL で測る）:

```bash
git worktree add ../raintrace-08-before ba9cc26
cd ../raintrace-08-before && pnpm install --frozen-lockfile && pnpm build:perf
```

（`pnpm install` が lockfile を書き換えようとしたら止めて知らせる）

組ごとに 前→後→前→後 と交互に回す（07 の `docs/perf/2026-09-29-outflow.md` と同じ。各 3 ラン × 2 回。ポートは両方とも 4175 を順に使う）。各実行はバックグラウンドで回し、終わりを待ってから次を回す:

```bash
# 前（worktree の中で）
cd ../raintrace-08-before && RAINTRACE_UNCAPPED=1 RAINTRACE_FPS_SET=outflow-500 RAINTRACE_FPS_SITES=shibuya,minatomirai \
  RAINTRACE_FPS_OUT_DIR=<このリポジトリの絶対パス>/.handoff/08-perf/fps-before-1 pnpm perf:fps tests/perf/fps.perf.ts -g 'fps の測り直し'
# 後（このリポジトリで）
RAINTRACE_UNCAPPED=1 RAINTRACE_FPS_SET=outflow-500 RAINTRACE_FPS_SITES=shibuya,minatomirai \
  RAINTRACE_FPS_OUT_DIR=.handoff/08-perf/fps-after-1 pnpm perf:fps tests/perf/fps.perf.ts -g 'fps の測り直し'
# 前・後をもう 1 回ずつ（fps-before-2・fps-after-2）。outflow-1000 も同じく 4 回
# 天井あり（UNCAPPED なし）を前・後で 1 回ずつ（fps-before-capped・fps-after-capped）
# 06 の 1 組（渋谷、500 m・1000 m の z16 ×10 p85 の行を読む）: RAINTRACE_FPS_SET=water を前・後で 1 回ずつ
```

終わったら `cd <このリポジトリ> && git worktree remove ../raintrace-08-before` で消し、`pnpm build` で `dist` を通常のビルドに戻す

- [ ] **Step 7: 記録を書く**

`docs/perf/<Task 1 の実行日>-physical-time.md` の末尾に足す:

```markdown
## ブラウザの計測（Task 16。<実行日>、load average <machine.txt の uptime>）

- 道具: `tests/perf/steps.perf.ts`（Task 15 の組。2D、`pnpm build:perf`、ポート 4175、固定の DEM のフィクスチャ〈06 §4.1〉）、`tests/perf/fps.perf.ts`
- 生の JSON: `.handoff/08-perf/`（gitignore）
- **判定はしない（R08-9）**。比べる相手は参考

### 開始から停止まで（「最速」。spec §7.3 の 1・2 行目）

<steps-2d-settle-max-r10-r100-500.md・steps-2d-settle-max-all-500.md・steps-2d-settle-max-all-1000.md の表をそのまま貼る>

- 比べる相手: 06 の平衡までの時間（tech-spec §14.1: 半径 10 m は綾瀬 76.8 s・渋谷 35.1 s・みなとみらい 2.6 s、半径 100 m は 300 s で届かず）。止まる条件が違う（06 は流れが 1 つも無い、08 は雨の後の流速 1 cm/s か上限 6 時間）ので参考
- spec §7.2 の見積もり（半径 10 m は 45 秒〜2.3 分、半径 100 m は 26〜47 分、範囲全体は 45〜55 分）との差: <書く。外れた理由が分かれば書く>
- 停止の理由（settled・cap）の内訳: <書く。Q1 = (a) の帰結（spec §3.9）と合っているか>

### 1 step の所要時間（全面を濡らす雨、窓 10 分。spec §7.3 の 3 行目）

<steps-2d-window-max-full-500-1000.md の表>

- 比べる相手: 06 の実測（500 m 6.50〜7.90 ms・p95 9.60〜11.10 ms、1000 m 30.80〜36.00 ms）、07 の記録（`docs/perf/2026-09-29-outflow.md` の「1 step 前→後」）、spec §7.1 の見込み（ブラウザで 500 m・全面が濡れた状態で 12〜19 ms）
- tech-spec §6.3 の目安（中央値 8 ms・p95 16 ms）に当たるかの検討はしない（N6。後続へ引き継ぐ。spec §14）

### 60 倍での実際の倍率（spec §7.3 の 4 行目）

<steps-2d-window-60-r10-all-500.md の表の「実際の倍率」の列>

### fps（spec §7.3 の 5・6 行目）

**08 の fps の数値は、07 の記録とは直接には比べられない**（07 は 500 mm を一度に置いて測った。08 は同じ総量を 2 時間かけて降らせるので、測る間の水の広がり方が違う。N7）。08 の前（`ba9cc26`）も古い `mm=500` でしか測れないので、前後の差にも雨の降り方の違いが入る。差は参考として並べる。

<outflow-500・outflow-1000 の UNCAPPED の交互の前後の表（セルごとの 6 ランの中央値）、天井ありの表、06 の組（渋谷 z16 ×10 p85 の 500 m・1000 m）の前後>

### Node のベンチマークとの突き合わせ

- Task 9 の Node の 1 step の時間と、ブラウザの全面の 1 step の比: <書く>
```

- [ ] **Step 8: ゲート（記録だけなので、書式と lint だけ確かめる）**

Run: `pnpm format && pnpm lint`
Expected: 成功（`docs/` は Biome の対象外）

- [ ] **Step 9: コミット**

```bash
git add docs/perf/<Task 1 の実行日>-physical-time.md
git commit -m "spec 08 Task 16: 開始から停止まで・1 step・実際の倍率・fps の記録（判定はしない。R08-9）"
```

---

## レビュー役のチェックポイント（M4。Task 16 の後）

1. `git log --oneline <M3 の承認のコミット>..HEAD`（Task 15・16）
2. 記録（`docs/perf/<日付>-physical-time.md`）の各表と、spec §7.2 の見積もりとの差の説明
3. 打ち切った行（上限 60 分）と、回さなかった組（1000 m の範囲全体は渋谷だけ。計画で決めたこと 28）
4. fps の前後が雨の降り方の違いを含むこと（N7）が記録に書いてあること

---

# M5: 締め（spec §11 の M5）

### Task 17: tech-spec の改訂（spec §8.1・§8.2、R08-11）

base-spec の本文は変えない（R08-11）。差異は tech-spec §19 と overview §8（Task 18）に記録する。

**Files:**
- Modify: `specs/tech-spec.md`（§3.3・§6.1・§6.2・§6.3・§6.5・§6.6・§8.3・§9.7・§11.2・§11.3・§11.4・§14.1・§14.3・§19）

**Interfaces:**
- Consumes: Task 1〜16 の結果（とくに Task 16 の記録）
- Produces: 文書

- [ ] **Step 1: §3.3 ルーティング**

URL の例を `/?lat=35.6812&lon=139.7671&z=17&size=500&mmh=100&dur=60&all=0&r=10` にし、表の `mm` の行を次の 3 行に置き換える:

```markdown
| `mmh` | 時間雨量（mm/h）。1〜300 の整数（実装 spec 08 §6.4） | 100 |
| `dur` | 継続時間（分）。10・20・30・60・120・180・360 のどれか | 60 |
| `all` | `1` なら範囲全体に降らせる、`0` なら円（オフでも `0` を書く） | 0 |
```

表の下に足す: 「古い URL の `mm`（総量の雨量）は読まない。無いものとして扱い、雨は保存値（無ければ既定）になる。`mm` は次に URL を書くときに消える（実装 spec 08 §6.4、R08-8、N3）。」。「URL と localStorage（§8.3）の両方にある項目（`size`・`mm`・`r`）」を「（`size`・`mmh`・`dur`・`all`・`r`）」にする

- [ ] **Step 2: §6.1〜§6.3・§6.5・§6.6**

§6.1 の判断根拠の概算のブロックを次にし、その下に 1 文を足す:

```
全セル総当たり   : 250,000 cells × 面 2（東・南）= 0.5M faces/step
                   × 60 step/sec              = 30M face-updates/sec
Active Cell 適用 : 水のある領域のみ（数百〜数万セル）
                   30,000 × 2 = 60K faces/step
                   × 60                       = 3.6M face-updates/sec
```

「実装 spec 08 で流れの式を 4 近傍の局所慣性式に替えた。1 面あたりの演算（`Math.cbrt` と割り算）は 8 近傍の拡散式の 1 近傍より重く、1 step は今の約 2 倍（実装 spec 08 §7.1）。概算の桁は変わらない」

§6.2 の `SimulationEngine` のコードを実装 spec 08 §5.1 の形（`RainfallInput`・`StepStats`・`SimulationEvent`・`setRainfall`・`flowVectors` の m/s）に置き換える（`src/simulation/types.ts` の宣言をそのまま写す）。対応表の `timestep` の行を `| §44 SimulationConfig | TerrainMeta | timestep は持たない。dt はエンジンが毎 step 決め（実装 spec 08 §3.3）、StepStats.dtS に載せる |`、`Rainfall` の行を `| §44 Rainfall | RainfallInput | 座標系（グリッド北西端からの m）と単位を名前で明示した。時間雨量 × 継続時間と、範囲全体の雨（実装 spec 08 §4） |` にし、`§45 step() など` の行に「`addRainfall` は `setRainfall`（登録し、step ごとに投入。実装 spec 08 §4.2）」を足す

§6.3 の測定条件の引用の下に足す: 「1 step の時間は dt によらない。step 数は dt（水深で決まる）で決まる（実装 spec 08 §7.3）。基準の値は変えない（実装 spec 08 の N6。08 の実測がこれに当たるかの検討は後続に回す）」

§6.5 の表に足す（`水深（Worker 内）` の行の後）:

```markdown
| 面の単位幅流量 `qx`・`qy`（Worker 内） | `Float64Array` | 運動量を step をまたいで持つ。水深と同じく丸め誤差の累積を避ける（実装 spec 08 §3.1） |
```

§6.6 の許容誤差の表:
- 「水深の比較許容値（epsilon）」の用途を「水深・水面の比較の許容値。面を通れる水深の閾値 `DRY_DEPTH_M` と同じ値」にする
- 「流れの閾値 θ」の行を次に置き換える:

```markdown
| 面を通れる水深の閾値 `DRY_DEPTH_M` | 1e-5 m | 面を通れる水の深さ h_f がこれ以下の面の流量を 0 にする（R03-3 の θ を実装 spec 08 §3.4 で読み替えた）。局所慣性式では池の水面は平らになり、θ の傾きは無くなった |
```

- 表の下に足す（実装 spec 08 §3.12 の定数）:

```markdown
| 名前 | 値 | 用途 |
|---|---|---|
| `GRAVITY` | 9.81 m/s² | 局所慣性式 |
| `MANNING_N` | 0.03 | Manning の粗度係数（R08-3。テストは `EngineOptions` で差し替える） |
| `CFL_ALPHA` | 0.5 | dt = min(DT_MAX_S, α·Δx / max(√(g·h_max), u_max)) |
| `THETA` | 0.8 | de Almeida ほか（2012）の θ 重み付け |
| `DT_MAX_S` | 1 s | dt の上限 |
| `FROUDE_MAX` | 1 | フルード数の上限 |
| `SETTLE_VELOCITY_M_PER_S` | 0.01 m/s | 自動停止（雨の後、すべての面の流速がこれ未満。R08-6） |
| `SETTLE_CAP_S` | 21,600 s | 雨がやんでから止めるまでの上限（6 時間。R08-6） |
| `ARROW_MIN_VELOCITY_M_PER_S` | 0.005 m/s | 水の流れの矢印を出す流速の下限 |
```

- [ ] **Step 3: §8.3 localStorage スキーマ**

コードの `schemaVersion: 1` を `schemaVersion: 2` に、`rainfall` を次にする:

```ts
  rainfall: {
    intensityMmPerH: number   // 既定 100。1〜300 の整数（時間雨量）
    durationMin: 10 | 20 | 30 | 60 | 120 | 180 | 360   // 既定 60（継続時間）
    radiusM: number           // 既定 10
    wholeRange: boolean       // 既定 false（範囲全体に降らせる）
  }
```

コードの下の段落の最後の「形は変わらないので `schemaVersion` は 1 のまま。」の後に足す: 「実装 spec 08 で `rainfall` の形が互換でなく変わったので、`schemaVersion` を 2 に上げた。」

「バージョニング方針」の「schemaVersion のマイグレーションはしない。…」の段落の後に足す: 「例外として、v1 → v2 は雨量（`amountMm`）だけを既定の時間雨量・継続時間・範囲全体に戻し、半径を含むそれ以外を今の規則で検証して残す（R08-8、N1・N2。`src/state/persistedSettings.ts` の `parsePersistedSettings`）。保存するときは常に v2 の形で書く。08 の後で v0.2.0・07 のビルドに戻すと、v2 の保存値は捨てられ、注意事項がもう一度出る（ユーザーの裁定 N2）」

- [ ] **Step 4: §9.7・§11・§14・§19**

§9.7 の「流出しているセルの帯」の「近傍（FlowSolver の近傍の表）」を「上下左右（FlowSolver の 4 近傍の面の表。実装 spec 08 §3.7 で 8 近傍から替わった）」にし、「`TerrainPayload.outflow` で Transferable として送る」の後に「（`nearest`・`band` だけ。`mask` は実装 spec 08 §5.3 で送らなくした）」を足す。「水が減る理由」の項目の最後に「統計には『流出の速さ』（その時点の 1 時間あたりの量）の行もあり、ツールチップは合計と速さの両方を説明する（実装 spec 08 §6.5）」を足す

§11.2 の表を次にする（実装 spec 08 §9.1）:

```markdown
| ケース | 検証内容 |
|---|---|
| 平面 | 縁で囲んだ平らな盆地に一度に置いた水が広がり、止めた後の水面の最大と最小の差が 1cm 以内 |
| 傾斜面 | 水の重心が下り方向へ移る。置いた位置より 1cm 以上高い標高のセルは水を得ない（慣性で上る分を 1cm まで許す） |
| 単純窪地 | 窪地に蓄積し、止めた後の水面が 1cm 以内で平ら |
| 越流 | 峠でつながった窪地の一方に容量を超える水を置くと、越流イベントが 1 回だけ出て、もう一方が水を得る |
| 平衡水位 | 閉じた窪地に既知の体積の水を入れ、止めた後の水面標高が理論値と 1cm 以内で一致すること（§6.6） |
| 満水との一致 | 十分な水を入れて止めた水面が、4 近傍の Priority-Flood の満水の水面と一致する（池 1cm、池の外 5mm） |

平衡を見るテストは UI の停止（流速 1cm/s）とは別の止め方で回す: 雨の後、流れによる水深の変化の最大が 0.1 mm/h（満水との一致は 3 mm/h）未満になるまで（実装 spec 08 §9.1）。
```

§11.3 の箇条書きの「地形はランダム生成（平坦、単調傾斜、複数窪地、無効値混在の各パターン）」を「地形はランダム生成（平坦、単調傾斜、複数窪地、凹凸、1 セルで 3 m 下がる段差、無効値混在の各パターン）。雨は一度に置くものと継続時間のあるもの」にし、末尾に足す: 「ほかの性質: 非負・有限（水深と面の流量）、静水の保存（標高と水面を 1/256 m の格子に載せ、ビット単位で変わらない）、時間刻み（dt ≤ DT_MAX_S、dt ≤ α·Δx/√(g·h_max)、雨の終わりをまたがない）、決定性、走査範囲（bbox と full のビット単位の一致、範囲の外の水深と流量が 0）。03 の局所的な最大値原理は局所慣性式では成り立たないので外した（実装 spec 08 §9.2）」

§11.4 の 1〜9 番の 4・5・7・9 を次にし、10 番を足す（実装 spec 08 §9.4）:

```markdown
4. 既定の設定（100 mm/h・1 時間・10 m）で開始し、速度を「最速」にすると、経過時間が進み「降雨中」と出る。雨が終わると「降雨終了」になり、投入水量が 31.4 m³ になる
5. Reset を押すと投入水量・経過時間・Step が 0 に戻り、もう一度開始すると新しい実行が 0 から進む
7. `?mmh=50&dur=120&all=0&r=20` を付けて開くと入力欄にその値が入る。古い `?mm=50&r=20` では雨は既定で半径は 20 m、URL から `mm` が消える
9. キーボードだけで時間雨量・継続時間・範囲全体・半径の入力から開始・一時停止・リセットまで操作できる
10. 範囲全体の雨をオンにすると半径の欄が無効になり、開始すると投入水量が範囲の有効セルの面積 × 雨量で増えていく
```

§14.1 の表の「平衡までの時間」の行を次に置き換える:

```markdown
| 開始から停止までの時間 | 基準を置かない（記録のみ。実装 spec 08 の R08-9） | 「最速」で、3 地点の 500 m・100 mm/h × 1 時間（半径 10 m・100 m）と範囲全体。06 の平衡の目標（R06-6）は、この記録に置き換えた。実測は `docs/perf/<Task 1 の実行日>-physical-time.md` |
```

§14.1 の表の下（05 の要約の前）に足す: 「実装 spec 08 の実測（記録のみ。R08-9）: 1 step の中央値は 500 m・全面を濡らす雨で <Task 16 の値> ms、1000 m で <Task 16 の値> ms（1 step の目標 8 ms・p95 16 ms は変えない。N6）。開始から停止までは半径 10 m で <値>、半径 100 m で <値>（停止の理由は <settled・cap の内訳>）。60 倍での実際の倍率は半径 10 m で <値>、範囲全体で <値>。詳細は `docs/perf/<日付>-physical-time.md`」（< > は Task 16 の記録の数字で埋める）

§14.3 の Worker の表に `qx・qy  Float64Array((N+1)·N) × 2 = 約 4 MB（500 m）・約 17 MB（1000 m）` の行を足し（合計を直す）、07 の段落から `mask` がメインスレッドに残る旨の文を消して「`mask` は実装 spec 08 §5.3 で送らなくした（1000 m で約 1 MB 減る）」を足す

§19 の表:
- `| §55 Phase 4 の「降雨時間」 | 実装 spec 04 | …` の行を `| §55 Phase 4 の「降雨時間」 | 実装 spec 04 → 08 | 04 は瞬時の投入のみとした（R04-3）。実装 spec 08 で継続時間の間の降雨を実装し、差異を解消した |` にする
- `| §16 の threshold | 実装 spec 03 | …` の行を `| §16 の threshold | 実装 spec 03 → 08 | 03 は水面差の閾値 1e-5 m（R03-3）。08 で面を通れる水深の閾値 DRY_DEPTH_M（1e-5 m）に読み替えた（§6.6） |` にする
- 表の末尾に実装 spec 08 §8.1 の差異を足す:

```markdown
| §2 正確な流速・流体力学的乱流を考慮しない | 実装 spec 08 | 近似の流速を計算する（局所慣性式）。「正確な流速」を保証しないことは変わらない |
| §11 降雨量から水量への変換 | 実装 spec 08 | 水量 = 面積 × 時間雨量 × 継続時間 |
| §12 均一降雨（時間変化降雨は将来） | 実装 spec 08 | 継続時間の間、一定の強さで降り続ける。強さが変わる雨は将来のまま |
| §13〜§16 mass-conserving grid model・8 近傍・flow ∝ ΔH・物理的な流速まで再現しない | 実装 spec 08 | 4 近傍の局所慣性式（Manning の摩擦）。質量保存は保つ |
| §33 現実時間との対応を保証しない | 実装 spec 08 | 経過時間（物理時間）を表示する |
| §34 速度 0.25x〜4x | 実装 spec 08 | 実時間の倍率（実時間・10・60・600 倍・最速） |
| §37・§38 UI・統計 | 実装 spec 08 | 時間雨量・継続時間・範囲全体の入力、経過時間・降雨の状態・累積雨量・流出の速さの表示 |
| §44 `timestep` | 実装 spec 08 | エンジンが毎 step 決める dt（`StepStats.dtS`） |
| §45 `addRainfall` | 実装 spec 08 | `setRainfall`（登録し、step ごとに投入） |
| §53.2 降雨時間は将来 | 実装 spec 08 | 実装した |
| §54 浅水流モデルは初期実装の対象外 | 実装 spec 08 | 浅水方程式の簡略形（局所慣性式）を採る。完全な浅水流（移流項を含む）は対象外のまま |
```

- [ ] **Step 5: 確かめる**

Run: `grep -n "mm=\|amountMm\|平衡までの時間\|流れの閾値 θ" specs/tech-spec.md`
Expected: 実装 spec 08 の差異として残した説明の文だけが当たる（古い URL・古い型・古い目標の行が残っていない）。当たった行を報告に書く

- [ ] **Step 6: コミット**

```bash
git add specs/tech-spec.md
git commit -m "spec 08 Task 17: tech-spec を物理時間の降雨と局所慣性式に改訂する（base-spec との差異は §19）"
```

---

### Task 18: overview と各 spec の注記（spec §8.3、R08-11、N10）

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-00-overview.md`（§3・§6・§8）
- Modify: `docs/superpowers/specs/2026-09-10-02-dem-grid-2d-design.md`（§5）
- Modify: `docs/superpowers/specs/2026-09-10-03-simulation-engine-design.md`（冒頭の注記）
- Modify: `docs/superpowers/specs/2026-09-10-04-rain-ui-integration-design.md`（冒頭の注記）
- Modify: `docs/superpowers/specs/2026-09-10-06-performance-design.md`（§4.1・§5 の注記）
- Modify: `docs/superpowers/specs/2026-09-27-07-explanations-design.md`（§5.1・§10 の注記）
- Modify: `docs/superpowers/specs/2026-09-29-08-physical-time-design.md`（Status の行だけ）

**Interfaces:**
- Consumes: spec 08 §8.3・§13、spec 07 の裁定の表
- Produces: 文書

- [ ] **Step 1: overview §3 の表と依存関係の図**

§3 の表の `D` の行の後に足す:

```markdown
| 07 | 地図の印の説明と流出の表示 | ○（最低点・あふれ出し点）のクリックの説明、水が減る理由の説明、流出しているセルの帯（2D・3D） | 02、04、05 | — |
| 08 | 物理時間の降雨と水の流れ | 4 近傍の局所慣性式（物理時間を持つ流れの式）、時間雨量 × 継続時間の降雨（円・範囲全体）、経過時間の表示、実時間の倍率の再生、窪地解析の 4 近傍化 | 02、03、04、06、07 | Phase 4（降雨時間） |
```

依存関係の図を次に置き換える:

```
01 ─┬─→ 02 ─┬───────────→ 04 ─→ 05 ─→ 06 ─→ 07 ─→ 08
    │       └─(地形解析)─→ 03 ─┘     ↑
    ├─────────────────────→ 03       │
    └─────────────────────→ S ───────┘
```

図の下に足す: 「07 と 08 は 06 の後に積んだ（07 は 02・04・05 の表示に、08 は 03 のエンジン・04 の UI・07 の流出の表示に依る）」

- [ ] **Step 2: overview §6 の裁定の表**

冒頭の説明の段落の最後に「2026-09-29 に足した R07-1〜R07-6 は spec 07 §9、R08-1〜R08-12 は spec 08 §13 の裁定（ユーザー）」を足し、表の末尾に spec 07 の裁定の表（`R07-1`〜`R07-6` の 6 行。論点・裁定・理由の列を、この表の「論点・推奨・レビュー・裁定」に写す。推奨は裁定に「推奨どおり」とあればその文、レビューは「—」）と、次の R08 の 12 行を足す:

```markdown
| R08-1 | 流れの式 | (a) 4 近傍の局所慣性式（Bates, Horritt & Fewtrell 2010） | 反映済み（レビュー 1、M0 の再レビュー） | 承認（推奨どおり）（2026-09-29）。M0 で θ 重み付け 0.8 を足した |
| R08-2 | 4 近傍に揃える範囲 | 流れ・窪地解析・流出の縁のマスクを 4 近傍に。D8 の矢印は 8 方向のまま | 反映済み | 承認（推奨どおり）（2026-09-29） |
| R08-3 | Manning の粗度係数 | 0.03 に固定 | 賛成 | 承認（推奨どおり）（2026-09-29） |
| R08-4 | 雨の範囲 | 円を既定とし、「範囲全体に降らせる」を足す（既定オフ） | 賛成 | 承認（推奨どおり）（2026-09-29） |
| R08-5 | 再生速度の意味 | 実時間の倍率（実時間・10・60・600 倍・最速。既定 60 倍） | 賛成 | 承認（推奨どおり）（2026-09-29） |
| R08-6 | 自動停止の条件 | 雨の後、すべての面の流速が 1 cm/s 未満で止める。上限は雨がやんでから 6 時間 | M0 の実測で実 DEM はほぼ上限で止まる（§13.2 の Q1） | 承認（推奨どおり）（2026-09-29）。Q1 は (a)（R08-6 のまま。2026-09-30） |
| R08-7 | 入力の範囲と既定 | 時間雨量 1〜300 mm/h（既定 100）、継続時間 10 分〜6 時間の選択（既定 1 時間）、半径は R04-6 のまま | 賛成 | 承認（推奨どおり）（2026-09-29） |
| R08-8 | URL と localStorage の移行 | 古い mm を mm/h × 1 時間に読み替える | — | 変更: 古い値は読み替えず、雨量だけを既定に戻す。URL の mm は無視。localStorage は雨以外（半径と注意事項の了解を含む）を残す（N1〜N3）（2026-09-29） |
| R08-9 | 性能の受け入れ | 「最速」で半径 10 m は 60 秒、半径 100 m は 5 分の基準 | — | 変更: 基準は置かず、記録だけにする（2026-09-29） |
| R08-10 | 排水の項 | 入れず、口だけ設計する | 賛成 | 承認（推奨どおり）（2026-09-29） |
| R08-11 | base-spec と 03・04 の扱い | 差異を tech-spec §19 と overview §8 に記録し、base-spec の本文は残す。03・04 は冒頭に注記 | 賛成 | 承認（推奨どおり）（2026-09-29） |
| R08-12 | ブランチと進め方 | 1 ブランチ・PR 1 つ、M0〜M5 | 賛成 | 承認（推奨どおり）（2026-09-29） |
```

既存の行の「裁定」の欄の末尾に足す: R03-1 に「。**08 で変更（R08-1）**: 4 近傍の局所慣性式」、R03-3 に「。**08 で変更（R08-1・spec 08 §3.4）**: 面を通れる水深の閾値 `DRY_DEPTH_M` に読み替え」、R04-3 に「。**08 で変更**: 継続時間の間の降雨を実装した」、R04-5 に「。**08 で変更（R08-5・R08-6）**: 実時間の倍率と、雨の後の流速・上限 6 時間の自動停止」、R04-6 に「。**08 で変更（R08-7）**: 時間雨量 1〜300 mm/h・継続時間の選択」、R06-6 に「。**08 で記録のみに置き換え（R08-9）**」

- [ ] **Step 3: overview §8 の base-spec との差異**

冒頭の文の「4 件とも承認され」の後に「（§55 Phase 4 の差異は spec 08 で解消した）」を足し、`| §55 Phase 4 の「降雨時間」 | PoC では瞬時の投入のみ | R04-3 |` の行を `| §55 Phase 4 の「降雨時間」 | PoC では瞬時の投入のみ → **spec 08 で解消**（継続時間の間の降雨） | R04-3 → spec 08 |` にし、`§16 の「threshold」` の行の差異に「→ spec 08 で面を通れる水深の閾値に読み替え」を足す。表の末尾に Task 17 Step 4 の §19 に足した 11 行と同じ内容を、この表の列（base-spec・差異・論点）に写して足す（論点の欄は `R08-1`〜`R08-8` のうち当たるもの。§2・§13〜§16・§54 は R08-1、§11・§12・§45・§53.2 は R08-4・R08-7、§33・§34・§37・§38 は R08-5・R08-7、§44 は R08-1）

- [ ] **Step 4: 各 spec の注記（本文は履歴として残す。R08-11）**

spec 02 §5（`2026-09-10-02-dem-grid-2d-design.md`）の表の `analyzeDepressions` の行の説明の「グリッドの端のセルと無効セルに隣接するセルを起点にする」の後に「（**spec 08 で 4 近傍にした**〈R08-2〉。起点は無効セルに上下左右で接するセル、走査も上下左右。D8 の流向は 8 近傍のまま）」を足す

spec 03（`2026-09-10-03-simulation-engine-design.md`）の `- Status:` の行の次に足す:

```markdown
- **注記（spec 08、2026-09-30）**: §3.2〜§3.11・§4.1・§5・§6 は spec 08（`2026-09-29-08-physical-time-design.md`）で改訂した（流れの式を 4 近傍の局所慣性式に、θ を面を通れる水深の閾値に、平衡の検出を自動停止に、テストを §9 に）。本文は裁定の経緯（R03-1・R03-3）の履歴として残す（R08-11）
```

spec 04（`2026-09-10-04-rain-ui-integration-design.md`）の `- Status:` の行の次に足す:

```markdown
- **注記（spec 08、2026-09-30）**: §5.1 の `start`・`setSpeed`・`frame`、§5.2、§6.3 の末尾の 1 文（実時間との対応を示す表現を使わない）、§7、§9、§11.2、R04-3・R04-5・R04-6 は spec 08（`2026-09-29-08-physical-time-design.md`）で改訂した（時間雨量 × 継続時間の降雨、実時間の倍率の再生、経過時間の表示、URL の mmh・dur・all、localStorage の schemaVersion 2）。本文は履歴として残す（R08-11）
```

spec 06（`2026-09-10-06-performance-design.md`）の §4.1 の見出しの直後と、§5 の平衡の目標（R06-6）の行の後に、それぞれ「**注記（spec 08）**: 平衡の目標と、一度に置く雨の計測は、spec 08 §7.3 の記録（基準を置かない。R08-9）に置き換えた」を足す

spec 07（`2026-09-27-07-explanations-design.md`）:
- §5.1 の見出しの直後に「**注記（spec 08）**: 流出の縁のマスクは FlowSolver の面の表が 4 近傍になったので 4 近傍になった（R08-2。斜めにだけ無効セルに接するセルは起点にならない）。`TerrainPayload.outflow` から `mask` を外した（spec 08 §5.3）」を足す
- §10 の見出しの直後に「**注記（spec 08）**: 流出の速さの行とツールチップの文の見直し（下の申し送り）は spec 08 §6.5 で済ませた」を足す

spec 08（`2026-09-29-08-physical-time-design.md`）の 3 行目（`- Status: …`）の末尾に「。実装済み（`feat/08-physical-time`、計画 `docs/superpowers/plans/2026-09-30-08-physical-time.md`）」を足す（本文は変えない）

- [ ] **Step 5: コミット**

```bash
git add docs/superpowers/specs
git commit -m "spec 08 Task 18: overview（07・08 の行、R07・R08 の裁定、base-spec との差異）と 02・03・04・06・07・08 の注記"
```

---

### Task 19: 完了条件の照合・手動確認・試作の削除・PR の下書き（spec §9.5・§10・§11 の M5）

**Files:**
- Delete: `scripts/proto-08/`（M0 の試作。spec §11）
- Create（gitignore）: `.handoff/08-physical-time-pr.md`
- Modify（gitignore）: `.handoff/README.md`

**Interfaces:**
- Consumes: Task 1〜18 の結果
- Produces: PR の本文の下書きと push の手順

- [ ] **Step 1: 試作を消す**

Run: `git rm -r scripts/proto-08 && grep -rn "proto-08" --include=*.ts --include=*.mjs --include=*.json . --exclude-dir=node_modules --exclude-dir=.handoff`
Expected: `git rm` が 7 ファイルを消す。grep は何も当たらない（spec と計画の文書の中の言及は、履歴として残す）

- [ ] **Step 2: 完了条件を照合する（spec §10。ブランチ全体）**

Run: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm licenses`
Expected: すべて成功。ユニットの件数を報告に書く

Run: `pnpm build && pnpm exec playwright test --project=chromium`
Expected: すべて成功（Task 14 の件数）

Run: `pnpm build && pnpm size`
Expected: 初期ロード 500 KB 以下。Task 1 の基準との差を報告に書く

spec §10 の各項目を、報告に表で照合する:
1. §9 のテスト（§9.1〜§9.4 の各行 → テストのファイルと名前）とゲート
2. base-spec §57 の #5〜#8・#10・#11 が新しい式で示せること（#5 降雨の投入 → `physics.test.ts` の降雨の総量、#6 水の移動 → `scenarios.test.ts` の傾斜面、#7 窪地への蓄積 → 単純窪地・満水との一致、#8 越流 → 越流、#10 質量保存 → `properties.test.ts`、#11 統計の表示 → E2E 4・`StatisticsPanel.test.tsx`。当たるものを確かめて書く）
3. 継続時間の間の降雨・経過時間・雨の終わりの表示・実時間の倍率の再生（E2E 4・10、`playbackScheduler.test.ts`）
4. §7.3 の記録（`docs/perf/<日付>-physical-time.md`）
5. §12 の M0 の結果（spec §12.1。M0 で済み）
6. §8 の文書（Task 17・18）

- [ ] **Step 3: 【手動・ユーザー】手動確認（spec §9.5）**

コントローラーに次を渡す（実装役はユーザーに直接送らない）:

「`pnpm build && pnpm preview --port 4173` で開き、次を確かめてスクリーンショットを `.handoff/08-screenshots/` に置いてください。
1. 3 地点（綾瀬・渋谷・みなとみらい。R02-7）で 100 mm/h × 2 時間を「600 倍」か「最速」で回し、水が溜まる場所が窪地の表示（4 近傍）と合っているか、経過時間と『降雨中（残り …）』『降雨終了』の表示が自然か
2. 03・04 の手動確認（8 近傍）と比べて、水の溜まり方や ○（あふれ出し点）の位置が大きく変わった場所があれば、場所と様子を書いてください
3. 07 の流出の帯（濃いピンク）が、雨の間に広がっていく様子を 2D と 3D で 1 回ずつ
4. 止まったとき、上限の文（『計算の上限（雨がやんでから 6 時間）に達しました』）が出ること（spec §6.2。実 DEM ではほとんどがこちら）」

結果が届いたら報告と PR の本文に書く。

- [ ] **Step 4: PR の本文を下書きする（gitignore）**

`.handoff/08-physical-time-pr.md` に、プロジェクトの PR の書き方（`writing-pr-descriptions` の skill を使う）で書く。先頭に、ユーザーが実行する順のコマンドを HTML の注釈で書く（07 を先に push する。08 の PR の base は `feat/07-explanations`）:

```markdown
<!--
push と PR のコマンド（ユーザーが実行。レビュー役の承認の後に）。この注釈は GitHub の本文には表示されない
07 の PR（.handoff/07-explanations-pr.md）を先に push して作ってから、08 を push する

git push -u origin feat/07-explanations
gh pr create --base main --head feat/07-explanations \
  --title "spec 07: 地図の印の説明と、流出の説明・可視化" \
  --body-file .handoff/07-explanations-pr.md
git push -u origin feat/08-physical-time
gh pr create --base feat/07-explanations --head feat/08-physical-time \
  --title "spec 08: 物理時間の降雨と水の流れ" \
  --body-file .handoff/08-physical-time-pr.md
-->
```

本文に入れる項目:
- 概要: v0.2.0 のデモの要望（2026-09-27）とユーザーの裁定、R08-1〜R08-12、§13.1 の N1〜N10、§13.2 の Q1 = (a)。**base は `feat/07-explanations`**（07 がマージされたら GitHub が base を `main` に付け替える）
- 足したもの: 4 近傍の局所慣性式（θ 重み付け・Manning・適応的な dt）、窪地解析の 4 近傍化、時間雨量 × 継続時間の雨（円・範囲全体）、経過時間・降雨・累積雨量・流出の速さ・実際の倍率の表示、実時間の倍率の再生、停止の 2 つの文言、URL（mmh・dur・all）と保存値 v2、`TerrainPayload.outflow` から `mask` を外した
- **⚠ 既存挙動の変更**: 古い URL の `mm` は読まない（雨は既定）。保存値は v2 になり、v0.2.0・07 に戻すと保存値が捨てられて注意事項がもう一度出る（N2）。自動停止は実 DEM ではほとんど「計算の上限（雨がやんでから 6 時間）」で止まり、止めた後に来るはずの越流の通知を見逃すことがある（Q1 = (a) の帰結、spec §3.9）。水の流れの矢印は 0.005 m/s 以上のセルだけ。斜めにだけ抜ける窪地は 4 近傍では窪地になる（○ の位置が変わりうる）
- spec との差異（計画で決めたこと）: 1（満水との一致のテストを一時的に消した順序）、3（M1 の暫定の橋渡し）、5（`durationS = 0` の読み方）、6（`reset` は雨の登録を消し地形を残す）、7（正値の制限の実現）、13（cap のテストの作り方）、16（降雨の総量のテストの組）、17（スケジューラの最初の tick・`setSpeed`・`rewind`）、19（継続時間は `NativeSelect`）、20（`'settled'` の状態の名前）、21（統計の並びと丸め）、24（07 の帯の E2E の t1 の取り方としきい値）、26〜28（計測の口と打ち切り）、32（`water.perf.ts` の URL）
- 性能の記録（R08-9。判定なし）: Task 16 の表の要約と、tech-spec §6.3 の目安に当たるかの検討は後続（N6。spec §14）
- 満水との一致の許容と止め方（Task 6 で動かしたか）、07 の帯の E2E のしきい値の測り直し（Task 14）
- 手動確認（Step 3）の結果とスクリーンショット
- コミットの一覧（`git log --oneline 6f6906d..HEAD`）
- 末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

- [ ] **Step 5: `.handoff/README.md` に行を足す（gitignore）**

表の 8 番（`feat/07-explanations`）の行の後に足す:

```markdown
| 9 | `feat/08-physical-time` | `feat/07-explanations` | [08-physical-time-pr.md](08-physical-time-pr.md)（性能の生データ: [08-perf/](08-perf/)、M0 の報告: [08-m0-report.md](08-m0-report.md)） | spec 08（物理時間の降雨と水の流れ。4 近傍の局所慣性式、時間雨量 × 継続時間、実時間の倍率）。07 の上に積んだ（**07 を先に push・PR。08 の PR の base は `feat/07-explanations`**。07 がマージされたら base を `main` に付け替える）。M1〜M5 完了（<日付>、先頭 `<ハッシュ>`）。全段緑（単体 <件数>・E2E chromium <件数>・初期ロード <KB> / 500）。性能は記録のみ（R08-9）。**レビュー役のブランチ全体のレビューの承認の後に push** |
```

冒頭の段落の「残る 06 は base `main`」の後に「（07・08 は 2026-09-30 時点で未 push。07 → 08 の順に push する）」を足す

- [ ] **Step 6: コミット（試作の削除だけ。`.handoff/` は gitignore）**

```bash
git commit -m "spec 08 Task 19: M0 の試作（scripts/proto-08）を消す"
```

---

## レビュー役のチェックポイント（M5・ブランチ全体。Task 19 の後）

実装役は Task 19 の報告に次をまとめ、コントローラーがレビュー役に渡す。**承認まで PR の本文を確定しない**（ユーザーの push はその後）。

1. `git log --oneline 6f6906d..HEAD`（Task 1〜19 の 19 コミットと、レビューの指摘の追加の Task）と `git diff --stat 6f6906d..HEAD`
2. ゲートの結果（ユニットの件数・E2E の件数・`pnpm size`・`pnpm depcheck`・`pnpm licenses`）。`package.json`・`pnpm-lock.yaml` が 07 から変わっていないこと（`git diff ba9cc26 -- package.json pnpm-lock.yaml` が空）
3. spec §10 の照合の表（Task 19 Step 2）
4. 性能の記録の要約（Task 16）
5. 計画で決めたこと 1〜34 のうち、実装の中で変えたもの（無ければ「無し」）
6. 手動確認の結果（Task 19 Step 3）

レビューの指摘は、この計画の書式で追加の Task（20 以降）として足し、同じブランチで直す。

---

## 計画の見直し（自己レビュー）

- **spec の網羅**: §3.1〜§3.6（Task 3・5）、§3.7（Task 2・5。`NEIGHBOR_DX`・`NEIGHBOR_DY` を 4 近傍の面の表として export し続ける〈R1〉、`outflowCells.test.ts` の期待値〈Task 5〉、D8 は変えない〈Task 2〉）、§3.8（Task 3 の `clearFacesOutside`、Task 7 の走査範囲の外の性質）、§3.9（Task 5 の `stopReason`、Task 8 の閉じた盆地と cap、Task 10 のスケジューラ、Task 13 の文言）、§3.10（Task 3・5・11）、§3.12（Task 3・5。`manningN`・`settleVelocityMPerS` を `EngineOptions` に、`THETA` は出さない）、§4.1〜§4.3（Task 4・5・8・12）、§4.4（入れない。R08-10）、§5.1（Task 5）、§5.2（Task 10）、§5.3（Task 11。偽物 3 つ）、§6.1（Task 10）、§6.2（Task 12・13。停止の 2 つの文言・越流・1000 m の注意書き）、§6.3・§6.4（Task 12。N1〜N4）、§6.5（Task 11・13）、§7.1〜§7.3（Task 1・9・15・16。記録のみ）、§8（Task 17・18）、§9.1（Task 5・6。止め方 0.1 mm/h と、満水との一致の 3 mm/h・地形ごとの n・12 × 12・`fillMatch.slow.test.ts` の分岐・許容を黙って緩めない）、§9.2（Task 7）、§9.3（Task 3・4・5・8・10・11・12・13。Manning の斜面は壁の分を足した `q = I·x·(W+2)/W` と中央 10 列、自動停止は閉じた盆地）、§9.4（Task 14。`explanations.spec.ts` は `all=1` でしきい値を測り直す）、§9.5（Task 19 Step 3）、§10（Task 19 Step 2）、§11（各マイルストーンのチェックポイント。試作は Task 19 で消す）
- **単体テストに壁時計の判定が無いこと**: スケジューラのテストは偽の時計、エンジンのテストは `timeS` と step 数で見る。vitest の timeout（満水との一致・物理のテスト）は判定ではない。E2E と計測の時間は判定でなく待ちの上限
- **型と名前の一貫**: `RainfallInput { x; y; radiusM; intensityMmPerH; durationS; wholeRange }`（Task 5 → 10・12）、`TimedRainfall`（Task 4 だけ。Task 5 で `RainfallInput` に移す）、`RainSchedule`（Task 4 → 5）、`Faces`・`FACE_*`・`updateFaceFlows`・`limitOutflows`・`applyFaceFlows`・`faceVelocityMax`・`clearFacesOutside`・`cellVelocities`・`timeStep`（Task 3 → 5）、`StopReason`・`stopReason`（Task 5 → 10・13・15）、`DEFAULT_PLAYBACK_SPEED`・`PlaybackSpeed`（Task 10 → 13・15）、`simSecondsPerSecond`（`FrameMessage`・`FrameView`・スケジューラ・ストア。Task 10 → 13）、`RainfallSettings`・`DurationMin`・`DURATIONS_MIN`・`INTENSITY_MM_PER_H`（Task 12 → 13・15）、`RunRain`・`run`（Task 13）、`displayStats`（Task 5 → 12・13）、`runUntilStopped`・`runUntilQuiet`・`QUIET_*`・`instantRain`（Task 5 → 6・7・8）、`StepsReport.stopped`・`stopReason`・`simTimeS`・`actualRatio`・`dt`（Task 15 → 16）
- **Review Focus の 5 行のテストの置き場所**: 1 → Task 8（西の端の円・無効セルのある範囲全体）、2 → Task 5（`reset`）と Task 10（`rewind`）、3 → Task 10（`setSpeed`）、4 → Task 12（`urlState.test.ts`）、5 → Task 12（`ControlsSection.test.tsx`）
- **まだ確かめていない前提**（実行の中で確かめ、外れたら分岐に従う）: 満水との一致の許容（Task 6 Step 3 の分岐。許容は変えない）、満水との一致の時間（Task 6 Step 4 の分岐）、Runner の矢印のテストの中央のセルの流速（Task 11 Step 4。step を 5 に）、Linux の Chromium で `<select>` が上矢印で変わること（Task 14 Step 3。先頭の文字に替える）、07 の帯の E2E の実測としきい値（Task 14 Step 7 の規則）、3D の強い雨の E2E の冠水面積に届く時間（Task 14 Step 4。待ちの上限だけを延ばす）、`NativeSelect` の `inputProps.id` でラベルと select が結び付くこと（Task 12 の `ControlsSection.test.tsx` の `getByLabelText` で確かめる。結び付かなければ `NativeSelect` の `id` の渡し方を MUI 9 の型に合わせて直す）
