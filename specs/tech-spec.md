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

base-spec が候補や例として挙げている事項（ホスティング先、技術スタック、モジュール構成、API など）を本書で確定または変更している場合は、本書を優先する。対応関係は §19 に一覧する。

---

# 1. 技術スタック一覧

| 領域 | 採用技術 | 備考 |
|---|---|---|
| 言語 | TypeScript | strict + 追加フラグ（§10） |
| ビルド | Vite | ビルドの情報は `build-info/`（配信する `dist/` の外。実装 spec D） |
| UI フレームワーク | React | SPA、SSR なし |
| UI コンポーネント | MUI (`@mui/material`) + Emotion | §9 |
| 地図 | MapLibre GL JS | 命令的ラッパーで React から分離（§5.3） |
| 3D 描画 | Three.js | MapLibre Custom WebGL Layer 内で使用。地形の描画方式は §5.5 |
| 状態管理 | Zustand | UI 状態のみ。セル配列は載せない（§5） |
| 並行処理 | Web Worker + Transferable | SharedArrayBuffer 不採用（§7.3） |
| シミュレーション | TypeScript + TypedArray | 性能未達時に Rust WASM へ差し替え（§6） |
| テスト | Vitest / fast-check / Testing Library / Playwright | §11 |
| Lint / Format | Biome | §12.1 |
| 依存方向検査 | dependency-cruiser | §4.2 |
| パッケージマネージャ | pnpm | クールダウン機能のため必須（§13） |
| ホスティング | Cloudflare Pages（Direct Upload） | §3 |
| CI | GitHub Actions | §12.3 |
| バックエンド | なし | §7.1 |
| 永続化 | localStorage / IndexedDB | §8 |

## 1.1 採用しない技術と理由

| 不採用 | 理由 |
|---|---|
| react-map-gl | MapLibre Custom WebGL Layer に Three.js を差し込む設計（base-spec §28）と宣言的モデルの相性が悪い。依存を1つ増やして MapLibre のバージョン追従が遅れる |
| react-three-fiber | 同上。Custom Layer 内では Three.js を直接扱う方が単純 |
| Next.js / React Router (framework mode) / TanStack Start | 単一画面・完全クライアント処理のため SSR とサーバルーティングの恩恵がない。ビルドの複雑さのみが増える |
| Cloudflare Workers（Static Assets） | 独自ドメインを付ける方法（Custom Domains・Routes）がどちらも Cloudflare 上の有効なゾーンを要し、DNS を外部（value-domain.com）に置いたままでは付けられない。01〜05 は Workers で配信し、実装 spec D（2026-09-17）で Pages に移した |
| ESLint + typescript-eslint + Prettier | 依存パッケージが数十個増え、サプライチェーン方針（§13）と整合しない。型認識ルールが必要になった時点で再検討する |
| SharedArrayBuffer | Transferable で性能要件を満たせるため、COOP/COEP を運用する負担に見合わない（§7.3） |
| WebGPU | 初期対応ブラウザを狭める。将来の選択肢として構造だけ確保する（base-spec §26） |
| i18n ライブラリ | 初期は日本語のみ。文字列を1モジュールに集約して将来に備える（§9.4） |

---

# 2. 設計原則

本プロジェクト固有の判断基準を、優先順位順に定める。判断に迷った場合はこの順で従う。

1. **シミュレーションエンジンを純粋に保つ** — `src/simulation/` は DOM・React・WebGL・MapLibre のいずれにも依存しない。base-spec §61 の要求であり、テスト容易性と将来の実装差し替え（WASM 化）の前提でもある。CI で機械的に強制する（§4.2）
2. **大きな配列を React に載せない** — 250,000 セルの TypedArray を React state / props / context に流さない。React が扱うのは UI 設定値と低頻度の統計値のみ（§5）
3. **依存を増やさない** — 依存追加は 10 日のリリースクールダウン（§13）を経て初めて利用可能になり、かつ攻撃面を広げる。既存の依存または標準 API で実現できる場合はそちらを選ぶ
4. **速度は測ってから最適化する** — 性能目標（§14）に対する実測なしに最適化手段（WASM / WebGPU）を導入しない

---

# 3. アプリケーション形態とデプロイ

## 3.1 決定

Vite でビルドした React SPA を、**Cloudflare Pages**（Direct Upload。CI から `wrangler pages deploy` で上げる）で配信する。手元の `pnpm preview` は `wrangler pages dev`（Pages のローカルの実装、workerd）で `dist/` を配信し、E2E はこれに対して回す（実装 spec D、2026-09-17。01〜05 は `@cloudflare/vite-plugin` 経由の Workers の Static Assets だった）。

```
src/              React SPA（クライアントのみ）
public/_headers   レスポンスヘッダ（§7.7）
scripts/preview.mjs  pnpm preview（wrangler pages dev dist）
dist/             ビルド成果物。配信するファイルだけを置く（Pages はディレクトリの全ファイルを上げる）
build-info/       ビルドの情報（Vite のマニフェスト・チャンクのモジュール一覧。gitignore）
```

## 3.2 この形態を選ぶ理由

- SSR が不要（単一画面、初期 HTML に載せられる意味のある内容がない）
- 将来バックエンドが必要になった場合は、その時点で Pages Functions か別の Worker を選ぶ。基本仕様の「バックエンドが必要になったらその時に選定する」方針と整合する
- 独自ドメイン（サブドメイン）を外部 DNS の CNAME で付けられる。Workers はゾーンを Cloudflare に置く必要がある（実装 spec D §3.2）
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

URL と localStorage（§8.3）の両方にある項目（`size`・`mm`・`r`）は、URL の値を優先する。URL の値は設定に適用するので、localStorage にも保存される（保存値は『最後に使った値』のため。実装 spec 04）。

## 3.4 デプロイ

Pages の project は `raintrace` の 1 つ（production branch は `production`。Git に同名のブランチは作らない）。ビルドは 3 段とも `pnpm build` で、`wrangler pages deploy dist --branch <名前>` の名前で段を分ける。ステージングの環境は置かない（実装 spec D R-D1、R01-3 の変更）。

| 段 | トリガ | `--branch` | URL |
|---|---|---|---|
| プレビュー | Pull Request（同じリポジトリのブランチ） | `pr-<番号>` | `pr-<番号>.raintrace.pages.dev`（noindex） |
| `main` | `main` への push（必須ジョブの成功が前提） | `main` | `main.raintrace.pages.dev`（noindex。独自ドメインなし） |
| 本番 | `v*` のタグの push（必須ジョブの成功が前提） | `production` | `raintrace.terapyon.net`（value-domain.com の DNS の CNAME）、`raintrace.pages.dev`（noindex） |

- ブランチ名はジョブの `env` の `PAGES_BRANCH` で組み立て、`production` はタグのジョブにだけ書く。プレビューと `main` のジョブは `production` を拒む。CI を通らない本番への経路は緊急用の `pnpm deploy:production:manual` だけ
- 上げた後に `scripts/check-deployed-headers.mjs` で本物の応答（CSP・`Cache-Control`・ビルドの情報を配信しないこと・SPA のフォールバック・noindex）を検査する。独自ドメインはリポジトリの変数 `PRODUCTION_URL` があるときだけ
- `*.pages.dev` は `_headers` で `X-Robots-Tag: noindex` にし、独自ドメインだけを索引させる

Cloudflare API トークンは GitHub Actions Secrets に保持する。トークンは Account の Cloudflare Pages: Edit のみを持つ最小権限とする（旧 Workers を消すまでの移行の間は Workers の権限も持つ。実装 spec D §4.8）。

---

# 4. リポジトリ構成

## 4.1 ディレクトリ構成

単一 package.json 構成とする。pnpm workspace による分割は行わない。

下の図は**主なもの**を載せる（すべてのファイルは載せない。テストと `*.test-support.ts` も省く）。

```
raintrace/
  specs/
    base-spec.md          基本仕様
    tech-spec.md          本書
  src/
    simulation/           純粋 TypeScript。I/O・DOM・描画に非依存
      types.ts            エンジンのインターフェースと型（§6.2）
      TsSimulationEngine.ts エンジンの TypeScript 実装
      FlowSolver.ts       1 step 分の水移動計算（エンジン内部）
      WaterGrid.ts        水深の2つのバッファと走査範囲（外接矩形。実装 spec 03 §3.5）
      Rainfall.ts         降雨の投入先と水深（実装 spec 03 §3.6）
      testing/            テスト用の組み立て（`*.test-support.ts`。02 の地形と 03 のエンジンの補助関数）
      terrain/            地形解析（D8 流向・窪地・spill point。実装 spec 02 §5）
      constants.ts        許容誤差などの定数（§6.6）
    dem/                  純粋 TypeScript。RGBA → 標高の変換とグリッド組み立て（I/O なし）
      GsiDemDecoder.ts    RGBA バイト列 → 標高 Float32Array + 有効セルマスク
      DemGrid.ts          複数タイルの結合と範囲の切り出し
      tileMath.ts         緯度経度・タイル座標・地上解像度の変換（§7.6）
      demSources.ts       DEM 種別・エンドポイント・最大ズーム（§7.4）
      tileZoom.ts         描かれる地形タイルと DEM のズームの型と変換（実装 spec 05 §4.3）
      terrarium.ts        Terrarium の符号化、角の規約の標本化、無効セルの埋め方（実装 spec 05 §4.2）
      terrainTiles.ts     3D の地形のタイルの組み立て（範囲の中・外・境目。実装 spec 05 §4.2）
    shared/
      protocol.ts         Worker とメインスレッド間の型付きメッセージ定義
    workers/              Worker 内でのみ動くコード
      simulation.worker.ts
      demLoader.ts        fetch → createImageBitmap → OffscreenCanvas → RGBA
    bridge/
      SimulationClient.ts メインスレッドで Worker を所有する。水深バッファを Renderer へ、統計を store へ渡す
    renderer/             Three.js（水面だけ）。3D に切り替えたときに動的 import で読む。React には非依存
      waterLayer.ts       three の水面の Custom Layer
      waterMesh.ts        純粋な部分（格子のメッシュ）
      matrix.ts           純粋な部分（局所座標のモデル行列と倍精度の積）
      waterTextures.ts    純粋な部分（R32F と LUT の詰め方）
      waterShaders.ts     純粋な部分（シェーダの文字列）
    map/                  MapLibre の命令的ラッパー
      MapController.ts
      GsiTileSource.ts
      view3d/             方式 A の地形（addProtocol・setTerrain・hillshade）、3D の視点、2D への切り替え。
                          3D に切り替えたときに動的 import で読む（options.ts・layerIds.ts は初期ロード側からも読む）
        View3d.ts         3D の取りまとめ（地形・視点・水面・(c) の 2D への切り替え・復帰・E2E の印）
        Terrain3d.ts      addProtocol の登録、DEM のソースと hillshade、setTerrain
        drawnZoom.ts      描かれる地形タイルのズームの実測と見込み、境界の定数（15）
        tileGenerator.ts・mainTileGenerator.ts・gsiDemTile.ts  タイルの生成（メインスレッド）と地理院の取得
        demSource.ts・layerIds.ts・options.ts  タイルの URL とソース、3D のレイヤー ID、3D の選択肢
      fpsProbe.ts・fpsStats.ts  fps の計測と集計（実装 spec 05 §4.4。計測用のフックから使う）
    state/                Zustand ストア
      settingsStore.ts
      simulationStore.ts
      arrowSpacing.ts     矢印の間隔を範囲に比例させる換算（実装 spec 05 §3.3）
    ui/                   React + MUI
      App.tsx
      theme.ts
      strings.ts
      view3dSession.ts    2D と 3D の切り替えと、3D のコードの遅延読み込み（実装 spec 05 §3.6・§3.8）
      perfHook.ts・perfParams.ts  計測用のフック（`pnpm build:perf` のときだけビルドに入る）
      components/
    main.tsx
  tests/
    e2e/                  Playwright
    perf/                 実 GPU の headless の fps の計測と撮影（`pnpm perf:fps`。実装 spec 05 §4.4）
  .npmrc                レジストリの指定のみ（§13.2）
  pnpm-workspace.yaml   pnpm の設定（§13.2。workspace としては使わない）
  .nvmrc
  .dependency-cruiser.mjs
  biome.json
  tsconfig.json           project references のルート（§10.3）
  tsconfig.sim.json
  tsconfig.core.json
  tsconfig.worker.json
  tsconfig.app.json
  tsconfig.node.json
  vite.config.ts
  playwright.config.ts
  playwright.perf.config.ts  計測用（ポート 4175。E2E とは別に回す）
  scripts/preview.mjs     pnpm preview（wrangler pages dev。実装 spec D）
```

## 4.2 レイヤー境界の強制（決定）

base-spec §61 の「Simulation Engine を MapLibre や Three.js に依存させない」を、**dependency-cruiser により CI で機械的に強制する**。

許可される依存方向:

```
ui ────────→ state ─────→ simulation（型のみ）
ui ────────→ bridge
ui ────────→ map ───────→ renderer
ui, map ───→ dem（座標の計算などの純粋な関数。実装 spec 02 で追加）
bridge ────→ state, renderer（05 の時点で renderer への import は無い。水面は map/view3d が動的 import で読む）
bridge ────→ shared（protocol）
renderer ──→ simulation, dem（型のみ）
workers ───→ simulation, dem, shared
shared ────→ simulation, dem（型のみ）
map, state → shared（型のみ）
state ─────→ dem（型のみ）

simulation → （何にも依存しない）
dem ───────→ （何にも依存しない）
```

禁止ルール:

| ルール | 内容 |
|---|---|
| `core-is-pure` | `src/simulation/` と `src/dem/` から、自ディレクトリの外（src 内の他ディレクトリ、外部パッケージ）への import を禁止 |
| `types-only-from-core` | `state`・`renderer`・`shared` から `simulation`・`dem` への import は型のみに限る（dependency-cruiser の type-only 判定を用いる） |
| `map-types-only` | `src/map/`（テストは除く）から `simulation`・`shared` への import は型のみに限る |
| `no-react-outside-ui` | `src/renderer/` と `src/bridge/` から `react`・`react-dom`・`@mui/*`・`@emotion/*` への import を禁止 |
| `workers-not-imported` | `src/workers/` を他のディレクトリから静的に import することを禁止。Worker は `new Worker(new URL(...), { type: 'module' })` でのみ起動する |
| `workers-isolated` | `src/workers/` から `simulation`・`dem`・`shared` 以外の自作モジュールへの import を禁止（Worker にメインスレッド側のコードを持ち込まない） |
| `no-circular` | 循環依存を禁止 |
| `no-orphans` | 依存も被依存も無いモジュールを禁止（テストと型宣言は除外） |
| `not-reachable-from-entry` | エントリ（`src/main.tsx`、`src/workers/*.worker.ts`）から到達できないモジュールを禁止（テストと、テスト用の組み立て `*.test-support.ts` は対象外）。dependency-cruiser の orphan は「依存も被依存も無い」ものだけなので、import を持つ死んだモジュールや、テストからしか使わないモジュールはこの規則で捕まえる |
| `three-only-in-renderer` | `three`（と `@types/three`）を import してよいのは `src/renderer/` だけ（実装 spec 05 §3.8、R05-5） |
| `renderer-dynamic-only` | `src/renderer/` をほかのディレクトリから読むのは動的 import か型だけ。初期ロードに入れない（§14.2）。あわせて `pnpm size` が、初期ロードのチャンクに `three` と `src/renderer/` のモジュールが無いことを検査する |

`types-only-from-core` は、dependency-cruiser の `options.tsPreCompilationDeps: "specify"` で型のみの import を区別し、`dependencyTypesNot: ["type-only"]` を持つルールで違反を検出する。§10.1 の `verbatimModuleSyntax` により型のみの import には必ず `import type` が付くため、判定は確実である。

`src/simulation/` と `src/dem/` は、DOM や WebWorker の API そのものも使えない。これは §10.3 の tsconfig 分割によって型レベルでも担保する。

二重の強制は役割を分けて担う。外部パッケージの import を止めるのは dependency-cruiser、DOM・WebWorker の API の使用を止めるのは tsconfig である。`@types/react` などは DOM の lib が無くても読めるため、tsconfig だけでは外部パッケージを止められない（実装 spec 01 §4.5 の検証 2 で確認）。

## 4.3 workspace 分割を採らない理由

`packages/simulation-core` として物理分離すれば依存は原理的に不可能になるが、ビルド構成と CI が一段複雑になる。dependency-cruiser による CI 強制で同等の規律が得られるため、複雑さに見合わないと判断した。

将来 CLI 実装や npm 公開が現実の要件になった時点で切り出す。その時点でも `src/simulation/` が純粋であることは保証されているため、切り出しコストは低い。

---

# 5. 実行時アーキテクチャ

## 5.1 三層構造（最重要）

大きな配列を React に載せないため、責務を3層に分離する。

```
┌──────────────────────────────────────────────────┐
│ Web Worker                                       │
│   elevation : Float32Array   標高                │
│   validMask : Uint8Array     有効セル            │
│   water     : Float64Array   水深                │
│   activeCells                                    │
│   → シミュレーションの真の状態を所有             │
└───────┬──────────────────────────────────────────┘
        │ postMessage
        │   ・標高と有効セルマスク（読み込み時に1回、コピー）
        │   ・水深の Float32 転送バッファ（毎フレーム、Transferable で往復）
        │   ・統計値（小さいオブジェクト）
        ↓
┌──────────────────────────────────────────────────┐
│ bridge/SimulationClient（メインスレッド）        │
│   Worker を所有し、受信したものを下の2層へ渡す   │
└───────┬───────────────────────────┬──────────────┘
        │ 標高・水深バッファ        │ 10Hz にスロットルした統計値
        ↓                           ↓
┌──────────────────────────┐ ┌───────────────────────────┐
│ Renderer                 │ │ React + MUI + Zustand     │
│ (Three.js / Custom Layer)│ │ 降雨量・半径・再生状態    │
│ バッファを直接 GPU へ    │ │ 垂直強調・DEM 種別        │
│ React の再描画と無関係   │ │ 統計表示・セル情報        │
└──────────────────────────┘ └───────────────────────────┘
```

## 5.2 バッファの受け渡し（ダブルバッファ）

Worker 内部の水深（`Float64Array`）とは別に、描画用の `Float32Array` を2枚用意し、`postMessage` の Transferable として所有権ごと往復させる。転送そのものはコピーを伴わない。Worker は step の後に内部の水深を転送バッファへ単精度で書き写す（250,000 要素で 1ms 未満）。表示には単精度で十分である。

```
Worker                          Main
  bufferA (書き込み中)            bufferB (描画中)
      │                               │
      │  step 完了                    │  描画完了
      └────── transfer bufferA ──────→│
       ←───── transfer bufferB ───────┘
  bufferB (書き込み中)            bufferA (描画中)
```

転送中の配列は転送元で `byteLength === 0` になるため、**転送後に元の参照へアクセスしない**ことを実装上の不変条件とする。

メインスレッドからバッファがまだ返却されていない場合、Worker はそのフレームの送信を見送る（新しいバッファを確保しない）。描画が遅れても Worker 側のメモリは増えない。

frame（と失敗の通知 `simFailed`）は、`terrainId`（その地形を読み込んだ要求の番号）と `runId`（実行の通し番号）を持つ。`runId` はメイン側だけが開始とリセットのたびに振り、Worker は写して返す。地形を読み込み直すと両側で 0 に戻る。メインは今の地形・今の実行でない frame を表示せずに、バッファだけ返す。スケジューラの保留枠は 1 つしかなく、特定の frame（step 0 など）を目印にすると取りこぼしうるためである（実装 spec 04 §5.1）。

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
- `MapController` は地図の生成・破棄とベースマップの切り替え（`setStyle` の後に重ね描きを足し直す購読 `onRestyle`）を受け持つ。実装 spec 04 では、E2E のため、重ね描きのレイヤー ID を知っていて、今のスタイルに実在するものをコンテナの `data-overlay-layers` に、今のベースマップを `data-basemap` に書く（重ね描きの中身は各 Overlay が持つ。この 2 つの印のために役割を少し広げた）
- 実装 spec 05 で、E2E と計測のための印を地図のコンテナに足した。`MapController` が `data-visible-overlay-layers`（今のスタイルにあり、`visibility` が `none` でないレイヤー）を、`View3d` が `data-view3d`（`off`・`3d`・`fallback-2d`）・`data-view3d-framed`（3D の視点へ動き終えた）・`data-water-builds`（水面を作った回数）・`data-map-zoom`（小数 3 桁）・`data-map-pitch`・`data-drawn-tile-zoom`（画面の中心で描かれている地形タイルのズームの実測）を書く。使うのは `tests/e2e/view3d.spec.ts`（§11.4）と `tests/perf/`

## 5.4 データフロー全体

```
ユーザーが地図をクリック
        ↓
中心座標 → タイル座標へ変換 (src/dem/tileMath.ts)
        ↓
DEM タイル URL を決定（DEM1A → DEM5A/B/C → DEM10B のフォールバック）
        ↓
Worker 内で fetch → createImageBitmap → OffscreenCanvas → getImageData（workers/demLoader.ts）
        ↓
GsiDemDecoder（純粋関数）で RGBA → elevation + validMask   (§7.2)
        ↓
DemGrid でタイルを結合し、範囲を切り出す   (§7.6)
        ↓
標高と validMask をメインスレッドへ1回コピーで送る（Renderer・セル情報用）
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

`createImageBitmap` は既定で色空間の変換やアルファの乗算を行うことがあり、PNG の RGB 値が変わると標高が狂う。`createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })` とし、Canvas は `getContext('2d', { willReadFrequently: true })` で取得する。実タイル 1 枚の既知の画素について、復号した標高が一致することを確かめるテストを置く。

## 5.5 地形の描画方式（決定。スパイク S の結論、2026-09-13 のユーザーの裁定）

| 項目 | 決定 | 根拠（`docs/superpowers/spikes/2026-09-12-3d-rendering.md`） |
|---|---|---|
| 地形 | A 系: MapLibre の 3D terrain。`addProtocol` で GSI の標高 PNG を Terrarium に変換する。raster-dem は `tileSize: 256` を明示する。hillshade は地形と**別の raster-dem のソース**（`tileSize: 512`。同じソースだと MapLibre が警告を出す）で、既定の `auto` は**淡色・標準の地図で付け、写真の地図では付けない** | §4、§10 |
| 水面 | Custom Layer。標高と水深を R32F のテクスチャで渡し、頂点シェーダで高さを付ける | spec 05 §3.1、§4 の fps |
| 水面の高さの基準 | シミュレーションの標高（A）。曲面では、描かれる地形タイルのメッシュが弦の高さぶん水面より上に出うる（描かれるタイル z15 で最大約 2.5cm）。**対策は (c)**: 画面の中心で描かれる地形タイルのズーム（**実測**）が **15** より粗いときは 2D にする。地形が有効な間は描かれるタイルが pitch で粗くなる（pitch 60 で 1 段、pitch 85 で 1〜2 段）ので、3D の最初の視点は地図のズーム **16.5 以上**にする。2D に落ちた後は地形が無く実測できないので、pitch つきの**見込み**が **15 + 0.5 以上**になったら 3D に戻す（実装 spec 05 §4.3、R05-4） | §5、§4 の曲面、A' の差、§10 |
| 垂直強調 | `setTerrain({ exaggeration })` とシェーダに同じ値 | §4 の合格基準 2 |
| z-fighting の対策 | 水面を後に描く＋`polygonOffset(−1, −4)` | §4、`water-a.md` |
| 範囲の境界 | なし（A 系） | §4 の継ぎ目、`seam.md` |
| 3D 描画のライブラリ | Three.js（水面のチャンクを動的 import。初期ロードは不変） | `bundle.md`、`complexity.md`、§8 |

スパイク S は、A（上の決定）、A'（水面の高さを `queryTerrainElevation` で MapLibre の地形に合わせる）、B（範囲の中は Three.js で地形メッシュも描く）、B-raw（B を Three.js なしの WebGL2 で書く）を比べた。A' は、高さの取り直しが速い経路でも 123〜156 ms かかり（§14.1 の 50 ms を超える）、表示される水面の高さがシミュレーションの標高と最大 0.024 m × 倍率 食い違うので採らない。裁定は実装 spec の概要（`docs/superpowers/specs/2026-09-10-00-overview.md` §6）の RS-2・RS-4・R05-4〜R05-6。設計の詳細は実装 spec 05 §4。

GSI の標高 PNG は符号付き 24bit で無効値を持つため、MapLibre の `raster-dem` が前提とする Terrarium・Mapbox 形式とも、線形のカスタムエンコーディングとも一致しない（base-spec §27）。そのため変換が必須になる。範囲の中は、02 のグリッドから全ズームのタイルを作る（実装 spec 05 §4.2）。

垂直強調 ×10 では、地図の pitch は 85° に届かない。計測ではタイルが揃ってから同じ視点を置き直しており、渋谷の z16 ×10 p85 は Task 6・9 の 36 ラン（範囲 500 m・1000 m、地形のみ・水面あり）のすべてで **78.60°** に収束している。直しの前の Task 5 では、タイルが読める前に視点を置いたため 78.60〜82.96° に割れた。MapLibre はカメラが持ち上がった地形の中に入るとき、カメラをその地形の高さまで持ち上げて pitch とズームを作り直すためで、持ち上がりは「カメラの下の標高 × 垂直強調」に比例する。`MapController` の `maxPitch: 85` が文字どおり効くのは垂直強調 ×1 のとき（実装 spec 05 Task 5 の実測）。

これとは別に、**2D のラスタ表示（水深や標高を画像として地図に重ねる）を検証用ビューとして必ず作る。** 3D の描画方式に関係なく、base-spec §56 が最初に求める「窪地・流路が期待どおりに得られるか」の確認は、この 2D 表示で行える（実装 spec 04 で作り、05 でも常設のモードとして残す。R05-1）。

スパイクの合格基準と結果（A）:

| 合格基準 | 結果 |
|---|---|
| 1. 垂直強調 1x〜10x のすべてで、水深 1cm 以上の水面が地形に沈まず、ちらつかないこと | 平面の 1cm の膜は `polygonOffset(−1, −4)` で 8/8 ○（可視率の最小 0.9986、ちらつきの最大 0.0077%）。曲面は、描かれる地形タイル z16 以上なら幾何の上でも沈まない。z15 以下は弦の沈み込み（z15 で最大 2.46 cm）が残り、斜め視点は未確定。置き方は実装 spec 05 §4.3（R05-4）で決める。**05 の撮影（計画 Task 13。実アプリ・実タイル、渋谷駅付近・範囲 500 m・雨量 500 mm）**: 画面の中心で描かれる地形タイルが**境界の 15** になる斜め視点（pitch 45 × 倍率 1〜10、pitch 60 × 倍率 1・10、pitch 85 × 倍率 1）で、地肌の透けも水面の縁の欠けも見えなかった。**pitch 85 の倍率 2 以上は、カメラが強調した地形の中に入るか水平線すれすれになり評価できなかった。** 境界 **16** との比較は pitch 60 の 2 視点（倍率 1・10）だけで行っており、**16 側は地図のズームが 1 段近い（17.0 対 16.0）ぶん同じ池が大きく写る**という 15 に有利な偏りを含むが、それでも質の違いは見られなかったため、境界は **15** のままとした。ただし**ちらつきは静止画では判定できない**ので、確定はユーザーの手動確認の後である |
| 2. 垂直強調を地形と水面に同じ倍率で適用できること（base-spec §29） | ○（`setTerrain` とシェーダに同じ値） |
| 3. シミュレーション実行中も、地図操作で 60fps を維持できること（§14.1） | 手動（実 GPU）の結果は S の報告の時点で未着。参考値（実 GPU・headless、60Hz が上限）は z17 ×5 p60 で 58.0 fps、z16 ×10 p85 で 56.8 fps・長いフレーム 285 間隔のうち 6 で、z16 ×10 p85 は外す。地形のみでも同じで、不足は地形の経路にある。**裁定（2026-09-13）: 外しても A を保ち、05 で本番のタイルの経路で測り直して改善する**（実装 spec 05 §4.4、R05-6）。**05 の測り直しの結果**（Task 5・6・9、実 GPU・headless、本番のタイルの経路、毎回新しい context）: 4 視点 × 地形のみ／水面あり の 8 条件のうち **7 条件が D15 を満たし**（そのうち **6 条件は 60.0 fps**〈rAF の上限〉、残る 1 条件〈地形のみ 1000 m ×10 p85〉は **59.6 fps**）、**1000 m ×10 p85 の水面ありだけが 51.0 fps** で外れた。採った調整は「タイルの生成はメインスレッドのまま」「hillshade の既定は auto のまま」（どちらも Worker を増やさない）で、地形を描く範囲を狭める試しは不要だった。残る 1 条件は 06 へ引き継ぐ（§14.1） |

方式 A を採っても、シミュレーション側（§5.1 の Worker 層）の設計は変わらない。

---

# 6. シミュレーションエンジンの実装方針

## 6.1 決定: 初期は TypeScript 実装

Phase 1〜4（base-spec §55）は TypeScript + TypedArray で実装する。Rust WASM は初期実装に含めない。

### 判断根拠

base-spec §22-23 が指定する Active Cell 方式を適用した場合の概算（base-spec の Active Cell は、実装 spec 03 §3.5 で濡れたセルの外接矩形の走査範囲として実装した）:

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
export interface TerrainMeta {
  width: number        // 列数
  height: number       // 行数
  cellSizeM: number    // セルの一辺（m）。§7.6
}

export interface RainfallInput {
  x: number            // グリッドの北西端から東向きの距離（m）
  y: number            // グリッドの北西端から南向きの距離（m）
  radiusM: number
  amountMm: number
}

export interface StepStats {
  step: number         // 実行済みの step 数（base-spec §33 の「Step N」）
  totalWater: number   // 累積の投入水量（m³）
  storedWater: number  // 領域内にある現在の水量（m³）
  outflowWater: number // 累積の領域外流出量（m³）
  maxDepth: number     // 最大水深（m）
  floodedArea: number  // 水深が描画閾値（1cm）以上のセルの面積（m²）
  settled: boolean     // この step で、θ を超える水面差による流れが無かった（§6.6）
  massError: number    // totalWater − storedWater − outflowWater（m³）
  events: SimulationEvent[]  // この step で起きた越流イベント
}

export interface SimulationEvent {
  type: 'spill'        // 窪地の最低点の水位が spill 標高 − 1cm に達した（base-spec §21）
  step: number
  depressionId: number
  spillElevation: number
}

export interface SimulationEngine {
  loadTerrain(elevation: Float32Array, validMask: Uint8Array, meta: TerrainMeta): void
  addRainfall(rain: RainfallInput): void
  step(): StepStats
  reset(): void
  /**
   * 内部の水深配列（読み取り専用。転送バッファへのコピー元にのみ使う）。
   * step() のたびに別の配列に入れ替わるので、step の後に呼び直す
   */
  waterDepth(): Float64Array
  /** 越流イベントの判定に使う窪地（実装 spec 02 の地形解析の結果） */
  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void
  /** 現在の状態から計算した、各セルの流出のベクトル（水の流れの矢印用） */
  flowVectors(): { x: Float32Array; y: Float32Array }
}
```

TypeScript 実装（`TsSimulationEngine`）と将来の WASM 実装（`WasmSimulationEngine`）が同一インターフェースを満たす。呼び出し側（Worker）は実装を知らない。`FlowSolver.ts` はエンジン内部で 1 step 分の水移動を計算するモジュールであり、外部には公開しない。

base-spec の API 例との対応:

| base-spec | 本書 | 変更理由 |
|---|---|---|
| §44 `SimulationConfig` | `TerrainMeta` | `timestep` は持たない。base-spec §33 のとおり step は物理時間と対応しないため |
| §44 `Rainfall` | `RainfallInput` | 座標系（グリッド北西端からの m）と単位を名前で明示した |
| §45 `step()` など | 同名のメソッド | 変更なし |
| §46 `SimulationResult` | `StepStats` + `waterDepth()` | 水深配列は §5.2 の転送設計で統計値と別経路になるため分けた。統計のフィールド名は base-spec を踏襲 |

## 6.3 Rust WASM への移行基準（決定）

以下の**いずれか**を満たした場合に限り、Rust WASM 実装の追加を検討する。

> DEM1A / 500m 四方 / 濡れたセルに絞った走査（実装 spec 03 §3.5 の外接矩形）の条件で、Chrome デスクトップ実測において
> - 1 step の所要時間の**中央値が 8ms を超える**、または
> - **p95 が 16ms を超える**

実測が上記に届かない限り、TypeScript 実装を維持する。「速そうだから」という理由での導入を認めない。

## 6.4 WASM を採用する場合の方針

移行基準に達した場合、以下の方針で実装する。

- **crate 依存ゼロ**。`wasm-bindgen` も使用しない。`#[no_mangle] pub extern "C"` 関数と WebAssembly linear memory のみで JS と接続する
- ビルドは `cargo build --target wasm32-unknown-unknown --release` の単一コマンド。`wasm-pack` を使わない
- メインスレッドではなく Worker 内でのみインスタンス化する
- 中間計算は f64 で行う。TypeScript の数値演算は常に倍精度なので、差分テスト（§11.6）で両実装を一致させるために必要である
- **TypeScript 実装を削除しない。リファレンス実装として維持する**

最後の点が重要である。同一入力に対する両実装の出力を突き合わせる**差分テスト**を CI で実行することで、WASM 実装のバグ（浮動小数点演算順序の差異、境界処理の取りこぼし等）を機械的に検出できる。base-spec §47/§48 のテストケース群はそのまま両実装に適用可能である。

### WASM が明確に有利な箇所

移行を検討する際、特に効果が見込めるのは以下である。

1. **濡れたブロックの管理** — 実装 spec 03 §3.5 の外接矩形は、濡れた場所が散らばると広がる。ブロックをビットセットで管理する方式に移すと差が出やすい（Rust では自前のビットセットで持てる）
2. **全セル総当たりが必要な処理** — 窪地検出（Priority-Flood 等）や初期シンク解析。走査範囲を絞る方式が効かないため素の演算速度が支配的になる

## 6.5 数値表現

| 対象 | 型 | 理由 |
|---|---|---|
| 標高 | `Float32Array` | GSI の記録単位は 0.01m。単精度の丸め誤差は標高 4000m でも 0.3mm 未満 |
| 有効セルマスク | `Uint8Array` | 無効値セルの判定（§7.2） |
| 水深（Worker 内） | `Float64Array` | 数百万回の水移動で丸め誤差が累積し、質量保存を崩すのを避ける |
| 水深（描画用の転送バッファ） | `Float32Array` | 表示には単精度で十分。転送量が半分になる |
| 質量保存の累計値（投入・流出・湛水） | `number`（f64） | 加算の反復による誤差の蓄積を避ける |
| 中間計算 | `number`（f64） | JavaScript の数値演算は常に倍精度。WASM でも f64 に揃える（§6.4） |
| セルインデックス | `Int32Array` | 降雨の投入先の一覧。走査範囲はセルの集合ではなく、濡れたセルの外接矩形で持つ（実装 spec 03 §3.5） |

許容誤差は §6.6 で定める。定数は `src/simulation/constants.ts` に集約する。

## 6.6 精度・許容誤差・表示の粒度（決定）

base-spec §6 の精度方針を、以下のとおり具体化する。内部の値は 0.1m などの単位に丸めない。丸めると薄い水の移動が消え、質量保存が成り立たなくなるためである。

### データの記録単位

GSI の標高 PNG は 0.01m 単位で標高を記録している（地理院の標高タイル仕様で u = 0.01m）。2026-09-10 に実タイルを復号して確認した結果は以下のとおり。

| タイル | 0.1m の倍数である値の割合 | 解釈 |
|---|---|---|
| DEM1A（`dem1a_png`、z17） | 約 5% | 1cm 刻みの値を持つ |
| DEM5A（`dem5a_png`、z15） | 約 9% | 1cm 刻みの値を持つ |
| DEM10B（`dem_png`、z14） | 約 52% | 元データが 0.1m 刻みの箇所を多く含む |

1cm は記録の単位であって、測量精度そのものではない。base-spec §6 のとおり、この区別を UI で明示する。

### 計算

- 標高と水深は連続値で扱う（§6.5）。0.1m などへの丸めは行わない
- 数値計算による誤差を、ユーザーが求める「10cm 以内」より十分小さく抑える

### 許容誤差（初期値。実測で調整する。base-spec §49）

| 名前 | 初期値 | 用途 |
|---|---|---|
| 質量保存の許容誤差 | (初期水量 + 投入水量の累計) × 1e-9 | 各 step での質量保存の検査（§11.3） |
| 水面標高の数値誤差 | 1cm | 平衡状態の水面標高と、体積から求めた理論値との差（§11.2）。目標の 10cm に対し十分な余裕を取る |
| 水深の比較許容値（epsilon） | 1e-5 m | 水深・水面の比較の許容値。流れの閾値 θ と同じ値 |
| 流れの閾値 θ | 1e-5 m | 水面差がこれ以下の近傍には流さない。池の水面は 1 セルあたり最大 θ まで傾いたまま止まりうるので、512 セル幅でも 5mm に収まる値とした（実装 spec 03 §3.4） |

### 表示

- 水深の色分けと凡例は **5cm 刻み**とする。base-spec §31 の標準区分と「10cm 刻み表示」を置き換える。連続表示のモードは残す
- 数値で表示する水深と標高（base-spec §38 の最大水深、§39 のセル情報）は **0.01m 単位**とする。元データの記録単位に合わせる
- 水面の描画閾値は base-spec §30 のとおり 1cm とする

## 6.7 base-spec §55 のフェーズとの対応（決定）

base-spec §55 は Web Worker・TypedArray・Active Cells を Phase 5（Performance）に置いているが、§24・§25 の本文と本書の設計はこれらを前提にしている。本書では次のとおりに前倒しする。

| 要素 | base-spec §55 | 本書 | 理由 |
|---|---|---|---|
| Web Worker | Phase 5 | Phase 1 から | DEM の取得とデコードに既に使う。スレッド境界を後から入れると手戻りが大きい |
| TypedArray | Phase 5 | Phase 1 から | base-spec §25 の原則どおり |
| Active Cells | Phase 5 | Phase 3（Dynamic Water） | §6.3 の測定条件の前提になる |
| WebGPU | Phase 5 | 導入しない | §1.1 |

Phase 5 は、性能の計測と、§6.3・§8.4 の条件を満たした場合の最適化を行う段階とする。

---

# 7. 外部データアクセス

## 7.1 バックエンド不要の検証結果（実測）

GSI タイルエンドポイントの CORS 対応を実測した（2026-09-10 時点。`Origin` ヘッダを付けた GET で確認した。GSI は `Vary: Origin` を返し、`Origin` の無いリクエストには ACAO を付けない。ブラウザの CORS リクエストは必ず `Origin` を送るので実害はないが、再検証の際は `Origin` を付けること）。

```
GET https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/{z}/{x}/{y}.png
GET https://cyberjapandata.gsi.go.jp/xyz/dem5a_png/{z}/{x}/{y}.png
GET https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png

いずれも:
  HTTP/2 200
  access-control-allow-origin: *
  ※ Cross-Origin-Resource-Policy ヘッダは返却されない

存在しないタイル（海域の DEM1A、存在しないパスなど）:
  HTTP/2 404（本文は S3 の XML エラー）
  access-control-allow-origin: *
```

`access-control-allow-origin: *` が返るため、ブラウザから直接 fetch でき、`createImageBitmap` 経由でピクセル値を読み取っても canvas が tainted にならない。**プロキシ用のバックエンドは不要である**。

404 のレスポンスにも `access-control-allow-origin: *` が付くため、ブラウザの fetch から 404 のステータスを読み取れる。§7.4 のフォールバックは、404（データなし）とネットワークエラーを区別して実装できる。

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

`x == 2^23` の無効値セル（海域、データ欠測域）は、有効セルマスク（`Uint8Array`。有効 = 1、無効 = 0）で表す。無効セルの標高配列の値は参照しない。`NaN` はホットループに持ち込まない（比較が常に false になり、分岐の取りこぼしを招くため）。

シミュレーション上は**領域外と同等に扱う**。すなわち:

- 無効値セルへ流入した水は「領域外流出」として計上する（base-spec §18 の境界条件と同一の扱い）
- 無効値セルには水を保持させない
- 無効値セルからの流出は発生しない

無効値セルが対象範囲に含まれる場合、UI 上でその割合を表示し、結果の信頼性が下がる旨を注意表示する。

## 7.3 SharedArrayBuffer を採用しない理由（決定）

`SharedArrayBuffer` を使うには、ページに `Cross-Origin-Opener-Policy: same-origin` と `Cross-Origin-Embedder-Policy` を付けて cross-origin isolation を有効にする必要がある。

技術的には可能である。Cloudflare Pages は `_headers` ファイルでこれらのヘッダを付けられる。また COEP の下でも、CORS モードで取得して ACAO の検査を通るリソースは読み込める。MapLibre はタイルを `fetch()` の CORS モードで取得し、GSI は `access-control-allow-origin: *` を返すので、地図と DEM の取得は壊れない。

それでも採用しないのは、§5.2 の Transferable ダブルバッファで性能要件を満たせるためである。cross-origin isolation を有効にすると、`crossorigin` 属性なしで第三者のリソース（Web フォントの `<link>` など）を埋め込めなくなる制約と、ヘッダ設定を維持し続ける負担を負う。得られるものに対して、運用の負担が見合わない。

§6.3 の基準で WASM を導入し、さらにマルチスレッド化が必要になった場合に再検討する。

## 7.4 DEM の選択とフォールバック

base-spec §41 のとおり自動選択する。

| DEM | 最大ズーム | エンドポイント |
|---|---|---|
| DEM1A | z17 | `/xyz/dem1a_png/{z}/{x}/{y}.png` |
| DEM5A | z15 | `/xyz/dem5a_png/{z}/{x}/{y}.png` |
| DEM5B | z15 | `/xyz/dem5b_png/{z}/{x}/{y}.png` |
| DEM5C | z15 | `/xyz/dem5c_png/{z}/{x}/{y}.png` |
| DEM10B | z14 | `/xyz/dem_png/{z}/{x}/{y}.png` |

DEM10B の PNG タイルのパスは `dem_png` である。`dem10b_png` というパスは存在しない（2026-09-10 に実測。存在しないキーとして 404 が返る）。上表のパスは地理院タイル一覧のページで確認した。

DEM1A → DEM5 → DEM10B の 3 段で選ぶ。DEM5 は、タイルごとに 5A → 5B → 5C の順に 200 が返るまで試して合成する（同じズームなので解像度は混在しない）。範囲内のタイルが 404 の場合は、`dem_png` でそのタイルが海域かを判定し、海域なら無効値として扱い、未整備の陸域なら範囲全体を次の段に落とす。範囲の全画素が無効値なら「この地域には標高データがありません」と表示し、シミュレーションを開始しない。詳細は実装 spec 02 §4。

## 7.5 エラー処理方針

| 事象 | 挙動 |
|---|---|
| DEM タイルが 404（国外・海域等） | 次の DEM へフォールバック。全滅時はユーザーに明示 |
| ネットワークエラー | 指数バックオフで最大3回リトライ。以後ユーザーに通知 |
| WebGL 2 非対応 | 起動時に検出し、非対応である旨を表示して 3D 表示を行わない |
| `OffscreenCanvas` 非対応 | WebGL 2 と同じく起動時に検出し、非対応である旨を表示する。フォールバック経路は作らない（対象ブラウザの最新版はすべて対応している） |
| Worker の異常終了 | エラーを UI に表示し、「再読み込み」で同じ地点を選び直して復帰する（地形の読み込みからやり直す。DEM は HTTP キャッシュから読む）。異常終了の後、再生の命令では Worker を起動し直さない（実装 spec 04） |
| 地形の読み込みが進まない | 進捗が 30 秒届かなければ、Worker の異常終了と同じに扱う。生きている Worker を止めないよう、タイルの 1 回の取得に 20 秒の上限を置き（超えたら再試行、尽きたらネットワークエラー）、再試行の各回で進捗を送り直す（実装 spec 04） |

## 7.6 シミュレーショングリッドの定義（決定）

選択した DEM の最大ズームのピクセルを、リサンプリングせずにそのままセルとする。

```
cellSizeM = 2π × 6378137 × cos(φ0) / (256 × 2^z)
  φ0 : シミュレーション範囲の中心の緯度
  z  : DEM の最大ズーム（§7.4）
```

| DEM | z | φ0 = 26°（那覇付近） | φ0 = 35°（東京付近） | φ0 = 45°（稚内付近） |
|---|---|---|---|---|
| DEM1A | 17 | 約 1.07m | 約 0.98m | 約 0.84m |
| DEM5A/B/C | 15 | 約 4.3m | 約 3.9m | 約 3.4m |
| DEM10B | 14 | 約 8.6m | 約 7.8m | 約 6.8m |

- 範囲内での緯度による縮尺の変化は、1000m 四方でも 0.02% 以下なので無視する。全セルに同じ `cellSizeM` を使う
- セル数は `ceil(sizeM / cellSizeM)` とし、要求された範囲を必ず覆う。DEM1A・500m・φ0 = 35° では 512 × 512 になる。base-spec §9 の「500 × 500」はこの近似である
- 範囲は複数のタイルにまたがるため、`DemGrid` がタイルを結合して切り出す。DEM1A・500m では 1 辺あたり最大 3 タイル（計 9 タイル）になる
- セル面積は `cellSizeM²` とする。水量（m³）は 水深（m）× セル面積 で求める

## 7.7 レスポンスヘッダと CSP（決定）

Cloudflare Pages の `_headers` で、CSP などのレスポンスヘッダを付ける（2026-09-10 裁定。配信先は実装 spec D で Workers の Static Assets から Pages に移した）。

- 読み込みを許すのは、自サイトと地理院タイル（`https://cyberjapandata.gsi.go.jp`）のみとする。`img-src` と `connect-src` に地理院を加える
- `style-src 'unsafe-inline'` は Emotion のために必要である
- MapLibre の内部の Worker は `setWorkerUrl()` で同一オリジンのファイルから起動するので、`worker-src` に `blob:` は要らない（実装 spec 01 の E2E で、`worker-src 'self'` のまま CSP 違反が 0 件であることを確認した）
- フォントは外部から読まず、システムフォントを使う。外部のフォントを読むと許可するオリジンが増え、利用者のアクセスが外部に伝わる（base-spec §52）
- Rust WASM を導入する場合（§6.4）は、`script-src` に `'wasm-unsafe-eval'` を加える
- 具体的なポリシーは実装 spec 01 §4.8 で定める。手元では `pnpm preview`（`wrangler pages dev`）が同じ `_headers` を適用し、E2E で確かめる（実装 spec D §4.5）
- `/assets/*` は `Cache-Control: public, max-age=31536000, immutable` で配信する（2026-09-11 裁定 RB-1）。Vite の出力ファイル名にはコンテンツハッシュが付くため、内容が変われば URL も変わる。`index.html` はハッシュを持たないのでこのルールの対象外とし、従来どおり毎回検証させる
- `*.pages.dev`（本番の `raintrace.pages.dev` と、`main.`・`pr-<番号>.` などの別名）には `X-Robots-Tag: noindex` を付ける。独自ドメインには付けない（実装 spec D R-D6）

---

# 8. 状態管理と永続化

## 8.1 状態の分類

| 分類 | 保持場所 | 例 |
|---|---|---|
| シミュレーションの真の状態 | Web Worker 内の TypedArray | 標高、水深、走査範囲 |
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
    waterDepthPalette: 'stepped' | 'continuous'   // stepped は 5cm 刻み（§6.6）
    showFlowVectors: boolean
    flowVectorSpacingM: 5 | 10 | 20   // 範囲 500 m での間隔。実際の間隔は 値 × 範囲 ÷ 500（実装 spec 05 §3.3）
  }
  map: {
    basemap: 'std' | 'pale' | 'photo'   // 既定 'pale'
    theme: 'light' | 'dark' | 'system'  // 既定 'system'
  }
  disclaimerAcknowledgedAt: string | null   // ISO 8601
}
```

保存する値は上の形そのままとする（zustand の persist の既定の包み `{ state, version }` を外す）。`showFlowVectors` は水の流れの矢印の表示、`flowVectorSpacingM` は水の流れと地形の流向で共通の矢印の間隔（実装 spec 04）。実装 spec 05 から、保存する値は**範囲 500 m での間隔**で、実際の間隔は範囲の一辺に比例させる（1000 m で 2 倍、250 m で半分。保存の形は変えていない）。範囲を小さくしたときは、半径を範囲の半分に収めてから保存する（保存値が常に検証を通る形になる）。

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

`@mui/material` と Emotion（`@emotion/react` / `@emotion/styled`）を使用する。アイコンは `@mui/icons-material/PlayArrow` のように、アイコンごとのパスから import する。バレルからの named import は本番ビルドでは tree-shake されるが、開発サーバの起動が重くなるためである。

SSR を行わないため Emotion のランタイムコストは許容範囲である。

実装 spec 04 の時点ではアイコンを使わず、ボタンは文字にする（`@mui/icons-material` を依存に足さない。読み上げにも向く）。アイコンを入れるときは上のとおりアイコンごとのパスから import する。

## 9.2 テーマ

- MUI の CSS variables 機能（`colorSchemes`）を用い、light / dark の両方を定義する
- 既定はシステム設定に追従。ユーザーによる切り替えを可能とし、選択は localStorage に保存する
- 手動の切り替えのため、`cssVariables` の `colorSchemeSelector` を `'class'` にする（light と dark の両方があると MUI の既定は `'media'` で、`setMode` では変わらない）。選んだテーマは §8.3 の `map.theme` に保存し、MUI 自身の保存（`mui-mode`）は使わない（`storageManager={null}`）
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
| `PlaybackControls` | Play / Pause / Reset / 速度 | `Button`（文字。開始・一時停止・再開は 1 つのボタン）, `ToggleButtonGroup` |
| `StatisticsPanel` | base-spec §38 の統計表示 | `Table` |
| `CellInfoPopover` | base-spec §39 のセル情報 | `Popover` |
| `DemInfoBadge` | base-spec §40 の DEM 情報 | `Chip`, `Tooltip` |
| `DisclaimerDialog` | base-spec §59 の注意表示 | `Dialog` |
| `DisplaySettings` | 垂直強調・水深表示・流向表示 | `Switch`, `ToggleButtonGroup`（水深の配色・矢印の間隔・背景地図・画面の配色） |

列挙の選択は `ToggleButtonGroup` にし、`Select` を使わない（Menu・Popover を引き込み、`ui` チャンクが増えるため。実装 spec 04）。

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

TypeScript の project references で領域を分割し、`tsc -b` で一括して型検査する。

| ファイル | 対象 | lib | `noUncheckedIndexedAccess` |
|---|---|---|---|
| `tsconfig.json` | ルート（references のみ） | | |
| `tsconfig.sim.json` | `src/simulation/` | `ES2023` のみ | 無効 |
| `tsconfig.core.json` | `src/dem/`, `src/shared/` | `ES2023` のみ | 有効 |
| `tsconfig.worker.json` | `src/workers/` | `ES2023`, `WebWorker` | 有効 |
| `tsconfig.app.json` | 上記以外の `src/` | `ES2023`, `DOM`, `DOM.Iterable` | 有効 |
| `tsconfig.node.json` | `vite.config.ts`・`vitest.config.ts`・`playwright.config.ts`・`tests/e2e/` | `ES2023`, `DOM`（E2E の page.evaluate のため） | 有効 |
| `tsconfig.scripts.json` | `scripts/**/*.ts`（Node で直接実行するスクリプト） | `ES2023` のみ（types に `node`） | 有効 |
| `tsconfig.test.json` | `*.test.ts`・`*.test.tsx`（全ディレクトリ） | `ES2023`, `DOM`, `DOM.Iterable`（types に `node`・`vitest`） | 有効 |

構成上の要点:

- **`DOM` と `WebWorker` の lib を同じコンパイル単位に同時指定しない。** 同時に指定すると、Worker のコードから `document` を参照しても型エラーにならず、Worker で使えない API の誤用を型で防げないためである。なお `skipLibCheck: false` の場合は、2つの lib の宣言が衝突してエラーになる（2026-09-10 に tsc 5.9.3 で、`skipLibCheck: true` では衝突せず `document` の参照が通ること、`false` では TS6200 などが出ることを確認した）
- **純粋な領域（sim・core）はどちらの lib も持たない。** `document`・`window`・`self`・`fetch`・`console` のいずれも参照できないことを型レベルで保証する。計測（`performance.now()`）とログ出力は workers 側で行う。§4.2 の dependency-cruiser と合わせて二重に強制する
- **sim と core は `composite: true` と `emitDeclarationOnly: true` で型宣言を出力し、他のプロジェクトは references 経由でそれを参照する。** 参照せずにソースを直接 import すると、import した側の設定（`noUncheckedIndexedAccess: true` など）で `src/simulation/` まで検査され、§10.2 の設定分けが意味を失うためである。型宣言の出力先はリポジトリ外の一時ディレクトリ（例: `node_modules/.tmp/`）とする
- 実行時のバンドルは、Vite が TypeScript のソースから直接行う。型宣言の出力は型検査にだけ使う
- 参照する側（worker・app）は `noEmit` のままでよい。参照される側は `noEmit` にできない（TS6310 になる）
- **型検査は必ず `tsc -b` で行う。** `tsc -p` を単独で実行すると、参照先の型宣言がまだ出力されていない場合に TS6305 で失敗する。CI と pre-push（§12.2、§12.3）はどちらも `tsc -b` を使う
- テストファイル（`*.test.ts`・`*.test.tsx`）は各プロジェクトの対象から外し、`tsconfig.test.json` でまとめて検査する。composite プロジェクトの型宣言にテストが混ざらないようにするため（実装 spec 01 §4.5）
- 純粋な層（`src/simulation/`・`src/dem/`・`src/shared/`）の相対 import には `.ts` の拡張子を付け、これらのプロジェクトに `allowImportingTsExtensions: true` を置く。エンジンを Node で直接実行できるようにするため（base-spec §61、実装 spec 03 §5）

2026-09-10 に tsc 5.9.3 で、この構成なら隔離が成り立つことを確認した。Vite のテンプレートと同じ構成（各プロジェクトが `noEmit` で composite なし）では、`tsc -b` は通るものの、`src/simulation/` が import 側の設定で検査されてしまい、隔離されないことも確認した。

TypeScript は 6 系を使う（2026-09-10 時点で 6.0.3。実装 spec 01 で、6.0.3 でもこの構成で隔離が成り立つことを確認した）。7 系（Go 実装）は npm パッケージが従来の JS API を公開しておらず、dependency-cruiser（§4.2）が対応していない（18.2.0 は `typescript >=2.0.0 <7.0.0` のみ）。dependency-cruiser が対応した時点で 7 系への移行を検討する。

---

# 11. テスト戦略

## 11.1 レイヤーごとの方針

| 対象 | 手法 | 重点 |
|---|---|---|
| `src/simulation/` | Vitest（ユニット）+ fast-check（property-based） | **最重点**。base-spec §47/§48 |
| `src/dem/` | Vitest（ユニット） | デコード式、タイル座標変換、無効値処理 |
| `src/state/` | Vitest | localStorage スキーマ検証、不正値の破棄 |
| `src/renderer/`, `src/map/` | Vitest（ユニット）+ Playwright（E2E）+ 手動 | 純粋な部分（格子・行列・LUT・シェーダの文字列・描かれるタイルのズーム・地形のタイルの組み立て・fps の集計）はユニット。描画は E2E（スモーク。3D は `tests/e2e/view3d.spec.ts`）と手動。描画結果の画素は比べない（§11.4） |
| `src/ui/` | Vitest + Testing Library（jsdom。ファイルの先頭の `// @vitest-environment jsdom` で選ぶ。限定的） | 入力値のバリデーションと状態反映のみ |
| 全体 | Playwright（E2E） | スモークテスト（§11.4） |

## 11.2 シミュレーションの検証（最重要）

base-spec §47 の4ケースを必須テストとする。

| ケース | 検証内容 |
|---|---|
| 平面 | 完全に平坦な地形で、水面が均等になること |
| 傾斜面 | 高所から低所へ移動すること。逆流しないこと |
| 単純窪地 | 窪地に蓄積し、平衡状態で水面が水平になること |
| 越流 | 水位上昇後、最も低い峠（spill point）から隣接領域へ流れること |
| 平衡水位 | 閉じた窪地に既知の体積の水を入れ、平衡後の水面標高が体積から求めた理論値と 1cm 以内で一致すること（§6.6） |

## 11.3 質量保存の property-based テスト

base-spec §48 の質量保存はランダム入力に対する不変条件であるため、fast-check による property-based テストとして記述する。

```
∀ (地形, 降雨条件, ステップ数):
    |初期水量 + 投入水量 − (現在水量 + 累積流出量)| ≤ (初期水量 + 投入水量) × 1e-9   (§6.6)
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
4. 既定の設定（100mm・10m）で Start を押すと、投入水量が 31.4 m³ になり、Step が進む
5. Reset を押すと統計値が 0 に戻る
6. 免責ダイアログが初回に表示され、了解後は再表示されない
7. `?mm=50&r=20` を付けて開くと入力欄にその値が入る
8. 範囲内のクリックでセル情報が開き、『ここを降雨中心にする』で範囲を読み込み直す
9. キーボードだけで雨量・半径の入力から Start・Pause・Reset まで操作できる（実装 spec 04 §11.2）

実装 spec 05 の 3D は `tests/e2e/view3d.spec.ts` の 8 件で確かめる。3D の状態は §5.3 の印（`data-view3d`・`data-view3d-framed`・`data-water-builds`・`data-map-zoom`・`data-map-pitch`・`data-drawn-tile-zoom`・`data-visible-overlay-layers`）で待ち、判定する。

1. 3D に切り替えると地形と hillshade が出て、2D の水深の canvas が隠れ、コンソールにエラーと警告が出ず、2D に戻せる。3D のチャンク（`View3d`）は 3D に切り替えてから読む
2. 3D の視点の画面の中心で、描かれる地形タイルのズームの実測が pitch つきの見込みより粗くない
3. 3D で範囲内をクリックするとセル情報が開く（`unproject`）
4. 3D で降雨を始めると水面が出て、2D の水深の canvas は隠れる。three は 3D に切り替えてから読む。2D に戻すと元に戻る
5. 3D で強い降雨をすると、範囲の中心付近の画素が水の配色に変わる（画素の比較ではなく、水の配色の画素があるかだけを見る）
6. ズームアウトして画面の中心のタイルが境界より粗くなると 2D に落ちて知らせ、近づくと 3D に戻る
7. 3D の表示中にベースマップを切り替えると、写真では hillshade が消えて水面が作り直され、淡色に戻すと hillshade も戻る
8. 3D の表示中に WebGL のコンテキストを失って戻すと、水面が作り直され、hillshade と 04 の重ね描きが戻り、エラーが出ない（MapLibre 6.6.0 が出す復帰の警告だけは件数の上限つきで許す）

外部（GSI）へのネットワーク依存を避けるため、E2E ではタイルリクエストを Playwright の `route()` で固定のフィクスチャに差し替える。DEM の取得は Worker 内で行われるため、`page.route()` ではなく `browserContext.route()` を使う。Worker から出るリクエストも差し替えられることを、E2E を作る最初に確かめる。

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

型情報を要するルール（`no-floating-promises` 等）は Biome では扱えない。これが実際に問題となった場合に typescript-eslint の追加を再検討する。現時点では `tsc -b` による型検査で大半が捕捉できると判断する。

## 12.2 ローカルの品質ゲート

pre-commit フックを **lefthook** で管理する。

| フック | 実行内容 |
|---|---|
| pre-commit | Biome（変更ファイルのみ、自動修正あり） |
| pre-push | `tsc -b`、`vitest run`（ユニットのみ） |

pre-commit で重い検査を行わない。型検査とテストは pre-push に置き、コミットの速度を保つ。

## 12.3 CI（GitHub Actions）

### ワークフロー構成

| ジョブ | 内容 |
|---|---|
| `quality` | `biome ci`、`tsc -b`（全 project reference）、`depcruise` |
| `test` | `vitest run --coverage`（閾値検査を含む） |
| `build` | `vite build` + バンドルサイズ検査（§14.2）。`dist/` に配信しないもの（`.vite`・`404.html` など）が無いことも検査する |
| `e2e` | `playwright test` |
| `audit` | `pnpm audit --audit-level=high`。PR では警告のみで、マージはブロックしない。週次のスケジュール実行でも走らせ、検出したものは Issue として起票する（§12.4、§13.9） |
| `deploy-preview`・`deploy-main`・`deploy-production` | PR で `pr-<番号>.raintrace.pages.dev`、`main` への push で `main.raintrace.pages.dev`、`v*` のタグの push で本番（§3.4）。`main` と本番は必須ジョブの成功が前提。上げた後に応答を検査する（`scripts/check-deployed-headers.mjs`） |

### 共通設定

```yaml
permissions:
  contents: read        # 既定を最小権限に。必要なジョブでのみ昇格

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}   # main とタグのデプロイは途中で止めない
```

- Node バージョンは `.nvmrc` から読み取り、ローカルと CI を一致させる
- pnpm は `package.json` の `packageManager` フィールドで固定し、`pnpm/action-setup` がそれを読む（§13.7）
- 依存インストールは `pnpm install --frozen-lockfile`
- **すべての GitHub Actions をコミット SHA でピン留めする**（§13.4）

## 12.4 マージ条件

`main` へのマージには以下すべての成功を必須とする。

- `quality`、`test`、`build`、`e2e`
- 特に §11.3 の質量保存テスト

`audit` は必須に含めない。PR の内容と無関係に公開された脆弱性情報で、すべての PR が止まるのを避けるためである。検出された場合は Issue として起票し、別途対応する。

---

# 13. 依存管理とサプライチェーン対策

## 13.1 前提: リリースクールダウン

本プロジェクトは、公開直後のパッケージバージョンを使用しない方針を採る。開発機には以下のグローバル設定が入っている（2026-09-10 に pnpm 12.2.1 で、値の読み込みと、期間未満のバージョンが拒否されることを確認した）。

```yaml
# ~/.config/pnpm/config.yaml（pnpm 11 以降が読む）
minimumReleaseAge: 14400          # 分単位 = 10日
minimumReleaseAgeStrict: true
```

旧来の `~/.config/pnpm/rc`（pnpm 10 が読む）にも同じ値を残してある。ただし strict の行は pnpm 10 では無視される。

- `minimumReleaseAge` は**分**単位で指定する（pnpm 10.16.0 で追加）。`14400` 分は 10 日である
- `minimumReleaseAgeStrict` を true にすると、要求されたバージョン範囲の中に期間を満たすバージョンが無い場合、期間未満のバージョンで妥協せず、解決を失敗させる。false の場合は期間未満のバージョンへフォールバックする。これは pnpm 11 以降の設定であり、pnpm 10 は認識しない（pnpm 10.32.1 の配布物にこの設定名が存在しないことを 2026-09-10 に確認した）
- pnpm 11 以降、`minimumReleaseAge` の既定値は 1 日である。本プロジェクトは 10 日を明示的に設定する
- pnpm 12 は、対話的に実行すると期間未満のバージョンの採用を承認できる（拒否時のメッセージがそう案内する）。**この承認は行わない。** 期間内に取り込む必要がある場合は §13.9 の手順による。CI は非対話なので、期間未満のバージョンはそのまま失敗する

## 13.2 決定: 設定をリポジトリの pnpm-workspace.yaml に置く

グローバル設定は開発機ごとのものであり、CI や他の環境には適用されない。ローカルと CI で依存解決が食い違うのを防ぐため、**同じ設定をリポジトリにコミットする**。

置き場所は `pnpm-workspace.yaml` とする。pnpm 11 以降は、`.npmrc` から認証とレジストリ以外の設定を読まず、`package.json` の `pnpm` フィールドも読まないためである。本プロジェクトは workspace を用いない（§4.3）が、`pnpm-workspace.yaml` は非 workspace 構成でも設定ファイルとして読まれる（pnpm 10 でも読まれることを実機で確認した）。

```yaml
# pnpm-workspace.yaml
minimumReleaseAge: 14400
minimumReleaseAgeStrict: true
```

`.npmrc` にはレジストリの指定だけを置く。

### 開発機のグローバル設定

pnpm 11 以降は、グローバル設定を `~/.config/pnpm/config.yaml` から読み、`~/.config/pnpm/rc` は読まない。移さずに pnpm を上げると、リポジトリの外ではクールダウンが黙って無効になる。開発機は 2026-09-10 に pnpm 12.2.1 へ上げ、同じ値を `config.yaml` に移した。

本リポジトリの中では `pnpm-workspace.yaml` の設定が効くため、グローバル設定の有無に左右されない。

## 13.3 パッケージマネージャは pnpm（決定）

リリースクールダウンの機能自体は pnpm 以外にもある（npm の `min-release-age`、yarn の `npmMinimalAgeGate`、bun の `minimumReleaseAge`）。pnpm を選ぶ理由は次の3点である。

- strict モードで、期間を満たすバージョンが無いときに期間未満のバージョンへ妥協しない
- 依存パッケージのビルドスクリプト（postinstall など）を既定で実行しない（pnpm 10.0.0 以降）
- 開発機の既存の設定と一致する

ビルドスクリプトの実行が必要な依存パッケージは、`pnpm-workspace.yaml` の `allowBuilds` に明示的に列挙する。これはインストール時の任意コード実行という最大の攻撃経路を既定で塞ぐものであり、本プロジェクトはこの既定を維持する。`allowBuilds` への追加は、ビルドが必要な理由を Pull Request の説明に書いたうえで行う。

pre-commit フックの lefthook（§12.2）は postinstall でフックを導入するパッケージだが、スクリプトの実行は許可しない（pnpm 12 は許可するかどうかが未決のパッケージがあると install を失敗させるので、`allowBuilds` に `false` で明記する）。代わりに本プロジェクト自身の `package.json` に `"prepare": "lefthook install"` を置く。ルートプロジェクト自身のライフサイクルスクリプトは実行されるためである。Biome はビルドスクリプトを持たない。wrangler の依存の esbuild と workerd（esbuild は vite も使う）も `false` で明記している（スクリプトを実行しなくても build と preview〈`wrangler pages dev`〉が動くことを、実装 spec 01 と D で確認した）。

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

**導入は後回しとする**（2026-09-10 裁定。§17）。導入するまでは、依存と GitHub Actions の SHA の更新を手で行い、どちらも公開から 10 日を過ぎた版を選ぶ。以下は導入するときの方針である。

依存の更新には **Renovate** を使う。選ぶ理由は以下である。

- `minimumReleaseAge` を持ち、§13.1 の方針と揃えられる
- `lockFileMaintenance` により、推移的依存の更新もクールダウン付きで定期的に回せる
- GitHub Actions の SHA ピン留め（§13.4）を、`helpers:pinGitHubActionDigests` で自動的に維持できる

Dependabot にもクールダウンの設定があるため、クールダウンの有無は選択の理由にしない。

```jsonc
{
  "extends": ["config:recommended", "helpers:pinGitHubActionDigests"],
  "minimumReleaseAge": "10 days",
  "lockFileMaintenance": { "enabled": true }
}
```

自動マージは行わない（Renovate の既定のまま）。すべての依存更新を人が確認する。

Renovate は GitHub App としてリポジトリへの書き込み権限を持つ。この点は、リポジトリの公開・非公開の判断（§17）と併せて確認する。

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
| pnpm | `package.json` の `packageManager` フィールド。pnpm 自身と CI の `pnpm/action-setup` がこれを読み、同じバージョンを使う。Corepack には依存しない（Node 25 以降は Corepack が同梱されない） |

初期バージョン: Node 24（LTS）、**pnpm 12 系**（クールダウン期間を過ぎた最新のパッチ）。pnpm 10 は 2 メジャー古く、設定の置き場所（§13.2）もビルド許可の設定名も異なるため採らない。

**pnpm 本体はクールダウンの対象外である。** corepack や CI の `pnpm/action-setup` は pnpm 本体を直接ダウンロードするため、`minimumReleaseAge` が効かない。`packageManager` のバージョンを手で上げる場合は、公開から 10 日以上経っていることを `pnpm view pnpm time` で確かめる。Renovate による更新は、§13.5 の `minimumReleaseAge` で守られる。

## 13.8 Lockfile

`pnpm-lock.yaml` を必ずコミットする。CI は `--frozen-lockfile` で実行し、lockfile と `package.json` の不整合を失敗として扱う。

## 13.9 セキュリティ修正の緊急取り込み

クールダウンのため、脆弱性の修正版は公開から 10 日間インストールできない。緊急に取り込む必要がある場合は、`pnpm-workspace.yaml` の `minimumReleaseAgeExclude` に該当パッケージを一時的に追加する。追加は Pull Request で行い、理由と対象の脆弱性情報を記載する。クールダウン期間を過ぎたら除外を削除する。

---

# 14. 性能目標

## 14.1 実行時性能

| 指標 | 目標 | 測定条件 |
|---|---|---|
| 1 step の所要時間（中央値） | < 8ms | DEM1A / 500m 四方 / 濡れたセルに絞った走査（実装 spec 03 §3.5 の外接矩形） / Chrome デスクトップ |
| 1 step の所要時間（p95） | < 16ms | 同上 |
| 地図操作時のフレームレート | 60fps 維持 | シミュレーション実行中を含む。判定は D15（平均 57 fps 以上、かつ長いフレーム〈そのランの中央値の 2.5 倍を超えた間隔〉1% 以下。実装 spec 05 §4.4、R05-6）で行い、2 フレーム分（33 ms）の間隔の本数もあわせて報告する（実装 spec 06 §5） |
| 地点クリックから 2D の地形表示まで | < 3秒 | キャッシュなし、一般的な回線 |
| 3D に切り替えてから最初の 3D のフレームまで | < 3秒 | 同上。three のチャンク（動的 import、gzip 126.5 KB）の取得を含む。3D は利用者が選んで入るものになったので、クリックからの時間と分けた（実装 spec 06 §5） |
| メインスレッドの最長ブロック時間 | < 50ms | 全操作を通じて |
| 平衡までの時間 | 幅 30 セル程度の池（半径 10m・100mm）は 60 秒以内、幅 100 セル規模の池（半径 100m・100mm）は 5 分以内 | 「最速」（R04-5）で測る。1x は step 数 ÷ 60 で報告するが、目標にしない。届かなければ fill-spill-merge 法の spec を起こす（2026-09-17 の裁定 R06-6。R06-3 の 1x の目標を改めた） |

05 の地形のタイルの生成はメインスレッド、hillshade の既定は auto（淡色・標準の地図で付け、写真の地図では付けない。hillshade は地形と別の raster-dem のソースで `tileSize: 512`。§5.5）。本番のタイルの経路の測り直し（実装 spec 05 の計画 Task 6、実 GPU・headless）で決めた。

05 の測り直しの要約（実 GPU・headless の Chrome、ANGLE / NVIDIA GTX 1080 Ti、rAF が 60Hz に刻まれるので 60.0 fps が上限、地理院に実接続、毎回新しい context。指標は実装 spec 05 §4.4 の D15 = 平均 57 fps 以上かつ長いフレーム 1% 以下）:

| 範囲・視点（括弧は実測） | 地形のみ | 水面あり |
|---|---:|---:|
| 500 m z17 ×5 p60（pitch 60.00・描かれるタイル 17） | 60.0 fps | 60.0 fps |
| 500 m z16 ×10 p85（pitch 78.60・タイル 16） | 60.0 fps | 60.0 fps |
| 1000 m z17 ×5 p60（pitch 60.00・タイル 17） | 60.0 fps | 60.0 fps |
| 1000 m z16 ×10 p85（pitch 78.60・タイル 16） | 59.6 fps | **51.0 fps（D15 を外す）** |

- 採った調整（Task 6・9）: タイルの生成は**メインスレッドのまま**（Worker は足さない）、hillshade の既定は **auto のまま**、地形を描く範囲を狭める試しは**不要**（地形のみは全条件で D15 を満たす）。「粗いズームを 2D にする」（(c)）は fps の不足には効かない（測った 2 視点の描かれるタイルは 16・17 で、境界 15 より細かい）
- 06 へ引き継ぐ条件: **1000 m ×10 p85 の水面ありだけ**が 51.0 fps で D15 を外す（長いフレームは 0 本で 1% の方は満たす）。タイルの組み立て（24 ラン全部を見ても最大 15.7 ms で、1 フレーム分の 16.7 ms を超えたタイルは 0 枚）と水面の render CPU（0.416 ms）は原因から外れており、水深テクスチャの転送（4.25 MB）と描画のどちらが主因かは未切り分け。地形のみの 1000 m ×10 p85 も 59.6 fps で、D15（57 fps）までの余裕は中央値で 2.6 fps、3 回の最遅（58.5 fps）では 1.5 fps しかない

1番目と2番目の未達が §6.3 の WASM 移行検討の条件となる。

計測は `performance.now()` による step 時間の記録を実装に組み込み、統計は**計測用のビルド（`pnpm build:perf`）でだけ**表示する。本番のビルドには計測のコードを入れない（2026-09-17 の裁定 R06-5。実装 spec 06 §3）。

## 14.2 バンドルサイズ

| 対象 | 上限 | 備考 |
|---|---|---|
| 初期ロード JS（gzip 後） | 500 KB | MapLibre と MUI を含む。2026-09-11 の裁定（RB-1）で 400 KB から引き上げた |
| 遅延ロードを含む総 JS（gzip 後） | 1.2 MB | Three.js、シミュレーションを含む |

以下を動的 import により初期ロードから除外する。

- Three.js および `src/renderer/`（3D に切り替えたときに必要になる）
- Worker（`src/workers/`・`src/simulation/`・`src/dem/`。地点のクリック時に DEM の取得で必要になる）

上限超過を CI の `build` ジョブで失敗として扱う。

2026-09-10 時点の各パッケージの gzip サイズから試算すると（MapLibre 約 154KB、React 約 47KB、MUI 60〜100KB、Emotion 約 20KB）、初期ロードは 280〜330KB になると見込んでいた。しかし実測では、MapLibre 6 本体（`maplibre-gl.mjs` と、それが import する `maplibre-gl-shared.mjs` を合わせたもの）だけで 246.6KB あり、試算の 154KB を大きく超えた。03 完了時点で初期ロードは 388.7KB に達し、400KB の上限に近づいたため、2026-09-11 の裁定（RB-1）で上限を 500KB に引き上げた（総量の上限 1.2MB は変更していない）。チャンクごとの予算は、実装 spec 01 の完了時の実測で次のとおり確定した（T6）。

03 完了時点、2026-09-11 の実測（gzip level 9、1KB = 1000 バイト）とチャンク別の予算:

| チャンク | 内容 | 実測 | 予算 |
|---|---|---:|---:|
| `map` | maplibre-gl | 246.6 KB | 260 KB |
| `ui` | react、react-dom、scheduler、@mui/*、@emotion/* とその依存 | 132.8 KB | 150 KB |
| `index` | アプリ本体と rolldown のランタイム 0.4 KB（別のチャンク） | 8.9 KB | 20 KB |
| 初期ロードの合計 | | 388.7 KB | 500 KB |
| `maplibre-gl-worker` | MapLibre の内部 Worker（地図の起動時に読まれるが、初期ロードの定義の外） | 131.8 KB | — |
| `simulation.worker` | シミュレーション用 Worker（地点のクリック時に読まれるが、初期ロードの定義の外） | 4.6 KB | — |
| 総量 | | 525.0 KB | 1.2 MB |

- 予算は「実測を 10KB 単位で切り上げ、10KB を足す」で決めた。3 つの合計は 430KB で、500KB の上限に対して 70KB の余裕があり、04 以降で足す UI に使える
- 地図系は、上の試算（MapLibre 約 154KB）を大きく超えた。MapLibre 6 の本体（`maplibre-gl.mjs`）に、それが import する `maplibre-gl-shared.mjs` を合わせたものの実測である（試算は shared を数え落としていた）。Worker 側のチャンクにも同じ shared が複製されている（約 130KB）。上流の配布の形なら 1 回で済むので、06 でバンドル全体を詰めるときの候補になる。04 以降でアプリ本体と UI 系が使える余裕は、上の予算のとおり約 70KB である。超える見込みになったら、パネルなどの UI の遅延ロードを先に検討し、それでも足りなければ上限を見直す（裁定 RB-1）
- チャンク別の予算は目安であり、CI が検査するのは初期ロードと総量の上限である
- `ui` のチャンクは、node_modules 全体ではなく、パッケージの一覧で捕まえる。05 で動的 import する Three.js などを初期ロードに吸い込まないためである。依存を足したら一覧を見直す

04 完了時点、2026-09-13 の実測（`pnpm build && pnpm size`。gzip level 9、1KB = 1000 バイト）:

| チャンク | 実測 | 予算 |
|---|---:|---:|
| `map` | 246.6 KB | 260 KB |
| `ui` | 160.0 KB | 150 KB（超過） |
| `index` | 18.2 KB（別に rolldown のランタイム 0.4 KB） | 20 KB |
| 初期ロードの合計 | 425.1 KB | 500 KB |
| `maplibre-gl-worker` | 131.8 KB | — |
| `simulation.worker` | 8.7 KB | — |
| 総量 | 565.5 KB | 1.2 MB |

- `ui` がチャンクの予算（150 KB）を 10 KB 超えた。実装 spec 04 で足した MUI の部品（`TextField`・`Slider`・`ToggleButtonGroup`・`Popover`・`Dialog`・`Snackbar` など）による。とくに `TextField` は、使わなくても `Select`・`Menu`・`Popover` の実装を静的に import する（本アプリのコードはこれらを使わず、列挙の選択は §9.3 のとおり `ToggleButtonGroup` にしている）。予算が詰まってきたら、パネルの遅延ロードと合わせて、`TextField` を `OutlinedInput`（または `InputBase`）と `FormControl` の組み合わせに置き換えることを検討する（裁定 RB-1 の順序）
- 範囲 1000 m の確認（2026-09-13、04 の最終レビューの推奨。渋谷駅付近、本番ビルド、実タイル、headless の Chrome 135・実 GPU）: グリッド 1031 × 1031（DEM1A、セル 0.97 m）で、水深の frame は 4.25 MB、水深のテクスチャは 1031 × 1031。「1000 m」を押してから地形が出るまで 0.8 秒（`?size=1000` を新しいプロファイルで直接開くと 1.6 秒）。読み込みの番犬（30 秒）は発火せず、進捗の最長の途切れは窪地の解析の 0.3 秒。既定の雨は「最速」で Step 49,332・46 秒で平衡し、実行速度は中央値 985 step／秒、再生中の 50 ms を超えるタスクは 0 件。**ただし読み込みの終わりに 123 ms のタスクが 1 回ある**（§14.1 の 50 ms を超える。250・500 m では 0 件）。CPU プロファイルでは主に、メインスレッドでの標高の色分け（`elevationRgba`、75 ms）。対応は別に決める
- 05 の見込み（スパイク S の実測、2026-09-13）: three のチャンクは gzip で 126.5 KB。水面のチャンクとして動的 import するので（§5.5）、初期ロードの 425.1 KB は変わらない。総量は約 692.0 KB（04 の 565.5 KB + three の 126.5 KB）で、上限 1.2 MB に収まる

05 完了時点、2026-09-16 の実測（`pnpm build && pnpm size`。gzip level 9、1KB = 1000 バイト）:

| チャンク | 実測 | 予算 |
|---|---:|---:|
| `map` | 246.6 KB | 260 KB |
| `ui` | 160.0 KB | 150 KB（超過。04 からの持ち越し） |
| `index` | 20.5 KB（別に rolldown のランタイム 0.4 KB） | 20 KB（超過） |
| 初期ロードの合計 | 427.5 KB | 500 KB |
| `maplibre-gl-worker` | 131.8 KB | — |
| `three` | 126.5 KB | — |
| `simulation.worker` | 8.7 KB | — |
| `View3d`（3D の地形・視点・(c) の切り替え） | 5.8 KB | — |
| `waterLayer`（three の水面の Custom Layer） | 2.1 KB | — |
| 総量 | 702.2 KB | 1.2 MB |

- 見込み（約 692.0 KB）に対して **+約 10 KB**。`three` は見込みどおり 126.5 KB で、**初期ロードには入っていない**（3D に切り替えたときに動的 import で読む。§5.5、R05-5。dependency-cruiser の規則とチャンクの検査で機械的に守る）
- 初期ロードは 04 の 425.1 KB から **+2.4 KB**（`index` が 18.2 → 20.5 KB。3D への切り替え、(c) の知らせ、矢印の間隔の換算などのぶん）。上限 500 KB に対して 72.5 KB の余裕がある
- `@types/three` が引き込む推移的な依存（fflate・meshoptimizer など）は、1 つもバンドルに入っていない（開発時のみ）
- 3D のチャンク（`View3d` 5.8 KB・`waterLayer` 2.1 KB）と `three` は、3D に切り替えたときだけ読まれる

## 14.3 メモリ

500m 四方 / DEM1A（250,000 セル）における主要な配列:

```
Worker:
  elevation      Float32Array(250,000)  = 1.0  MB
  validMask      Uint8Array(250,000)    = 0.25 MB
  water          Float64Array(250,000)  = 2.0  MB
  activeCells    Int32Array(250,000)    = 1.0  MB
Worker ⇄ メイン:
  転送用 × 2     Float32Array(250,000)  = 2.0  MB
メインスレッド:
  elevation と validMask のコピー       = 1.25 MB
─────────────────────────────────────────────────
                                          約 7.5 MB
```

1000m 四方（1,000,000 セル）を選択した場合でも約 30MB であり、実用範囲に収まる。

---

# 15. ブラウザ対応

## 15.1 対応ブラウザ

base-spec §58 に従い、以下の最新版を対象とする。

| ブラウザ | 備考 |
|---|---|
| Chrome / Edge | 主要開発対象 |
| Firefox | |
| Safari | `OffscreenCanvas` の挙動差に注意。DEM の復号の E2E を WebKit でも回す（実装 spec 01 R01-4） |

## 15.2 必須要件と任意要件

| 機能 | 区分 | 非対応時の挙動 |
|---|---|---|
| WebGL 2 | **必須** | 起動時に検出し、非対応である旨を表示 |
| Web Worker | **必須** | 同上 |
| `OffscreenCanvas`（Worker 内の 2D コンテキスト） | **必須** | 起動時に検出し、非対応である旨を表示 |
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

すべての依存パッケージのライセンスを CI で `pnpm licenses list` により列挙し（依存を増やさないよう pnpm の組み込み機能を使う）、GPL 系など本プロジェクトの配布形態と両立しないライセンスが混入していないことを確認する。

## 16.3 本プロジェクトのライセンス

**MIT ライセンス**とし、リポジトリは公開する（2026-09-10 裁定。実装 spec 01 R01-1）。

---

# 17. 未決事項

以下は本書の時点で決定していない。実装開始前、または該当フェーズ到達時に決定する。

| 項目 | 決定時期 | 備考 |
|---|---|---|
| Renovate の導入時期 | 未定 | 実装 spec 01 では導入しない（R01-2）。導入までは、依存と GitHub Actions の SHA の更新を手で行う |
| アクセス解析の導入可否 | Phase 1 完了後 | 導入する場合は Cloudflare Web Analytics を候補とする。base-spec §52 のプライバシー方針（位置情報をサーバへ保存しない）と両立することが条件 |
| エラー監視の導入可否 | Phase 3 以降 | 導入する場合、位置情報を送信しない設定を必須とする |
| 許容誤差の具体値 | Phase 2〜3 | §6.6 の初期値を実測で調整する（base-spec §49） |
| IndexedDB キャッシュの導入 | Phase 5 | §8.4 の条件を満たした場合のみ |
| Rust WASM の導入 | Phase 5 | §6.3 の移行基準を満たした場合のみ |
| 水深表示の配色（カラーマップ） | Phase 3 | 色覚特性に配慮した配色を選定する（§9.5） |

---

# 18. 決定事項の要約

実装時に参照すべき決定を再掲する。

1. **Vite + React SPA を Cloudflare Pages（Direct Upload）で配信**する。バックエンドは持たない（§3、§7.1）
2. **単一 package.json 構成**とし、レイヤー境界は dependency-cruiser で CI 強制する（§4）
3. **250,000 セルの TypedArray を React に載せない**。Worker / Renderer / React の三層に分離する（§5.1）
4. **Worker との受け渡しは Transferable ダブルバッファ**。SharedArrayBuffer は使わない（§5.2、§7.3）
5. **MapLibre と Three.js は React の外で命令的に扱う**。react-map-gl / react-three-fiber を使わない（§1.1、§5.3）
6. **シミュレーションは初期 TypeScript 実装**。§6.3 の実測基準を割った場合にのみ Rust WASM を追加し、TypeScript 実装はリファレンスとして残す（§6）
7. **UI は MUI**。文字列は 1 モジュールに集約する（§9）
8. **`noUncheckedIndexedAccess` は `src/simulation/` のみ無効**。純粋な領域（simulation・dem）は DOM と WebWorker のどちらの lib も持たない（§10.2、§10.3）
9. **質量保存を property-based テストで検証**し、CI の必須ゲートとする（§11.3）
10. **pnpm 12 系を必須**とし、リリースクールダウン 10 日を `pnpm-workspace.yaml` でリポジトリにコミットする。GitHub Actions は SHA でピン留めする（§13）
11. **内部の水深は Float64 の連続値で計算する**。水面標高の数値誤差は 1cm 以内を目標とする。水深の色分けは 5cm 刻み、数値は 0.01m で表示する（§6.6）
12. **Worker と TypedArray は Phase 1 から採用し、濡れたセルに絞った走査（base-spec の Active Cells）は Phase 3 で入れる**（§6.7）
13. **地形の描画方式は方式 A**（MapLibre の 3D terrain ＋ 水面の Custom Layer）。水面は Three.js で描き、動的 import で初期ロードの外に置く（§5.5。スパイク S の結論、2026-09-13 の裁定）

---

# 19. base-spec との対応

本書が base-spec の記述を確定・変更している箇所の一覧。

| base-spec | 本書 | 内容 |
|---|---|---|
| §4、§41 DEM10B | §7.4 | PNG タイルのパスは `dem_png`（`dem10b_png` は存在しない） |
| §9 500 × 500 cells | §7.6 | セルの大きさは緯度で変わる。DEM1A・東京付近で 512 × 512 |
| §24 メインスレッドで DEM を取得 | §5.4 | Worker 内で取得・デコードする |
| §31 水深の表示区分 | §6.6 | 5cm 刻みの色分けに置き換える（base-spec §6.3 と揃える） |
| §43 モジュール構成 | §4.1 | `dem/` を純粋化し、`shared/`・`bridge/` を追加 |
| §44〜§46 API | §6.2 | `SimulationEngine` として型を確定 |
| §49 epsilon | §6.6 | 用途別に3種類の許容誤差を定義 |
| §51 ホスティング候補 | §3 | Cloudflare Pages（Direct Upload。01〜05 は Workers の Static Assets、実装 spec D で移行） |
| §55 Phase 5 の Worker・TypedArray・Active Cells | §6.7 | Worker・TypedArray は Phase 1、Active Cells は Phase 3 |
| §60 技術スタック候補 | §1 | React・MUI・Zustand などを追加して確定 |
| §55 Phase 1 の「3D terrain」 | 実装 spec 02・S・05 | Phase 1 は 2D 表示までとし、3D はスパイク S と実装 spec 05 に移す |
| §55 Phase 2 の「水の平衡計算」 | 実装 spec 03 | 別のアルゴリズムを持たず、動的モデルを収束まで回して得る |
| §55 Phase 4 の「降雨時間」 | 実装 spec 04 | PoC では瞬時の投入のみとし、降雨時間は後回しにする |
| §16 の threshold | 実装 spec 03 | 流れの閾値を 1e-5 m と定める（§6.6） |

---

# 20. 実装 spec へ引き継ぐ事項

base-spec の曖昧さ・矛盾のうち、技術選定ではなく機能やモデルの設計として決めるべきもの。個別の実装 spec で決定する。右端の欄は技術仕様のレビューで出た案で、決定ではない。

| # | 事項 | 内容 | 技術仕様のレビューで出た案（決定ではない） |
|---|---|---|---|
| 1 | 地図クリックの意味 | base-spec §36（クリックで降雨地点を指定）と §39（クリックでセル情報を表示）が同じ操作で衝突している。E2E（§11.4）にも影響する | 地点が未選択ならクリックで降雨中心を設定する。選択後のクリックはセル情報を開き、その中に「ここを降雨中心にする」ボタンを置く。マーカーはドラッグで動かせる。これなら base-spec §58 の 3 操作も保てる |
| 2 | Phase 1 の範囲 | base-spec §55 の Phase 1 は 3D terrain を含むが、§56 は最初に確認すべきは 3D 描画ではないとしている | Phase 1 を「DEM グリッドと 2D 表示（標高の色分け、最低点、流向）」とし、3D はスパイク S（§5.5。結論は方式 A）として並行させ、Phase 1 の完了条件から外す |
| 3 | 流れのモデルの詳細 | 境界条件、base-spec §16 の threshold、1 step あたりの移動量の上限、D8 の対角距離の扱い。更新方式は、差分テスト（§11.6）が成り立つよう、処理順に結果が依存しない決定的な方式とする | 全セルを読んで別バッファに書く Jacobi 方式（2 バッファ）。1 step の総流出量を水面差の半分までに制限して振動を防ぐ。対角の重みは 1/√2 などに固定する。threshold は 1mm 程度。領域端の外側に、標高が端のセルと同じで水深 0 の仮想セルを置き、そこへの流出を領域外流出とする。Phase 2 の「平衡計算」を別アルゴリズム（Priority-Flood など）として持つか、動的モデルを収束まで回すことで済ませるかも決める |
| 4 | DEM のカバレッジの混在 | 範囲内で DEM1A のタイルが一部だけ存在しない場合の扱い | 1 枚でも 404 なら範囲全体を次の DEM に落とし、解像度の混在を作らない。ただし沿岸では海域の DEM1A タイルも 404 になるため、この規則だけでは海に面した地域の多くが DEM5 に落ちる。区別の案: 404 になったタイルの位置を、全国分がある `dem_png`（z14）で調べる。対応する画素がすべて無効値なら海域として無効セル扱いにし（フォールバックしない）、有効な標高があれば未整備の陸域として範囲全体を次の DEM に落とす |
| 5 | 粗い DEM での降雨量 | DEM10B（約 8m のセル）では半径 10m の円が数セルしか覆わず、πr² × 雨量と実際の投入量がずれる | 半径内に中心があるセルの集合 S（最低 1 セル）に、1 セルあたり (πr² × 雨量) ÷ \|S\| を入れる。総量は解像度によらず理論値と一致し、雨の足跡の形だけが近似になる（決定は実装 spec 03 §3.6（R03-4）。円が範囲の端・無効セルで切れる場合は、2026-09-11 の R04-8 で、投入量を円内の有効セルの割合に減らすよう改めた） |
| 6 | 3 操作の目標と免責表示 | base-spec §58 の「3 操作以内」を、初回の免責ダイアログ（§9.6）を除いて数えるか | 「初回の免責の了解を除く」と明記する。または免責をパネル内の常時表示とし、初回の Start 時の確認を 3 操作目に含める |
| 7 | 越流イベント | base-spec §21 の越流イベント（窪地の水位が spill point に達した）を、どう検出して `StepStats` に載せるか | |
