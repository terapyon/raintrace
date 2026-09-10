# Spec 02 実装レビューの反映 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec 02 の実装レビュー（2026-09-11、レビュー役 raintrace-ab → raintrace-19。条件付き承認）の指摘を反映し、承認の条件（M1・M2・P1）を満たす。

**Architecture:** 既存の構成（`src/dem`・`src/simulation/terrain` の純粋な計算、Worker、`SimulationClient`、`TerrainSession`、`src/map` の重ね描き）はそのまま。指摘ごとに小さく直す。

**Spec:** `docs/superpowers/specs/2026-09-10-02-dem-grid-2d-design.md`（あわせて `specs/tech-spec.md` §4.2・§5。裁定は `docs/superpowers/specs/2026-09-10-00-overview.md` §6）。元の計画は `docs/superpowers/plans/2026-09-10-02-dem-grid-2d.md`

**前提:** ブランチ `feat/02-dem-grid-2d`（05681fe）の上で続けて行う。Task は番号順に 1 つずつ

## Global Constraints

- Node 24、pnpm 12.1.0。**依存を足さない**
- 書式は Biome（`pnpm format` で整えてから `pnpm lint`）。画面の文字列は `src/ui/strings.ts` に置く
- `src/simulation/` と `src/dem/` は純粋（外部パッケージ・自ディレクトリの外を import しない）。相対 import に `.ts` を付ける。`src/dem/` は `src/simulation/` の型も import できない
- `src/shared/` と `src/state/` は `src/simulation/`・`src/dem/` の型だけを import する
- Worker（`src/workers/`）は `src/simulation`・`src/dem`・`src/shared` 以外を import しない
- 大きな配列（標高、マスク、地形解析の結果）を React の state・props・context、Zustand のストアに載せない
- 窪地の表示と越流イベントの対象は、最大深さ 5cm 以上かつ面積 10m² 以上（R02-3）
- コメントとテストの名前は日本語。既存のコードの書き方（コメントの密度、命名）に合わせる
- コミットは Task ごとに 1 つ。メッセージは日本語で、末尾に空行を置いてから `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **ゲート（すべての Task）:** `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage` がすべて成功する
- **E2E（Task 1・3・6・7）:** `pnpm build && pnpm exec playwright test --project=chromium` が全件成功する（WebKit は手元ではホストのライブラリが無く起動できないので回さない）
- **バンドル（Task 3・4・5・6）:** `pnpm build && pnpm size` が成功する（初期ロードの上限 400 KB gzip。現状 388.5 KB）

## 指摘の裁定

| 指摘 | 裁定 | Task |
|---|---|---|
| M1 Worker が地形を保持しない | Worker が grid（標高・マスク・大きさ）と窪地を保持し、標高とマスクは `.slice()` した複製を送る | 1 |
| L3 `GridMeta` と `payload.meta` の重複 | `assembleGrid` が width・height・cellSizeM を直接返す。`GridMeta` と `meta` を消す | 1 |
| M2 緯度の上限が無い（とレビュー役の補足 1: クリックでも lat 85 まで届く） | 対応範囲（日本）の判定 `inServiceArea()` を `src/dem/` に置き、Worker が取得の前に判定して `'out-of-range'` で失敗させる（クリックも URL も通る）。URL の緯度は Web Mercator の範囲（±85.051129）に絞る。`computeGridRange` は N の上限 4096 を超えたら RangeError（最後の砦） | 2 |
| P1 Worker の異常終了の後に要求が止まる（補足 a〜d） | **案を変える**: onError ですぐ起動し直すのではなく、次の要求のときに起動し直す（起動の直後に落ち続ける Worker で作り直しを繰り返さない）。`restart()`・`onCrash()` は消す。TerrainSession は異常終了でストアを変えない | 3 |
| L9 App の props | `TerrainSession` に `readonly store` を持たせ、props は `session` だけ | 3 |
| L13 main.tsx で Worker が孤児になる | ストアを先に作る。TerrainSession の生成は代入だけにする | 3 |
| P2 同時数の枠が再試行の待ちを含む | `retry(() => limit(() => fetchOnce()))` に入れ替える | 4 |
| P7 本文の読み込みの失敗が NetworkError にならない | `response.blob()` の失敗も NetworkError にする | 4 |
| L5 タイルごとに OffscreenCanvas を作る | fetcher ごとに 1 枚を使い回す | 4 |
| L4 海域判定を順に await する | `Promise.all` で並べる | 4 |
| P6 `significantIds` を並べて持つ | `Depression.significant` を持たせ、`significantIds` と `significantDepressions()` を消す | 5 |
| L11 ちょうど 5cm の窪地が Float32 の丸めで漏れる | 比較に 1mm の余裕（1e-6 では 1000m 付近で足りない。実測 1000.05 − 1000.00 = 0.04998779）。`depthBand` も同じ | 5 |
| L8 窪地のテスト用リテラルの重複 | `testGrids.ts` に `makeDepression()` | 5 |
| P3 カーソル位置の標高を毎フレーム書く | **案を変える**: ストアの `setCursor` が値を比べ、同じなら set しない（TerrainSession で index を覚えると、新しい地形で同じ index のときに更新を落とす） | 6 |
| L1 generation の戻し | `removeLayers()` を切り出す | 6 |
| L2 `LoadState` の superseded | 型から除く | 6 |
| L6 `DEM_ORDER` の重複 | `demSources.ts` の `DEM_IDS` を使う | 6 |
| L10 URL の z の適用順 | **案を変える**: z があるときは `jumpTo({ center: 地点, zoom: z })` してから選ぶ（setZoom を先にすると既定の中心で z17 のタイルを読む） | 6 |
| L12 描画を待つ間の表示の切り替えが捨てられる | overlay が最新の表示の設定を覚え、遅れた描画はそれを使う | 6 |
| P4 方位表と近傍の順序が独立 | 近傍の順序から方位を求めて一致を確かめるテスト | 6 |
| P8 tech-spec §4.2 の図に無い依存 | 図に足す。map から simulation・shared へは型のみ、の規則を足す（テストは除く） | 7 |
| L7 E2E の地理院の差し替えが二重 | smoke.spec も `routeGsi` を使う | 7 |
| P5 colormap のセルごとの確保、L14 読み込みのタイムアウト、窪地の閾値の案 (a)〜(c) | 04 への申し送り（`.handoff/02-dem-grid-2d.md`。実装役が書く） | — |

---

### Task 1: Worker が地形を保持する（M1）、GridMeta を消す（L3）

**Files:**
- Modify: `src/dem/DemGrid.ts`、`src/dem/DemGrid.test.ts`
- Modify: `src/shared/protocol.ts`
- Create: `src/workers/terrainResult.ts`、`src/workers/terrainResult.test.ts`
- Modify: `src/workers/simulation.worker.ts`
- 必要なら: `tsconfig.worker.json`・`tsconfig.test.json`（`src/workers/*.test.ts` が型検査に入り、Worker のビルドから外れるように）

**要件:**
- spec 02 §4.4「Worker はグリッドを保持し、標高のコピー・マスク・メタ情報・地形解析の結果をメインスレッドへ送る」、tech-spec §5.4「標高と validMask をメインスレッドへ1回コピーで送る」に合わせる。03 の `engine.loadTerrain(elevation, validMask, meta)` と `setDepressions(list)` に、04 で Worker が保持したものを渡せるようにする
- `AssembledGrid` を `{ elevation; validMask; width; height; cellSizeM; invalidRatio }` にし、`GridMeta` と `meta` を消す。コメントに「width・height・cellSizeM を持つので simulation の `TerrainGrid` にそのまま代入できる（dem は simulation の型を import できないので独自に持つ）」
- `TerrainPayload` から `meta` を消す（`GridMeta` の import も）
- `src/workers/terrainResult.ts` に純粋な関数を置く:
  ```ts
  export interface RetainedTerrain {
    requestId: number
    grid: TerrainGrid // src/simulation/terrain/types.ts の型
    depressions: Depression[]
  }
  export function packTerrain(
    requestId: number,
    grid: AssembledGrid,
    analysis: TerrainAnalysis,
    geo: TerrainGeo,
  ): { retained: RetainedTerrain; payload: TerrainPayload; transfer: ArrayBuffer[] }
  ```
  - `retained.grid` は grid の配列そのもの（Worker が持つ）。`payload.elevation`・`payload.validMask` は `.slice()` した複製
  - `transfer` は payload の elevation・validMask の buffer と、表示専用の `flowDirection`・`fill`・`labels` の buffer。retained の buffer は含めない
- Worker はモジュール変数 `let terrain: RetainedTerrain | null = null` を持ち、読み込みに成功したら post の前に代入する（新しい読み込みが成功するまでは前のものを残す。メインの `SimulationClient.terrain` と同じ）。コメントに「04 でエンジンに渡す（loadTerrain と、significant の窪地を setDepressions）」

**テスト（`src/workers/terrainResult.test.ts`、先に書いて失敗を確かめる）:**
1. payload の elevation・validMask は retained.grid と中身が同じで、buffer は別
2. transfer は payload の elevation・validMask と analysis の flowDirection・fill・labels の buffer を含み、retained.grid の buffer を含まない
3. retained は requestId・width・height・cellSizeM・depressions を持つ
4. payload は geo をそのまま持ち、`meta` を持たない

`DemGrid.test.ts` の `grid.meta` の期待は、`width`・`height`・`cellSizeM` の直接の期待に直す。

- [ ] テストを書き、`pnpm vitest run src/workers/terrainResult.test.ts` で失敗を確かめる
- [ ] 実装し、テストの成功を確かめる
- [ ] ゲートと E2E
- [ ] コミット: `Worker が地形を保持し、標高とマスクの複製を送る（レビュー M1）。GridMeta を消す（L3）`

---

### Task 2: 対応範囲の判定とグリッドの大きさの上限（M2）

**Files:**
- Create: `src/dem/serviceArea.ts`、`src/dem/serviceArea.test.ts`
- Modify: `src/dem/gridRange.ts`、`src/dem/gridRange.test.ts`
- Modify: `src/shared/protocol.ts`、`src/workers/simulation.worker.ts`
- Modify: `src/state/urlState.ts`、`src/state/urlState.test.ts`
- Modify: `src/ui/strings.ts`、`src/ui/components/Panel.tsx`
- Modify: `tests/e2e/dem.spec.ts`

**要件:**
- URL から lat=90 を渡すと `computeGridRange` の N が約 6.8e18 になり、`tilesInPixelRect` の二重ループで Worker が同期的に固まる（lat=85 でも N = 4804）。地図は lat ±85.05 までパンできるので、クリックでも北の端の要求は届く。3 段で止める
- `src/dem/serviceArea.ts`（純粋な関数）:
  ```ts
  /** 対応範囲: 地理院の DEM が覆う日本（与那国島 122.9°E、南鳥島 154.0°E、沖ノ鳥島 20.4°N、北海道の北端 45.5°N を含む矩形） */
  export const SERVICE_AREA = { minLat: 20, maxLat: 46, minLon: 122, maxLon: 154 } as const
  export function inServiceArea(lon: number, lat: number): boolean
  ```
- `protocol.ts`: `TerrainFailureReason` に `'out-of-range'` を足す（コメント: 対応範囲（日本）の外）
- Worker の `loadTerrain`: 取得の前に `inServiceArea(message.lon, message.lat)` を判定し、外なら `terrainFailed`（reason `'out-of-range'`）を送って終わる（タイルを取得しない）
- `gridRange.ts`（最後の砦）: `export const MAX_GRID_SIZE = 4096`。`size` が上限を超える（または有限でない）なら `RangeError`（メッセージに N と緯度）。判定は `!(size <= MAX_GRID_SIZE)` の形にして NaN も止める。コメントに「1000m・DEM1A・北緯 46° でも N = 1206」。Worker はこれを既存の catch で `'internal'` にする（変更は要らない）
- `urlState.ts`: 緯度の範囲を Web Mercator の範囲 `±85.051129`（MapLibre が扱える緯度）に絞る。定数に名前を付ける。日本の範囲の外でも地図が扱える値なら地点として読み、Worker が `'out-of-range'` を返す（クリックと同じ扱い）
- `strings.errors['out-of-range']`: `'この地点は対応範囲（日本国内）の外です'`
- Panel: `'out-of-range'` は `'no-data'` と同じく severity `info` で、再試行のボタンを出さない

**テスト（先に書く）:**
- `serviceArea.test.ts`: 東京（139.77, 35.68）・与那国島（122.9981, 24.4677）・南鳥島（153.98, 24.28）・北海道の北端（141.94, 45.52）は true。（139, 60）・（139, 85）・（121, 35）・（155, 35）・（139, 19） は false
- `gridRange.test.ts`: `(139, 85, 500, 17)` と `(139, 90, 500, 17)` は `RangeError`。`(139, 46, 1000, 17)` の N は 1206
- `urlState.test.ts`: `?lat=90&lon=139` と `?lat=-86&lon=139` は `point: null`。`?lat=60&lon=139` と `?lat=85&lon=139` は地点になる
- `dem.spec.ts`（E2E）: `/?lat=60.000000&lon=139.000000` を開くと、`load-error` に `strings.errors['out-of-range']` が出て、範囲の枠は出ず（`data-range-shown` が付かない）、DEM の要求は 0 件（`routeGsi` の `counts.dem`）

- [ ] テストを書き、失敗を確かめる
- [ ] 実装し、成功を確かめる
- [ ] ゲート、E2E
- [ ] コミット: `対応範囲（日本）の外の地点は取得せずに知らせ、グリッドの大きさに上限を置く（レビュー M2）`

---

### Task 3: Worker の異常終了の後は、次の要求で起動し直す（P1、L9、L13）

**Files:**
- Modify: `src/bridge/SimulationClient.ts`、`src/bridge/SimulationClient.test.ts`
- Modify: `src/ui/terrainSession.ts`、`src/ui/App.tsx`、`src/main.tsx`

**要件（spec 02 §7「Worker の異常終了: エラーを表示し、Worker を起動し直す」）:**
- 今は `onError` が待っている要求を失敗させるだけで Worker を作り直さないため、その後の `loadTerrain` は止まった Worker に送られて loading のまま止まる
- `SimulationClient`:
  - `onError` は `stop(new TerrainLoadError('worker', 'Worker が異常終了しました'))`（受信をやめ、terminate し、待っている要求を失敗させる）をしてから `crashed = true` にする。コメント: 「'error' は Worker の未捕捉の例外でも発火し、Worker が止まったとは限らない。どちらも作り直しの契機にして扱いを決定的にする」
  - `ping` と `loadTerrain` は `private port(): WorkerPort` を通して送る。`crashed` なら `start()` で新しい Worker を作ってから送る。コメント: 「異常終了の後は、次の要求のときに起動し直す（spec 02 §7）。すぐに起動し直すと、スクリプトを読めない Worker（CSP で塞がれた場合など）で作り直しが止まらない」
  - `restart()`・`onCrash()`・`crashListeners` を消す（使う所が無くなる）
- `TerrainSession`:
  - コンストラクタの `client.onCrash(...)` を消す。異常終了してもストア（load・summary）は変えない。読み込み中なら、その要求の失敗（'worker'）が `load()` の catch で failed になる。表示中なら、メインは地形の複製（Task 1）を持つので、重ね描きもカーソル位置の標高もそのまま動く
  - `retry()` は、選んだ地点があれば選び直すだけにする。コメント: 「Worker が止まっていれば、SimulationClient が次の要求で起動し直す」
  - `store` を `readonly store: AppStore`（public）にする（L9）
- `App`: props から `store` を消し、`Panel` には `session.store` を渡す（L9）
- `main.tsx`: ストアを try の外で先に作り、try の中では `new SimulationClient()` → `new TerrainSession(client, store)` → `checkWorker(client)` の順にする（L13。TerrainSession の生成は代入だけなので、Worker の生成の後に例外は出ない）
- `data-worker-ready` は起動時の確認の結果のまま（spec 01 §4.4）。起動し直した後の ping はしない

**テスト（`SimulationClient.test.ts`。`onCrash`・`restart` のテストは置き換える。先に書く）:**
1. 異常終了で、待っている ping と読み込みを 'worker' で失敗させ、その Worker を terminate して受信をやめる（listeners と errorListeners が空）。ping のタイマーも残さない（偽のタイマーで `vi.getTimerCount()` が 0）
2. 異常終了しただけでは新しい Worker を作らない（Worker の factory の呼び出しが 1 回のまま）
3. 読み込み中の異常終了 → その読み込みは 'worker' で失敗 → もう一度 `loadTerrain` すると factory が 2 回目に呼ばれ、新しい Worker の `terrainLoaded` で解決する（画面の「再試行」の流れ）
4. 起動し直した Worker がまた異常終了しても、同じように扱う（次の ping は 3 つ目の Worker に送られる）
5. 作るたびにすぐ異常終了する Worker（factory の中で `queueMicrotask(() => worker.crash())`）: `loadTerrain` は速やかに 'worker' で失敗し、その後に要求が無ければ factory は呼ばれない（作り直しが回り続けない）

**E2E（`tests/e2e/dem.spec.ts` に足す）:** Worker のスクリプトを読めない場合。`pnpm build` の後に `dist/assets/` で simulation の Worker のファイル名を確かめ、その要求を `context.route()` で abort する。開くと `data-worker-ready="false"`、地図をクリックすると `load-error` に `strings.errors.worker` が出る。もう一度クリックしても同じ表示になり、ページのエラーで固まらない

- [ ] テストを書き、失敗を確かめる
- [ ] 実装し、成功を確かめる
- [ ] ゲート、E2E、バンドル
- [ ] コミット: `Worker の異常終了の後は、次の要求で起動し直す（レビュー P1）。App の props を session だけにする（L9）、main の生成の順（L13）`

---

### Task 4: DEM の取得の直し（P2、P7、L5、L4）

**Files:**
- Modify: `src/workers/demLoader.ts`
- Create: `src/workers/demLoader.test.ts`
- Modify: `src/dem/demSelection.ts`、`src/dem/demSelection.test.ts`

**要件:**
- P2: 今は `limit(() => retry(...))` なので、再試行の待ち（0.5〜2 秒）の間も同時数の枠を占める。`retry(() => limit(() => fetchOnce(...)), {...})` に入れ替える。`progress.onStart()` と `.finally(() => progress.onDone())` はタイルごとに 1 回のまま
- P7: 200 を受けた後の `response.blob()` の失敗（本文の読み込み中の切断）も、`signal.aborted` でなければ `NetworkError` で投げ直す（fetch() の失敗と同じ扱い）
- L5: OffscreenCanvas と 2D コンテキストを fetcher ごとに 1 つだけ作り、使い回す。最初に使うときに作る（Node のテストでは OffscreenCanvas が無いので、fetcher の生成時には作らない）。コメント: 「drawImage から getImageData までは await を挟まないので、同時に取得していても 1 枚を使い回せる」
- L4: `allSea` は 404 のタイルの海域判定を `Promise.all` で並べ、`every` で判定する（親タイルが複数でも同時数の制限の中で並列に取る。取得は `fetchReference` が使い回す）

**テスト（先に書く）:**
- `src/workers/demLoader.test.ts`（`vi.stubGlobal('fetch', ...)` と偽のタイマー。テストの後に `vi.unstubAllGlobals()` と `vi.useRealTimers()`）:
  1. 再試行の待ちの間は同時数の枠を空ける: 7 枚を同時に要求する。1 枚目は最初に 503 を返し、ほかの 6 枚は決して解決しない。1 枚目が再試行を待つ間（500ms より前）に、7 枚目の fetch が始まっている（fetch の呼び出しが 7 回）
  2. 本文の読み込みの失敗も再試行する: 1 回目は `{ status: 200, ok: true, blob: () => Promise.reject(new TypeError('network')) }`、2 回目は 404。結果は `{ status: 'missing' }` で、fetch は 2 回
- `demSelection.test.ts`:
  3. 404 のタイルの海域判定は、親タイル（z14）が複数あっても並べて取得する: z14 のタイルの境目にかかる地点で、段 1 のタイルがすべて 404 になる取得関数を使い、dem_png の要求が 2 つとも、どちらかが解決する前に始まることを確かめる

- [ ] テストを書き、失敗を確かめる（テスト 3 は、今の順の実装では 2 つ目が始まらないことで失敗する）
- [ ] 実装し、成功を確かめる
- [ ] ゲート、バンドル
- [ ] コミット: `DEM の取得: 再試行の待ちで同時数の枠を占めない（レビュー P2）、本文の失敗も再試行（P7）、canvas の使い回し（L5）、海域判定を並べる（L4）`

---

### Task 5: 窪地が表示対象かを窪地に持たせる（P6、L11、L8）

**Files:**
- Modify: `src/simulation/terrain/types.ts`、`analyzeDepressions.ts`（+ test）、`analyzeTerrain.ts`（+ test）、`testGrids.ts`
- Modify: `src/map/colormap.ts`（+ test）、`src/map/terrainFeatures.ts`（+ test）、`src/map/TerrainOverlay.ts`
- Modify: `src/state/appStore.ts`（+ test）

**要件:**
- `Depression` に `significant: boolean // 表示と越流イベントの対象（R02-3）` を足す
- `analyzeDepressions.ts`:
  - `export const DEPTH_TOLERANCE_M = 1e-3`。コメント: 「標高は Float32 で持つので、F − Z に絶対標高に応じた丸めの誤差が乗る（3.05 − 3.00 は 0.04999995、1000.05 − 1000.00 は 0.04998779）。DEM は 1cm 刻みなので、1mm の余裕なら隣の値と取り違えない」
  - `export function isSignificant(d: Pick<Depression, 'maxDepthM' | 'areaM2'>, criteria = SIGNIFICANT_DEPRESSION): boolean` は `d.maxDepthM >= criteria.minDepthM - DEPTH_TOLERANCE_M && d.areaM2 >= criteria.minAreaM2`
  - `analyzeDepressions(grid, criteria = SIGNIFICANT_DEPRESSION)` が各窪地の `significant` を埋める
  - `significantDepressions()` を消す
- `analyzeTerrain`: `significantIds` を消す
- `testGrids.ts`: `export function makeDepression(overrides: Partial<Depression> = {}): Depression`（既定値 `{ id: 1, pitIndex: 0, spillIndex: 1, spillElevation: 1, maxDepthM: 1, areaM2: 100, capacityM3: 1, cellCount: 1, significant: true }`）。`terrainFeatures.test.ts`・`appStore.test.ts`・`analyzeDepressions.test.ts` の 8 項目のリテラルをこれに置き換える
- `colormap.ts`:
  - `depressionRgba(fill, elevation, labels, depressions: TerrainPayload['depressions'])`（型は `src/shared/protocol` から import する。map は simulation を直接 import しない）。ラベル `label` の窪地は `depressions[label - 1]`（コメント: 「窪地の id は 1 から順（types.ts）」）で、`significant` でなければ塗らない
  - `depthBand` は `Math.floor((depthM + DEPTH_TOLERANCE_M) / DEPTH_BAND_M)`。`export const DEPTH_TOLERANCE_M = 1e-3` は colormap に独自に持ち、コメントで analyzeDepressions の同名の定数と揃えていることを書く（map は simulation を実行時に import しない。2 つが同じ値であることは `colormap.test.ts` が確かめる）
- `terrainFeatures.markerFeatures` と `appStore.summarizeTerrain` は `d.significant` で絞る。`TerrainOverlay` は `terrain.depressions` を渡す（`new Set(significantIds)` を消す）

**テスト（先に書く）:**
- `analyzeDepressions.test.ts`: 縁 3.05m・底 3.00m、セル 1.2m の 5×5（中の 3×3 が窪地、面積 12.96m²）で、窪地は `significant: true`（Float32 の差が 0.04999995 でも）。`isSignificant` の境界: `maxDepthM` 0.0499 は false、0.04999 は true、面積 9.99 は false
- `analyzeTerrain.test.ts`: `significantIds` の期待を `depressions.filter((d) => d.significant).map((d) => d.id)` に直す
- `colormap.test.ts`: `depthBand(Math.fround(3.05) - Math.fround(3.0))` は 1、`depthBand(0.049)` は 0。`depressionRgba` は significant でない窪地を塗らない。colormap の `DEPTH_TOLERANCE_M` は `src/simulation/terrain/analyzeDepressions.ts` の `DEPTH_TOLERANCE_M` と等しい（テストからの import は依存規則の対象外）
- `terrainFeatures.test.ts`・`appStore.test.ts`: `significantIds` を使っていたテストを `significant` で書き直す（期待する結果は同じ）

- [ ] テストを書き、失敗を確かめる
- [ ] 実装し、成功を確かめる
- [ ] ゲート、バンドル
- [ ] コミット: `窪地が表示対象かを Depression.significant に持たせる（レビュー P6）。ちょうど 5cm の窪地を Float32 の丸めで落とさない（L11）、makeDepression（L8）`

---

### Task 6: 画面と地図の小さな直し（P3、L1、L2、L6、L10、L12、P4）

**Files:**
- Modify: `src/state/appStore.ts`（+ test）
- Modify: `src/map/TerrainOverlay.ts`、`src/map/terrainFeatures.test.ts`
- Modify: `src/ui/terrainSession.ts`、`src/ui/components/Panel.tsx`、`src/ui/format.ts`
- Modify: `src/dem/demSources.ts`

**要件:**
- P3: `setCursor` は、今の値と kind が同じで（value なら meters も同じ）なら何もしない（`set((state) => (sameCursor(state.cursor, cursor) ? state : { cursor }))`。zustand は同じ state を返すと購読者に知らせない）。null どうしも同じとみなす
- L2: `export type LoadFailureReason = Exclude<TerrainErrorReason, 'superseded'>` を appStore に置き、`LoadState` の failed の reason と `setFailed` の引数をこれにする。`TerrainSession.load()` の catch は `const reason = error instanceof TerrainLoadError ? error.reason : 'internal'` を作り、`if (reason === 'superseded') return` の後に `setFailed(reason)`。Panel の `load.reason !== 'superseded'` を消す
- L1: `TerrainOverlay` に private `removeLayers()`（generation に触らず、レイヤー・ソース・`data-range-shown`・`this.terrain` を消す）を切り出す。`clearTerrain()` は `generation++` の後に `removeLayers()`。`showTerrain` の遅れた描画の中では `removeLayers()` を呼び、`this.generation = generation` の戻しを消す
- L12: `TerrainOverlay` は最新の表示の設定を `private display: OverlayDisplay` に覚える。`setDisplay` は地形が無くても覚え、地形があれば適用する。`showTerrain(terrain, display)` は受け取った display を覚え、遅れた描画は描く時点で覚えている display を使う（`flowSpacingM` は「描いた矢印の間隔」として別に持つ）
- L6: `demSources.ts` に `export const DEM_IDS = ['dem1a', 'dem5a', 'dem5b', 'dem5c', 'dem10b'] as const` を置き、`export type DemId = (typeof DEM_IDS)[number]` にする。`format.ts` の `DEM_ORDER` を消して `DEM_IDS` を使う（ui → dem の実行時の import は tech-spec §4.2 で許されている）
- L10: `TerrainSession.attach` で、URL に地点と z の両方があるときは、`map.jumpTo({ center: [lon, lat], zoom })` をしてから `select` する。コメント: 「読み込みの間も地点の周りを見せる。範囲が出たら fitBounds で合わせ直す」。地点だけ・z だけのときは今のまま
- P4: `terrainFeatures.test.ts` に、`src/simulation/terrain/neighbors.ts` の `NEIGHBOR_DX`・`NEIGHBOR_DY`（y は南が正）から求めた方位 `(atan2(dx, −dy) を度にしたもの + 360) % 360` が、方向の番号 k + 1 の矢印の bearing と一致することを、8 方向すべてについて確かめるテストを足す（`flowFeatures` を 1 セルずつ呼ぶ。テストからの import は依存規則の対象外）

**テスト（先に書く）:**
- `appStore.test.ts`: `subscribe` で知らせの回数を数える。同じ `{ kind: 'value', meters: 1 }` を 2 回 set すると 1 回、meters が違えば 2 回、`{ kind: 'outside' }` を 2 回で 1 回、null を 2 回で 0 回
- `terrainFeatures.test.ts`: 上の P4 のテスト
- TerrainOverlay・TerrainSession・Panel はユニットテストが無い（MapLibre と DOM）。E2E の「表示のスイッチと矢印の間隔を切り替えてもエラーが出ない」「URL」などが通ることで確かめる

- [ ] テストを書き、失敗を確かめる（P4 のテストは今の実装でも通る。念のため neighbors の順序を一時的に入れ替えて落ちることを確かめ、元に戻す）
- [ ] 実装し、成功を確かめる
- [ ] ゲート、E2E、バンドル
- [ ] コミット: `画面と地図: カーソル位置の標高を同じ値で書かない（レビュー P3）、重ね描きの消し方（L1）と表示の設定の保持（L12）、superseded を型から除く（L2）、DEM_IDS（L6）、URL の z（L10）、方位表のテスト（P4）`

---

### Task 7: 依存の図と規則（P8）、E2E の地理院の差し替え（L7）

**Files:**
- Modify: `specs/tech-spec.md`（§4.2）
- Modify: `.dependency-cruiser.mjs`
- Modify: `tests/e2e/smoke.spec.ts`

**要件:**
- P8: tech-spec §4.2 の「許可される依存方向」の図に、`map, state ─→ shared（型のみ）` と `state ─────→ dem（型のみ）` を足す（今のコードにある依存: `TerrainOverlay.ts`・`terrainFeatures.ts`・`colormap.ts` → `shared/protocol`、`appStore.ts` → `shared/protocol`・`dem/demSources`。いずれも型のみ）
- 規則 `map-types-only` を足す: `from: { path: '^src/map/', pathNot: '\\.test\\.ts$' }`、`to: { path: '^src/(simulation|shared)/', dependencyTypesNot: ['type-only'] }`。comment は「map から simulation・shared へは型だけを import する（テストは除く）」。tech-spec §4.2 の禁止ルールの表にも同じ行を足す
- 規則が働くことを確かめる: `src/map/terrainFeatures.ts` に一時的に `import { NEIGHBOR_DX } from '../simulation/terrain/neighbors'` と、それを使う行を足して `pnpm depcheck` が `map-types-only` で失敗することを確かめ、元に戻す（結果を報告に書く）
- L7: `smoke.spec.ts` の独自の `gsiTiles` の fixture をやめ、`tests/e2e/support/gsi.ts` の `routeGsi(context)` を auto の fixture から呼ぶ。地図タイルの件数は `counts.pale` を使う

**テスト:** 規則の確かめ（上）と、E2E の全件の成功

- [ ] tech-spec と規則を直し、一時的な違反で規則が働くことを確かめて戻す
- [ ] smoke.spec を直す
- [ ] ゲート、E2E
- [ ] コミット: `tech-spec §4.2 に map・state → shared と state → dem（型のみ）を足し、map-types-only の規則を置く（レビュー P8）。smoke の E2E も routeGsi を使う（L7）`
