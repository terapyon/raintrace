# Spec 03 シミュレーションエンジン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** tech-spec §6.2 の `SimulationEngine` を純粋な TypeScript（`TsSimulationEngine`）で実装し、水が高所から低所へ動き、窪地に溜まり、越流し、領域外へ流出するまでを、質量を保存して Node 上のテストで示す。

**Architecture:** 水深を2つの `Float64Array`（W と W'）で持ち、Jacobi 方式で 1 step を計算する（`FlowSolver`）。走査するのは濡れたセルの外接矩形とその周囲 1 セルだけ（`WaterGrid`）。降雨の投入先の計算（`Rainfall`）、統計・越流イベント・平衡の検出はエンジン本体（`TsSimulationEngine`）がまとめる。UI・Worker・描画にはつながない（04）。

**Tech Stack:** TypeScript 6.0（`src/simulation` は lib `ES2023` のみ）、Vitest 4、fast-check 4.9.0、Node 24（ベンチマークを直接実行）、Biome 2、dependency-cruiser 18

**Spec:** `docs/superpowers/specs/2026-09-10-03-simulation-engine-design.md`（あわせて `specs/tech-spec.md` §6・§10・§11、裁定は `docs/superpowers/specs/2026-09-10-00-overview.md` §6。R03-1〜R03-7 はすべて推奨どおり承認済みで、本計画は蒸し返さない）

## Global Constraints

- 起点: ブランチ `feat/03-simulation-engine` を、spec 01 の完成したコミット `a8f7db1` から切る。push はしない。spec 02 は別のブランチで並行して実装中
- `src/simulation/` は純粋な TypeScript。lib は `ES2023` のみで、`console`・`performance`・DOM は型エラーになる。外部パッケージの import は dependency-cruiser の `core-is-pure` で禁止（テストファイルは除く）
- `src/simulation/` の相対 import には `.ts` の拡張子を付ける（Biome の `useImportExtensions` が強制する）。`noUncheckedIndexedAccess` は `src/simulation` だけ無効（`tsconfig.sim.json`）。テスト（`tsconfig.test.json`）では有効なので、テストの中で型付き配列の要素を計算に使うときは `?? 0` などを付ける
- 書式は Biome（2 スペース、シングルクォート、セミコロンなし、行幅 100）。`pnpm lint` を通す。import の並びは Biome が決める（`./TsSimulationEngine.ts` は `./testing/…` より前。大文字が先）
- テストの型検査は `tsconfig.test.json`（`src/**/*.test.ts`）。カバレッジの閾値は `src/simulation` 90%（`vitest.config.ts` に設定済み）
- 依存を足すときは `pnpm add -DE <名前>@<版>` で正確な版を固定する。このマシンと CI には公開から 10 日のクールダウンが強制されていて、新しすぎる版は install が失敗する。fast-check は **4.9.0**（2026-07-08 公開）を使う。pnpm が対話的に新しすぎる版の承認を求めても承認しない。ビルドスクリプトの許可を求められたら `pnpm-workspace.yaml` の `allowBuilds` に `false` で足す（01 の esbuild などと同じ扱い）
- 型は tech-spec §6.2 と spec 03 §3.10 のとおり（`src/simulation/types.ts`）。定数の名前は spec 03 §3.11 のとおりで、01 が置いた `constants.ts` に `DIFFUSION_C`、`FLOODED_DEPTH_M`、`SPILL_TOLERANCE_M` を足す（既存の `MASS_TOLERANCE_REL`、`SURFACE_ELEVATION_TOLERANCE_M`、`DEPTH_EPSILON_M`、`FLOW_THRESHOLD_M`、`massTolerance()` を使う）
- 03 では `src/simulation/terrain/`（02 の地形解析）を作らない。越流イベントのテストは `setDepressions()` に手で組んだ窪地を渡して書く。02 の関数が要る「満水との一致」は最後の Task 10 で、02 の後に行う
- 計時（`performance.now()`）は `src/simulation` の中ではできない。ベンチマークの計時は `scripts/bench-engine.ts` の側で行う
- 結果は決定的であること（同じ入力でビット単位で一致）。`scanMode: 'bbox'` と `'full'` の結果もビット単位で一致すること。浮動小数点の演算順序を変える変更（和の順序の入れ替えなど）は、この2つの性質のテストで確かめる
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` を付ける（下の各 Task のコミット例では省略しているが、必ず付ける）

## 事前に確かめた事実（2026-09-10、この worktree の使い捨ての試作で確認し、試作は消した）

本計画のコードは、試作としてそのまま動かし、`pnpm test`・`pnpm typecheck`・`pnpm lint`・`pnpm depcheck` がすべて通ることを確かめたものである。

| 事実 | 計画への影響 |
|---|---|
| `pnpm add -DE fast-check@4.9.0` はクールダウンの下で成功する。依存は `pure-rand` 8.4.2（2026-07-10 公開）のみ。ビルドスクリプトの許可は求められない | Task 7 でそのまま入れる。`allowBuilds` の変更は不要の見込み |
| Node v24.19.0 は `node scripts/bench-engine.ts` を警告なしで直接実行する。`.ts` の拡張子付きの import、クラスの `private`・`readonly`・`override` はそのまま動く | ベンチマークに tsx などの依存を足さない（spec 03 §5） |
| `tsconfig.node.json` の `include` に `scripts/**/*.ts` を足しただけでは、`tsc -b` が `src/simulation/FlowSolver.ts` などを node の設定（`noUncheckedIndexedAccess: true`）で検査し、TS2532 で失敗する。`references: [{ "path": "./tsconfig.sim.json" }]` を足すと通る | Task 8 は専用の tsconfig を作らず、`tsconfig.node.json` に `include` と `references` を足す（`tsconfig.core.json` と同じ形） |
| `src/simulation` のテストは全体で約 0.7 秒。性質のテスト（fast-check の既定 100 回）は1つあたり約 0.1 秒 | テストのタイムアウトを延ばす設定は不要 |
| 性質のテストの中で要素ごとに `expect` を呼ぶと、最大値原理の検査が 1,000 万回の `expect` になり 5 秒のタイムアウトを超える | 検査は普通の比較で行い、違反の説明を返す関数にして `expect(...).toBeNull()` を 1 step に 1 回だけ呼ぶ |
| 行カバレッジは `src/simulation` でほぼ 100% | 90% の閾値を満たす |
| 「s ≤ 1 の上限を外す」改変は、`FlowSolver` のユニットテストと、性質のテストの質量保存・非負・最大値原理の3つが検出する | Task 7 で同じ改変を一時的に入れて、テストが効くことを確かめる |
| `WaterGrid.endStep` の「書き込み先を 0 にする」処理を外しても、性質のテスト（bbox と full の一致を含む）は通り、`WaterGrid` のユニットテストだけが検出する。理由: セルが乾く（W がちょうど 0 になる）のは、低い有効な近傍へ水をすべて渡したときだけで、その近傍は次の状態で濡れている。よって「今濡れているセル」は必ず次の走査範囲（濡れたセルの外接矩形 + 周囲 1 セル）に入り、`beginStep` の写しで上書きされる | 0 にする処理は spec 03 §3.5 の不変条件を、この性質に頼らずに保つための防御として残す（06 のブロック方式などで前提が変わっても壊れない）。不変条件は `WaterGrid` のユニットテストで直接押さえる |
| ベンチマーク（Node、この開発機）: 半径 10m は 2,253 step で平衡、1 step の中央値 0.029ms。半径 100m は 19,643 step で平衡、中央値 2.85ms・p95 6.25ms（最初の 2,000 step だけなら中央値 6.2ms・p95 7.6ms）。質量誤差は 1.3e-11 m³ 以下 | tech-spec §6.3 の基準（中央値 8ms・p95 16ms）には届かないが、半径 100m の序盤は近い。PR に記録し、06 に申し送る（Task 8・9）。Chrome での値は 06 で測る |
| 「満水との一致」を、素朴な Priority-Flood（8 近傍、端と無効セルに接するセルが起点）で求めた F と比べた。どの地形でも H ≥ F（池が満ち足りないことはない）。しかし spec 03 §6.1 の許容「θ × 窪地の幅 + 1e-9」は、窪地の幅を外接矩形の長辺とすると、決まった地形でも 1.16〜1.45 倍超える。「θ × (窪地の幅 + 1) + 1e-9」なら、流出口が下り続ける地形では最大 0.964 倍に収まる。ランダムな凹凸の地形では、流出口の先の平らな所や濡れた所に沿って θ ずつの傾きが積み上がるため、どちらの式も数倍超える | Task 10 は、流出口が下り続ける3つの決まった地形で、許容を θ × (窪地の幅 + 1) + 1e-9 とする（+1 は spill のセル自身が持ちうる θ 以下の水）。spec との差異として PR に書き、spec 03 §6.1 を改める（Task 10） |

## 設計の判断（spec が決めていない細部）

1. **ファイルの分け方。** tech-spec §4.1 の一覧のうち `WaterGrid.ts`・`Rainfall.ts` は作り、`Boundary.ts` は作らない（境界の扱いは `FlowSolver` の近傍の読み出しの 3 行で、分けると呼び出しが増えるだけ）。テストとベンチマークで共有する地形と補助関数を `src/simulation/testing/fixtures.ts` に置く（純粋な TS なので sim のプロジェクトに入る。`noUncheckedIndexedAccess` が無効な側に置くことで、配列を多く読む補助関数を素直に書ける）。tech-spec §4.1 は Task 9 で改める
2. **`waterDepth()` は内部の現在のバッファをそのまま返す。** step のたびに W と W' を入れ替えるので、返る配列は step の後に別物になる（`types.ts` の JSDoc に書く）。テストは step のたびに呼び直す
3. **`loadTerrain` は標高とマスクを複製して持つ**（512² で約 1.3MB）。呼び出し側が後で配列を書き換えても壊れない。`loadTerrain` は窪地の一覧も消す（別の地形の窪地になるため）
4. **`scanMode` はコンストラクタの引数**（`new TsSimulationEngine({ scanMode: 'full' })`、既定は `'bbox'`）。`SimulationEngine` のインターフェースには入れない
5. **入力の検査。** `loadTerrain`（大きさ・セルの大きさ・配列の長さ）、`addRainfall`（座標・半径・雨量が有限で、半径 > 0、雨量 ≥ 0）、`setDepressions`（最低点のセル番号が整数で範囲内）は `RangeError` を投げる。spec には無いが、負の雨量などで非負や質量保存が崩れるのを入口で止める。UI の入力範囲（R04-6）は 04 が検査する
6. **「降雨中心に標高データがありません」は `NoElevationAtRainCenterError`**（`name` で判別できる）。メッセージは spec 03 §3.6 の文言。画面の文言は `src/ui/strings.ts` にだけ置く規則（tech-spec §9.4）なので、04 は `name` で判別して strings.ts の文言を出す
7. **`flowVectors()` は呼ぶたびに新しい `Float32Array` を2つ作る。** 04 は Worker から転送できる
8. **流出量は、仮想セルへ出た水深の和に最後にセル面積を掛ける。** 貯留量も Σ W に面積を掛ける。和の順序は行優先の走査順で固定され、bbox と full で同じになる（full では 0 を足すだけ）
9. **越流の判定値は `Z[pit] + W[pit] ≥ spillElevation − SPILL_TOLERANCE_M`**（f64）。`setDepressions` で渡し直すと通知済みの記録も新しくなる

## ファイル構成

| ファイル | 責務 | Task |
|---|---|---|
| `src/simulation/constants.ts`（+ test、変更） | `DIFFUSION_C`・`FLOODED_DEPTH_M`・`SPILL_TOLERANCE_M` を足す | 1 |
| `src/simulation/types.ts` | `TerrainMeta`・`RainfallInput`・`SimulationEvent`・`StepStats`・`SimulationEngine`（tech-spec §6.2、spec 03 §3.10） | 1 |
| `src/simulation/Rainfall.ts`（+ test） | 降雨の投入先のセルと水深（§3.6）、`NoElevationAtRainCenterError` | 1 |
| `src/simulation/WaterGrid.ts`（+ test） | W と W'、走査範囲（外接矩形）、入れ替えと集計（§3.5） | 2 |
| `src/simulation/FlowSolver.ts`（+ test） | 1 step の計算（§3.2・§3.3）と流れのベクトル（§3.9） | 3 |
| `src/simulation/TsSimulationEngine.ts`（+ test） | エンジン本体。統計・平衡・reset（§3.8） | 4、5 |
| `src/simulation/testing/fixtures.ts` | テストとベンチマーク用の地形と補助関数 | 4、6 |
| `src/simulation/spillEvents.test.ts` | 越流イベント（§3.7） | 5 |
| `src/simulation/scenarios.test.ts` | base-spec §47 の 4 ケースと平衡水位（§6.1） | 6 |
| `src/simulation/properties.test.ts` | 性質のテスト（§6.2） | 7 |
| `package.json`、`pnpm-lock.yaml` | fast-check 4.9.0、`bench:engine` | 7、8 |
| `scripts/bench-engine.ts`、`tsconfig.node.json`（変更） | ベンチマーク（§5）とその型検査 | 8 |
| `specs/tech-spec.md`（変更）、`.handoff/*` | §4.1・§6.5 の改訂、引き継ぎ | 9 |
| `src/simulation/fillMatch.test.ts`、spec 03 §6.1（変更） | 満水との一致（02 の後） | 10 |

---

### Task 1: 定数・型・降雨の投入

**Files:**
- Modify: `src/simulation/constants.ts`、`src/simulation/constants.test.ts`
- Create: `src/simulation/types.ts`、`src/simulation/Rainfall.ts`、`src/simulation/Rainfall.test.ts`

**Interfaces:**
- Consumes: `constants.ts` の既存の定数（01）
- Produces:
  - `constants.ts`: `DIFFUSION_C = 0.5`、`FLOODED_DEPTH_M = 0.01`、`SPILL_TOLERANCE_M = 0.01`（既存の `FLOW_THRESHOLD_M = 1e-5`、`massTolerance(totalInputM3: number): number` などはそのまま）
  - `types.ts`: `TerrainMeta { width; height; cellSizeM }`、`RainfallInput { x; y; radiusM; amountMm }`、`SimulationEvent { type: 'spill'; step; depressionId; spillElevation }`、`StepStats { step; totalWater; storedWater; outflowWater; maxDepth; floodedArea; settled; massError; events }`、`SimulationEngine`（7 メソッド）
  - `Rainfall.ts`: `class NoElevationAtRainCenterError extends Error`（`name = 'NoElevationAtRainCenterError'`）、`interface RainfallPlan { cells: Int32Array; depthM: number; volumeM3: number; x0; y0; x1; y1 }`（外接矩形はセル単位の半開区間）、`planRainfall(rain: RainfallInput, validMask: Uint8Array, meta: TerrainMeta): RainfallPlan`

- [ ] **Step 1: 定数の失敗するテストを書く**

`src/simulation/constants.test.ts` を次の内容にする（既存の describe はそのまま、末尾に1つ足す）:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEPTH_EPSILON_M,
  DIFFUSION_C,
  FLOODED_DEPTH_M,
  FLOW_THRESHOLD_M,
  MASS_TOLERANCE_REL,
  massTolerance,
  SPILL_TOLERANCE_M,
  SURFACE_ELEVATION_TOLERANCE_M,
} from './constants.ts'

describe('許容誤差（tech-spec §6.6）', () => {
  it('表の値と一致する', () => {
    expect(MASS_TOLERANCE_REL).toBe(1e-9)
    expect(SURFACE_ELEVATION_TOLERANCE_M).toBe(0.01)
    expect(FLOW_THRESHOLD_M).toBe(1e-5)
  })

  it('水深の比較許容値は流れの閾値 θ と同じ値', () => {
    expect(DEPTH_EPSILON_M).toBe(FLOW_THRESHOLD_M)
  })

  it('質量保存の許容誤差は投入総量に比例する', () => {
    expect(massTolerance(0)).toBe(0)
    expect(massTolerance(1000)).toBeCloseTo(1e-6, 15)
  })
})

describe('エンジンの定数（spec 03 §3.11）', () => {
  it('表の値と一致する', () => {
    expect(DIFFUSION_C).toBe(0.5)
    expect(FLOODED_DEPTH_M).toBe(0.01)
    expect(SPILL_TOLERANCE_M).toBe(0.01)
  })
})
```

Run: `pnpm vitest run src/simulation/constants.test.ts`
Expected: FAIL（「エンジンの定数」が `expected undefined to be 0.5`）

- [ ] **Step 2: 定数を足す**

`src/simulation/constants.ts` を次の内容にする（先頭の説明に spec 03 §3.11 を足し、`FLOW_THRESHOLD_M` の後に3つ足す）:

```ts
/**
 * 許容誤差と閾値（tech-spec §6.6、spec 03 §3.11）。値を変えるときは tech-spec も改訂する
 */

/** 質量保存の許容誤差の係数。許容誤差 = (初期水量 + 投入水量の累計) × この値 */
export const MASS_TOLERANCE_REL = 1e-9

/** 平衡状態の水面標高と、体積から求めた理論値との差の許容値（m） */
export const SURFACE_ELEVATION_TOLERANCE_M = 0.01

/** 水深・水面の比較の許容値 epsilon（m）。流れの閾値 θ と同じ値 */
export const DEPTH_EPSILON_M = 1e-5

/** 流れの閾値 θ（m）。水面差がこれ以下の近傍には流さない（R03-3） */
export const FLOW_THRESHOLD_M = 1e-5

/** 流量の係数 c。1 セルから 8 近傍へ出る流量の係数の和 k·Σw の値（R03-1） */
export const DIFFUSION_C = 0.5

/** 浸水面積に数える水深の下限（m）。base-spec §30 の描画閾値 */
export const FLOODED_DEPTH_M = 0.01

/** 越流の判定の余裕（m）。窪地の最低点の水面標高が spill 標高 − この値に達したら通知する（R03-6） */
export const SPILL_TOLERANCE_M = 0.01

/** 質量保存の許容誤差（m³）。totalInputM3 は初期水量と投入水量の累計の和 */
export function massTolerance(totalInputM3: number): number {
  return totalInputM3 * MASS_TOLERANCE_REL
}
```

Run: `pnpm vitest run src/simulation/constants.test.ts`
Expected: PASS（4 件）

- [ ] **Step 3: 型を置く**

`src/simulation/types.ts`:

```ts
/**
 * エンジンのインターフェースと型（tech-spec §6.2、spec 03 §3.10）。
 * 実装（TsSimulationEngine、将来の WASM 実装）はこのインターフェースだけを満たす
 */

export interface TerrainMeta {
  /** 列数 */
  width: number
  /** 行数 */
  height: number
  /** セルの一辺（m）。tech-spec §7.6 */
  cellSizeM: number
}

export interface RainfallInput {
  /** グリッドの北西端から東向きの距離（m） */
  x: number
  /** グリッドの北西端から南向きの距離（m） */
  y: number
  radiusM: number
  amountMm: number
}

export interface SimulationEvent {
  /** 窪地の最低点の水位が spill 標高 − 1cm に達した（base-spec §21） */
  type: 'spill'
  step: number
  depressionId: number
  spillElevation: number
}

export interface StepStats {
  /** 実行済みの step 数（base-spec §33 の「Step N」） */
  step: number
  /** 累積の投入水量（m³） */
  totalWater: number
  /** 領域内にある現在の水量 Σ W × A（m³） */
  storedWater: number
  /** 累積の領域外流出量（m³） */
  outflowWater: number
  /** 最大水深（m） */
  maxDepth: number
  /** 水深が描画閾値（1cm）以上のセルの面積（m²） */
  floodedArea: number
  /** この step で、θ を超える水面差による流れが1つも無かった */
  settled: boolean
  /** totalWater − storedWater − outflowWater（m³） */
  massError: number
  /** この step で起きた越流イベント */
  events: SimulationEvent[]
}

export interface SimulationEngine {
  loadTerrain(elevation: Float32Array, validMask: Uint8Array, meta: TerrainMeta): void
  addRainfall(rain: RainfallInput): void
  step(): StepStats
  reset(): void
  /**
   * 内部の水深配列。呼び出し側は読み取り専用として扱い、転送バッファへのコピー元にのみ使う。
   * step() のたびに別の配列に入れ替わるので、step() の後は呼び直す
   */
  waterDepth(): Float64Array
  /** 越流イベントの判定に使う窪地（実装 spec 02 の地形解析の結果） */
  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void
  /** 現在の状態から計算した、各セルの流出のベクトル（水の流れの矢印用） */
  flowVectors(): { x: Float32Array; y: Float32Array }
}
```

- [ ] **Step 4: 降雨の失敗するテストを書く**

`src/simulation/Rainfall.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NoElevationAtRainCenterError, planRainfall } from './Rainfall.ts'
import type { TerrainMeta } from './types.ts'

const META_5: TerrainMeta = { width: 5, height: 5, cellSizeM: 1 }

function mask5(invalid: number[] = []): Uint8Array {
  const mask = new Uint8Array(25).fill(1)
  for (const i of invalid) mask[i] = 0
  return mask
}

describe('planRainfall（spec 03 §3.6）', () => {
  it('中心が円内に入る有効セルを選び、その外接矩形を返す', () => {
    // 中心 (2.5, 2.5)・半径 1m: 中央のセルと上下左右の 5 セル（斜めのセルの中心は √2 m 離れている）
    const plan = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 10 }, mask5(), META_5)
    expect(Array.from(plan.cells)).toEqual([7, 11, 12, 13, 17])
    expect([plan.x0, plan.y0, plan.x1, plan.y1]).toEqual([1, 1, 4, 4])
  })

  it('投入総量は π · radiusM² · amountMm / 1000 で、選んだセルに等分する', () => {
    const plan = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 10 }, mask5(), META_5)
    expect(plan.volumeM3).toBeCloseTo((Math.PI * 10) / 1000, 15)
    expect(plan.depthM * 5).toBeCloseTo(plan.volumeM3, 15)
  })

  it('半径がセルより小さく、中心が円内に入るセルが無いときは、降雨中心を含むセル 1 つに入れる', () => {
    // セル 7.8m・半径 1m。降雨中心はセル (3, 2) の中心から 3m ずつずれている
    const meta: TerrainMeta = { width: 11, height: 11, cellSizeM: 7.8 }
    const mask = new Uint8Array(121).fill(1)
    const plan = planRainfall(
      { x: 3 * 7.8 + 0.9, y: 2 * 7.8 + 0.9, radiusM: 1, amountMm: 100 },
      mask,
      meta,
    )
    expect(Array.from(plan.cells)).toEqual([2 * 11 + 3])
    expect(plan.depthM * 7.8 * 7.8).toBeCloseTo(plan.volumeM3, 15)
  })

  it('無効セルには入れない', () => {
    const plan = planRainfall({ x: 2.5, y: 2.5, radiusM: 1, amountMm: 10 }, mask5([12]), META_5)
    expect(Array.from(plan.cells)).toEqual([7, 11, 13, 17])
    expect(plan.depthM * 4).toBeCloseTo(plan.volumeM3, 15)
  })

  it('範囲に有効セルが無く、降雨中心のセルが無効ならエラー', () => {
    const rain = { x: 2.5, y: 2.5, radiusM: 0.4, amountMm: 10 }
    expect(() => planRainfall(rain, mask5([12]), META_5)).toThrow(NoElevationAtRainCenterError)
    expect(() => planRainfall(rain, mask5([12]), META_5)).toThrow(
      '降雨中心に標高データがありません',
    )
  })

  it('降雨中心がグリッドの外で、範囲にもセルが無ければエラー', () => {
    const rain = { x: -10, y: 2.5, radiusM: 1, amountMm: 10 }
    expect(() => planRainfall(rain, mask5(), META_5)).toThrow(NoElevationAtRainCenterError)
  })

  it.each([
    { x: Number.NaN, y: 0, radiusM: 1, amountMm: 1 },
    { x: 0, y: 0, radiusM: 0, amountMm: 1 },
    { x: 0, y: 0, radiusM: Number.POSITIVE_INFINITY, amountMm: 1 },
    { x: 0, y: 0, radiusM: 1, amountMm: -1 },
  ])('不正な入力は RangeError: %o', (rain) => {
    expect(() => planRainfall(rain, mask5(), META_5)).toThrow(RangeError)
  })
})
```

Run: `pnpm vitest run src/simulation/Rainfall.test.ts`
Expected: FAIL（`./Rainfall.ts` が見つからない）

- [ ] **Step 5: 降雨の投入を実装する**

`src/simulation/Rainfall.ts`:

```ts
/**
 * 降雨の投入先と水深の計算（spec 03 §3.6、R03-4）
 */
import type { RainfallInput, TerrainMeta } from './types.ts'

/** 降雨の範囲に有効セルが無く、降雨中心のセルも無効（またはグリッドの外）のとき */
export class NoElevationAtRainCenterError extends Error {
  override name = 'NoElevationAtRainCenterError'

  constructor() {
    super('降雨中心に標高データがありません')
  }
}

export interface RainfallPlan {
  /** 雨を入れるセルの番号（行優先の昇順） */
  cells: Int32Array
  /** 各セルに足す水深（m） */
  depthM: number
  /** 投入総量（m³）。π · radiusM² · amountMm / 1000 */
  volumeM3: number
  /** cells の外接矩形（列 [x0, x1)、行 [y0, y1)） */
  x0: number
  y0: number
  x1: number
  y1: number
}

export function planRainfall(
  rain: RainfallInput,
  validMask: Uint8Array,
  meta: TerrainMeta,
): RainfallPlan {
  const { x, y, radiusM, amountMm } = rain
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError(`降雨中心の座標が不正です: (${x}, ${y})`)
  }
  if (!Number.isFinite(radiusM) || radiusM <= 0) {
    throw new RangeError(`降雨の半径が不正です: ${radiusM}`)
  }
  if (!Number.isFinite(amountMm) || amountMm < 0) {
    throw new RangeError(`雨量が不正です: ${amountMm}`)
  }
  const { width, height, cellSizeM } = meta
  const r2 = radiusM * radiusM
  const cx0 = Math.max(0, Math.floor((x - radiusM) / cellSizeM))
  const cx1 = Math.min(width - 1, Math.floor((x + radiusM) / cellSizeM))
  const cy0 = Math.max(0, Math.floor((y - radiusM) / cellSizeM))
  const cy1 = Math.min(height - 1, Math.floor((y + radiusM) / cellSizeM))

  const cells: number[] = []
  for (let cy = cy0; cy <= cy1; cy++) {
    const dy = (cy + 0.5) * cellSizeM - y
    for (let cx = cx0; cx <= cx1; cx++) {
      const dx = (cx + 0.5) * cellSizeM - x
      const i = cy * width + cx
      if (dx * dx + dy * dy <= r2 && validMask[i] !== 0) cells.push(i)
    }
  }
  if (cells.length === 0) {
    // 半径がセルより小さいなど、中心が円内に入るセルが無いときは、降雨中心を含むセル1つに入れる
    const cx = Math.floor(x / cellSizeM)
    const cy = Math.floor(y / cellSizeM)
    const inside = cx >= 0 && cx < width && cy >= 0 && cy < height
    if (!inside || validMask[cy * width + cx] === 0) throw new NoElevationAtRainCenterError()
    cells.push(cy * width + cx)
  }

  let x0 = width
  let y0 = height
  let x1 = 0
  let y1 = 0
  for (const i of cells) {
    const cx = i % width
    const cy = (i - cx) / width
    if (cx < x0) x0 = cx
    if (cx + 1 > x1) x1 = cx + 1
    if (cy < y0) y0 = cy
    if (cy + 1 > y1) y1 = cy + 1
  }

  const volumeM3 = (Math.PI * r2 * amountMm) / 1000
  const depthM = volumeM3 / (cells.length * cellSizeM * cellSizeM)
  return { cells: Int32Array.from(cells), depthM, volumeM3, x0, y0, x1, y1 }
}
```

Run: `pnpm vitest run src/simulation/Rainfall.test.ts`
Expected: PASS（10 件）

- [ ] **Step 6: 型検査・lint・依存規則を通す**

Run: `pnpm typecheck && pnpm lint && pnpm depcheck`
Expected: すべて成功（`types.ts` は `Rainfall.ts` から、`Rainfall.ts` はテストから辿れるので orphan にならない）

- [ ] **Step 7: Commit**

```bash
git add src/simulation/constants.ts src/simulation/constants.test.ts src/simulation/types.ts src/simulation/Rainfall.ts src/simulation/Rainfall.test.ts
git commit -m "エンジン: 定数（c・浸水の水深・越流の余裕）、インターフェースの型、降雨の投入先と正規化"
```

---

### Task 2: 水深のバッファと走査範囲（WaterGrid）

**Files:**
- Create: `src/simulation/WaterGrid.ts`、`src/simulation/WaterGrid.test.ts`

**Interfaces:**
- Consumes: `FLOODED_DEPTH_M`（Task 1）
- Produces:
  - `interface WaterSummary { depthSum: number; maxDepth: number; floodedCells: number }`
  - `class WaterGrid`: `constructor(width: number, height: number, full: boolean)`、フィールド `width`・`height`・`full`（readonly）、`current: Float64Array`（W）、`next: Float64Array`（W'）、走査範囲 `x0`・`y0`・`x1`・`y1`（列 `[x0, x1)`・行 `[y0, y1)`。空は `x0 = x1`）。メソッド `clear(): void`、`include(cx0, cy0, cx1, cy1): void`（セルの矩形とその周囲 1 セルを走査範囲に足す。full では何もしない）、`beginStep(): void`（W' ← W、走査範囲のみ）、`endStep(): WaterSummary`（入れ替え、集計、走査範囲の更新）
  - `WaterGrid` は `ScanWindow`（Task 3 の `{ x0; y0; x1; y1 }`）として `solveStep` にそのまま渡せる

spec 03 §3.5 の不変条件「走査範囲の外では W と W' の両方が 0」を、ここでは「step と step の間では W' はすべて 0、W は走査範囲の外で 0」として保つ。`endStep` で入れ替えた後、書き込み先になる古いバッファを今の走査範囲で 0 にする（「事前に確かめた事実」のとおり、これは防御であり、不変条件は本 Task のテストで直接押さえる）。

- [ ] **Step 1: 失敗するテストを書く**

`src/simulation/WaterGrid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { WaterGrid } from './WaterGrid.ts'

function windowOf(g: WaterGrid): number[] {
  return [g.x0, g.y0, g.x1, g.y1]
}

describe('WaterGrid（spec 03 §3.5）', () => {
  it('はじめの走査範囲は空。full ではグリッド全体', () => {
    expect(windowOf(new WaterGrid(6, 4, false))).toEqual([0, 0, 0, 0])
    expect(windowOf(new WaterGrid(6, 4, true))).toEqual([0, 0, 6, 4])
  })

  it('include は周囲 1 セルを足してグリッドの中に切り詰め、今の範囲と合わせる', () => {
    const g = new WaterGrid(6, 4, false)
    g.include(0, 0, 1, 1)
    expect(windowOf(g)).toEqual([0, 0, 2, 2])
    g.include(4, 2, 5, 3)
    expect(windowOf(g)).toEqual([0, 0, 6, 4])
  })

  it('full では include しても全体のまま', () => {
    const g = new WaterGrid(6, 4, true)
    g.include(2, 2, 3, 3)
    expect(windowOf(g)).toEqual([0, 0, 6, 4])
  })

  it("beginStep は走査範囲の W を W' に写す", () => {
    const g = new WaterGrid(6, 4, false)
    g.current[1 * 6 + 1] = 0.5
    g.include(1, 1, 2, 2)
    g.beginStep()
    expect(g.next[1 * 6 + 1]).toBe(0.5)
  })

  it('endStep は入れ替えて集計し、走査範囲を濡れたセルの外接矩形と周囲 1 セルに縮める', () => {
    const g = new WaterGrid(6, 4, false)
    g.include(0, 0, 6, 4)
    g.beginStep()
    g.next[2 * 6 + 3] = 0.02
    g.next[2 * 6 + 4] = 0.005
    const s = g.endStep()
    expect(s.depthSum).toBeCloseTo(0.025, 15)
    expect(s.maxDepth).toBe(0.02)
    expect(s.floodedCells).toBe(1)
    expect(g.current[2 * 6 + 3]).toBe(0.02)
    expect(windowOf(g)).toEqual([2, 1, 6, 4])
  })

  it("縮めた後も、走査範囲の外では W と W' がどちらも 0（不変条件）", () => {
    const g = new WaterGrid(6, 4, false)
    g.current[0] = 1
    g.current[23] = 1
    g.include(0, 0, 6, 4)
    g.beginStep()
    g.next[23] = 0
    g.endStep()
    expect(windowOf(g)).toEqual([0, 0, 2, 2])
    expect(g.next.every((d) => d === 0)).toBe(true)
    expect(Array.from(g.current).filter((d) => d !== 0)).toEqual([1])
  })

  it('水がなくなると走査範囲は空になる', () => {
    const g = new WaterGrid(6, 4, false)
    g.current[7] = 1
    g.include(1, 1, 2, 2)
    g.beginStep()
    g.next[7] = 0
    expect(g.endStep()).toEqual({ depthSum: 0, maxDepth: 0, floodedCells: 0 })
    expect(windowOf(g)).toEqual([0, 0, 0, 0])
  })

  it('clear は水を消し、走査範囲を空に戻す', () => {
    const g = new WaterGrid(6, 4, false)
    g.current[7] = 1
    g.include(1, 1, 2, 2)
    g.clear()
    expect(g.current.every((d) => d === 0)).toBe(true)
    expect(windowOf(g)).toEqual([0, 0, 0, 0])
  })
})
```

Run: `pnpm vitest run src/simulation/WaterGrid.test.ts`
Expected: FAIL（`./WaterGrid.ts` が見つからない）

- [ ] **Step 2: 実装する**

`src/simulation/WaterGrid.ts`:

```ts
/**
 * 水深の2つのバッファ（W と W'）と走査範囲（spec 03 §3.5）。
 *
 * 不変条件: step と step の間では、next はすべて 0 で、current は走査範囲の外で 0 である。
 * endStep で入れ替えた後、書き込み先になる古いバッファを今の走査範囲で 0 にして、これを保つ
 */
import { FLOODED_DEPTH_M } from './constants.ts'

export interface WaterSummary {
  /** Σ W（m）。セル面積を掛けると貯留量 */
  depthSum: number
  /** 最大水深（m） */
  maxDepth: number
  /** 水深が FLOODED_DEPTH_M 以上のセルの数 */
  floodedCells: number
}

export class WaterGrid {
  readonly width: number
  readonly height: number
  /** true なら走査範囲を常にグリッド全体にする（scanMode: 'full'） */
  readonly full: boolean
  /** W（現在の水深） */
  current: Float64Array
  /** W'（次の step の書き込み先） */
  next: Float64Array
  /** 走査範囲。列 [x0, x1)、行 [y0, y1)。空のときは x0 = x1 */
  x0 = 0
  y0 = 0
  x1 = 0
  y1 = 0

  constructor(width: number, height: number, full: boolean) {
    this.width = width
    this.height = height
    this.full = full
    this.current = new Float64Array(width * height)
    this.next = new Float64Array(width * height)
    this.resetWindow()
  }

  /** 水をすべて消す */
  clear(): void {
    this.current.fill(0)
    this.next.fill(0)
    this.resetWindow()
  }

  /** セルの矩形（列 [cx0, cx1)、行 [cy0, cy1)）と、その周囲 1 セルを走査範囲に含める */
  include(cx0: number, cy0: number, cx1: number, cy1: number): void {
    if (this.full) return
    const x0 = Math.max(0, cx0 - 1)
    const y0 = Math.max(0, cy0 - 1)
    const x1 = Math.min(this.width, cx1 + 1)
    const y1 = Math.min(this.height, cy1 + 1)
    if (this.x0 >= this.x1) {
      this.x0 = x0
      this.y0 = y0
      this.x1 = x1
      this.y1 = y1
      return
    }
    this.x0 = Math.min(this.x0, x0)
    this.y0 = Math.min(this.y0, y0)
    this.x1 = Math.max(this.x1, x1)
    this.y1 = Math.max(this.y1, y1)
  }

  /** W' ← W（走査範囲のみ） */
  beginStep(): void {
    const { width, x0, x1, current, next } = this
    for (let y = this.y0; y < this.y1; y++) {
      const a = y * width + x0
      next.set(current.subarray(a, a + (x1 - x0)), a)
    }
  }

  /**
   * W と W' を入れ替え、新しい W を走査範囲で集計し、走査範囲を濡れたセルの外接矩形と
   * その周囲 1 セルに更新する。水は 1 step に 1 セルしか動かないので、濡れたセルは今の走査範囲の中にある
   */
  endStep(): WaterSummary {
    const w = this.next
    this.next = this.current
    this.current = w
    const { width, x0, x1, next } = this
    let depthSum = 0
    let maxDepth = 0
    let floodedCells = 0
    let wetX0 = width
    let wetX1 = 0
    let wetY0 = this.height
    let wetY1 = 0
    for (let y = this.y0; y < this.y1; y++) {
      const row = y * width
      next.fill(0, row + x0, row + x1)
      for (let x = x0; x < x1; x++) {
        const d = w[row + x]
        if (d === 0) continue
        depthSum += d
        if (d > maxDepth) maxDepth = d
        if (d >= FLOODED_DEPTH_M) floodedCells++
        if (x < wetX0) wetX0 = x
        if (x + 1 > wetX1) wetX1 = x + 1
        if (y < wetY0) wetY0 = y
        wetY1 = y + 1
      }
    }
    if (!this.full) {
      this.resetWindow()
      if (wetX1 > 0) this.include(wetX0, wetY0, wetX1, wetY1)
    }
    return { depthSum, maxDepth, floodedCells }
  }

  private resetWindow(): void {
    this.x0 = 0
    this.y0 = 0
    this.x1 = this.full ? this.width : 0
    this.y1 = this.full ? this.height : 0
  }
}
```

Run: `pnpm vitest run src/simulation/WaterGrid.test.ts`
Expected: PASS（8 件）

- [ ] **Step 3: 型検査・lint・依存規則を通す**

Run: `pnpm typecheck && pnpm lint && pnpm depcheck`
Expected: すべて成功

- [ ] **Step 4: Commit**

```bash
git add src/simulation/WaterGrid.ts src/simulation/WaterGrid.test.ts
git commit -m "エンジン: 水深の2つのバッファと、濡れたセルの外接矩形による走査範囲"
```

---

### Task 3: 1 step の計算と流れのベクトル（FlowSolver）

**Files:**
- Create: `src/simulation/FlowSolver.ts`、`src/simulation/FlowSolver.test.ts`

**Interfaces:**
- Consumes: `DIFFUSION_C`、`FLOW_THRESHOLD_M`（Task 1）
- Produces:
  - 定数 `NEIGHBOR_DX`・`NEIGHBOR_DY`（`Int8Array`、固定順: 北西・北・北東・西・東・南西・南・南東。y は南が正）、`NEIGHBOR_WEIGHT`（`Float64Array`。上下左右 1、斜め 1/√2）、`FLOW_K = DIFFUSION_C / (4 + 4 / √2)`
  - `interface TerrainArrays { width; height; elevation: Float32Array; validMask: Uint8Array }`
  - `interface ScanWindow { x0; y0; x1; y1 }`（列 `[x0, x1)`・行 `[y0, y1)`）
  - `interface Scratch { g: Float64Array; nb: Int32Array }`、`createScratch(): Scratch`（長さ 8 の作業領域。呼び出し側が1つ持って使い回す）
  - `interface StepFlow { outflowDepth: number; flowed: boolean }`（`outflowDepth` は仮想セルへ出た水深の和。面積を掛けると流出量）
  - `solveStep(t: TerrainArrays, w: Float64Array, next: Float64Array, win: ScanWindow, s: Scratch): StepFlow`（呼ぶ前に W' ← W を済ませる）
  - `computeFlowVectors(t: TerrainArrays, w: Float64Array, win: ScanWindow, s: Scratch): { x: Float32Array; y: Float32Array }`

spec 03 §3.2 の擬似コードをそのまま実装する。要点:
- 近傍がグリッドの外か無効セルなら、標高 `Z_i`・水深 0 の仮想セル（§3.3）。そこへの流量は `outflowDepth` に足す
- `G_i ≤ W_i` なら各近傍へ `g_ij` を流す。`G_i > W_i` なら `s = W_i / G_i` を掛け、W' から `W_i` をそのまま引き、最後の近傍への流量を `max(0, W_i − それまでの合計)` とする（W'_i がちょうど 0 になる。`max` は丸めで負の流量を渡さないため）

- [ ] **Step 1: 失敗するテストを書く**

`src/simulation/FlowSolver.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FLOW_THRESHOLD_M } from './constants.ts'
import {
  computeFlowVectors,
  createScratch,
  FLOW_K,
  solveStep,
  type TerrainArrays,
} from './FlowSolver.ts'

/** 標高 0 の平らな地形。invalid のセルは無効セル */
function flat(width: number, height: number, invalid: number[] = []): TerrainArrays {
  const validMask = new Uint8Array(width * height).fill(1)
  for (const i of invalid) validMask[i] = 0
  return { width, height, elevation: new Float32Array(width * height), validMask }
}

/** 全体を走査範囲にして 1 step 計算する */
function stepOnce(t: TerrainArrays, w: Float64Array) {
  const next = w.slice()
  const win = { x0: 0, y0: 0, x1: t.width, y1: t.height }
  const flow = solveStep(t, w, next, win, createScratch())
  return { next, flow }
}

describe('solveStep（spec 03 §3.2・§3.3）', () => {
  it('k · Σw = c = 0.5', () => {
    expect(FLOW_K * (4 + 4 * Math.SQRT1_2)).toBeCloseTo(0.5, 15)
  })

  it('平らな地形の中央の水は、8 近傍へ水面差と重みに比例して配られ、半分が残る', () => {
    const w = new Float64Array(9)
    w[4] = 1
    const { next, flow } = stepOnce(flat(3, 3), w)
    expect(next[4]).toBeCloseTo(0.5, 15)
    expect(next[1]).toBeCloseTo(FLOW_K, 15)
    expect(next[0]).toBeCloseTo(FLOW_K * Math.SQRT1_2, 15)
    expect(flow).toEqual({ outflowDepth: 0, flowed: true })
  })

  it('角のセルの水は、グリッドの外の仮想セルへも流れ、流出になる', () => {
    const w = new Float64Array(9)
    w[0] = 1
    const { next, flow } = stepOnce(flat(3, 3), w)
    // 仮想セル: 西・北（上下左右）と、北西・北東・南西（斜め）
    expect(flow.outflowDepth).toBeCloseTo(FLOW_K * (2 + 3 * Math.SQRT1_2), 15)
    expect(next[0]).toBeCloseTo(0.5, 15)
    expect(next[1]).toBeCloseTo(FLOW_K, 15)
    expect(next[4]).toBeCloseTo(FLOW_K * Math.SQRT1_2, 15)
  })

  it('無効セルは仮想セルとして扱い、そこへの流れは流出になる。無効セルは水を持たない', () => {
    const w = new Float64Array(25)
    w[11] = 1
    const { next, flow } = stepOnce(flat(5, 5, [12]), w)
    expect(flow.outflowDepth).toBeCloseTo(FLOW_K, 15)
    expect(next[12]).toBe(0)
  })

  it('水面差が θ 以下の近傍には流さない（flowed は false）', () => {
    const w = new Float64Array(9)
    w[0] = FLOW_THRESHOLD_M / 2
    w[4] = FLOW_THRESHOLD_M / 2
    const { next, flow } = stepOnce(flat(3, 3), w)
    expect(flow).toEqual({ outflowDepth: 0, flowed: false })
    expect(Array.from(next)).toEqual(Array.from(w))
  })

  it('持っている水より多くは出さず、水をすべて出したセルはちょうど 0 になる', () => {
    const t = flat(3, 3)
    t.elevation[4] = 1
    const w = new Float64Array(9)
    w[4] = 0.01
    const { next } = stepOnce(t, w)
    expect(next[4]).toBe(0)
    expect(next.every((d) => d >= 0)).toBe(true)
    expect(next.reduce((a, d) => a + d, 0)).toBeCloseTo(0.01, 17)
    // 上下左右（北）は斜め（北西）の √2 倍
    expect((next[1] ?? 0) / (next[0] ?? 0)).toBeCloseTo(Math.SQRT2, 12)
  })

  it('Jacobi 方式: 同じ step で先に更新したセルの値を読まない（左右対称な配置は対称な結果になる）', () => {
    const w = Float64Array.of(1, 0, 1)
    const { next } = stepOnce(flat(3, 1), w)
    expect(next[0]).toBe(next[2])
    expect(next[1]).toBeCloseTo(2 * FLOW_K, 15)
  })
})

describe('computeFlowVectors（spec 03 §3.9）', () => {
  it('平らな地形の中央の水は 8 方向に均等に出るので、ベクトルの和は 0', () => {
    const w = new Float64Array(9)
    w[4] = 1
    const v = computeFlowVectors(flat(3, 3), w, { x0: 0, y0: 0, x1: 3, y1: 3 }, createScratch())
    expect(Math.abs(v.x[4] ?? Number.NaN)).toBeLessThan(1e-7)
    expect(Math.abs(v.y[4] ?? Number.NaN)).toBeLessThan(1e-7)
  })

  it('東へ下る斜面の水は東を向き、濡れていないセルは 0、水は動かさない', () => {
    const t = flat(5, 3)
    for (let i = 0; i < 15; i++) t.elevation[i] = 4 - (i % 5)
    const w = new Float64Array(15)
    w[7] = 0.1
    const before = w.slice()
    const v = computeFlowVectors(t, w, { x0: 0, y0: 0, x1: 5, y1: 3 }, createScratch())
    const vx = v.x[7] ?? Number.NaN
    expect(vx).toBeGreaterThan(0)
    expect(Math.abs(v.y[7] ?? Number.NaN)).toBeLessThan(1e-7 * vx)
    expect(v.x[6]).toBe(0)
    expect(v.y[8]).toBe(0)
    expect(Array.from(w)).toEqual(Array.from(before))
  })
})
```

Run: `pnpm vitest run src/simulation/FlowSolver.test.ts`
Expected: FAIL（`./FlowSolver.ts` が見つからない）

- [ ] **Step 2: 実装する**

`src/simulation/FlowSolver.ts`:

```ts
/**
 * 1 step 分の水移動の計算（spec 03 §3.2・§3.3・§3.9）。エンジンの内部モジュールで、外部には公開しない
 */
import { DIFFUSION_C, FLOW_THRESHOLD_M } from './constants.ts'

/** 8 近傍の固定順（北西、北、北東、西、東、南西、南、南東）。y は南向きが正 */
export const NEIGHBOR_DX = Int8Array.of(-1, 0, 1, -1, 1, -1, 0, 1)
export const NEIGHBOR_DY = Int8Array.of(-1, -1, -1, 0, 0, 1, 1, 1)
/** 近傍の重み w_j。上下左右は 1、斜めは 1/√2 */
export const NEIGHBOR_WEIGHT = Float64Array.of(
  Math.SQRT1_2,
  1,
  Math.SQRT1_2,
  1,
  1,
  Math.SQRT1_2,
  1,
  Math.SQRT1_2,
)
/** k = c / Σ_j w_j */
export const FLOW_K = DIFFUSION_C / (4 + 4 * Math.SQRT1_2)

/** 近傍の方向の単位ベクトル（流れのベクトル用） */
const UNIT_X = Float64Array.from(NEIGHBOR_DX, (dx, k) => dx * NEIGHBOR_WEIGHT[k])
const UNIT_Y = Float64Array.from(NEIGHBOR_DY, (dy, k) => dy * NEIGHBOR_WEIGHT[k])

export interface TerrainArrays {
  width: number
  height: number
  elevation: Float32Array
  validMask: Uint8Array
}

/** 走査範囲。列 [x0, x1)、行 [y0, y1) */
export interface ScanWindow {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** 計算の作業領域。呼び出し側が1つ持ち、使い回す */
export interface Scratch {
  /** 各近傍への流量の候補 g_ij（m） */
  g: Float64Array
  /** 各近傍のセル番号。仮想セル（グリッドの外・無効セル）は −1 */
  nb: Int32Array
}

export function createScratch(): Scratch {
  return { g: new Float64Array(8), nb: new Int32Array(8) }
}

export interface StepFlow {
  /** 仮想セルへ出た水深の合計（m）。セル面積を掛けると流出量 */
  outflowDepth: number
  /** θ を超える水面差による流れが1つでもあった */
  flowed: boolean
}

/**
 * セル i（列 x、行 y）から各近傍への流量の候補 g_ij を scratch に書き、合計 G_i を返す。
 * グリッドの外と無効セルは、標高が i と同じで水深 0 の仮想セルとして扱う（§3.3）
 */
function outflowCandidates(
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

/**
 * W を読み、W' に書く（Jacobi 方式）。呼ぶ前に W' ← W（走査範囲のみ）を済ませておく。
 * 走査範囲の外の W は 0 であること
 */
export function solveStep(
  t: TerrainArrays,
  w: Float64Array,
  next: Float64Array,
  win: ScanWindow,
  s: Scratch,
): StepFlow {
  const { width } = t
  const { g, nb } = s
  let outflowDepth = 0
  let flowed = false
  for (let y = win.y0; y < win.y1; y++) {
    for (let x = win.x0; x < win.x1; x++) {
      const i = y * width + x
      const wi = w[i]
      if (wi === 0) continue
      const total = outflowCandidates(t, w, x, y, i, s)
      if (total === 0) continue
      flowed = true
      if (total <= wi) {
        next[i] -= total
        for (let k = 0; k < 8; k++) {
          const f = g[k]
          if (f === 0) continue
          const j = nb[k]
          if (j < 0) outflowDepth += f
          else next[j] += f
        }
        continue
      }
      // 持っている水より多くは出さない（s = W_i / G_i）。最後の流量を残りとし、W'_i をちょうど 0 減らす
      const scale = wi / total
      next[i] -= wi
      let last = 7
      while (g[last] === 0) last--
      let given = 0
      for (let k = 0; k <= last; k++) {
        if (g[k] === 0) continue
        const f = k === last ? Math.max(0, wi - given) : scale * g[k]
        given += f
        const j = nb[k]
        if (j < 0) outflowDepth += f
        else next[j] += f
      }
    }
  }
  return { outflowDepth, flowed }
}

/**
 * 現在の W に §3.2 の式を当てはめたときの各セルの流出を、流出先の方向の単位ベクトルで
 * 重み付けして足したもの（m／step）。水は動かさない。濡れていないセルは 0
 */
export function computeFlowVectors(
  t: TerrainArrays,
  w: Float64Array,
  win: ScanWindow,
  s: Scratch,
): { x: Float32Array; y: Float32Array } {
  const { width, height } = t
  const vx = new Float32Array(width * height)
  const vy = new Float32Array(width * height)
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
  return { x: vx, y: vy }
}
```

Run: `pnpm vitest run src/simulation/FlowSolver.test.ts`
Expected: PASS（9 件）

- [ ] **Step 3: 型検査・lint・依存規則を通す**

Run: `pnpm typecheck && pnpm lint && pnpm depcheck`
Expected: すべて成功

- [ ] **Step 4: Commit**

```bash
git add src/simulation/FlowSolver.ts src/simulation/FlowSolver.test.ts
git commit -m "エンジン: 水面差に比例する 1 step の計算（Jacobi 方式、仮想セルへの流出）と流れのベクトル"
```

---

### Task 4: エンジン本体（統計・境界・平衡・流れのベクトル・reset）

**Files:**
- Create: `src/simulation/TsSimulationEngine.ts`、`src/simulation/TsSimulationEngine.test.ts`、`src/simulation/testing/fixtures.ts`

**Interfaces:**
- Consumes: `planRainfall`・`NoElevationAtRainCenterError`（Task 1）、`WaterGrid`（Task 2）、`solveStep`・`computeFlowVectors`・`createScratch`・`Scratch`・`TerrainArrays`・`FLOW_K`（Task 3）、`types.ts`（Task 1）
- Produces:
  - `type ScanMode = 'bbox' | 'full'`、`interface EngineOptions { scanMode?: ScanMode }`
  - `class TsSimulationEngine implements SimulationEngine`: `constructor(options: EngineOptions = {})`、`readonly scanMode: ScanMode`。`loadTerrain` の前に他のメソッドを呼ぶと `Error('loadTerrain を先に呼んでください')`
  - この Task の `setDepressions` は入力の検査だけを行い、`StepStats.events` は常に空。越流イベントは Task 5 で足す
  - `testing/fixtures.ts`: `interface Terrain { elevation: Float32Array; validMask: Uint8Array; meta: TerrainMeta }`、`buildTerrain(width, height, cellSizeM, f: (x, y) => number): Terrain`（f が NaN のセルは無効）、`engineOn(t: Terrain, options?: EngineOptions): TsSimulationEngine`、`cellCenter(x, y, cellSizeM): { x; y }`、`runUntilSettled(engine, maxSteps): StepStats`（届かなければ例外）、`walledBasin(size, floor, rim): Terrain`（外周 1 セルが rim、セル 1m）、`cone(size, slope, rim): Terrain`（中心からの距離 × slope、外周 1 セルが rim、セル 1m）、`sameBits(a: Float64Array, b: Float64Array): boolean`

- [ ] **Step 1: テスト用の地形と補助関数を置く**

`src/simulation/testing/fixtures.ts`（Task 6 で関数を足す）:

```ts
/**
 * テストとベンチマーク用の地形と補助関数。純粋な TypeScript（テストの外からも import できる）
 */
import { type EngineOptions, TsSimulationEngine } from '../TsSimulationEngine.ts'
import type { StepStats, TerrainMeta } from '../types.ts'

export interface Terrain {
  elevation: Float32Array
  validMask: Uint8Array
  meta: TerrainMeta
}

/** f(x, y) は列 x・行 y のセルの標高。NaN を返したセルは無効セルにする */
export function buildTerrain(
  width: number,
  height: number,
  cellSizeM: number,
  f: (x: number, y: number) => number,
): Terrain {
  const elevation = new Float32Array(width * height)
  const validMask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const z = f(x, y)
      const i = y * width + x
      if (Number.isNaN(z)) continue
      elevation[i] = z
      validMask[i] = 1
    }
  }
  return { elevation, validMask, meta: { width, height, cellSizeM } }
}

/** 地形を読み込んだエンジン */
export function engineOn(t: Terrain, options: EngineOptions = {}): TsSimulationEngine {
  const engine = new TsSimulationEngine(options)
  engine.loadTerrain(t.elevation, t.validMask, t.meta)
  return engine
}

/** 列 x・行 y のセルの中心の座標（グリッドの北西端からの m） */
export function cellCenter(x: number, y: number, cellSizeM: number): { x: number; y: number } {
  return { x: (x + 0.5) * cellSizeM, y: (y + 0.5) * cellSizeM }
}

/** settled になるまで step を回し、最後の統計を返す。maxSteps で届かなければ例外 */
export function runUntilSettled(engine: TsSimulationEngine, maxSteps: number): StepStats {
  for (let n = 0; n < maxSteps; n++) {
    const stats = engine.step()
    if (stats.settled) return stats
  }
  throw new Error(`${maxSteps} step で平衡に達しませんでした`)
}

/** 縁（外周 1 セル）の標高が rim、内側の標高が floor の盆地 */
export function walledBasin(size: number, floor: number, rim: number): Terrain {
  return buildTerrain(size, size, 1, (x, y) =>
    x === 0 || y === 0 || x === size - 1 || y === size - 1 ? rim : floor,
  )
}

/** 中心 (c, c) からの距離に比例して高くなるすり鉢。外周 1 セルは rim */
export function cone(size: number, slope: number, rim: number): Terrain {
  const c = (size - 1) / 2
  return buildTerrain(size, size, 1, (x, y) =>
    x === 0 || y === 0 || x === size - 1 || y === size - 1 ? rim : slope * Math.hypot(x - c, y - c),
  )
}

/** 2 つの配列がビット単位で一致する（+0 と −0、NaN の違いも区別する） */
export function sameBits(a: Float64Array, b: Float64Array): boolean {
  if (a.length !== b.length) return false
  const x = new BigUint64Array(a.buffer, a.byteOffset, a.length)
  const y = new BigUint64Array(b.buffer, b.byteOffset, b.length)
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false
  return true
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/simulation/TsSimulationEngine.test.ts`（spec 03 §6.3 の「降雨の正規化」「境界」「平衡の検出」「流れのベクトル」「reset」と、§3.8 の統計）:

```ts
import { describe, expect, it } from 'vitest'
import { massTolerance } from './constants.ts'
import { FLOW_K } from './FlowSolver.ts'
import { NoElevationAtRainCenterError } from './Rainfall.ts'
import { TsSimulationEngine } from './TsSimulationEngine.ts'
import {
  buildTerrain,
  cellCenter,
  cone,
  engineOn,
  runUntilSettled,
  sameBits,
  walledBasin,
} from './testing/fixtures.ts'

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
    engine.addRainfall({ ...cellCenter(2, 2, 1), radiusM: 0.4, amountMm: 100 })
    const stats = runUntilSettled(engine, 1000)
    expect(stats.outflowWater).toBe(0)
  })
})

describe('addRainfall（spec 03 §3.6）', () => {
  const cases = [0.98, 3.9, 7.8].flatMap((cs) => [1, 10, 100].map((r) => [cs, r]))

  it.each(cases)('セル %f m・半径 %f m: 投入量が πr² × 雨量と相対 1e-12 以内で一致', (cs, r) => {
    const n = Math.ceil(250 / cs)
    const engine = engineOn(buildTerrain(n, n, cs, () => 0))
    engine.addRainfall({ x: 125, y: 125, radiusM: r, amountMm: 100 })
    const expected = (Math.PI * r * r * 100) / 1000
    const placed = engine.waterDepth().reduce((a, d) => a + d, 0) * cs * cs
    expect(Math.abs(placed - expected) / expected).toBeLessThanOrEqual(1e-12)
    const stats = engine.step()
    expect(Math.abs(stats.totalWater - expected) / expected).toBeLessThanOrEqual(1e-12)
  })

  it('降雨中心に標高データが無ければエラーで、水も統計も変えない', () => {
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    expect(() => engine.addRainfall({ x: 2.5, y: 2.5, radiusM: 0.4, amountMm: 10 })).toThrow(
      NoElevationAtRainCenterError,
    )
    expect(engine.step().totalWater).toBe(0)
  })
})

describe('step の統計（spec 03 §3.8）', () => {
  it('投入量・貯留量・流出量・最大水深・浸水面積・質量誤差', () => {
    const engine = engineOn(walledBasin(7, 0, 10))
    // 中央のセル 1 つに π × 0.4² × 1 m³ ≈ 0.503 m³
    engine.addRainfall({ ...cellCenter(3, 3, 1), radiusM: 0.4, amountMm: 1000 })
    const s = engine.step()
    const v = Math.PI * 0.16
    expect(s.step).toBe(1)
    expect(s.totalWater).toBeCloseTo(v, 12)
    expect(s.storedWater).toBeCloseTo(v, 12)
    expect(s.outflowWater).toBe(0)
    // c = 0.5 なので半分が残る。8 近傍はすべて 1cm 以上になる
    expect(s.maxDepth).toBeCloseTo(v / 2, 12)
    expect(s.floodedArea).toBe(9)
    expect(s.settled).toBe(false)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
    expect(s.events).toEqual([])
  })

  it('水が無ければ settled で、統計はすべて 0', () => {
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
    })
  })
})

describe('境界と無効セル（spec 03 §3.3、§6.3）', () => {
  it('端のセルの水は流出し、outflowWater に入る', () => {
    // セル 2m（面積 4m²）の平面。角のセル (0, 0) にだけ水を置く
    const engine = engineOn(buildTerrain(3, 3, 2, () => 0))
    engine.addRainfall({ x: 1, y: 1, radiusM: 0.5, amountMm: 1000 })
    const w0 = engine.waterDepth()[0] ?? Number.NaN
    const s = engine.step()
    expect(s.outflowWater).toBeCloseTo(FLOW_K * (2 + 3 * Math.SQRT1_2) * w0 * 4, 12)
    expect(Math.abs(s.massError)).toBeLessThanOrEqual(massTolerance(s.totalWater))
  })

  it('無効セルに接するセルの水も流出する', () => {
    const engine = engineOn(buildTerrain(5, 5, 1, (x, y) => (x === 2 && y === 2 ? Number.NaN : 0)))
    engine.addRainfall({ ...cellCenter(1, 2, 1), radiusM: 0.4, amountMm: 1000 })
    const w = engine.waterDepth()[2 * 5 + 1] ?? Number.NaN
    const s = engine.step()
    expect(s.outflowWater).toBeCloseTo(FLOW_K * w, 12)
    expect(engine.waterDepth()[2 * 5 + 2]).toBe(0)
  })
})

describe('平衡の検出（§6.3）', () => {
  it('流れている間は settled が false、平衡後に true になり、その後は水が動かない', () => {
    const engine = engineOn(cone(9, 0.1, 5))
    engine.addRainfall({ ...cellCenter(6, 4, 1), radiusM: 1, amountMm: 100 })
    expect(engine.step().settled).toBe(false)
    expect(runUntilSettled(engine, 5000).settled).toBe(true)
    const before = engine.waterDepth().slice()
    expect(engine.step().settled).toBe(true)
    expect(sameBits(engine.waterDepth(), before)).toBe(true)
  })
})

describe('flowVectors（§3.9、§6.3）', () => {
  it('一様な斜面では、濡れたセルのベクトルが下り方向（東）を向き、水は動かない', () => {
    const engine = engineOn(buildTerrain(15, 9, 1, (x) => (14 - x) * 0.2))
    engine.addRainfall({ ...cellCenter(5, 4, 1), radiusM: 2, amountMm: 50 })
    const w = engine.waterDepth().slice()
    const v = engine.flowVectors()
    let wet = 0
    for (let i = 0; i < w.length; i++) {
      if (w[i] === 0) {
        expect([v.x[i], v.y[i]]).toEqual([0, 0])
        continue
      }
      wet++
      expect(v.x[i]).toBeGreaterThan(Math.abs(v.y[i] ?? 0))
    }
    expect(wet).toBe(13)
    expect(sameBits(engine.waterDepth(), w)).toBe(true)
  })
})

describe('reset（§6.3）', () => {
  it('水と統計を初期状態に戻し、地形は残す（以降は新しいエンジンとビット単位で同じ）', () => {
    const t = cone(9, 0.1, 5)
    const a = engineOn(t)
    const b = engineOn(t)
    const rain = { ...cellCenter(4, 4, 1), radiusM: 1.5, amountMm: 200 }
    a.addRainfall(rain)
    for (let n = 0; n < 50; n++) a.step()
    a.reset()
    expect(a.waterDepth().every((d) => d === 0)).toBe(true)
    a.addRainfall(rain)
    b.addRainfall(rain)
    for (let n = 0; n < 30; n++) expect(a.step()).toEqual(b.step())
    expect(sameBits(a.waterDepth(), b.waterDepth())).toBe(true)
  })
})
```

Run: `pnpm vitest run src/simulation/TsSimulationEngine.test.ts`
Expected: FAIL（`./TsSimulationEngine.ts` が見つからない）

- [ ] **Step 3: エンジンを実装する**

`src/simulation/TsSimulationEngine.ts`（越流イベントは Task 5 で足す）:

```ts
/**
 * SimulationEngine の TypeScript 実装（tech-spec §6.2、spec 03）
 */
import {
  computeFlowVectors,
  createScratch,
  type Scratch,
  solveStep,
  type TerrainArrays,
} from './FlowSolver.ts'
import { planRainfall } from './Rainfall.ts'
import type { RainfallInput, SimulationEngine, StepStats, TerrainMeta } from './types.ts'
import { WaterGrid } from './WaterGrid.ts'

/** 'bbox': 濡れたセルの外接矩形だけを走査する（既定）。'full': 全セルを走査する（比較用） */
export type ScanMode = 'bbox' | 'full'

export interface EngineOptions {
  scanMode?: ScanMode
}

interface Loaded {
  terrain: TerrainArrays
  meta: TerrainMeta
  grid: WaterGrid
}

export class TsSimulationEngine implements SimulationEngine {
  readonly scanMode: ScanMode
  private loaded: Loaded | null = null
  private stepCount = 0
  private totalWater = 0
  private outflowWater = 0
  private readonly scratch: Scratch = createScratch()

  constructor(options: EngineOptions = {}) {
    this.scanMode = options.scanMode ?? 'bbox'
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
    this.loaded = {
      terrain: { width, height, elevation: elevation.slice(), validMask: validMask.slice() },
      meta: { width, height, cellSizeM },
      grid: new WaterGrid(width, height, this.scanMode === 'full'),
    }
    this.resetCounters()
  }

  addRainfall(rain: RainfallInput): void {
    const { terrain, meta, grid } = this.require()
    const plan = planRainfall(rain, terrain.validMask, meta)
    for (const i of plan.cells) grid.current[i] += plan.depthM
    grid.include(plan.x0, plan.y0, plan.x1, plan.y1)
    this.totalWater += plan.volumeM3
  }

  step(): StepStats {
    const { terrain, meta, grid } = this.require()
    const area = meta.cellSizeM * meta.cellSizeM
    grid.beginStep()
    const flow = solveStep(terrain, grid.current, grid.next, grid, this.scratch)
    const summary = grid.endStep()
    this.stepCount++
    this.outflowWater += flow.outflowDepth * area
    const storedWater = summary.depthSum * area
    return {
      step: this.stepCount,
      totalWater: this.totalWater,
      storedWater,
      outflowWater: this.outflowWater,
      maxDepth: summary.maxDepth,
      floodedArea: summary.floodedCells * area,
      settled: !flow.flowed,
      massError: this.totalWater - storedWater - this.outflowWater,
      events: [],
    }
  }

  reset(): void {
    this.require().grid.clear()
    this.resetCounters()
  }

  waterDepth(): Float64Array {
    return this.require().grid.current
  }

  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void {
    const { terrain } = this.require()
    const n = terrain.width * terrain.height
    for (const d of list) {
      if (!Number.isInteger(d.pitIndex) || d.pitIndex < 0 || d.pitIndex >= n) {
        throw new RangeError(`窪地 ${d.id} の最低点のセル番号が範囲外です: ${d.pitIndex}`)
      }
    }
  }

  flowVectors(): { x: Float32Array; y: Float32Array } {
    const { terrain, grid } = this.require()
    return computeFlowVectors(terrain, grid.current, grid, this.scratch)
  }

  private resetCounters(): void {
    this.stepCount = 0
    this.totalWater = 0
    this.outflowWater = 0
  }

  private require(): Loaded {
    if (this.loaded === null) throw new Error('loadTerrain を先に呼んでください')
    return this.loaded
  }
}
```

Run: `pnpm vitest run src/simulation/TsSimulationEngine.test.ts`
Expected: PASS（20 件。降雨の正規化の 9 通りを含む）

- [ ] **Step 4: 型検査・lint・依存規則・カバレッジを通す**

Run: `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功。`src/simulation` の行カバレッジは 90% 以上（ほぼ 100%）

- [ ] **Step 5: Commit**

```bash
git add src/simulation/TsSimulationEngine.ts src/simulation/TsSimulationEngine.test.ts src/simulation/testing/fixtures.ts
git commit -m "エンジン: TsSimulationEngine（降雨・step・統計・平衡の検出・流れのベクトル・reset）"
```

---

### Task 5: 越流イベント

**Files:**
- Modify: `src/simulation/TsSimulationEngine.ts`
- Create: `src/simulation/spillEvents.test.ts`

**Interfaces:**
- Consumes: `SPILL_TOLERANCE_M`（Task 1）、`TsSimulationEngine`・`fixtures.ts`（Task 4）
- Produces: `setDepressions(list)` が窪地を保持し、各 step の終わりに、まだ通知していない窪地について `Z[pitIndex] + W[pitIndex] ≥ spillElevation − SPILL_TOLERANCE_M` なら `{ type: 'spill', step, depressionId, spillElevation }` を `StepStats.events` に入れる（窪地ごとに1回）。`reset()` で通知済みの記録を消す。`setDepressions` を呼び直すと通知済みの記録も新しくなる。`loadTerrain` は窪地の一覧を消す

- [ ] **Step 1: 失敗するテストを書く**

`src/simulation/spillEvents.test.ts`（窪地は `setDepressions()` に手で組んで渡す。02 の地形解析は使わない）:

```ts
import { describe, expect, it } from 'vitest'
import { SPILL_TOLERANCE_M } from './constants.ts'
import type { TsSimulationEngine } from './TsSimulationEngine.ts'
import { cellCenter, engineOn, walledBasin } from './testing/fixtures.ts'
import type { SimulationEvent } from './types.ts'

// 7 × 7 の盆地（床 0m、縁 10m、床は列・行 1〜5 の 25m²）。中央のセルを最低点、spill 標高 0.3m とする手組みの窪地
const BASIN = walledBasin(7, 0, 10)
const PIT = 3 * 7 + 3
const SPILL = 0.3

function setup(): TsSimulationEngine {
  const engine = engineOn(BASIN)
  engine.setDepressions([{ id: 7, pitIndex: PIT, spillElevation: SPILL }])
  return engine
}

/** 床全体（25 セル）に、平衡の水位が level になる量の雨を一様に降らせる。半径 2.9m は床の 25 セルだけを含む */
function rainOnFloor(engine: TsSimulationEngine, level: number): void {
  const amountMm = (level * 25 * 1000) / (Math.PI * 2.9 * 2.9)
  engine.addRainfall({ ...cellCenter(3, 3, 1), radiusM: 2.9, amountMm })
}

/** 床の北西の角のセル 1 つに、平衡の水位が level になる量の雨を降らせる */
function rainOnCorner(engine: TsSimulationEngine, level: number): void {
  const amountMm = (level * 25 * 1000) / (Math.PI * 0.4 * 0.4)
  engine.addRainfall({ ...cellCenter(1, 1, 1), radiusM: 0.4, amountMm })
}

/** steps 回まわして、出たイベントを集める */
function collect(engine: TsSimulationEngine, steps: number): SimulationEvent[] {
  const events: SimulationEvent[] = []
  for (let n = 0; n < steps; n++) events.push(...engine.step().events)
  return events
}

describe('越流イベント（spec 03 §3.7）', () => {
  it('最低点の水面標高が spill 標高 − 1cm に届かなければ通知しない', () => {
    const engine = setup()
    rainOnFloor(engine, 0.28)
    expect(collect(engine, 3000)).toEqual([])
  })

  it('届いた step で 1 回だけ通知し、その後は通知しない', () => {
    const engine = setup()
    rainOnCorner(engine, 0.35)
    const events: SimulationEvent[] = []
    let reachedAt = -1
    for (let n = 0; n < 3000; n++) {
      const s = engine.step()
      events.push(...s.events)
      const h = (BASIN.elevation[PIT] ?? 0) + (engine.waterDepth()[PIT] ?? 0)
      if (reachedAt < 0 && h >= SPILL - SPILL_TOLERANCE_M) reachedAt = s.step
    }
    expect(reachedAt).toBeGreaterThan(1)
    expect(events).toEqual([
      { type: 'spill', step: reachedAt, depressionId: 7, spillElevation: SPILL },
    ])
  })

  it('雨が窪地の端に局所的に溜まって spill 標高を超えても、最低点の水位が届かなければ通知しない', () => {
    const engine = setup()
    // 角のセルの水深ははじめ約 1.25m（spill 標高を大きく超える）。平衡の水位は 0.05m
    rainOnCorner(engine, 0.05)
    expect(collect(engine, 3000)).toEqual([])
  })

  it('reset で通知済みの記録が消え、もう一度通知する', () => {
    const engine = setup()
    rainOnFloor(engine, 0.35)
    expect(collect(engine, 10)).toHaveLength(1)
    engine.reset()
    rainOnFloor(engine, 0.35)
    expect(collect(engine, 10)).toHaveLength(1)
  })

  it('setDepressions で渡し直すと通知済みの記録も新しくなり、loadTerrain で窪地は消える', () => {
    const engine = setup()
    rainOnFloor(engine, 0.35)
    expect(collect(engine, 10)).toHaveLength(1)
    engine.setDepressions([{ id: 8, pitIndex: PIT, spillElevation: SPILL }])
    expect(collect(engine, 1).map((e) => e.depressionId)).toEqual([8])
    engine.loadTerrain(BASIN.elevation, BASIN.validMask, BASIN.meta)
    rainOnFloor(engine, 0.35)
    expect(collect(engine, 10)).toEqual([])
  })

  it('最低点のセル番号が範囲外か整数でなければ RangeError', () => {
    const engine = engineOn(BASIN)
    const bad = [
      { id: 1, pitIndex: 49, spillElevation: 1 },
      { id: 1, pitIndex: -1, spillElevation: 1 },
      { id: 1, pitIndex: 1.5, spillElevation: 1 },
    ]
    for (const d of bad) expect(() => engine.setDepressions([d])).toThrow(RangeError)
  })
})
```

Run: `pnpm vitest run src/simulation/spillEvents.test.ts`
Expected: FAIL（「届いた step で 1 回だけ通知し」「reset で…もう一度通知する」「setDepressions で渡し直すと…」の 3 件。イベントが空のため）

- [ ] **Step 2: 越流イベントを実装する**

`src/simulation/TsSimulationEngine.ts` を次の内容にする（Task 4 から、import に `SPILL_TOLERANCE_M` と `SimulationEvent`、フィールド `depressions`・`notified`、`loadTerrain`・`reset`・`setDepressions`・`step` の変更、`detectSpills` を足す）:

```ts
/**
 * SimulationEngine の TypeScript 実装（tech-spec §6.2、spec 03）
 */
import { SPILL_TOLERANCE_M } from './constants.ts'
import {
  computeFlowVectors,
  createScratch,
  type Scratch,
  solveStep,
  type TerrainArrays,
} from './FlowSolver.ts'
import { planRainfall } from './Rainfall.ts'
import type {
  RainfallInput,
  SimulationEngine,
  SimulationEvent,
  StepStats,
  TerrainMeta,
} from './types.ts'
import { WaterGrid } from './WaterGrid.ts'

/** 'bbox': 濡れたセルの外接矩形だけを走査する（既定）。'full': 全セルを走査する（比較用） */
export type ScanMode = 'bbox' | 'full'

export interface EngineOptions {
  scanMode?: ScanMode
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
}

export class TsSimulationEngine implements SimulationEngine {
  readonly scanMode: ScanMode
  private loaded: Loaded | null = null
  private depressions: Depression[] = []
  private notified = new Uint8Array(0)
  private stepCount = 0
  private totalWater = 0
  private outflowWater = 0
  private readonly scratch: Scratch = createScratch()

  constructor(options: EngineOptions = {}) {
    this.scanMode = options.scanMode ?? 'bbox'
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
    this.loaded = {
      terrain: { width, height, elevation: elevation.slice(), validMask: validMask.slice() },
      meta: { width, height, cellSizeM },
      grid: new WaterGrid(width, height, this.scanMode === 'full'),
    }
    this.depressions = []
    this.notified = new Uint8Array(0)
    this.resetCounters()
  }

  addRainfall(rain: RainfallInput): void {
    const { terrain, meta, grid } = this.require()
    const plan = planRainfall(rain, terrain.validMask, meta)
    for (const i of plan.cells) grid.current[i] += plan.depthM
    grid.include(plan.x0, plan.y0, plan.x1, plan.y1)
    this.totalWater += plan.volumeM3
  }

  step(): StepStats {
    const { terrain, meta, grid } = this.require()
    const area = meta.cellSizeM * meta.cellSizeM
    grid.beginStep()
    const flow = solveStep(terrain, grid.current, grid.next, grid, this.scratch)
    const summary = grid.endStep()
    this.stepCount++
    this.outflowWater += flow.outflowDepth * area
    const storedWater = summary.depthSum * area
    return {
      step: this.stepCount,
      totalWater: this.totalWater,
      storedWater,
      outflowWater: this.outflowWater,
      maxDepth: summary.maxDepth,
      floodedArea: summary.floodedCells * area,
      settled: !flow.flowed,
      massError: this.totalWater - storedWater - this.outflowWater,
      events: this.detectSpills(terrain.elevation, grid.current),
    }
  }

  reset(): void {
    this.require().grid.clear()
    this.notified.fill(0)
    this.resetCounters()
  }

  waterDepth(): Float64Array {
    return this.require().grid.current
  }

  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void {
    const { terrain } = this.require()
    const n = terrain.width * terrain.height
    for (const d of list) {
      if (!Number.isInteger(d.pitIndex) || d.pitIndex < 0 || d.pitIndex >= n) {
        throw new RangeError(`窪地 ${d.id} の最低点のセル番号が範囲外です: ${d.pitIndex}`)
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
    const { terrain, grid } = this.require()
    return computeFlowVectors(terrain, grid.current, grid, this.scratch)
  }

  /** まだ通知していない窪地のうち、最低点の水面標高が spill 標高 − 1cm に達したもの（§3.7） */
  private detectSpills(elevation: Float32Array, w: Float64Array): SimulationEvent[] {
    const events: SimulationEvent[] = []
    for (let k = 0; k < this.depressions.length; k++) {
      if (this.notified[k] !== 0) continue
      const d = this.depressions[k]
      if (elevation[d.pitIndex] + w[d.pitIndex] >= d.spillElevation - SPILL_TOLERANCE_M) {
        this.notified[k] = 1
        events.push({
          type: 'spill',
          step: this.stepCount,
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
  }

  private require(): Loaded {
    if (this.loaded === null) throw new Error('loadTerrain を先に呼んでください')
    return this.loaded
  }
}
```

Run: `pnpm vitest run src/simulation`
Expected: PASS（`spillEvents.test.ts` の 6 件を含むすべて）

- [ ] **Step 3: 型検査・lint・依存規則を通す**

Run: `pnpm typecheck && pnpm lint && pnpm depcheck`
Expected: すべて成功

- [ ] **Step 4: Commit**

```bash
git add src/simulation/TsSimulationEngine.ts src/simulation/spillEvents.test.ts
git commit -m "エンジン: 越流イベント（窪地の最低点の水位で判定し、窪地ごとに1回通知）"
```

---

### Task 6: base-spec §47 の 4 ケースと平衡水位

**Files:**
- Modify: `src/simulation/testing/fixtures.ts`（関数を足す）
- Create: `src/simulation/scenarios.test.ts`

**Interfaces:**
- Consumes: `TsSimulationEngine`（Task 5）、`fixtures.ts`（Task 4）、`SURFACE_ELEVATION_TOLERANCE_M`
- Produces（`fixtures.ts` に足す。Task 10 も使う）:
  - `twoBasins(passZ: number): Terrain`（31 × 11、セル 1m。床 0m、外周と列 15 の仕切りは 5m、峠（列 15・行 5）は passZ。西の盆地 A は列 1〜14、東の盆地 B は列 16〜29、どちらも行 1〜9）
  - `wetSurfaceRange(t: Terrain, w: Float64Array): { cells: number; min: number; max: number }`（W > 0 のセルの数と、その水面標高の最小・最大）
  - `levelForVolume(t: Terrain, volumeM3: number): number`（Σ max(0, h − Z) × A = V となる h。二分法）
  - `centroidX(t: Terrain, w: Float64Array): number`（水深で重み付けした重心の列番号）
  - `maxWetElevation(t: Terrain, w: Float64Array): number`（水のあるセルの標高の最大）

spec 03 §6.1 の表のうち、「満水との一致」以外の 5 行をここで書く（「満水との一致」は Task 10）。エンジンは Task 5 で完成しているので、これらは受け入れのテストであり、書いてすぐ通るのが正しい。

各ケースの地形と数値の根拠:
- **平面**: 12 × 12 の盆地（床 10 × 10 = 100m²、縁 10m）。約 12.6m³ で水深約 12.6cm。境界から排水されるので、縁の無い平面は使わない（spec の注記）
- **傾斜面**: 東へ 1 セルにつき 0.2m 下る。雨の深さ（約 5cm）が 1 セルの高低差より小さいので、最大値原理により、置いた位置より高いセルの水面標高は超えられない。15 step では水は東端（列 39）に届かず、流出で重心がずれることもない
- **単純窪地**: 勾配 0.1 のすり鉢。約 1.41m³ で池の半径は約 2.4 セル。雨は中心から 6 セル東（池の外）に降らせる。平衡では、低い近傍が乾いている斜面のセルは水を持てない（θ を超える水面差があれば流れる）ので、水のあるセルはすべて池の中にあり、その水面は 1cm 以内で平らになる
- **越流**: A に約 150.8m³（A の峠までの容量 126m³ を約 25m³ 超える）。B に移る水は B を約 0.2m 満たすだけで、B の最低点は spill 標高 − 1cm に届かない。したがってイベントは A の1回だけ
- **平衡水位**: すり鉢に 20m³。池の幅は約 12 セル

- [ ] **Step 1: 補助関数を足す**

`src/simulation/testing/fixtures.ts` の `cone` の後（`sameBits` の前）に足す:

```ts
/**
 * 峠でつながった 2 つの盆地（31 × 11、セル 1m）。床は 0m、外周と仕切り（列 15）は 5m、
 * 峠（列 15・行 5）は passZ。西の盆地 A は列 1〜14、東の盆地 B は列 16〜29（どちらも行 1〜9）
 */
export function twoBasins(passZ: number): Terrain {
  return buildTerrain(31, 11, 1, (x, y) => {
    if (x === 0 || y === 0 || x === 30 || y === 10) return 5
    if (x === 15) return y === 5 ? passZ : 5
    return 0
  })
}

/** 水のあるセル（W > 0）の数と、その水面標高 Z + W の最小・最大 */
export function wetSurfaceRange(
  t: Terrain,
  w: Float64Array,
): { cells: number; min: number; max: number } {
  let cells = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < w.length; i++) {
    if (w[i] === 0) continue
    const h = t.elevation[i] + w[i]
    cells++
    if (h < min) min = h
    if (h > max) max = h
  }
  return { cells, min, max }
}

/** Σ max(0, h − Z) × A = volumeM3 となる水面標高 h（有効セルすべてが対象。二分法） */
export function levelForVolume(t: Terrain, volumeM3: number): number {
  const area = t.meta.cellSizeM * t.meta.cellSizeM
  let lo = Number.POSITIVE_INFINITY
  let hi = Number.NEGATIVE_INFINITY
  for (let i = 0; i < t.elevation.length; i++) {
    if (t.validMask[i] === 0) continue
    lo = Math.min(lo, t.elevation[i])
    hi = Math.max(hi, t.elevation[i])
  }
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2
    let v = 0
    for (let i = 0; i < t.elevation.length; i++) {
      if (t.validMask[i] !== 0) v += Math.max(0, mid - t.elevation[i]) * area
    }
    if (v < volumeM3) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 水の重心の列番号（水深で重み付け） */
export function centroidX(t: Terrain, w: Float64Array): number {
  let sum = 0
  let moment = 0
  for (let i = 0; i < w.length; i++) {
    sum += w[i]
    moment += w[i] * (i % t.meta.width)
  }
  return moment / sum
}

/** 水のあるセルの標高の最大 */
export function maxWetElevation(t: Terrain, w: Float64Array): number {
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < w.length; i++) if (w[i] > 0 && t.elevation[i] > max) max = t.elevation[i]
  return max
}
```

- [ ] **Step 2: テストを書く**

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
  levelForVolume,
  maxWetElevation,
  runUntilSettled,
  twoBasins,
  walledBasin,
  wetSurfaceRange,
} from './testing/fixtures.ts'
import type { SimulationEvent } from './types.ts'

describe('base-spec §47 の 4 ケースと平衡水位（spec 03 §6.1）', () => {
  it('平面: 縁で囲んだ平らな盆地に置いた水が広がり、平衡後の水面の最大と最小の差が 1cm 以内', () => {
    // 12 × 12（床 10 × 10 = 100m²、縁 10m）。約 12.6m³ を床の北西寄りに置く
    const t = walledBasin(12, 0, 10)
    const engine = engineOn(t)
    engine.addRainfall({ ...cellCenter(3, 3, 1), radiusM: 2, amountMm: 1000 })
    const stats = runUntilSettled(engine, 20_000)
    const r = wetSurfaceRange(t, engine.waterDepth())
    expect(r.cells).toBe(100)
    expect(r.max - r.min).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(stats.outflowWater).toBe(0)
  })

  it('傾斜面: 水は下り方向にしか動かず、置いた位置より高いセルは水を得ず、重心が下り方向へ移る', () => {
    // 東へ 1 セルにつき 0.2m 下る斜面。雨の深さ（約 5cm）は 1 セルの高低差より小さい
    const t = buildTerrain(40, 41, 1, (x) => (39 - x) * 0.2)
    const engine = engineOn(t)
    engine.addRainfall({ ...cellCenter(10, 20, 1), radiusM: 3, amountMm: 50 })
    const zTop = maxWetElevation(t, engine.waterDepth())
    const start = centroidX(t, engine.waterDepth())
    let prev = start
    for (let n = 0; n < 15; n++) {
      engine.step()
      expect(maxWetElevation(t, engine.waterDepth())).toBeLessThanOrEqual(zTop)
      const c = centroidX(t, engine.waterDepth())
      expect(c).toBeGreaterThanOrEqual(prev)
      prev = c
    }
    expect(prev).toBeGreaterThan(start + 1)
  })

  it('単純窪地: 窪地の外に置いた水が窪地に集まり、平衡後の水面が 1cm 以内で平ら', () => {
    // すり鉢（中心 (10, 10)、勾配 0.1）。雨は中心から 6 セル東の斜面に降らせる
    const t = cone(21, 0.1, 5)
    const engine = engineOn(t)
    engine.addRainfall({ ...cellCenter(16, 10, 1), radiusM: 1.5, amountMm: 200 })
    const stats = runUntilSettled(engine, 50_000)
    const w = engine.waterDepth()
    const r = wetSurfaceRange(t, w)
    expect(r.max - r.min).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(w[10 * 21 + 10]).toBeGreaterThan(0.1)
    expect(w[10 * 21 + 16]).toBe(0)
    expect(stats.outflowWater).toBe(0)
  })

  it('越流: 峠でつながった 2 つの窪地の一方に容量を超える水を置くと、もう一方が水を得て、越流イベントが 1 回だけ出る', () => {
    // 西の盆地 A（床 14 × 9 = 126m²）と東の盆地 B を、高さ 1m の峠でつなぐ。A の峠までの容量は 126m³
    const t = twoBasins(1)
    const engine = engineOn(t)
    engine.setDepressions([
      { id: 1, pitIndex: 5 * 31 + 7, spillElevation: 1 },
      { id: 2, pitIndex: 5 * 31 + 23, spillElevation: 1 },
    ])
    // 約 150.8m³（A の容量を約 25m³ 超える。B は峠まで満ちない）
    engine.addRainfall({ ...cellCenter(7, 5, 1), radiusM: 4, amountMm: 3000 })
    const events: SimulationEvent[] = []
    for (let n = 0; n < 3000; n++) events.push(...engine.step().events)
    expect(events.map((e) => e.depressionId)).toEqual([1])
    const w = engine.waterDepth()
    let inB = 0
    for (let y = 1; y < 10; y++) for (let x = 16; x < 30; x++) inB += w[y * 31 + x] ?? 0
    expect(inB).toBeGreaterThan(1)
  })

  it('平衡水位: 縁に囲まれた窪地に体積 V の水を入れると、平衡後の水面標高が理論値と 1cm 以内で一致', () => {
    const t = cone(21, 0.1, 5)
    const engine = engineOn(t)
    const volume = 20
    const amountMm = (volume * 1000) / (Math.PI * 9)
    engine.addRainfall({ ...cellCenter(10, 10, 1), radiusM: 3, amountMm })
    const stats = runUntilSettled(engine, 100_000)
    const level = levelForVolume(t, volume)
    const r = wetSurfaceRange(t, engine.waterDepth())
    expect(Math.abs(r.min - level)).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(Math.abs(r.max - level)).toBeLessThanOrEqual(SURFACE_ELEVATION_TOLERANCE_M)
    expect(stats.outflowWater).toBe(0)
  })
})
```

- [ ] **Step 3: テストを実行する**

Run: `pnpm vitest run src/simulation/scenarios.test.ts`
Expected: PASS（5 件。全体で 0.2 秒程度）。失敗したら、テストの数値を緩めずに、エンジンと spec 03 §3.2 の式の食い違いを superpowers:systematic-debugging で調べる

- [ ] **Step 4: 型検査・lint・依存規則を通す**

Run: `pnpm typecheck && pnpm lint && pnpm depcheck`
Expected: すべて成功

- [ ] **Step 5: Commit**

```bash
git add src/simulation/testing/fixtures.ts src/simulation/scenarios.test.ts
git commit -m "エンジンのテスト: base-spec §47 の 4 ケース（平面・傾斜面・単純窪地・越流）と平衡水位"
```

---

### Task 7: 性質のテスト（fast-check）

**Files:**
- Modify: `package.json`、`pnpm-lock.yaml`（fast-check 4.9.0）
- Create: `src/simulation/properties.test.ts`

**Interfaces:**
- Consumes: `TsSimulationEngine`・`ScanMode`（Task 5）、`buildTerrain`・`engineOn`・`sameBits`・`Terrain`（Task 4）、`massTolerance`
- Produces: なし（CI の必須ゲートになるテスト。tech-spec §11.3）

spec 03 §6.2 の 5 つの性質を書く。地形は平坦・斜面・複数の窪地（sin・cos の凹凸）・ランダムな凹凸の 4 種に、無効セルを 0%・10%・30% で混ぜる。大きさは 3〜16 セル四方、セルの大きさは 0.98m・3.9m・7.8m。降雨は 1〜3 回（降雨中心は有効セルの中心に置き、各降雨は 0〜step 数 − 1 回目の step の前に入れる）、step は 1〜200 回。

- 最大値原理の検査は、エンジンの近傍の表を借りずに spec 03 §3.3 から独立に書く（検査がエンジンと同じ誤りを持たないように）
- 検査の中で要素ごとに `expect` を呼ぶと遅すぎる（「事前に確かめた事実」）。違反の説明を返す関数にして、`expect(...).toBeNull()` を 1 step に 1 回だけ呼ぶ
- テストファイルは `noUncheckedIndexedAccess` が有効なので、配列の要素を計算に使うところは `?? 0` を付ける

- [ ] **Step 1: fast-check を入れる**

Run: `pnpm add -DE fast-check@4.9.0`
Expected: 成功。`package.json` の devDependencies に `"fast-check": "4.9.0"`、依存として pure-rand 8.4.2 が入る。新しすぎる版の承認を求められても承認しない（4.9.0 は 2026-07-08 公開で、クールダウンの 10 日を過ぎている）。ビルドスクリプトの許可を求められたら、その名前を `pnpm-workspace.yaml` の `allowBuilds` に `false` で足し、理由のコメントを付ける

- [ ] **Step 2: 性質のテストを書く**

`src/simulation/properties.test.ts`:

```ts
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { massTolerance } from './constants.ts'
import type { ScanMode, TsSimulationEngine } from './TsSimulationEngine.ts'
import { buildTerrain, engineOn, sameBits, type Terrain } from './testing/fixtures.ts'
import type { RainfallInput, StepStats } from './types.ts'

interface Scenario {
  terrain: Terrain
  /** atStep 回目の step の前に降らせる */
  rains: { atStep: number; rain: RainfallInput }[]
  steps: number
}

const MAX_SIDE = 16
const KINDS = ['flat', 'slope', 'pits', 'bumpy'] as const

/** 地形: 平坦・斜面・複数の窪地・ランダムな凹凸に、無効セルを混ぜる（spec 03 §6.2） */
const terrainArb: fc.Arbitrary<Terrain> = fc
  .record({
    width: fc.integer({ min: 3, max: MAX_SIDE }),
    height: fc.integer({ min: 3, max: MAX_SIDE }),
    cellSizeM: fc.constantFrom(0.98, 3.9, 7.8),
    kind: fc.constantFrom(...KINDS),
    a: fc.double({ min: -1, max: 1, noNaN: true }),
    b: fc.double({ min: -1, max: 1, noNaN: true }),
    noise: fc.array(fc.integer({ min: 0, max: 1000 }), {
      minLength: MAX_SIDE * MAX_SIDE,
      maxLength: MAX_SIDE * MAX_SIDE,
    }),
    invalidPercent: fc.constantFrom(0, 0, 10, 30),
  })
  .map(({ width, height, cellSizeM, kind, a, b, noise, invalidPercent }) => {
    const t = buildTerrain(width, height, cellSizeM, (x, y) => {
      const i = y * width + x
      if ((noise[(i * 7919) % noise.length] ?? 0) % 100 < invalidPercent) return Number.NaN
      switch (kind) {
        case 'flat':
          return 10
        case 'slope':
          return 10 + a * x + b * y
        case 'pits':
          return 10 + (Math.abs(a) + 0.2) * Math.sin(x * 1.3) * Math.cos(y * 1.1)
        case 'bumpy':
          return 10 + ((noise[i] ?? 0) / 1000) * (Math.abs(b) * 5 + 0.01)
      }
    })
    // 有効セルが 1 つも無い地形は降雨できないので、左上を有効にする
    if (t.validMask.every((v) => v === 0)) {
      t.validMask[0] = 1
      t.elevation[0] = 10
    }
    return t
  })

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    terrain: terrainArb,
    steps: fc.integer({ min: 1, max: 200 }),
    rains: fc.array(
      fc.record({
        atStep: fc.nat(),
        cell: fc.nat(),
        radiusCells: fc.double({ min: 0.1, max: 8, noNaN: true }),
        amountMm: fc.integer({ min: 1, max: 1000 }),
      }),
      { minLength: 1, maxLength: 3 },
    ),
  })
  .map(({ terrain, steps, rains }) => {
    const valid: number[] = []
    terrain.validMask.forEach((v, i) => {
      if (v !== 0) valid.push(i)
    })
    const { width, cellSizeM } = terrain.meta
    return {
      terrain,
      steps,
      // 降雨中心は有効セルの中心に置く（「降雨中心に標高データがありません」にしない）
      rains: rains.map((r) => {
        const c = valid[r.cell % valid.length] ?? 0
        return {
          atStep: r.atStep % steps,
          rain: {
            x: ((c % width) + 0.5) * cellSizeM,
            y: (Math.floor(c / width) + 0.5) * cellSizeM,
            radiusM: r.radiusCells * cellSizeM,
            amountMm: r.amountMm,
          },
        }
      }),
    }
  })

/**
 * 局所的な最大値原理の検査（spec 03 §6.2）。有効セル i の次の水面標高が、i 自身と 8 近傍の今の
 * 水面標高の最小・最大の間（丸め誤差 1e-9 m を許す）に無ければ、その説明を返す。
 * 近傍の定義はエンジンから借りず、§3.3 から独立に書く（グリッドの外と無効セルは、標高 Z_i・水深 0）
 */
function maxPrincipleViolation(
  t: Terrain,
  before: Float64Array,
  after: Float64Array,
): string | null {
  const { elevation, validMask, meta } = t
  const { width, height } = meta
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (validMask[i] === 0) continue
      const zi = elevation[i] ?? 0
      let lo = zi + (before[i] ?? 0)
      let hi = lo
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          const j = ny * width + nx
          const real = nx >= 0 && nx < width && ny >= 0 && ny < height && validMask[j] !== 0
          const h = real ? (elevation[j] ?? 0) + (before[j] ?? 0) : zi
          if (h < lo) lo = h
          if (h > hi) hi = h
        }
      }
      const next = zi + (after[i] ?? 0)
      if (next < lo - 1e-9 || next > hi + 1e-9) {
        return `セル (${x}, ${y}): 次の水面標高 ${next} が [${lo}, ${hi}] の外`
      }
    }
  }
  return null
}

/** シナリオを実行し、各 step の後に onStep を呼ぶ。before は step の前の水深の複製 */
function run(
  s: Scenario,
  scanMode: ScanMode,
  onStep: (engine: TsSimulationEngine, stats: StepStats, before: Float64Array) => void,
): TsSimulationEngine {
  const engine = engineOn(s.terrain, { scanMode })
  for (let n = 0; n < s.steps; n++) {
    for (const r of s.rains) if (r.atStep === n) engine.addRainfall(r.rain)
    const before = engine.waterDepth().slice()
    const stats = engine.step()
    onStep(engine, stats, before)
  }
  return engine
}

describe('性質のテスト（spec 03 §6.2、tech-spec §11.3）', () => {
  it('質量保存: 各 step で |massError| ≤ totalWater × 1e-9', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (_, stats) => {
          expect(Math.abs(stats.massError)).toBeLessThanOrEqual(massTolerance(stats.totalWater))
        })
      }),
    )
  })

  it('非負: すべての step で W ≥ 0', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (engine) => {
          expect(engine.waterDepth().every((d) => d >= 0)).toBe(true)
        })
      }),
    )
  })

  it('局所的な最大値原理: 次の水面標高は、自身と 8 近傍の今の水面標高の範囲に入る', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        run(s, 'bbox', (engine, _, before) => {
          expect(maxPrincipleViolation(s.terrain, before, engine.waterDepth())).toBeNull()
        })
      }),
    )
  })

  it('決定性: 同じ入力を 2 回実行すると W がビット単位で一致する', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const a = run(s, 'bbox', () => {})
        const b = run(s, 'bbox', () => {})
        expect(sameBits(a.waterDepth(), b.waterDepth())).toBe(true)
      }),
    )
  })

  it("走査範囲: scanMode 'bbox' と 'full' で W と統計がビット単位で一致する", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const statsFull: StepStats[] = []
        const full = run(s, 'full', (_, stats) => statsFull.push(stats))
        const statsBbox: StepStats[] = []
        const bbox = run(s, 'bbox', (_, stats) => statsBbox.push(stats))
        expect(sameBits(bbox.waterDepth(), full.waterDepth())).toBe(true)
        expect(statsBbox).toEqual(statsFull)
      }),
    )
  })
})
```

- [ ] **Step 3: テストを実行する**

Run: `pnpm vitest run src/simulation/properties.test.ts`
Expected: PASS（5 件。1 件あたり 0.1 秒程度）。反例が出たら、fast-check が表示する縮小した反例（`Counterexample` と `seed`）を控え、superpowers:systematic-debugging で原因を調べる

- [ ] **Step 4: テストが誤りを検出できることを確かめる（一時的な改変。コミットしない）**

`src/simulation/FlowSolver.ts` の `solveStep` の `if (total <= wi) {` を `if (total <= wi || wi > 0) {` に書き換える（持っている水より多く出してしまう誤り）。

Run: `pnpm vitest run src/simulation/properties.test.ts src/simulation/FlowSolver.test.ts`
Expected: FAIL。少なくとも「質量保存」「非負」「局所的な最大値原理」と、FlowSolver の「持っている水より多くは出さず…」が失敗する

Run: `git restore src/simulation/FlowSolver.ts && pnpm vitest run src/simulation`
Expected: 元に戻り、すべて PASS

- [ ] **Step 5: 型検査・lint・依存規則・カバレッジを通す**

Run: `pnpm typecheck && pnpm lint && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（テストファイルは `core-is-pure` の対象外なので、fast-check の import は通る）

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/simulation/properties.test.ts
git commit -m "エンジンのテスト: 性質のテスト（質量保存・非負・最大値原理・決定性・走査範囲）、fast-check 4.9.0"
```

---

### Task 8: ベンチマーク

**Files:**
- Create: `scripts/bench-engine.ts`
- Modify: `tsconfig.node.json`、`package.json`（scripts に `bench:engine`）

**Interfaces:**
- Consumes: `TsSimulationEngine`、`RainfallInput`・`StepStats`（`src/simulation`）
- Produces: `pnpm bench:engine [上限の step 数]`。Markdown の表を標準出力に出す（Task 9 で PR 本文に貼る）

spec 03 §5 のとおり、Node 24 で直接実行する（型注釈は Node が取り除く。依存は増やさない）。計時はスクリプトの側で `performance.now()` を使う。CI のゲートにはしない。

**型検査の扱い（決定）:** `scripts/bench-engine.ts` を `tsconfig.node.json` の `include` に足し、同じファイルに `references: [{ "path": "./tsconfig.sim.json" }]` を足す。参照しないと、`src/simulation` のソースを node の設定（`noUncheckedIndexedAccess: true`）で検査して TS2532 で失敗する（「事前に確かめた事実」、tech-spec §10.3）。専用の tsconfig は作らない（node の設定で lib・types が足りており、`tsconfig.core.json` が sim を参照するのと同じ形で済むため）。スクリプトの中では `noUncheckedIndexedAccess` が有効なので、配列の要素には `?? Number.NaN` を付ける。

- [ ] **Step 1: 型検査の設定を変える**

`tsconfig.node.json` を次の内容にする:

```jsonc
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "tsBuildInfoFile": "node_modules/.tmp/tsc/node.tsbuildinfo",
    // DOM は、E2E の page.evaluate の中で window などを参照するため。
    // E2E が src/ui/strings.ts を import するので、strings.ts は app とこのプロジェクトの両方で検査される（意図どおり）
    "lib": ["ES2023", "DOM"],
    "types": ["node"]
  },
  "include": [
    "vite.config.ts",
    "vitest.config.ts",
    "playwright.config.ts",
    "tests/e2e/**/*.ts",
    "scripts/**/*.ts"
  ],
  // scripts/bench-engine.ts は src/simulation を import する。参照しないと、simulation のソースを
  // このプロジェクトの設定（noUncheckedIndexedAccess: true）で検査してしまう（tech-spec §10.3）
  "references": [{ "path": "./tsconfig.sim.json" }]
}
```

`package.json` の scripts の `"licenses"` の次の行に足す:

```json
"bench:engine": "node scripts/bench-engine.ts",
```

- [ ] **Step 2: ベンチマークを書く**

`scripts/bench-engine.ts`:

```ts
/**
 * エンジンのベンチマーク（spec 03 §5）。Node 24 で直接実行する（型注釈は Node が取り除く）:
 *
 *   pnpm bench:engine [上限の step 数（既定 100000）]
 *
 * 512 × 512 の合成地形（窪地と斜面を含む）に、半径 10m と 100m・雨量 100mm を降らせ、
 * 1 step の所要時間の中央値と p95、平衡までの step 数を Markdown の表で出す。
 * 計時はこのスクリプトで行う（src/simulation は performance を参照できない）。
 * CI のゲートにはしない。結果は PR に記録し、tech-spec §6.3 の基準（中央値 8ms、p95 16ms）と比べる
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

function run(label: string, elevation: Float32Array, rain: RainfallInput, maxSteps: number): void {
  const engine = new TsSimulationEngine()
  const validMask = new Uint8Array(SIZE * SIZE).fill(1)
  engine.loadTerrain(elevation, validMask, { width: SIZE, height: SIZE, cellSizeM: CELL_M })
  engine.addRainfall(rain)
  const times: number[] = []
  let last: StepStats | null = null
  const started = performance.now()
  for (let n = 0; n < maxSteps; n++) {
    const t0 = performance.now()
    last = engine.step()
    times.push(performance.now() - t0)
    if (last.settled) break
  }
  const seconds = (performance.now() - started) / 1000
  times.sort((a, b) => a - b)
  const settled = last?.settled ? `${last.step}` : `未到達（上限 ${maxSteps}）`
  const cells = [
    label,
    String(times.length),
    percentile(times, 0.5).toFixed(3),
    percentile(times, 0.95).toFixed(3),
    settled,
    (last?.maxDepth ?? 0).toFixed(3),
    (last?.massError ?? 0).toExponential(2),
    seconds.toFixed(1),
  ]
  console.log(`| ${cells.join(' | ')} |`)
}

const maxSteps = Number(process.argv[2] ?? 100_000)
const elevation = syntheticElevation()
const center = { x: 256.5 * CELL_M, y: 256.5 * CELL_M }

console.log(`Node ${process.version}、${SIZE} × ${SIZE}、セル ${CELL_M}m、上限 ${maxSteps} step`)
console.log('')
console.log(
  '| 降雨 | step 数 | 中央値（ms） | p95（ms） | 平衡までの step | 最大水深（m） | 質量誤差（m³） | 所要（秒） |',
)
console.log('|---|---:|---:|---:|---:|---:|---:|---:|')
run('半径 10m・100mm', elevation, { ...center, radiusM: 10, amountMm: 100 }, maxSteps)
run('半径 100m・100mm', elevation, { ...center, radiusM: 100, amountMm: 100 }, maxSteps)
```

- [ ] **Step 3: 型検査と lint を通す**

Run: `pnpm typecheck && pnpm lint`
Expected: 成功。確認のため、Step 1 の `references` を一時的に消して `pnpm typecheck` を実行すると、`src/simulation/FlowSolver.ts` などで TS2532 が出ることを見てから、元に戻す（結果を PR に記録する）

- [ ] **Step 4: ベンチマークを実行する**

Run: `pnpm bench:engine 2000`（動作確認。十数秒）
Expected: 警告なしで表が出る。半径 100m の中央値は数 ms

Run: `pnpm bench:engine`（本番。1〜2 分）
Expected: 2 行とも「平衡までの step」に数値が出る（開発機の Node での目安: 半径 10m は約 2,250 step・中央値 0.03ms、半径 100m は約 19,600 step・中央値 2.9ms・p95 6.2ms）。質量誤差は 1e-10 m³ 程度以下。出力の表をそのまま控える（Task 9 で PR 本文に貼る）

- [ ] **Step 5: Commit**

```bash
git add scripts/bench-engine.ts tsconfig.node.json package.json
git commit -m "ベンチマーク: 512 × 512 の合成地形で 1 step の所要時間と平衡までの step 数（Node で直接実行）"
```

---

### Task 9: tech-spec の改訂と引き継ぎ（02 を待つ時点まで）

**Files:**
- Modify: `specs/tech-spec.md`（§4.1、§6.5）
- Create: `.handoff/03-simulation-engine.md`（git 管理外）。`.handoff/README.md` に 03 の行を足す（無ければ 01 の計画の Task 9 の形式で作る）

**Interfaces:**
- Consumes: Task 1〜8 の成果、Task 8 のベンチマークの表
- Produces: PR 本文の下書き（Task 10 で仕上げる）

- [ ] **Step 1: tech-spec §6.2・§6.6 が改訂済みであることを確かめる（spec 03 §7 の完了条件 4、T2・T3）**

Run: `grep -n "setDepressions\|flowVectors\|massError\|settled\|流れの閾値 θ" specs/tech-spec.md`
Expected: §6.2 の `StepStats`（`settled`・`massError`・`events`）と `SimulationEngine`（`setDepressions`・`flowVectors`）、§6.6 の表の「流れの閾値 θ | 1e-5 m」が見つかる（spec 群のブランチで反映済み）。見つからなければ、spec 03 §3.10・§3.11 のとおりに足す

- [ ] **Step 2: tech-spec §4.1 と §6.5 を実装に合わせる**

§4.1 のディレクトリ構成の次の 3 行:

```
      WaterGrid.ts
      Rainfall.ts
      Boundary.ts
```

を、次の 3 行に置き換える（境界の扱いは `FlowSolver.ts` の中にあり、`Boundary.ts` は作らなかった）:

```
      WaterGrid.ts        水深の2つのバッファと走査範囲（外接矩形。実装 spec 03 §3.5）
      Rainfall.ts         降雨の投入先と水深（実装 spec 03 §3.6）
      testing/            テストとベンチマーク用の地形と補助関数
```

§6.5 の表の行 `| セルインデックス | `Int32Array` | Active Cell のスタックに使用 |` を、次に置き換える:

```markdown
| セルインデックス | `Int32Array` | 降雨の投入先の一覧。走査範囲はセルの集合ではなく、濡れたセルの外接矩形で持つ（実装 spec 03 §3.5） |
```

- [ ] **Step 3: 全体の検査**

Run: `pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage && pnpm build`
Expected: すべて成功。`src/simulation` の行カバレッジが 90% 以上。`pnpm build` はアプリのバンドルに影響が無いことの確認（エンジンはまだどこからも import されない）

- [ ] **Step 4: Commit**

```bash
git add specs/tech-spec.md
git commit -m "tech-spec: エンジンのファイル構成と走査範囲の持ち方を実装 spec 03 に合わせる"
```

- [ ] **Step 5: 引き継ぎのメモを書く**

superpowers の writing-pr-descriptions のスキルで PR 本文の下書きを `.handoff/03-simulation-engine.md` に書く。少なくとも次を含める:
- 概要（spec 03 の目的。PoC 完成条件 #6・#7・#8・#10・#11 をエンジン単体のテストで示し、#5 はエンジン側の投入まで）
- テストと spec 03 §6 の対応（§6.1 の 6 行、§6.2 の 5 性質、§6.3 の 5 項目がそれぞれどのテストか）
- Task 7 Step 4 の改変で性質のテストが失敗することを確かめた結果
- Task 8 のベンチマークの表（Node の版と実行した機械を添える）と、tech-spec §6.3 の基準との比較。半径 100m の序盤で中央値が基準の 8ms に近いこと、平衡までの step 数（spec 03 §4.1 の見積もりとの比較）を 06 への申し送りに書く
- Task 8 Step 3 の確認（`references` が無いと TS2532）
- spec との差異と判断: 本計画の「設計の判断」1〜9、`WaterGrid` の 0 にする処理を防御として残した理由（「事前に確かめた事実」）、満水との一致の許容（Task 10）
- 後続への申し送り: 04 へ（`waterDepth()` の配列は step ごとに入れ替わる、`NoElevationAtRainCenterError` は `name` で判別して strings.ts の文言を出す、`flowVectors()` は呼ぶたびに新しい配列）、06 へ（ベンチマーク、平衡までの時間、16 × 16 のブロック方式を比べる場合も §3.5 の不変条件と bbox・full の一致のテストがそのまま使える）

`.handoff/README.md` の表に行を足す（状態は「Task 10 待ち（02 の後）」。base は、Task 10 で 02 の上に載せ替えた後の `feat/02-dem-grid-2d`）:

```markdown
| 3 | `feat/03-simulation-engine` | `feat/02-dem-grid-2d` | [03-simulation-engine.md](03-simulation-engine.md) | Task 10 待ち（02 の後） |
```

---

### Task 10: 満水との一致（**02 の後に行う**）

spec 03 §6.1 の最後の行「満水との一致」は、02 の `analyzeDepressions` の `F` を使う。**02 のブランチ（`feat/02-dem-grid-2d`）の実装とレビューが終わってから**、03 のブランチを 02 の上に載せ替えて行う。それまでこの Task には手を付けない。

**Files:**
- Modify: `src/simulation/testing/fixtures.ts`（`depressionComponents` を足す）、`docs/superpowers/specs/2026-09-10-03-simulation-engine-design.md`（§6.1 の許容）
- Create: `src/simulation/fillMatch.test.ts`

**Interfaces:**
- Consumes: 02 の `analyzeDepressions`（spec 02 §5: 入力 `(elevation, validMask, width, height, cellSizeM)`、出力に満水時の水面 `F`）。**使うのは F だけ**。窪地のラベルと幅は、F と標高から本 Task で独立に求める（02 のラベルの表し方に依存しないため）
- Produces: `depressionComponents(t: Terrain, filled: ArrayLike<number>): { label: Int32Array; widths: number[] }`（`fixtures.ts`。F > Z の有効セルを 8 近傍でつないだ成分の番号（窪地でないセルは −1）と、成分ごとの外接矩形の長辺のセル数）

**許容（spec との差異）:** spec 03 §6.1 は「θ × 窪地の幅 + 1e-9」とするが、本計画は **θ × (窪地の幅 + 1) + 1e-9** とする。窪地の幅は外接矩形の長辺のセル数。「事前に確かめた事実」のとおり、spec の式は流出口が下り続ける地形でも 1.16〜1.45 倍超える。池の水面は spill のセルから 1 セル進むごとに最大 θ まで高くなりうるうえ、spill のセル自身も θ 以下の水を持ちうるので、その 1 セル分を足す。H は F を下回らなかった（池が満ち足りないことは無い）。流出口の先が平らな地形やランダムな凹凸では、θ の傾きが流出口の先まで積み上がるので、どちらの式も成り立たない。テストには流出口が下り続ける 3 つの地形を使う（試作では、02 の代わりの素朴な Priority-Flood に対して誤差が許容の最大 0.964 倍）。

- [ ] **Step 1: 03 のブランチを 02 の上に載せ替える**

Run: `git switch feat/03-simulation-engine && git rebase feat/02-dem-grid-2d`
Expected: 成功。`package.json` と `pnpm-lock.yaml` が衝突した場合は、`package.json` を両方の変更を残す形に手で直し、`pnpm install`（`--frozen-lockfile` なし）で lockfile を作り直してから `git add package.json pnpm-lock.yaml && git rebase --continue`。`src/simulation/constants.ts`・`tsconfig.node.json` が衝突した場合も、両方の追加を残す

Run: `pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm lint && pnpm depcheck`
Expected: すべて成功（02 と 03 のテストがともに通る）

- [ ] **Step 2: 02 の API を確かめる**

Run: `grep -rn "export function analyzeDepressions" src/simulation/terrain/`
確かめること: (1) ファイルのパス、(2) 引数の並び、(3) 満水時の水面 F を返すフィールドの名前、(4) Priority-Flood の近傍が 8 近傍で、グリッドの端のセルと無効セルに接するセルを起点にしていること（spec 02 §5）。(4) が違う場合は、この Task を止めてレビュー役に相談する（03 の境界の扱い R03-2 と一致しなくなる）。下の Step 4 のコードの `import` の行と `filledSurface` の 1 行を、(1)〜(3) に合わせる（コードは、パスを `./terrain/analyzeDepressions.ts`、フィールド名を `filled` と仮定して書いてある）

- [ ] **Step 3: 窪地の成分を求める関数を足す**

`src/simulation/testing/fixtures.ts` の `sameBits` の前に足す:

```ts
/**
 * 満水時の水面 F が標高より高い有効セル（窪地のセル）を 8 近傍でつないだ成分に分ける。
 * 成分の番号（窪地でないセルは −1）と、成分ごとの幅（外接矩形の長辺のセル数）を返す
 */
export function depressionComponents(
  t: Terrain,
  filled: ArrayLike<number>,
): { label: Int32Array; widths: number[] } {
  const { width, height } = t.meta
  const label = new Int32Array(width * height).fill(-1)
  const widths: number[] = []
  const inDepression = (i: number) => t.validMask[i] !== 0 && filled[i] > t.elevation[i]
  for (let s = 0; s < width * height; s++) {
    if (label[s] !== -1 || !inDepression(s)) continue
    const id = widths.length
    let x0 = width
    let x1 = -1
    let y0 = height
    let y1 = -1
    const queue = [s]
    label[s] = id
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q]
      const cx = c % width
      const cy = (c - cx) / width
      x0 = Math.min(x0, cx)
      x1 = Math.max(x1, cx)
      y0 = Math.min(y0, cy)
      y1 = Math.max(y1, cy)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const j = ny * width + nx
          if (label[j] !== -1 || !inDepression(j)) continue
          label[j] = id
          queue.push(j)
        }
      }
    }
    widths.push(Math.max(x1 - x0, y1 - y0) + 1)
  }
  return { label, widths }
}
```

- [ ] **Step 4: テストを書く**

`src/simulation/fillMatch.test.ts`（`import` の行と `filledSurface` の中身は Step 2 で確かめた 02 の API に合わせる）:

```ts
import { describe, expect, it } from 'vitest'
import { FLOW_THRESHOLD_M } from './constants.ts'
import { analyzeDepressions } from './terrain/analyzeDepressions.ts'
import {
  buildTerrain,
  depressionComponents,
  engineOn,
  runUntilSettled,
  type Terrain,
} from './testing/fixtures.ts'

/** 02 の地形解析による満水時の水面 F。02 の API に合わせるのはこの関数だけ */
function filledSurface(t: Terrain): ArrayLike<number> {
  const { width, height, cellSizeM } = t.meta
  return analyzeDepressions(t.elevation, t.validMask, width, height, cellSizeM).filled
}

/** 流出口が下り続ける地形（流出口の先が平らだと、θ の傾きが流出口の先まで積み上がる） */
const TERRAINS: [string, Terrain][] = [
  [
    '凹凸（24 × 24、セル 1m）',
    buildTerrain(24, 24, 1, (x, y) => 10 + 0.5 * Math.sin(x * 0.7) * Math.cos(y * 0.6) + 0.02 * x),
  ],
  [
    '凹凸と無効セル（24 × 20、セル 3.9m）',
    buildTerrain(24, 20, 3.9, (x, y) =>
      x >= 9 && x <= 11 && y >= 8 && y <= 10
        ? Number.NaN
        : 10 + 0.8 * Math.sin(x * 0.9) * Math.sin(y * 0.8),
    ),
  ],
  [
    '入れ子の窪地（20 × 20、セル 1m、東の縁に高さ 1.5m の切れ目）',
    buildTerrain(20, 20, 1, (x, y) => {
      if (x === 0 || y === 0 || x === 19 || y === 19) return x === 19 && y === 10 ? 1.5 : 3
      const bowl = 0.1 * Math.hypot(x - 9.5, y - 9.5)
      const pitA = Math.hypot(x - 6, y - 6) < 2 ? -0.5 : 0
      const pitB = Math.hypot(x - 13, y - 12) < 2.5 ? -0.3 : 0
      return bowl + pitA + pitB
    }),
  ],
]

describe('満水との一致（spec 03 §6.1、02 の analyzeDepressions）', () => {
  it.each(TERRAINS)('%s: 十分な水を入れて平衡させた水面が F と一致する', (_, t) => {
    const F = filledSurface(t)
    const { label, widths } = depressionComponents(t, F)
    expect(widths.length).toBeGreaterThan(0)
    const { width, height, cellSizeM } = t.meta
    const engine = engineOn(t)
    // グリッド全体に 2m の雨。窪地を満たした残りは領域外へ流れ出る
    engine.addRainfall({
      x: (width * cellSizeM) / 2,
      y: (height * cellSizeM) / 2,
      radiusM: Math.hypot(width, height) * cellSizeM,
      amountMm: 2000,
    })
    runUntilSettled(engine, 200_000)
    const w = engine.waterDepth()
    let checked = 0
    for (let i = 0; i < w.length; i++) {
      const d = label[i] ?? -1
      if (d < 0) continue
      const h = (t.elevation[i] ?? 0) + (w[i] ?? 0)
      // 許容: θ × (窪地の幅 + 1) + 1e-9。+1 は spill のセル自身が持ちうる θ 以下の水
      const tolerance = FLOW_THRESHOLD_M * ((widths[d] ?? 0) + 1) + 1e-9
      expect(Math.abs(h - (F[i] ?? 0))).toBeLessThanOrEqual(tolerance)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 5: テストを実行する**

Run: `pnpm vitest run src/simulation/fillMatch.test.ts`
Expected: PASS（3 件。平衡までの step は、試作で順に約 3,300・4,900・54,000。全体で 1 秒以内）。失敗した場合は許容を緩めず、(a) 02 の F が 8 近傍の Priority-Flood の F と同じか（端と無効セルに接するセルが起点か）、(b) 失敗したセルが spill のセルからどれだけ離れているか、を調べてレビュー役に報告する

- [ ] **Step 6: spec 03 §6.1 の許容を改める（レビュー役の確認を得てから）**

`docs/superpowers/specs/2026-09-10-03-simulation-engine-design.md` の §6.1 の表の「満水との一致」の行の「（許容は θ × 窪地の幅 + 1e-9）」を、次に置き換える:

```markdown
（許容は θ × (窪地の幅 + 1) + 1e-9。窪地の幅は外接矩形の長辺のセル数、+1 は spill のセル自身が持ちうる θ 以下の水。流出口が下り続ける地形で確かめる。流出口の先が平らな地形では θ の傾きが流出口の先まで積み上がるので、この許容は成り立たない）
```

- [ ] **Step 7: 全体の検査**

Run: `pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage`
Expected: すべて成功（テストファイルから `./terrain/` を import するのは `core-is-pure` の対象外、かつ同じ `src/simulation` の中）

- [ ] **Step 8: Commit**

```bash
git add src/simulation/testing/fixtures.ts src/simulation/fillMatch.test.ts docs/superpowers/specs/2026-09-10-03-simulation-engine-design.md
git commit -m "エンジンのテスト: 満水との一致（02 の analyzeDepressions の F）、spec 03 §6.1 の許容を改める"
```

- [ ] **Step 9: 引き継ぎを仕上げ、レビューを依頼する**

`.handoff/03-simulation-engine.md` に、満水との一致の結果と許容の差異（本 Task の冒頭の説明）を足す。`.handoff/README.md` の 03 の状態を「レビュー待ち」にする。

SendMessage でレビュー役（`raintrace-ab`。名前は ListAgents で確かめる）に、ブランチ名、コミットの一覧（`git log --oneline feat/02-dem-grid-2d..HEAD`）、`.handoff/03-simulation-engine.md` の場所を送り、spec 03 と本計画に照らしたレビューを依頼する。指摘は superpowers:receiving-code-review に従って検証してから反映する。承認が出たら `.handoff/README.md` の状態を「レビュー承認済み／push 待ち」にする

## spec 03 の完了条件との対応

| 完了条件（spec 03 §7） | 満たす Task | 確認する時点 |
|---|---|---|
| 1. §6 のテストがすべて成功し、カバレッジの閾値を満たす | 1〜7（§6.1 の満水との一致以外、§6.2、§6.3）、10（満水との一致） | Task 9 Step 3、Task 10 Step 7 |
| 2. base-spec §57 #6・#7・#8・#10・#11 をエンジン単体のテストで示す（#5 はエンジン側の投入まで） | #5: 1・4（降雨の正規化）、#6: 6（傾斜面）、#7: 6（単純窪地・平衡水位）、#8: 5・6（越流）、#10: 7（質量保存）、#11: 4（境界） | 実装中 |
| 3. §5 のベンチマークの結果を PR に記録する | 8、9 | Task 9 Step 5 |
| 4. tech-spec §6.2・§6.6 を改訂している（T2・T3） | 9（反映済みの確認） | Task 9 Step 1 |
