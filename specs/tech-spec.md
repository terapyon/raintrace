# 技術仕様書

Version: 0.1
Status: Draft
対象: 局所雨水流動・湛水3Dシミュレータ（`specs/base-spec.md`）

---

# 0. 本書の位置づけ

本書は `specs/base-spec.md`（基本仕様）が定める機能要件を、どの技術で・どのような構造で実現するかを定めた文書である。

- 基本仕様が「何を作るか」を定める
- 本書が「何で・どう作るか」を定める
- 個別機能の実装手順・タスク分解は本書の対象外とし、別途 spec / implementation plan で扱う

本書で「決定」と記した事項は、変更する場合に本書の改訂を伴う。「方針」と記した事項は実装時の判断指針であり、合理的な理由があれば実装時に逸脱してよい。

---

# 1. 技術スタック一覧

| 領域 | 採用技術 | 備考 |
|---|---|---|
| 言語 | TypeScript | strict + 追加フラグ（§10） |
| ビルド | Vite | `@cloudflare/vite-plugin` 併用 |
| UI フレームワーク | React | SPA、SSR なし |
| UI コンポーネント | MUI (`@mui/material`) + Emotion | §9 |
| 地図 | MapLibre GL JS | 命令的ラッパーで React から分離（§5.3） |
| 3D 描画 | Three.js | MapLibre Custom WebGL Layer 内で使用 |
| 状態管理 | Zustand | UI 状態のみ。セル配列は載せない（§5） |
| 並行処理 | Web Worker + Transferable | SharedArrayBuffer 不採用（§7.3） |
| シミュレーション | TypeScript + TypedArray | 性能未達時に Rust WASM へ差し替え（§6） |
| テスト | Vitest / fast-check / Testing Library / Playwright | §11 |
| Lint / Format | Biome | §12.1 |
| 依存方向検査 | dependency-cruiser | §4.2 |
| パッケージマネージャ | pnpm | クールダウン機能のため必須（§13） |
| ホスティング | Cloudflare Workers (Static Assets) | §3 |
| CI | GitHub Actions | §12.3 |
| バックエンド | なし | §7.1 |
| 永続化 | localStorage / IndexedDB | §8 |

## 1.1 採用しない技術と理由

| 不採用 | 理由 |
|---|---|
| react-map-gl | MapLibre Custom WebGL Layer に Three.js を差し込む設計（base-spec §28）と宣言的モデルの相性が悪い。依存を1つ増やして MapLibre のバージョン追従が遅れる |
| react-three-fiber | 同上。Custom Layer 内では Three.js を直接扱う方が単純 |
| Next.js / React Router (framework mode) / TanStack Start | 単一画面・完全クライアント処理のため SSR とサーバルーティングの恩恵がない。ビルドの複雑さのみが増える |
| Cloudflare Pages | Cloudflare は新規プロジェクトについて Workers Static Assets を推奨方針としている |
| ESLint + typescript-eslint + Prettier | 依存パッケージが数十個増え、サプライチェーン方針（§13）と整合しない。型認識ルールが必要になった時点で再検討する |
| SharedArrayBuffer | COOP/COEP が必要になり、CORP を返さない GSI タイルの取得経路に不確実性を持ち込む（§7.3） |
| WebGPU | 初期対応ブラウザを狭める。将来の選択肢として構造だけ確保する（base-spec §26） |
| i18n ライブラリ | 初期は日本語のみ。文字列を1モジュールに集約して将来に備える（§9.4） |

---

# 2. 設計原則

本プロジェクト固有の判断基準を、優先順位順に定める。判断に迷った場合はこの順で従う。

1. **シミュレーションエンジンを純粋に保つ** — `src/simulation/` は DOM・React・WebGL・MapLibre のいずれにも依存しない。base-spec §61 の要求であり、テスト容易性と将来の実装差し替え（WASM 化）の前提でもある。CI で機械的に強制する（§4.2）
2. **大きな配列を React に載せない** — 250,000 セルの `Float32Array` を React state / props / context に流さない。React が扱うのは UI 設定値と低頻度の統計値のみ（§5）
3. **依存を増やさない** — 依存追加は 10 日のリリースクールダウン（§13）を経て初めて利用可能になり、かつ攻撃面を広げる。既存の依存または標準 API で実現できる場合はそちらを選ぶ
4. **速度は測ってから最適化する** — 性能目標（§14）に対する実測なしに最適化手段（WASM / WebGPU）を導入しない

---

# 3. アプリケーション形態とデプロイ

## 3.1 決定

Vite でビルドした React SPA を、`@cloudflare/vite-plugin` 経由で **Cloudflare Workers の Static Assets** として配信する。

```
src/            React SPA（クライアントのみ）
worker/         将来サーバ処理が必要になった場合の配置場所（初期は空）
wrangler.jsonc  assets 設定
dist/           ビルド成果物
```

## 3.2 この形態を選ぶ理由

- SSR が不要（単一画面、初期 HTML に載せられる意味のある内容がない）
- 将来バックエンドが必要になった場合、同一リポジトリ・同一 Worker に API ルートを後付けできる。基本仕様の「バックエンドが必要になったらその時に選定する」方針と整合する
- ビルド構成が最も単純で、依存が最小

## 3.3 ルーティング

ルーティングライブラリは導入しない。単一画面であり、画面遷移が存在しない。

ただし**共有可能な URL** は提供する。地図位置とシミュレーション条件を `URLSearchParams` で表現し、`history.replaceState()` で更新する。

```
/?lat=35.6812&lon=139.7671&z=17&size=500&mm=100&r=10
```

| パラメータ | 意味 | 既定値 |
|---|---|---|
| `lat`, `lon` | 降雨中心（10進度） | なし（未指定なら地点未選択） |
| `z` | 地図ズーム | 17 |
| `size` | シミュレーション範囲の一辺（m） | 500 |
| `mm` | 降雨量（mm） | 100 |
| `r` | 降雨半径（m） | 10 |

シミュレーション結果そのものは URL に載せない。同じ URL から同じ初期条件で再現できることのみを保証する。

## 3.4 デプロイ

| 環境 | トリガ | 手段 |
|---|---|---|
| 本番 | `main` への push | GitHub Actions から `wrangler deploy` |
| プレビュー | Pull Request | `wrangler versions upload` によるプレビュー URL |

Cloudflare API トークンは GitHub Actions Secrets に保持する。トークンは Workers のデプロイ権限のみを持つ最小権限とする。

---

# 4. リポジトリ構成

## 4.1 ディレクトリ構成

単一 package.json 構成とする。pnpm workspace による分割は行わない。

```
raintrace/
  specs/
    base-spec.md          基本仕様
    tech-spec.md          本書
  src/
    simulation/           純粋 TypeScript。外部 I/O・DOM・描画に非依存
      types.ts            エンジンのインターフェース定義
      SimulationEngine.ts
      FlowSolver.ts
      WaterGrid.ts
      Rainfall.ts
      Boundary.ts
      DepressionAnalysis.ts
    dem/                  DEM 取得とデコード。fetch は使うが DOM/React には非依存
      DemTileLoader.ts
      GsiDemDecoder.ts
      DemGrid.ts
      tileMath.ts
    workers/
      simulation.worker.ts
      protocol.ts         メインスレッドとの型付きメッセージ定義
    renderer/             Three.js / WebGL。React には非依存
      TerrainRenderer.ts
      WaterRenderer.ts
      FlowRenderer.ts
      MapCustomLayer.ts
    map/                  MapLibre の命令的ラッパー
      MapController.ts
      GsiTileSource.ts
    state/                Zustand ストア
      settingsStore.ts
      simulationStore.ts
    ui/                   React + MUI
      App.tsx
      theme.ts
      strings.ts
      components/
    main.tsx
  worker/                 Cloudflare Worker（初期は静的配信のみ）
  tests/
    e2e/                  Playwright
  .npmrc
  .nvmrc
  .dependency-cruiser.mjs
  biome.json
  tsconfig.json           project references のルート
  tsconfig.app.json
  tsconfig.sim.json
  tsconfig.node.json
  vite.config.ts
  wrangler.jsonc
```

## 4.2 レイヤー境界の強制（決定）

base-spec §61 の「Simulation Engine を MapLibre や Three.js に依存させない」を、**dependency-cruiser により CI で機械的に強制する**。

許可される依存方向:

```
ui  ─────────┐
             ├──→ state ──→ simulation (型のみ)
map ─────────┤
             │
renderer ────┴──→ simulation (型のみ)

workers ──→ simulation
workers ──→ dem

dem ──→ (外部依存なし。fetch のみ)
simulation ──→ (何にも依存しない)
```

禁止ルール:

| ルール | 内容 |
|---|---|
| `simulation-is-pure` | `src/simulation/` から `react`, `@mui/*`, `maplibre-gl`, `three`, `zustand`, および DOM 型に依存する自作モジュールへの import を禁止 |
| `dem-is-headless` | `src/dem/` から `react`, `@mui/*`, `maplibre-gl`, `three` への import を禁止 |
| `renderer-no-react` | `src/renderer/` から `react`, `@mui/*` への import を禁止 |
| `no-circular` | 循環依存を禁止 |
| `no-orphans` | どこからも参照されないモジュールを禁止（設定ファイル等は除外） |

`src/simulation/` は DOM 型そのものを使えないようにする。これは §10.2 の tsconfig 分割によって型レベルでも担保する（`lib` から `DOM` を外す）。

## 4.3 workspace 分割を採らない理由

`packages/simulation-core` として物理分離すれば依存は原理的に不可能になるが、ビルド構成と CI が一段複雑になる。dependency-cruiser による CI 強制で同等の規律が得られるため、複雑さに見合わないと判断した。

将来 CLI 実装や npm 公開が現実の要件になった時点で切り出す。その時点でも `src/simulation/` が純粋であることは保証されているため、切り出しコストは低い。

---

# 5. 実行時アーキテクチャ

## 5.1 三層構造（最重要）

大きな配列を React に載せないため、責務を3層に分離する。

```
┌─────────────────────────────────────────────────┐
│ Web Worker                                      │
│   elevation: Float32Array (250,000)             │
│   water:     Float32Array (250,000)             │
│   activeCells                                   │
│   → シミュレーションの真の状態を所有            │
└───────┬─────────────────────────────────────────┘
        │ postMessage(Transferable)
        │   ・水深バッファ（描画用、所有権を往復）
        │   ・統計値（小さいオブジェクト）
        ↓
┌─────────────────────────────────────────────────┐
│ Renderer (Three.js / MapLibre Custom Layer)     │
│   受け取ったバッファを直接 GPU へアップロード   │
│   → React の再描画サイクルとは完全に無関係      │
└───────┬─────────────────────────────────────────┘
        │ 10Hz にスロットルした統計値のみ
        ↓
┌─────────────────────────────────────────────────┐
│ React + MUI + Zustand                           │
│   降雨量 / 半径 / 再生状態 / 垂直強調 / DEM種別 │
│   統計表示（投入水量・湛水量・流出量・最大水深）│
│   → 再レンダリングは MUI パネルのみ             │
└─────────────────────────────────────────────────┘
```

## 5.2 バッファの受け渡し（ダブルバッファ）

Worker とメインスレッドの間で `Float32Array` を2枚用意し、`postMessage` の Transferable として所有権ごと往復させる。コピーが発生しないため 250,000 要素（1MB）でもコストは無視できる。

```
Worker                          Main
  bufferA (計算中)                bufferB (描画中)
      │                               │
      │  step 完了                    │  描画完了
      └────── transfer bufferA ──────→│
       ←───── transfer bufferB ───────┘
  bufferB (計算中)                bufferA (描画中)
```

転送中の配列は転送元で `byteLength === 0` になるため、**転送後に元の参照へアクセスしない**ことを実装上の不変条件とする。

## 5.3 MapLibre と React の接続

MapLibre は React の外で命令的に生成・破棄する。

```ts
// 概念コード
const map = new maplibregl.Map({ container, style, ... })
map.addLayer(new MapCustomLayer(renderer))   // Three.js をこの中で使う
```

- React は `useEffect` でインスタンスを生成し、Context で子孫に配る
- 地図の状態（中心・ズーム・pitch）を React state に同期しない。同期が必要なのは URL 更新（§3.3）のみで、これは `moveend` を debounce して行う
- React の再レンダリングが地図の再生成を引き起こさないよう、生成は依存配列を空にした `useEffect` に限定する

## 5.4 データフロー全体

```
ユーザーが地図をクリック
        ↓
中心座標 → タイル座標へ変換 (src/dem/tileMath.ts)
        ↓
DEM タイル URL を決定（DEM1A → DEM5A/B/C → DEM10B のフォールバック）
        ↓
Worker 内で fetch → createImageBitmap → OffscreenCanvas → getImageData
        ↓
GSI DEM PNG をデコード → elevation: Float32Array   (§7.2)
        ↓
SimulationEngine.loadTerrain()
        ↓
addRainfall() → step() ループ
        ↓
水深バッファ（Transferable）+ 統計値 → メインスレッド
        ↓
Renderer が GPU へ / React が統計を表示
```

DEM の取得とデコードを Worker 内で行うことで、`OffscreenCanvas` の利用が可能になり、メインスレッドを一切ブロックしない。

---

# 6. シミュレーションエンジンの実装方針

## 6.1 決定: 初期は TypeScript 実装

Phase 1〜4（base-spec §55）は TypeScript + `Float32Array` で実装する。Rust WASM は初期実装に含めない。

### 判断根拠

base-spec §22-23 が指定する Active Cell 方式を適用した場合の概算:

```
全セル総当たり   : 250,000 cells × 8近傍 = 2.0M ops/step
                   × 60 step/sec         = 120M ops/sec
Active Cell 適用 : 水のある領域のみ（数百〜数万セル）
                   30,000 × 8 = 240K ops/step
                   × 60                  = 14.4M ops/sec
```

V8 は単型の `Float32Array` 上のループを十分に最適化するため、Active Cell 方式であれば TypeScript で目標性能に届く公算が高い。また PoC の主目的は base-spec §56 が述べるとおり「DEM から期待した窪地・流路が得られるか」の検証であり、速度ではない。アルゴリズムが固まる前に WASM を導入すると試行錯誤の反復速度が落ちる。

## 6.2 実装差し替え可能なインターフェース

将来の差し替えに備え、エンジンを実装非依存のインターフェースとして定義する。

```ts
// src/simulation/types.ts
export interface FlowSolver {
  loadTerrain(elevation: Float32Array, meta: TerrainMeta): void
  addRainfall(rain: RainfallInput): void
  step(dt: number): StepResult
  reset(): void
  /** 描画用の水深バッファ。所有権は呼び出し側へ移らない読み取り専用ビュー */
  waterDepthView(): Float32Array
}
```

TypeScript 実装（`TsFlowSolver`）と将来の WASM 実装（`WasmFlowSolver`）が同一インターフェースを満たす。呼び出し側（Worker）は実装を知らない。

## 6.3 Rust WASM への移行基準（決定）

以下の**いずれか**を満たした場合に限り、Rust WASM 実装の追加を検討する。

> DEM1A / 500m 四方 / Active Cell 有効の条件で、Chrome デスクトップ実測において
> - 1 step の所要時間の**中央値が 8ms を超える**、または
> - **p95 が 16ms を超える**

実測が上記に届かない限り、TypeScript 実装を維持する。「速そうだから」という理由での導入を認めない。

## 6.4 WASM を採用する場合の方針

移行基準に達した場合、以下の方針で実装する。

- **crate 依存ゼロ**。`wasm-bindgen` も使用しない。`#[no_mangle] pub extern "C"` 関数と WebAssembly linear memory のみで JS と接続する
- ビルドは `cargo build --target wasm32-unknown-unknown --release` の単一コマンド。`wasm-pack` を使わない
- メインスレッドではなく Worker 内でのみインスタンス化する
- **TypeScript 実装を削除しない。リファレンス実装として維持する**

最後の点が重要である。同一入力に対する両実装の出力を突き合わせる**差分テスト**を CI で実行することで、WASM 実装のバグ（浮動小数点演算順序の差異、境界処理の取りこぼし等）を機械的に検出できる。base-spec §47/§48 のテストケース群はそのまま両実装に適用可能である。

### WASM が明確に有利な箇所

移行を検討する際、特に効果が見込めるのは以下である。

1. **Active Cell の集合管理** — JS の `Set<number>` は反復・追加のコストが高い。Rust では自前のリングバッファまたはビットセットで管理でき、差が出やすい
2. **全セル総当たりが必要な処理** — 窪地検出（Priority-Flood 等）や初期シンク解析。Active Cell 方式が効かないため素の演算速度が支配的になる

## 6.5 数値表現

| 対象 | 型 | 理由 |
|---|---|---|
| 標高 | `Float32Array` | DEM の精度（0.01m 単位）に対して十分。メモリ量が半分 |
| 水深 | `Float32Array` | 同上 |
| 質量保存の累計値（投入・流出・湛水） | `number`（f64） | 加算の反復による誤差蓄積を避けるため倍精度で保持 |
| セルインデックス | `number`（整数） | `Int32Array` を Active Cell スタックに使用 |

`epsilon` は base-spec §49 の候補どおり `1e-5` を初期値とし、質量保存テストの実測により調整する。定数は `src/simulation/constants.ts` に集約する。

---

# 7. 外部データアクセス

## 7.1 バックエンド不要の検証結果（実測）

GSI タイルエンドポイントの CORS 対応を実測した（2026-09-10 時点）。

```
GET https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/{z}/{x}/{y}.png
GET https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png
GET https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png

いずれも:
  HTTP/2 200
  access-control-allow-origin: *
  ※ Cross-Origin-Resource-Policy ヘッダは返却されない
```

`access-control-allow-origin: *` が返るため、ブラウザから直接 fetch でき、`createImageBitmap` 経由でピクセル値を読み取っても canvas が tainted にならない。**プロキシ用のバックエンドは不要である**。

この事実は base-spec §51「Version 0.1 ではバックエンドなし」の前提が成立することを裏付ける。

## 7.2 GSI DEM PNG のデコード

標高タイルは RGB 各 8bit に標高値が符号付きで格納されている。

```
x = 2^16 * R + 2^8 * G + B
u = 0.01                      （標高分解能 0.01m）

x <  2^23  →  h = x * u
x == 2^23  →  無効値（NA）
x >  2^23  →  h = (x - 2^24) * u
```

### 無効値の扱い（決定）

`x == 2^23` の無効値セル（海域、データ欠測域）は、内部表現で `NaN` として保持する。

シミュレーション上は**領域外と同等に扱う**。すなわち:

- 無効値セルへ流入した水は「領域外流出」として計上する（base-spec §18 の境界条件と同一の扱い）
- 無効値セルには水を保持させない
- 無効値セルからの流出は発生しない

無効値セルが対象範囲に含まれる場合、UI 上でその割合を表示し、結果の信頼性が下がる旨を注意表示する。

## 7.3 SharedArrayBuffer を採用しない理由（決定）

`SharedArrayBuffer` の利用には `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy` の設定が必須である。

しかし §7.1 の実測どおり GSI タイルは `Cross-Origin-Resource-Policy` を返さない。この状態で COEP を有効化すると、GSI タイルの読み込み可否が「すべての取得経路が CORS モードで行われること」に依存する。MapLibre 内部のタイル取得経路まで含めてこれを保証・維持するのは困難であり、外部サービス側のヘッダ変更に対して脆い。

§5.2 の Transferable ダブルバッファで性能要件を満たせるため、この不確実性を負う理由がない。

将来 WebGPU を導入する場合も同様の制約を負わないよう、この判断を維持する。

## 7.4 DEM の選択とフォールバック

base-spec §41 のとおり自動選択する。

| DEM | 最大ズーム | エンドポイント |
|---|---|---|
| DEM1A | z17 | `/xyz/dem1a_png/{z}/{x}/{y}.png` |
| DEM5A | z15 | `/xyz/dem5a_png/{z}/{x}/{y}.png` |
| DEM5B | z15 | `/xyz/dem5b_png/{z}/{x}/{y}.png` |
| DEM5C | z15 | `/xyz/dem5c_png/{z}/{x}/{y}.png` |
| DEM10B | z14 | `/xyz/dem10b_png/{z}/{x}/{y}.png` |

上位から順に取得を試み、404 が返った場合に次へフォールバックする。全て失敗した場合は「この地域には標高データがありません」と表示し、シミュレーションを開始しない。

## 7.5 エラー処理方針

| 事象 | 挙動 |
|---|---|
| DEM タイルが 404（国外・海域等） | 次の DEM へフォールバック。全滅時はユーザーに明示 |
| ネットワークエラー | 指数バックオフで最大3回リトライ。以後ユーザーに通知 |
| WebGL 2 非対応 | 起動時に検出し、非対応である旨を表示して 3D 表示を行わない |
| `OffscreenCanvas` 非対応 | メインスレッドの canvas でデコードするフォールバック経路を用意する |
| Worker の異常終了 | エラーを UI に表示し、Reset で復帰可能にする |

---

# 8. 状態管理と永続化

## 8.1 状態の分類

| 分類 | 保持場所 | 例 |
|---|---|---|
| シミュレーションの真の状態 | Web Worker 内の TypedArray | 標高、水深、Active Cell |
| 描画用の派生状態 | Renderer が保持するバッファ | 水深ビュー、流向ベクトル |
| UI 設定値 | Zustand + localStorage | 降雨量、半径、垂直強調、ベースマップ |
| UI 一時状態 | Zustand（永続化しない） | 再生中か、選択中セル、統計値 |
| 共有可能な条件 | URL クエリ | §3.3 |

## 8.2 Zustand の採用理由

- React の外（Worker の `onmessage` ハンドラ）から直接ストアを更新できる
- selector により、統計値の更新で MUI パネルの一部だけを再描画できる
- 依存が小さく単一パッケージで完結する

## 8.3 localStorage スキーマ

キー: `raintrace.settings`

```ts
interface PersistedSettings {
  schemaVersion: 1
  rainfall: {
    amountMm: number      // 既定 100
    radiusM: number       // 既定 10
  }
  area: {
    sizeM: 250 | 500 | 1000   // 既定 500
  }
  display: {
    verticalExaggeration: 1 | 2 | 5 | 10   // 既定 2
    waterDepthPalette: 'stepped' | 'continuous'
    showFlowVectors: boolean
    flowVectorSpacingM: 5 | 10 | 20
  }
  map: {
    basemap: 'std' | 'pale' | 'photo'   // 既定 'pale'
    theme: 'light' | 'dark' | 'system'  // 既定 'system'
  }
  disclaimerAcknowledgedAt: string | null   // ISO 8601
}
```

### バージョニング方針（決定）

`schemaVersion` が一致しない場合、**マイグレーションを書かず、保存値を破棄して既定値にリセットする**。

保存対象は再入力が容易な UI 設定のみであり、失っても利用者の損失が小さい。マイグレーションコードを維持するコストの方が上回る。

読み込み時は必ず形状を検証し、不正な値（型不一致、範囲外）が含まれる場合も同様に破棄する。localStorage の内容は改変可能であるため、信頼せずに検証する。

シミュレーション結果は localStorage に保存しない。

## 8.4 IndexedDB（DEM タイルキャッシュ）

base-spec §50 のとおり、初期実装では **HTTP キャッシュのみ**とし、IndexedDB は実装しない。

Phase 5（Performance）において、DEM 再取得が体感性能上のボトルネックであると実測された場合にのみ導入する。導入する場合:

- キー: `{dem}/{z}/{x}/{y}`
- 値: デコード済み `Float32Array`（PNG を再デコードしないため）
- 上限とエビクション方針を定めたうえで実装する

---

# 9. UI

## 9.1 決定: MUI

`@mui/material` と Emotion（`@emotion/react` / `@emotion/styled`）を使用する。アイコンは `@mui/icons-material` から named import する。

SSR を行わないため Emotion のランタイムコストは許容範囲である。

## 9.2 テーマ

- MUI の CSS variables 機能（`colorSchemes`）を用い、light / dark の両方を定義する
- 既定はシステム設定に追従。ユーザーによる切り替えを可能とし、選択は localStorage に保存する
- 地図が画面の主役であるため、UI パネルは地図の視認性を損なわない配色とする（半透明の `Paper` + 適切な elevation）

## 9.3 レイアウト

base-spec §37 の構成に従う。

| ブレークポイント | 構成 |
|---|---|
| デスクトップ（`md` 以上） | 地図全画面 + 右サイドパネル（`Drawer` variant=permanent） |
| モバイル（`md` 未満） | 地図全画面 + 下部パネル（`Drawer` anchor=bottom、折りたたみ可能） |

主要コンポーネント:

| コンポーネント | 用途 | 主な MUI 要素 |
|---|---|---|
| `RainfallControls` | 降雨量・半径の入力 | `TextField` + `Slider` |
| `PlaybackControls` | Play / Pause / Reset / 速度 | `IconButton`, `ToggleButtonGroup` |
| `StatisticsPanel` | base-spec §38 の統計表示 | `Table` |
| `CellInfoPopover` | base-spec §39 のセル情報 | `Popover` |
| `DemInfoBadge` | base-spec §40 の DEM 情報 | `Chip`, `Tooltip` |
| `DisclaimerDialog` | base-spec §59 の注意表示 | `Dialog` |
| `DisplaySettings` | 垂直強調・水深表示・流向表示 | `Select`, `Switch` |

## 9.4 文言と多言語化

初期実装は**日本語のみ**とする。i18n ライブラリは導入しない。

ただし将来の多言語化に備え、UI に表示するすべての文字列を `src/ui/strings.ts` の単一オブジェクトに集約し、コンポーネント内に文字列リテラルを直接書かない。

## 9.5 アクセシビリティ方針

- MUI の標準コンポーネントを使用し、独自の対話要素を極力作らない
- すべての操作をキーボードで実行可能とする（地図のパン・ズームを含む。MapLibre の `keyboard` ハンドラを有効化する）
- 水深表示は色のみで情報を伝えない。数値表示とパターンの併用を検討する
- 3D 地形および水面の描画内容そのものは代替テキストで表現できないため、統計値（§9.3 `StatisticsPanel`）をテキストとして提供することで補う

## 9.6 注意表示（base-spec §59）

免責文言は以下のタイミングで表示する。

1. 初回起動時に `DisclaimerDialog` として表示し、明示的な了解を得る（`disclaimerAcknowledgedAt` に記録）
2. 了解後も、画面上に常時、簡略版の注意文を表示する

この表示は設定で無効化できないものとする。

---

# 10. TypeScript 設定

## 10.1 共通の厳格化フラグ

すべての領域に適用する。

```jsonc
{
  "strict": true,
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "exactOptionalPropertyTypes": true,
  "verbatimModuleSyntax": true,
  "isolatedModules": true,
  "erasableSyntaxOnly": true,
  "moduleDetection": "force",
  "skipLibCheck": true
}
```

`erasableSyntaxOnly` により enum や parameter properties など実行時コードを生成する構文を禁止し、型と実行時の対応を明確に保つ。

## 10.2 `noUncheckedIndexedAccess` の扱い（決定）

**アプリケーション全体で有効。ただし `src/simulation/` のみ無効とする。**

理由:

- UI・DEM ローダー等の通常コードでは、配列アクセスの検査漏れを型で防ぐ価値が大きい
- 一方 `src/simulation/` は `Float32Array` に対する高頻度のインデックスアクセスが中心であり、すべてが `number | undefined` になると非 null アサーション（`!`）が大量に必要になる。`!` が常態化すると、本来検出すべき箇所を見落とすことになり、かえって安全性を下げる
- シミュレーションコードは配列長を自ら管理する閉じた領域であり、境界の正しさはユニットテスト（§11）で担保する方が実効的である

## 10.3 tsconfig の構成

TypeScript の project references で領域を分割する。

| ファイル | 対象 | 特記事項 |
|---|---|---|
| `tsconfig.json` | ルート（references のみ） | |
| `tsconfig.sim.json` | `src/simulation/` | `noUncheckedIndexedAccess: false`、**`lib` から `DOM` を除外** |
| `tsconfig.app.json` | `src/` のうち上記以外 | `noUncheckedIndexedAccess: true`、`lib: ["ES2023", "DOM", "DOM.Iterable", "WebWorker"]` |
| `tsconfig.node.json` | `vite.config.ts` 等 | |

`tsconfig.sim.json` から `DOM` を除外することで、`src/simulation/` が `document` や `window` を参照できないことを**型レベルで保証する**。§4.2 の dependency-cruiser と合わせて二重に強制する。

---

# 11. テスト戦略

## 11.1 レイヤーごとの方針

| 対象 | 手法 | 重点 |
|---|---|---|
| `src/simulation/` | Vitest（ユニット）+ fast-check（property-based） | **最重点**。base-spec §47/§48 |
| `src/dem/` | Vitest（ユニット） | デコード式、タイル座標変換、無効値処理 |
| `src/state/` | Vitest | localStorage スキーマ検証、不正値の破棄 |
| `src/renderer/`, `src/map/` | 自動テストの対象外 | WebGL の検証コストが見合わない |
| `src/ui/` | Vitest + Testing Library（限定的） | 入力値のバリデーションと状態反映のみ |
| 全体 | Playwright（E2E） | スモークテスト（§11.4） |

## 11.2 シミュレーションの検証（最重要）

base-spec §47 の4ケースを必須テストとする。

| ケース | 検証内容 |
|---|---|
| 平面 | 完全に平坦な地形で、水面が均等になること |
| 傾斜面 | 高所から低所へ移動すること。逆流しないこと |
| 単純窪地 | 窪地に蓄積し、平衡状態で水面が水平になること |
| 越流 | 水位上昇後、最も低い峠（spill point）から隣接領域へ流れること |

## 11.3 質量保存の property-based テスト

base-spec §48 の質量保存はランダム入力に対する不変条件であるため、fast-check による property-based テストとして記述する。

```
∀ (地形, 降雨条件, ステップ数):
    |初期水量 + 投入水量 − (現在水量 + 累積流出量)| < epsilon
```

- 地形はランダム生成（平坦、単調傾斜、複数窪地、無効値混在の各パターン）
- 各 step 後に不変条件を検査する
- 反例が見つかった場合、fast-check の縮小機能により最小反例を得る

このテストは CI の必須ゲートとする。失敗した場合マージを許可しない。

## 11.4 E2E（Playwright）

WebGL の描画結果に対するスクリーンショット比較は環境差で不安定になるため**行わない**。以下のスモークテストに限定する。

1. アプリが起動し、地図タイルが読み込まれる
2. 地図をクリックすると降雨マーカーが表示される
3. DEM 情報バッジに使用中の DEM が表示される
4. Start を押すと統計値（投入水量）が 0 から変化する
5. Reset を押すと統計値が 0 に戻る
6. 免責ダイアログが初回に表示され、了解後は再表示されない

外部（GSI）へのネットワーク依存を避けるため、E2E ではタイルリクエストを Playwright の `route()` で固定のフィクスチャに差し替える。

## 11.5 カバレッジ閾値

| 対象 | 行カバレッジ閾値 |
|---|---|
| `src/simulation/` | 90% |
| `src/dem/` | 85% |
| `src/state/` | 80% |
| その他 | 閾値を設けない |

閾値未達は CI の失敗とする。UI と描画に一律の閾値を課すことはテストのための無意味なテストを誘発するため行わない。

## 11.6 WASM 導入時の差分テスト

§6.4 のとおり Rust WASM を導入した場合、TypeScript 実装との差分テストを追加する。

```
∀ (地形, 降雨条件, ステップ数):
    |TS実装の水深[i] − WASM実装の水深[i]| < tolerance   (∀i)
```

`tolerance` は浮動小数点演算順序の差異を許容する値とし、実測により定める。

---

# 12. 品質ゲート

## 12.1 Lint / Format: Biome（決定）

Biome を lint と format の両方に使用する。

理由:

- 単一バイナリで依存パッケージを増やさない。ESLint + typescript-eslint + Prettier 構成では依存が数十個増え、§13 のサプライチェーン方針と整合しない
- リリースクールダウン（10日）の影響を受ける依存が少ないほど、更新が滞留しにくい
- 実行が高速で、pre-commit フックに組み込んでも体感を損なわない

有効化する主なルール群: `recommended`、React 向けルール、`a11y` ルール。

型情報を要するルール（`no-floating-promises` 等）は Biome では扱えない。これが実際に問題となった場合に typescript-eslint の追加を再検討する。現時点では `tsc --noEmit` による型検査で大半が捕捉できると判断する。

## 12.2 ローカルの品質ゲート

pre-commit フックを **lefthook** で管理する。

| フック | 実行内容 |
|---|---|
| pre-commit | Biome（変更ファイルのみ、自動修正あり） |
| pre-push | `tsc --noEmit`、`vitest run`（ユニットのみ） |

pre-commit で重い検査を行わない。型検査とテストは pre-push に置き、コミットの速度を保つ。

## 12.3 CI（GitHub Actions）

### ワークフロー構成

| ジョブ | 内容 |
|---|---|
| `quality` | `biome ci`、`tsc --noEmit`（全 project reference）、`depcruise` |
| `test` | `vitest run --coverage`（閾値検査を含む） |
| `build` | `vite build` + バンドルサイズ検査（§14.2） |
| `e2e` | `playwright test` |
| `audit` | `pnpm audit --audit-level=high` |
| `deploy` | `main` への push 時のみ。上記すべての成功が前提 |

### 共通設定

```yaml
permissions:
  contents: read        # 既定を最小権限に。必要なジョブでのみ昇格

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

- Node バージョンは `.nvmrc` から読み取り、ローカルと CI を一致させる
- pnpm は `package.json` の `packageManager` フィールドで固定し、Corepack で解決する
- 依存インストールは `pnpm install --frozen-lockfile`
- **すべての GitHub Actions をコミット SHA でピン留めする**（§13.4）

## 12.4 マージ条件

`main` へのマージには以下すべての成功を必須とする。

- `quality`、`test`、`build`、`e2e`
- 特に §11.3 の質量保存テスト

---

# 13. 依存管理とサプライチェーン対策

## 13.1 前提: リリースクールダウン

本プロジェクトは、公開直後のパッケージバージョンを使用しない方針を採る。開発環境には既に以下が設定されている。

```
~/.config/pnpm/rc
  minimum-release-age=14400          # 分単位 = 10日
  minimum-release-age-strict=true
```

`minimum-release-age` は**分**単位で指定する。`14400` 分は 10 日である。

`minimum-release-age-strict=true` により、lockfile に記載済みのバージョンであってもクールダウン期間を満たさなければインストールが失敗する。

## 13.2 決定: 設定をリポジトリに含める

上記はグローバル設定であり、開発者ごとの環境や CI には適用されない。設定差によりローカルと CI で依存解決が食い違うことを防ぐため、**リポジトリの `.npmrc` に同一の設定をコミットする**。

```
# .npmrc
minimum-release-age=14400
minimum-release-age-strict=true
```

これにより CI・他の開発者マシン・将来の自分のいずれにおいても同じ制約が働く。

## 13.3 パッケージマネージャは pnpm（決定）

npm・yarn にはリリースクールダウン相当の機能がない。§13.1 の方針を実現できるのは pnpm のみであるため、pnpm を必須とする。

加えて pnpm 10 は、**依存パッケージの postinstall スクリプトを既定で実行しない**。ビルドスクリプトの実行が必要なパッケージは `onlyBuiltDependencies` に明示的に列挙する。本プロジェクトは workspace を用いない単一 package.json 構成（§4.3）であるため、`package.json` の `pnpm.onlyBuiltDependencies` に記載する。これはインストール時の任意コード実行という最大の攻撃経路を既定で塞ぐものであり、本プロジェクトはこの既定を維持する。

`onlyBuiltDependencies` への追加は、そのパッケージがビルドを必要とする理由を Pull Request の説明に記載したうえで行う。

## 13.4 GitHub Actions のピン留め

すべての Actions を**コミット SHA で指定する**。タグ（`@v4` 等）は再割り当て可能であり、上流が侵害された場合に自動で悪意あるコードを取り込むことになる。

```yaml
# 悪い例
- uses: actions/checkout@v4
# 良い例
- uses: actions/checkout@<full-40-char-sha>  # v4.2.2
```

バージョンの可読性のため、SHA の後にコメントでタグを併記する。

## 13.5 依存更新: Renovate

Dependabot ではなく **Renovate** を使用する。Renovate は `minimumReleaseAge` 設定を持ち、§13.1 の方針と厳密に揃えられるためである。

```jsonc
{
  "minimumReleaseAge": "10 days",
  "lockFileMaintenance": { "enabled": true },
  "pinDigests": true,           // GitHub Actions を SHA でピン留め
  "packageRules": [
    {
      "matchUpdateTypes": ["minor", "patch"],
      "matchCurrentVersion": "!/^0/",
      "automerge": false        // 自動マージは行わない
    }
  ]
}
```

自動マージは行わない。すべての依存更新を人が確認する。

## 13.6 依存追加の判断基準

新規依存の追加は Pull Request で行い、以下を説明に記載する。

1. 標準 API または既存依存で実現できない理由
2. そのパッケージの推移的依存の数
3. メンテナンス状況（最終更新、メンテナ数）

§2 の設計原則3のとおり、依存を増やさない選択を既定とする。

## 13.7 Node / pnpm バージョンの固定

| 対象 | 固定方法 |
|---|---|
| Node | `.nvmrc` に記載。`package.json` の `engines` にも明記 |
| pnpm | `package.json` の `packageManager` フィールド（Corepack が検証） |

初期バージョン: Node 24（LTS）、pnpm 10。

## 13.8 Lockfile

`pnpm-lock.yaml` を必ずコミットする。CI は `--frozen-lockfile` で実行し、lockfile と `package.json` の不整合を失敗として扱う。

---

# 14. 性能目標

## 14.1 実行時性能

| 指標 | 目標 | 測定条件 |
|---|---|---|
| 1 step の所要時間（中央値） | < 8ms | DEM1A / 500m 四方 / Active Cell 有効 / Chrome デスクトップ |
| 1 step の所要時間（p95） | < 16ms | 同上 |
| 地図操作時のフレームレート | 60fps 維持 | シミュレーション実行中を含む |
| 地点クリックから 3D 地形表示まで | < 3秒 | キャッシュなし、一般的な回線 |
| メインスレッドの最長ブロック時間 | < 50ms | 全操作を通じて |

1番目と2番目の未達が §6.3 の WASM 移行検討の条件となる。

計測は `performance.now()` による step 時間の記録を実装に組み込み、開発モードで統計を表示できるようにする。

## 14.2 バンドルサイズ

| 対象 | 上限 | 備考 |
|---|---|---|
| 初期ロード JS（gzip 後） | 400 KB | MapLibre と MUI を含む |
| 遅延ロードを含む総 JS（gzip 後） | 1.2 MB | Three.js、シミュレーションを含む |

以下を動的 import により初期ロードから除外する。

- Three.js および `src/renderer/`（地点選択後に必要になる）
- `src/simulation/` および Worker（Start 押下時に必要になる）

上限超過を CI の `build` ジョブで失敗として扱う。

## 14.3 メモリ

500m 四方 / DEM1A（250,000 セル）における主要な配列:

```
elevation   Float32Array(250,000)  = 1.0 MB
water × 2   Float32Array(250,000)  = 2.0 MB   （ダブルバッファ）
activeCells Int32Array(250,000)    = 1.0 MB
────────────────────────────────────────────
                                     約 4 MB
```

1000m 四方（1,000,000 セル）を選択した場合でも約 16MB であり、実用範囲に収まる。

---

# 15. ブラウザ対応

## 15.1 対応ブラウザ

base-spec §58 に従い、以下の最新版を対象とする。

| ブラウザ | 備考 |
|---|---|
| Chrome / Edge | 主要開発対象 |
| Firefox | |
| Safari | `OffscreenCanvas` の挙動差に注意（§7.5 のフォールバック経路） |

## 15.2 必須要件と任意要件

| 機能 | 区分 | 非対応時の挙動 |
|---|---|---|
| WebGL 2 | **必須** | 起動時に検出し、非対応である旨を表示 |
| Web Worker | **必須** | 同上 |
| `OffscreenCanvas` | 任意 | メインスレッドでデコードするフォールバック |
| WebGPU | 任意 | 使用しない（将来の拡張余地としてのみ確保） |

WebGPU を必須要件としない方針は base-spec §58 と一致する。

## 15.3 ビルドターゲット

Vite の `build.target` は `baseline-widely-available` 相当とし、対応ブラウザで動作するトランスパイル結果を得る。レガシーブラウザ向けの polyfill は導入しない。

---

# 16. ライセンスと出典表示

## 16.1 出典表示（必須）

base-spec §3 のとおり、画面上に常時以下を表示する。

```
地図・標高データ：国土地理院
```

MapLibre のアトリビューションコントロールに含める形で実装する。この表示は設定で非表示にできないものとする。

## 16.2 依存ライブラリのライセンス

すべての依存パッケージのライセンスを CI で列挙し、GPL 系など本プロジェクトの配布形態と両立しないライセンスが混入していないことを確認する。

## 16.3 本プロジェクトのライセンス

**未決**。§17 参照。

---

# 17. 未決事項

以下は本書の時点で決定していない。実装開始前、または該当フェーズ到達時に決定する。

| 項目 | 決定時期 | 備考 |
|---|---|---|
| 本プロジェクトのライセンス | 実装開始前 | リポジトリを公開するか否かと併せて決定する |
| リポジトリの公開 / 非公開 | 実装開始前 | 公開する場合、GitHub Actions の Secrets 取り扱いを再確認する |
| アクセス解析の導入可否 | Phase 1 完了後 | 導入する場合は Cloudflare Web Analytics を候補とする。base-spec §52 のプライバシー方針（位置情報をサーバへ保存しない）と両立することが条件 |
| エラー監視の導入可否 | Phase 3 以降 | 導入する場合、位置情報を送信しない設定を必須とする |
| `epsilon` の具体値 | Phase 2 | `1e-5` を初期値とし、質量保存テストの実測で調整（base-spec §49） |
| IndexedDB キャッシュの導入 | Phase 5 | §8.4 の条件を満たした場合のみ |
| Rust WASM の導入 | Phase 5 | §6.3 の移行基準を満たした場合のみ |
| 水深表示の配色（カラーマップ） | Phase 3 | 色覚特性に配慮した配色を選定する（§9.5） |

---

# 18. 決定事項の要約

実装時に参照すべき決定を再掲する。

1. **Vite + React SPA を Cloudflare Workers の Static Assets として配信**する。バックエンドは持たない（§3、§7.1）
2. **単一 package.json 構成**とし、レイヤー境界は dependency-cruiser で CI 強制する（§4）
3. **250,000 セルの TypedArray を React に載せない**。Worker / Renderer / React の三層に分離する（§5.1）
4. **Worker との受け渡しは Transferable ダブルバッファ**。SharedArrayBuffer は使わない（§5.2、§7.3）
5. **MapLibre と Three.js は React の外で命令的に扱う**。react-map-gl / react-three-fiber を使わない（§1.1、§5.3）
6. **シミュレーションは初期 TypeScript 実装**。§6.3 の実測基準を割った場合にのみ Rust WASM を追加し、TypeScript 実装はリファレンスとして残す（§6）
7. **UI は MUI**。文字列は 1 モジュールに集約する（§9）
8. **`noUncheckedIndexedAccess` は `src/simulation/` のみ無効**。同ディレクトリは `lib` からも `DOM` を外す（§10.2、§10.3）
9. **質量保存を property-based テストで検証**し、CI の必須ゲートとする（§11.3）
10. **pnpm を必須**とし、リリースクールダウン 10 日をリポジトリの `.npmrc` にコミットする。GitHub Actions は SHA でピン留めする（§13）
