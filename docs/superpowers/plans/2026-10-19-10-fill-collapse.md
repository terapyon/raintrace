# Spec 10 盛土が崩れたらどうなるか Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 09 の「標高差の大きい範囲」を選び、崩れたと仮定したときに土砂がどこに積もるかを Worker で計算し、せき止められた場所の溜まりうる水を出し、崩れる前と後の地形・水を切り替えて比べられるようにする。

**Architecture:** 土砂の計算（経路・到達・堆積・形を整える）とせき止めの判定は純粋な関数として `src/simulation/debris/` に置く。Worker は新しいメッセージ `collapse`（土砂の計算）、`swapTerrain`（エンジンの地形の差し替え）、`compareCollapse`（崩れる前と後を雨の終わりまで別のエンジンで計算）を受ける。メインでは `CollapseSession`（`src/ui/`）が流れをまとめ、崩れた後の地形を `simulation.terrainReady(…, { variant: true })` で既存の 2D・3D・水の表示に流す。

**Tech Stack:** TypeScript 6、React 19 + MUI 9、MapLibre GL 6.6、zustand 5、Vitest 4、Playwright 1.62。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-10-18-10-fill-collapse-design.md`（以下「spec」）。09 の spec `docs/superpowers/specs/2026-10-18-09-fill-history-design.md` の実装の上に積む。ブランチ `feat/10-fill-collapse`（`feat/09-fill-history` 996dc9d の上）。

## Global Constraints

- 画面の文字はすべて日本語。文字列は `src/ui/strings.ts`（例外はプリセットの表。下の行）
- 画面の言葉: 表題は「崩れたと仮定した場合」。「崩壊確率」「被害」「危険」を画面に出さない（spec 6.2）。候補は 09 と同じく「標高差の大きい範囲」と書く（spec 6.3）
- 注意書きは spec 6.2 の文をそのまま使う
- **クリーンルーム（R10-1）**: 土砂の計算は Wichmann 2017（GMD 10:3309）の論文の式と手順だけから書く。SAGA の GPP のソース（GPL）を読まない・写さない。実装者にもリンクを渡さない
- かさの係数は 1.0（`DEBRIS_BULKING = 1`、1 か所に置く。R10-3）
- 崩れる量は 1・0.5・0.25（既定 1。R10-7）。崩れる厚さ = 割合 × max(0, 09 の ΔZ補正)（候補のセルだけ）
- プリセットは `src/shared/debrisPresets.ts` の表 1 つ（id・画面の名前・説明・パラメータ）。表に行を足すだけで、画面の選択肢・計算・テストに入る（R10-4。tech-spec §9.4 の「文字列は strings.ts」の例外として、この表だけは名前と説明を持つ）
- 質量の保存: |崩れた土 − 積もった土 − 範囲外へ出た土| ≤ 1e-6 × 崩れた土（かさの係数 1 のとき）
- 同じ入力なら同じ結果（乱数は種を固定した決まった生成器）
- 比べる時刻は、崩れる前も後も「雨が降り終わった時点」（spec 5.2・5.3）
- 計算はすべてブラウザ（Worker）。サーバーで作らない・置かない
- 新しい依存を足さない。dependency-cruiser の規則（`core-is-pure`: `src/simulation/**` は `src/simulation/**` だけを import する）を守る
- 性能の目安（判定しない。超えたら記録して報告）: 土砂の計算は 1000 m・DEM1A で 10 秒以内
- 各タスクの終わりに `pnpm lint && pnpm typecheck && pnpm test` が通る（`pnpm depcheck` は Worker につなぐ Task 5 から通す）

## Review Focus

1. **崩れた後を表示中・計算中に、別の地点を選ぶ／盛土の履歴を切る／別の候補を選ぶ** → 崩れる前の地形に戻り、古い結果を描かない（Task 8 のテスト）
2. **崩れた後で普通の再生をしてから「崩れる前」に切り替える（またはその逆）** → 再生はリセットされ、別の地形の水が一瞬でも描かれない（terrainId を新しくする。Task 6 のテスト）
3. **比べる計算の途中で中止する・別の地点を選ぶ** → Worker が止まり、結果も進み具合も届かない（Task 7 のテスト）
4. **範囲の端の候補** → 土砂の一部が範囲の外へ出て、その量を知らせ、質量の保存が成り立つ（Task 2 のテスト）
5. **せき止めが起きない（平らな土地・小さな量）** → 「せき止められた場所はありません」と出て、比べる計算は普通にできる（Task 4・Task 10 のテスト）

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/shared/debrisPresets.ts` | プリセットの表（Task 1） |
| `src/simulation/debris/random.ts`・`runout.ts` | 決まった乱数、粒の経路・到達・堆積（Task 2） |
| `src/simulation/debris/settle.ts`・`simulateCollapse.ts` | 形を整える、全体のまとめ（Task 3） |
| `src/simulation/debris/dams.ts` | せき止められた場所（Task 4） |
| `src/dem/fillHistory/removedThickness.ts` | 崩れる厚さ（Task 5） |
| `src/shared/protocol.ts`・`src/workers/collapse.ts`・`simulation.worker.ts` | `collapse` メッセージ（Task 5） |
| `src/workers/simulationRunner.ts`・`src/bridge/SimulationClient.ts`・`src/ui/simulationSession.ts`・`src/ui/fillHistorySession.ts` | 地形の差し替え（Task 6） |
| `src/workers/compareRun.ts` | 崩れる前と後の比べる計算（Task 7） |
| `src/state/appStore.ts`・`src/ui/collapseSession.ts` | 状態と流れ（Task 8） |
| `src/map/CollapseOverlay.ts`・`src/map/collapseColormap.ts`・`src/map/layerIds.ts` | 地図（Task 9） |
| `src/ui/components/CollapseSection.tsx`・`ScenarioToggle.tsx`・`FillHistorySection.tsx` | 画面（Task 10） |
| `src/ui/view3dSession.ts` ほか | 3D との整合（Task 11） |
| `tests/e2e/collapse.spec.ts` | E2E（Task 12） |
| `scripts/collapse-check.ts`・`docs/perf/2026-10-19-fill-collapse.md` | 実際の場所での確かめ・プリセットの値（Task 13） |
| 文書 | overview・tech-spec・spec（Task 14） |

---

### Task 1: プリセットの表

**Files:**
- Create: `src/shared/debrisPresets.ts`
- Test: `src/shared/debrisPresets.test.ts`

**Interfaces:**
- Produces:

```ts
export interface DebrisParams {
  /** PCM の摩擦係数 μ（論文の推奨 0.04〜0.8） */
  mu: number
  /** PCM の質量と抗力の比 M/D（m。推奨 20〜150） */
  massToDragM: number
  /** ランダムウォークの発散の指数（推奨 1.3〜3.0） */
  divergence: number
  /** 同じ向きに進み続ける重み（推奨 1.5〜2.0） */
  persistence: number
  /** 積もった土の斜面の限界の角度（度） */
  reposeDeg: number
}
export interface DebrisPreset { id: string; label: string; description: string; params: DebrisParams }
export const DEBRIS_PRESETS: readonly DebrisPreset[]
export const DEFAULT_DEBRIS_PRESET_ID: string
export function debrisPreset(id: string): DebrisPreset   // 無い id は既定のプリセット
```

- 初期の行（値は Task 13 で見直す）:
  - `{ id: 'near', label: '近くで止まる', description: '崩れた土がすぐ下の谷や川をふさぐ（酒々井の例）', params: { mu: 0.6, massToDragM: 20, divergence: 2, persistence: 1.5, reposeDeg: 30 } }`（既定）
  - `{ id: 'far', label: '遠くまで流れる', description: '水を含んだ土が谷を流れ下る（熱海の例）', params: { mu: 0.12, massToDragM: 100, divergence: 1.3, persistence: 2, reposeDeg: 8.5 } }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('id は重複しない。既定の id は表にある', () => {})
it('どの行もパラメータが論文の推奨の幅の中（μ 0.04〜0.8、M/D 20〜150、発散 1.3〜3.0、持続 1.5〜2.0、限界の角度 0〜45）', () => {})
it('無い id は既定のプリセットを返す', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 土砂の流れやすさのプリセットの表`

---

### Task 2: 粒の経路・到達・堆積（論文の PCM）

spec 3.2 の部品 1〜3。**論文だけから書く**（Global Constraints）。

**Files:**
- Create: `src/simulation/debris/random.ts`、`src/simulation/debris/runout.ts`、`src/simulation/debris/constants.ts`
- Test: `src/simulation/debris/runout.test.ts`

**Interfaces:**
- Consumes: `DebrisParams`（型だけ。`src/shared` から simulation へは import できないので、**同じ形の `DebrisParams` を `src/simulation/debris/runout.ts` に定義し、shared の型は構造的に代入できるようにする**）
- Produces:

```ts
// random.ts
export function createRandom(seed: number): () => number   // [0, 1)。mulberry32
// constants.ts
export const DEBRIS_BULKING = 1
export const PARTICLES_PER_CELL = 4
export const DEBRIS_SEED = 20261019
export const GRAVITY = 9.81
// runout.ts
export interface DebrisGrid { elevation: Float32Array; validMask: Uint8Array; size: number; cellSizeM: number }
export interface RunoutResult {
  deposit: Float32Array      // 積もった厚さ（m）
  collapsedM3: number
  depositedM3: number
  outsideM3: number          // 範囲の外・無効なセルへ出た量
}
export function runout(grid: DebrisGrid, removed: Float32Array, params: DebrisParams, seed: number): RunoutResult
```

- 手順（論文の 4 つの部品のうち 1〜3）:
  1. 崩れた跡の地形 = `elevation − removed`。土砂の通り道の高さは「崩れた跡 + それまでに積もった厚さ」（後の粒は先の粒が積もった上を通る。これがせき止めを作る）
  2. `removed > 0` のセルごとに `PARTICLES_PER_CELL` 個の粒を出す。1 粒の体積 = `removed × cellSizeM² × DEBRIS_BULKING / PARTICLES_PER_CELL`。粒は行・列の順（決まった順）に流す
  3. 経路: 8 近傍のうち今の高さより低いセルを、重み `tanβ^divergence`（前と同じ向きなら × `persistence`）の確率で選ぶ（`createRandom(seed)` を 1 つだけ使い回す）。低い近傍が無ければ止まる
  4. 到達（PCM）: 1 歩の長さ L（隣は cellSizeM、斜めは √2·cellSizeM）、傾き θ。`α = g(sinθ − μ cosθ)`、`β = −2L / (M/D)`、`v² = α·(M/D)·(1 − e^β) + v_prev²·e^β`。`v² ≤ 0` なら止まる（最初の v は 0）
  5. 範囲の外・無効なセルへ進んだら、その粒は `outsideM3` に数える
  6. 止まったセルに体積 ÷ cellSizeM² の厚さを積む。1 粒が進める歩数の上限は `4 × size`（超えたらそこで止まる）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('createRandom: 同じ種なら同じ列、[0, 1) に収まる', () => {})
it('質量の保存: 崩れた土 = 積もった土 + 範囲外（1e-6 の相対誤差）', () => {})
it('同じ入力・同じ種なら deposit が一致する', () => {})
it('平らな面では崩れたセル（とその周り）にだけ積もる', () => {})
it('東へ一様に下る斜面では、崩れた場所より東（下流）にだけ積もる', () => {})
it('範囲の東端の近くの候補では、一部が範囲の外へ出て outsideM3 > 0（Review Focus 4）', () => {})
it('μ を小さく・M/D を大きくすると、到達距離（崩れた場所から積もった重心までの距離）が長くなる', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 土砂の粒の経路・到達・堆積（Wichmann 2017 の PCM を論文から実装）`

---

### Task 3: 形を整えて、崩れた後の地形を作る

spec 3.2 の部品 4 と R10-2（ダムができることを許す）。

**Files:**
- Create: `src/simulation/debris/settle.ts`、`src/simulation/debris/simulateCollapse.ts`
- Test: `src/simulation/debris/settle.test.ts`、`src/simulation/debris/simulateCollapse.test.ts`

**Interfaces:**
- Consumes: `runout`・`DebrisGrid`・`RunoutResult`（Task 2）
- Produces:

```ts
// settle.ts — 積もった土だけを動かす（地山は削らない）。質量を保存する
export function settleDeposit(base: Float32Array, deposit: Float32Array, validMask: Uint8Array, size: number, cellSizeM: number, reposeDeg: number): void
// simulateCollapse.ts
export interface CollapseResult extends RunoutResult {
  removed: Float32Array      // 崩れた厚さ
  after: Float32Array        // 崩れた後の地形 = elevation − removed + deposit
}
export function simulateCollapse(grid: DebrisGrid, removed: Float32Array, params: DebrisParams, seed?: number): CollapseResult
```

- `settleDeposit`: 4 近傍で、高さ（base + deposit）の差が `tan(reposeDeg) × cellSizeM` を超える組から、超えた分の半分（ただし高い側の deposit を上限）を低い側へ移す。変化が 1e-4 m 未満になるか 200 回で止める。無効なセルへは移さない

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('settleDeposit: 積んだ土の斜面は限界の角度を超えない（許容 1e-3）', () => {})
it('settleDeposit: deposit の合計は変わらない、地山（base）は削らない', () => {})
it('【P1】V 字の谷の片側の斜面の上に盛土を置いて全部崩す → 谷底に積もり、analyzeDepressions で上流側に capacityM3 > 0 の窪地ができる（near のプリセット）', () => {
  // 谷: 南北に下る谷筋、東西の斜面 30°。盛土は谷の上流寄りの東の斜面
})
it('すべてのプリセット（DEBRIS_PRESETS のパラメータを写した表）で質量の保存と決まった結果', () => {})
it('after = elevation − removed + deposit', () => {})
```

  プリセットの値を simulation のテストで使うため、テストの中で `src/shared/debrisPresets.ts` を import してよい（テストは `core-is-pure` の対象外）

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**。【P1】が通らない場合は止めて報告する（spec 8 の P1。方式の見直しはユーザーに相談）
- [ ] **Step 5: コミット** — `spec 10: 積もった土の形を整え、崩れた後の地形を作る（せき止めを許す）`

---

### Task 4: せき止められた場所

spec 4。

**Files:**
- Create: `src/simulation/debris/dams.ts`
- Test: `src/simulation/debris/dams.test.ts`

**Interfaces:**
- Consumes: `analyzeDepressions`（`src/simulation/terrain/analyzeDepressions.ts`）、`Depression`
- Produces:

```ts
export interface DammedSite {
  depressionId: number       // 崩れた後の解析の窪地の id
  capacityM3: number
  addedCapacityM3: number    // 崩れる前の同じセルの満水の量より増えた分
  maxDepthM: number
  areaM2: number
  spillElevation: number
  pitIndex: number
  spillIndex: number
}
export function findDammedSites(
  before: { fill: Float32Array; elevation: Float32Array },
  after: { fill: Float32Array; elevation: Float32Array; labels: Int32Array; depressions: readonly Depression[] },
  deposit: Float32Array, size: number, cellSizeM: number,
): DammedSite[]
```

- 判定: 崩れた後の `significant` な窪地のうち、(a) 窪地のセルか、その 4 近傍に `deposit > 0.01` のセルがある、かつ (b) `addedCapacityM3 = capacityM3 − Σ max(0, before.fill − before.elevation) × セルの面積（同じセル）` が `max(10, 0.1 × capacityM3)` を超えるもの。`capacityM3` の大きい順

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('Task 3 の V 字谷で、上流の窪地が 1 つせき止められた場所になる', () => {})
it('もともとあった窪地に土が少し入っただけ（容量が増えない）なら、せき止めにしない', () => {})
it('平らな土地・崩れる量が小さいと、空の配列（Review Focus 5）', () => {})
it('容量の大きい順', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 崩れた後にできた窪地から、せき止められた場所を見つける`

---

### Task 5: Worker で土砂の計算をする

**Files:**
- Create: `src/dem/fillHistory/removedThickness.ts`（Test 同名）
- Modify: `src/shared/protocol.ts`
- Create: `src/workers/collapse.ts`（Test 同名）
- Modify: `src/workers/simulation.worker.ts`

**Interfaces:**
- Produces:

```ts
// src/dem/fillHistory/removedThickness.ts
export function removedThickness(delta: Float32Array, labels: Int32Array, candidateId: number, ratio: number): Float32Array
// ratio × max(0, delta)。候補のセル以外・NaN は 0

// protocol.ts
export type CollapseRatio = 1 | 0.5 | 0.25
export interface DammedSiteSummary { depressionId: number; capacityM3: number; addedCapacityM3: number; maxDepthM: number; areaM2: number; spillElevation: number; spill: { lon: number; lat: number } }
export interface CollapsePayload {
  terrainId: number          // 崩れる前の地形の id
  candidateId: number
  ratio: CollapseRatio
  presetId: string
  after: TerrainPayload      // 崩れた後の地形（解析・流出の縁・geo は崩れる前と同じ geo）
  removed: Float32Array
  deposit: Float32Array
  collapsedM3: number; depositedM3: number; outsideM3: number
  dams: DammedSiteSummary[]
}
// MainToWorkerMessage
| { type: 'collapse'; requestId: number; terrainId: number; geo: TerrainGeo; elevation: Float32Array; validMask: Uint8Array; removed: Float32Array; candidateId: number; ratio: CollapseRatio; presetId: string }
// WorkerToMainMessage
| { type: 'collapseProgress'; requestId: number; fraction: number }
| { type: 'collapseReady'; requestId: number; result: CollapsePayload }
| { type: 'collapseFailed'; requestId: number; message: string }
```

- `src/workers/collapse.ts`: `export function computeCollapse(input): CollapsePayload` — `simulateCollapse`（プリセットは `debrisPreset(presetId).params`）→ 崩れた後の格子で `analyzeTerrain`・`buildOutflowCells`・`packTerrain` 相当（`after.geo` は入力の geo）→ 崩れる前の `analyzeDepressions` → `findDammedSites` → あふれ出し点の経緯度。進み具合は粒の処理の割合で `collapseProgress` を最大 10 回送る
- Worker: `collapse` は前の `collapse`・`loadTerrain` で取り消す（09 の `fillHistory` と同じ形）。配列は Transferable
- この Task で `pnpm depcheck` を通す（`src/simulation/debris/*` が Worker から届く）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('removedThickness: 候補のセルだけ ratio × max(0, delta)、負と NaN は 0', () => {})
it('computeCollapse: V 字谷で dams が 1 つ、after.depressions にその窪地がある、質量の保存', () => {})
it('computeCollapse: after.elevation = elevation − removed + deposit、after.geo は入力の geo', () => {})
it('computeCollapse: 無い presetId は既定のプリセットで計算する', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**（`pnpm depcheck` も）
- [ ] **Step 5: コミット** — `spec 10: Worker で崩れた後の地形とせき止められた場所を計算する`

---

### Task 6: エンジンの地形を差し替える

spec 5.2。崩れる前と後を切り替えるたびに、エンジンの地形を差し替え、再生をリセットする。

**Files:**
- Modify: `src/shared/protocol.ts`、`src/workers/simulation.worker.ts`、`src/workers/simulationRunner.ts`
- Modify: `src/bridge/SimulationClient.ts`、`src/ui/simulationSession.ts`、`src/ui/fillHistorySession.ts`、`src/ui/view3dSession.ts`
- Test: `src/bridge/SimulationClient.test.ts`、`src/ui/simulationSession.test.ts`、`src/ui/fillHistorySession.test.ts`、`src/workers/simulationRunner.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SwapGrid { elevation: Float32Array; validMask: Uint8Array; size: number; cellSizeM: number; depressions: Depression[] }
// MainToWorkerMessage
| ({ type: 'swapTerrain'; requestId: number } & SwapGrid)
// WorkerToMainMessage
| { type: 'terrainSwapped'; requestId: number }
// SimulationClient
swapTerrain(terrain: TerrainPayload): Promise<void>   // 成功で this.terrain = terrain、this.terrainId = requestId、this.water = null
// SimulationSession
terrainReady(terrain: TerrainPayload, center: { lon: number; lat: number }, options?: { variant?: boolean }): void
onTerrain(listener: (terrain: TerrainPayload | null, info: { variant: boolean }) => void): () => void
```

- Worker の `swapTerrain` は `runner.loadTerrain(requestId, grid, depressions)` を呼び、`terrainSwapped` を返す（タイルは読まない）。読み込み中の `loadTerrain` があれば、差し替えはそれに負ける（`loadTerrain` が後から来たら差し替えは捨てる）
- `variant: true` の通知では、`FillHistorySession` は結果を捨てず計算し直さない。`View3dSession` は今までどおり `setTerrain` する（崩れた後の地形と水を描く）
- 差し替えのたびに terrainId が新しくなるので、古い地形の frame は `receiveFrame` で捨てられる

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('SimulationClient.swapTerrain: 成功で terrain と terrainId が変わり、古い terrainId の frame を捨てる（Review Focus 2）', async () => {})
it('SimulationRunner: swapTerrain の後は ZERO_STATS で、start は新しい地形で動く', () => {})
it('SimulationSession: variant の terrainReady で再生の状態がリセットされ、onTerrain に variant: true が届く', () => {})
it('FillHistorySession: variant の通知では結果を保ち、request しない', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 崩れる前と後でエンジンの地形を差し替える`

---

### Task 7: 崩れる前と後を、雨が降り終わるまで比べる

spec 5.2 の「任意で比べる」・5.3。

**Files:**
- Create: `src/workers/compareRun.ts`（Test 同名）
- Modify: `src/shared/protocol.ts`、`src/workers/simulation.worker.ts`、`src/bridge/SimulationClient.ts`（Test）

**Interfaces:**
- Produces:

```ts
export interface CompareSide { depth: Float32Array; stats: StepStats }
// MainToWorkerMessage
| { type: 'compareCollapse'; requestId: number; before: SwapGrid; after: SwapGrid; rain: RainfallInput }
| { type: 'cancelCompare'; requestId: number }
// SwapGrid は Task 6 の型
// WorkerToMainMessage
| { type: 'compareProgress'; requestId: number; side: 'before' | 'after'; fraction: number; remainingS: number | null }
| { type: 'compareReady'; requestId: number; before: CompareSide; after: CompareSide }
| { type: 'compareFailed'; requestId: number; reason: 'cancelled' | 'internal'; message: string }
// SimulationClient
compareCollapse(before: TerrainPayload, after: TerrainPayload, rain: RainfallInput, onProgress: (p) => void): Promise<{ before: CompareSide; after: CompareSide }>
cancelCompare(): void
```

- `compareRun.ts`: `export async function runToRainEnd(grid: SwapGrid, rain: RainfallInput, signal: AbortSignal, onProgress): Promise<CompareSide>` — 再生用とは別の `TsSimulationEngine` を作り、`loadTerrain`・`setDepressions`・`setRainfall` の後、`stats.raining === false` になった最初の step で止める（その step で `timeS` は雨の終わりちょうど。scripts/bench-engine.ts:70 と同じ判定）。約 50 ms ごとに `setTimeout(0)` で譲り、`signal` を見る。`fraction = timeS / durationS`、`remainingS` は直近の進み方からの見込み
- 崩れる前を計算し、次に崩れた後を計算する（エンジンは 1 つずつ。spec 8 の P4）。再生用のエンジン（`runner`）には触らない
- `cancelCompare`・`loadTerrain`・新しい `compareCollapse` で取り消す。取り消したら結果も進み具合も送らない

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('runToRainEnd: 止まった時点の stats.timeS が雨の継続時間に等しく、raining は false', async () => {})
it('runToRainEnd: 質量の保存（雨 = 溜まった水 + 流出。spec 7.1 の回帰）', async () => {})
it('runToRainEnd: signal を取り消すと途中で reject し、進み具合も止まる（Review Focus 3）', async () => {})
it('SimulationClient.compareCollapse: 古い requestId の compareProgress・compareReady を捨てる', async () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 崩れる前と後を、雨が降り終わる時点まで別のエンジンで計算する`

---

### Task 8: 状態と流れ（CollapseSession）

**Files:**
- Modify: `src/state/appStore.ts`（Test）
- Create: `src/ui/collapseSession.ts`（Test）
- Modify: `src/ui/terrainSession.ts`（`readonly collapse: CollapseSession`）

**Interfaces:**
- Produces（appStore）:

```ts
export interface CollapseSummary {
  candidateId: number; ratio: CollapseRatio; presetId: string
  collapsedM3: number; depositedM3: number; outsideM3: number
  dams: DammedSiteSummary[]
}
export interface CompareSummary {
  before: Pick<StepStats, 'maxDepth' | 'floodedArea' | 'storedWater' | 'outflowWater'>
  after: Pick<StepStats, 'maxDepth' | 'floodedArea' | 'storedWater' | 'outflowWater'>
  damMaxDepthM: number | null      // せき止められた場所のセルの、崩れた後の水深の最大
  newWaterAreaM2: number           // 崩れた後は 1 cm 以上・前は 1 cm 未満の面積
}
collapse: {
  candidateId: number | null       // 「崩れたと仮定する」を押した候補。null は閉じている
  ratio: CollapseRatio; presetId: string
  status: 'idle' | 'computing' | 'ready' | 'failed'
  progress: number
  summary: CollapseSummary | null
  view: 'before' | 'after'
  compare: { status: 'idle' | 'running' | 'done' | 'failed'; side: 'before' | 'after' | null; progress: number; remainingS: number | null; summary: CompareSummary | null }
}
// actions
openCollapse(candidateId: number): void       // ratio 1、presetId 既定、status idle、view before、compare idle
closeCollapse(): void
setCollapseRatio(ratio: CollapseRatio): void  // 結果があれば捨てる（idle に戻る）
setCollapsePreset(presetId: string): void     // 同上
```

  `selectPoint`・`setFillHistoryEnabled(false)`・`selectFillCandidate`（別の id）は `collapse` を閉じた状態に戻す

- Produces（CollapseSession）: `constructor(client, app, simulation, fillHistory)`、`compute(): Promise<void>`、`setView(view: 'before' | 'after'): Promise<void>`、`compare(): Promise<void>`、`cancelCompare(): void`、`result(): CollapsePayload | null`、`compareResult(): { before: CompareSide; after: CompareSide } | null`、`onChange(listener): () => void`
  - `compute`: 09 の結果の `deltaCorrected`・`candidateLabels` から `removedThickness`、`client.collapse(...)`。結果の `terrainId` が今の基の地形でなければ捨てる
  - `setView('after')`: `client.swapTerrain(result.after)` → `simulation.terrainReady(result.after, center, { variant: true })`、`terrainEpoch` を 'now' に。`setView('before')` は基の地形で同じことをする
  - 閉じる・地点を変える・候補を変える・盛土の履歴を切る: 比べる計算を取り消し、`view` が 'after' なら基の地形に戻す（Review Focus 1）
  - 地図の要素（`map.getContainer()`）に `data-collapse-view="before|after"` を書く（E2E が読む）
  - `compare`: 基の地形と `result.after` と、今の雨の設定（`SimulationSession.start` と同じ変換で `RainfallInput` を作る関数を共有する）で `client.compareCollapse`。結果から `CompareSummary` を作る（`damMaxDepthM` は `after.labels` が dams の id のセル）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('openCollapse → compute で computing → ready、summary に体積と dams', async () => {})
it('計算中に別の地点を選ぶと、結果を捨てて閉じる（Review Focus 1）', async () => {})
it('崩れた後を表示中に盛土の履歴を切ると、基の地形に戻す（swapTerrain が基の地形で呼ばれる）', async () => {})
it('setCollapseRatio で結果を捨てて idle に戻り、view も before に戻す', async () => {})
it('compare の途中で cancelCompare → compare.status は idle、summary は null', async () => {})
it('CompareSummary: newWaterAreaM2 と damMaxDepthM を深さの配列から正しく出す', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 崩れたと仮定した場合の状態と流れ`

---

### Task 9: 地図に描く

spec 4・5.3・5.4。

**Files:**
- Create: `src/map/collapseColormap.ts`、`src/map/CollapseOverlay.ts`（Test 各）
- Modify: `src/map/layerIds.ts`、`src/map/MapController.ts`（`data-overlay-layers` の一覧）、`src/ui/terrainSession.ts`（attach・onRestyle）

**Interfaces:**
- Produces: `COLLAPSE_LAYER_IDS = { deposit: 'collapse-deposit', dams: 'collapse-dams', newWater: 'collapse-new-water' } as const`。`OVERLAY_LAYER_ORDER` で `deposit` は `fill-a54` の直後、`dams` はその後、`newWater` は `WATER_LAYER_IDS.outflow` の直後
- `collapseDepositRgba(deposit, removed, size): Uint8ClampedArray` — 積もった厚さ 0.01 m 以上は茶色（厚いほど濃い、5 m で最大）、崩れた跡（removed > 0）は灰の斜線風（偶奇の市松で薄い灰）
- `newWaterRgba(before, after, size): Uint8ClampedArray` — 崩れた後 ≥ 0.01 m かつ前 < 0.01 m は濃い青紫
- `CollapseOverlay`: `show(result, geo)`、`showCompare(before, after, geo)`、`clear()`、`restore()`（09 の `FillHistoryOverlay` と同じ作り。dams は GeoJSON の点（あふれ出し点）と、せき止められた窪地の輪郭を canvas で）
- 表示するのは `collapse.view === 'after'` のときだけ（崩れる前の表示では消す）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('collapseDepositRgba: 0.009 m は透明、0.01 m は茶、崩れた跡は灰', () => {})
it('newWaterRgba: 前 0.009・後 0.01 は色、前 0.01・後 0.02 は透明', () => {})
it('OVERLAY_LAYER_ORDER の位置', () => {})
it('CollapseOverlay.restore で 3 つのレイヤーを足し直す（ベースマップの切り替え）', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 積もった土・せき止められた場所・新しく溜まった水を地図に重ねる`

---

### Task 10: 画面

spec 1.3・5.2・5.3・6.1・6.2。

**Files:**
- Modify: `src/ui/strings.ts`（`collapse` の項）
- Create: `src/ui/components/CollapseSection.tsx`、`src/ui/components/ScenarioToggle.tsx`（Test 各）
- Modify: `src/ui/components/FillHistorySection.tsx`（`CandidateDetail` の最後に「崩れたと仮定する」のボタン。`FillHistorySection.tsx:32` のコメントの場所）、`src/ui/components/Panel.tsx`、`src/ui/App.tsx`、`src/ui/format.ts`

**Interfaces:**
- `CollapseSection`（`collapse.candidateId !== null` のとき、盛土の履歴の区切りの直後に出す）: spec 6.1 の並び
  - 表題 `title: '崩れたと仮定した場合'`、対象の行 `target: (id, volume, evidence) => …`（09 の言葉）
  - 崩れる量 `ratio: '崩れる量'`、`ratios: { 1: '全部', 0.5: '半分', 0.25: '4分の1' }`
  - 流れやすさ `preset: '流れやすさ'`。選択肢は `DEBRIS_PRESETS` の `label` を並べ、`description` をツールチップに
  - ボタン `compute: '土砂の行き先を計算する'`、計算中 `computing: '土砂の行き先を計算しています'`（進み具合のバー）
  - 結果: `collapsed: '崩れた土'`、`deposited: '積もった土'`、`outside: (v) => \`（範囲の外へ ${v}）\``、`outsideNotice: (v) => \`土砂の一部（${v}）が範囲の外へ流れ出ました\``（outsideM3 > 0 のとき）
  - せき止め: `dams: (n, v) => \`せき止められた場所: ${n} か所（溜まりうる水 ${v}）\``、`noDams: 'せき止められた場所はありません'`。各場所の行に、溜まりうる水・最大の深さ・あふれ出す高さ・面積
  - 比べる: ボタン `compare: '崩れる前と後を比べる'`、`compareHint: '今の雨の設定で、雨が降り終わる時点まで両方を計算します'`。重い設定（範囲全体の雨、または範囲 1000 m）では押す前に `compareSlow: '範囲や雨の設定によっては、数分以上かかります'` を出す。計算中は `compareRunning: (side, remaining) => …`（「崩れる前を計算しています（残り約 3 分）」）と中止 `cancel: '中止'`
  - 比べた結果: spec 5.3 の表（最大の水深・湛水面積・溜まった水の量・流れ出た水の量 × 前・後・差、せき止められた場所の水深の最大）、`newWater: (a) => \`新しく水が溜まった範囲 +${a}\``、`compareAt: '雨が降り終わった時点で比べています'`
  - 注意書き `notice`: spec 6.2 の文をそのまま
- `ScenarioToggle`（地図の左上。`ViewModeToggle` と `TerrainEpochToggle` の下 top 112。`collapse.status === 'ready'` のときだけ）: 「崩れる前｜崩れた後」→ `session.collapse.setView`
- `TerrainEpochToggle` は `collapse.view === 'after'` の間は隠す
- 体積は 09 の `formatVolumeApprox`、面積・深さは既存の書式

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('候補の詳しい欄の「崩れたと仮定する」で openCollapse(id)、CollapseSection が出る', async () => {})
it('崩れる量・流れやすさの選択肢は DEBRIS_PRESETS の行の数だけ出る（行を足せば増える）', () => {})
it('ready で崩れた土・積もった土・せき止めの行が出る。outsideM3 > 0 で範囲の外の知らせ', () => {})
it('dams が空なら「せき止められた場所はありません」（Review Focus 5）', () => {})
it('比べる計算中は進み具合と中止、done で比べた表と「雨が降り終わった時点で比べています」', () => {})
it('画面の文字に「崩壊確率」「被害」「危険」を含まない（注意書きを除いても除かなくても）', () => {})
it('ScenarioToggle は ready のときだけ出て、押すと setView', async () => {})
```

  注意書きの文に「危険」は含まれない（spec 6.2）ので、全体で検査してよい

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 崩れたと仮定した場合のパネルと、崩れる前と後の切り替え`

---

### Task 11: 3D との整合

spec 5.4。崩れた後の地形は Task 6 の `variant` の `setTerrain` で 3D に出る。ここでは 09 の「昔｜今」との組み合わせを固める。

**Files:**
- Modify: `src/ui/view3dSession.ts`、`src/state/appStore.ts`（Test 各）

- `View3d` は範囲の地形を作り直すたびに、地図の要素に `data-view3d-range-generation` を 1 増やして書く（E2E が読む）
- 崩れた後を表示中は `terrainEpoch` を 'now' に固定する（`setTerrainEpoch('past')` を受けない）
- 「昔」を表示中に「崩れた後」へ切り替えると、'now' に戻してから差し替える

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('view が after の間は setTerrainEpoch("past") を無視する', () => {})
it('昔を表示中に崩れた後へ切り替えると、setPastElevation(null) の後に setTerrain(after) が届く', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 10: 3D で崩れた後の地形と、昔・今の切り替えを両立させる`

---

### Task 12: E2E

spec 7.2。09 の E2E（`tests/e2e/fillHistory.spec.ts` と `tests/e2e/support/gsi.ts` の `encodeDemPng`）を土台にする。

**Files:**
- Create: `tests/e2e/collapse.spec.ts`

- 地形: 南北の谷（中央の列が低い）と、谷の上流側の東の斜面に台（今の地形だけ +15 m）。昔の地形は台なし
- [ ] **Step 1: テストを書く**

```ts
test('候補を選び「崩れたと仮定する」→ 計算 → 崩れた土・積もった土・せき止めの行が出る', async () => {})
test('「崩れる前｜崩れた後」で、data-collapse-view が変わり、collapse-deposit のレイヤーが出たり消えたりする', async () => {})
test('「崩れる前と後を比べる」→ 比べた表が出る（雨は短く・半径を小さく）。途中で中止もできる', async () => {})
test('崩れた後を表示中に別の地点を選ぶと、閉じて崩れる前の地形に戻る', async () => {})
test('@3d 3D で崩れた後に切り替えると、data-view3d-range-generation が進む（3D の地形が作り直される）', async () => {})
```

- [ ] **Step 2: 走らせる** — `pnpm build && pnpm exec playwright test --project=chromium --project=chromium-3d tests/e2e/collapse.spec.ts --repeat-each=3`
- [ ] **Step 3: 全体** — `pnpm exec playwright test --project=chromium --project=chromium-3d`（既存を含めてすべて PASS）
- [ ] **Step 4: コミット** — `spec 10: 崩れたと仮定した場合の E2E`

---

### Task 13: 実際の場所での確かめと、プリセットの値

spec 3.3・7.3・8（P2〜P4）。合否はユーザーが見て決める。

**Files:**
- Create: `scripts/collapse-check.ts`（`node scripts/collapse-check.ts <lat> <lon> <sizeM> <candidateRank> <presetId> [ratio]`。09 の `scripts/fill-history-check.ts` の取得の部分を使い回し、`simulateCollapse`・`findDammedSites`・`runToRainEnd` 相当を Node で回す）
- Create: `docs/perf/2026-10-19-fill-collapse.md`
- Modify: `src/shared/debrisPresets.ts`（値を見直す場合）

- [ ] **Step 1: 酒々井・馬橋（35.7086, 140.2634、500 m と 1000 m）で `near`・全部** — 積もった場所、せき止めの数と溜まりうる水、計算時間。雨は 60 mm/h × 360 分（範囲全体）で崩れる前と後を雨の終わりまで計算し、最大の水深・新しく溜まった範囲と、その計算時間を記録する（P2・P3）
- [ ] **Step 2: 熱海・伊豆山（35.1224, 139.0706、1000 m）で `far`・全部** — 谷筋を下流へ流れるか、範囲の外へ出た量
- [ ] **Step 3: 値を見直す** — 「そんな感じ」に見えないときだけ、論文の推奨の幅の中で `DEBRIS_PRESETS` の値を変える。変えた値と理由を記録する（spec 3.3）。Task 1 のテストが通ること
- [ ] **Step 4: メモリ（P4）** — 1000 m・DEM1A で比べる計算をしたときの Worker のメモリの目安を記録する（Chrome の `performance.measureUserAgentSpecificMemory` が使えなければ、配列の大きさからの見積もり）
- [ ] **Step 5: スクリーンショット** — 2D の崩れる前・崩れた後・比べた結果（1280×800 と 390×844）を `.handoff/10-screenshots/` に
- [ ] **Step 6: コミット** — `spec 10: 熱海と酒々井で崩れたと仮定した場合を確かめた記録`

---

### Task 14: 文書を更新する

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-00-overview.md`（§3 の 10 の行を実装済みに、§6 に R10-1〜R10-7）
- Modify: `specs/tech-spec.md`（§5 の Worker のメッセージ、§9.4 にプリセットの表の例外、§14.2 の大きさ）
- Modify: `docs/superpowers/specs/2026-10-18-10-fill-collapse-design.md`（Status を実装済みに。計画で決めたこと〈せき止めの判定の閾値、比べる計算の止め方と見込み、プリセットの最終の値〉を本文に）

- [ ] **Step 1: 書き換える**
- [ ] **Step 2: 全部の確かめ** — `pnpm lint && pnpm typecheck && pnpm test && pnpm depcheck && pnpm build && pnpm size && pnpm run licenses`
- [ ] **Step 3: コミット** — `spec 10: overview・tech-spec・spec の状態を更新する`
