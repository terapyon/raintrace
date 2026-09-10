# Spec 01: 基盤（walking skeleton）

- Status: 確定（2026-09-10 裁定。同日、01 の実装で確かめた事実に合わせて §4.1・§4.5・§4.7・§4.8・§4.11 を改訂。裁定の内容は変えていない）
- 日付: 2026-09-10
- 対応: base-spec §55 Phase 1 の前提、§57 #1
- 依存: なし
- 後続: 02、03、S

---

## 1. 目的

tech-spec で決めた技術基盤を、実際に動く最小のアプリとして組み上げる。国土地理院の地図を表示するだけの画面を、すべての品質ゲートを通したうえで Cloudflare から配信する。

この spec の価値は機能ではなく、**tech-spec の決定が実際に成り立つことを最初に確かめる**点にある。確かめる対象は次のとおり。

- pnpm 12 とリリースクールダウン（`pnpm-workspace.yaml`）、`allowBuilds`（tech-spec §13）
- tsconfig の分割と `tsc -b` による隔離（§10.3）
- dependency-cruiser のレイヤー規則（§4.2）
- Biome、lefthook（§12）
- Vitest、Playwright（§11）
- SHA でピン留めした GitHub Actions、Cloudflare Workers へのデプロイ（§3、§12.3、§13.4）
- バンドル予算の実測（§14.2 のチャンク別予算を確定する）
- Worker の起動と、メインスレッドとの型付き通信（§5）

## 2. スコープ

### 含む

- リポジトリの雛形（tech-spec §4.1 のうち、この spec で実体を持つもの）
- 地図の表示: MapLibre、地理院タイルの淡色地図、出典表示（tech-spec §16.1）
- MUI のテーマ（light・dark、システム設定に追従）と、地図を全画面に置くレイアウト
- WebGL 2 の非対応の検出と、その旨の表示（tech-spec §7.5）
- 最小の Worker（ping を送ると pong を返す）と `SimulationClient`（R01-6）
- 各層に最小の実モジュールを1つずつ置く（composite プロジェクトは入力ファイルが無いとエラーになるため）
  - `src/simulation/constants.ts`: tech-spec §6.6 の許容誤差
  - `src/dem/tileMath.ts`: 緯度経度とタイル座標の変換、地上解像度（02 が使う）
  - `src/shared/protocol.ts`: メッセージ型の骨組み
- 品質ゲート: Biome、`tsc -b`、dependency-cruiser、Vitest（カバレッジ閾値つき）、Playwright、audit、ライセンス検査、バンドル予算
- CI/CD: GitHub Actions、Cloudflare Workers への本番・プレビューのデプロイ
- CSP（R01-7）

### 含まない

- 地点選択と DEM の取得（02）、エンジン（03）、設定の保存・免責表示・ベースマップの切り替え（04）、3D（S・05）
- Renovate（R01-2 で後回しと裁定。導入までは、依存と GitHub Actions の SHA の更新を手で行う）
- Zustand（02 で最初に必要になった時点で追加する）、fast-check（03）、Three.js（S・05）、jsdom と Testing Library（04）。tech-spec §2 の原則3（依存を増やさない）に従い、使う spec で入れる

## 3. 成果物の構成

```
raintrace/
  .github/workflows/ci.yml
  public/_headers                  CSP などのレスポンスヘッダ（§4.8）
  src/
    simulation/constants.ts
    dem/tileMath.ts
    dem/tileMath.test.ts
    shared/protocol.ts
    workers/simulation.worker.ts   ping に pong を返すだけ（02 以降で拡張）
    bridge/SimulationClient.ts     Worker の起動と ping の往復
    map/MapController.ts           MapLibre の生成と破棄
    map/gsiStyle.ts                地理院タイルのスタイル定義
    ui/App.tsx
    ui/theme.ts
    ui/strings.ts
    ui/components/MapView.tsx
    ui/components/WebGLUnsupported.tsx
    main.tsx
  tests/e2e/smoke.spec.ts
  tests/e2e/fixtures/              地図タイルの代わりに返す画像（自作の単色 PNG）
  scripts/check-bundle-size.mjs
  scripts/check-licenses.mjs
  .npmrc  pnpm-workspace.yaml  .nvmrc  .dependency-cruiser.mjs  biome.json  lefthook.yml
  tsconfig.json  tsconfig.sim.json  tsconfig.core.json  tsconfig.worker.json
  tsconfig.app.json  tsconfig.node.json  tsconfig.test.json
  vite.config.ts  vitest.config.ts  playwright.config.ts  wrangler.jsonc
  index.html  LICENSE  README.md
```

tech-spec §3.1 の `worker/`（Cloudflare Worker のスクリプト置き場）は、中身ができるまで作らない。

## 4. 設計

### 4.1 パッケージと設定

- `package.json`
  - `packageManager`: `pnpm@12.x.y`（公開から 10 日を過ぎた最新のパッチ。tech-spec §13.7）
  - `engines.node`: `>=24 <25`
  - scripts: `dev`、`build`（`tsc -b && vite build`）、`preview`、`test`、`test:e2e`、`lint`（`biome ci`）、`typecheck`（`tsc -b`）、`depcheck`（`depcruise src`）、`size`、`licenses`、`prepare`（`lefthook install`）、`deploy:production`（`pnpm deploy` と `pnpm licenses` は pnpm の組み込みのコマンドと同名なので、前者は名前を変え、後者は `pnpm run licenses` で呼ぶ）
- `pnpm-workspace.yaml`: `minimumReleaseAge: 14400`、`minimumReleaseAgeStrict: true`、`allowBuilds`
  - `allowBuilds` は空から始める。`pnpm install` がビルドスクリプトの許可を求めたパッケージだけを、理由を PR に書いたうえで追加する。Vite・wrangler の依存（esbuild、workerd など）が候補になりうるが、実際に必要かはインストール時に判断する
- `.npmrc`: `registry=https://registry.npmjs.org/` のみ
- `.nvmrc`: `24`

### 4.2 地図

- `MapController` が MapLibre を生成・破棄する。React 側は、依存配列を空にした `useEffect` の中で生成し、Context で子に配る（tech-spec §5.3）
- スタイル: 地理院タイルの淡色地図（`https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png`、256px、最大ズーム 18）を raster ソースとして使う
- 出典: MapLibre のアトリビューションに「地図・標高データ：国土地理院」を、地理院のページへのリンクつきで常時表示する（tech-spec §16.1）
- 初期表示: R01-5

### 4.3 アプリの骨格

- `main.tsx`: `canvas.getContext('webgl2')` で WebGL 2 を、`typeof OffscreenCanvas` で OffscreenCanvas を確かめ（R02-5 で必須）、どちらかが非対応なら `WebGLUnsupported`（非対応ブラウザの案内）を表示して終わる。確かめに使ったコンテキストは `WEBGL_lose_context` の `loseContext()` で解放する（ブラウザごとのコンテキスト数の上限を消費しないため）
- `App`: MUI の `createTheme({ colorSchemes: { light: true, dark: true }, cssVariables: true })`、`CssBaseline`、全画面の `MapView`
- フォントは外部から読まず、システムフォントを使う（テーマの `typography.fontFamily` にシステムフォントの並びを指定する）。MUI の既定の Roboto を Google Fonts から読むと、CSP に外部のオリジンが増え、利用者のアクセスが外部に伝わる（base-spec §52）
- `strings.ts`: 画面に出す文字列はすべてここに置く（tech-spec §9.4）

### 4.4 Worker の骨組み（R01-6）

- `SimulationClient` が `new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' })` で Worker を起動する
- `protocol.ts` はメッセージを判別可能な union 型で定義する。01 では `{ type: 'ping'; id: number }` と `{ type: 'pong'; id: number }` のみ
- 起動時に ping を送り、5 秒以内に pong が返れば、ルート要素に `data-worker-ready="true"` を付ける。E2E はこの属性で Worker の起動を確かめる
- 目的は機能ではなく、Vite による Worker のバンドル、`tsconfig.worker.json`、dependency-cruiser の Worker 関連の規則を、中身が薄いうちに通しておくことにある

### 4.5 型検査と依存規則

- tsconfig は tech-spec §10.3 の表のとおりに分ける。sim と core は `composite: true`・`emitDeclarationOnly: true`・`outDir: node_modules/.tmp/tsc/<名前>`、worker と app は `noEmit` で sim・core を references で参照する。ルートは `files: []` で全プロジェクトを参照する
- テストファイル（`*.test.ts`）は sim・core・worker・app の各プロジェクトの対象から外し、`tsconfig.test.json`（lib は `ES2023` と `DOM`、types に `node` と `vitest`、sim と core を references で参照）でまとめて型検査する。composite プロジェクトの型宣言にテストが混ざらず、vitest の型が lib `ES2023` だけの環境で通らない問題も避けられる（T10）
- `src/simulation/`・`src/dem/`・`src/shared/` の相対 import には `.ts` の拡張子を付ける。Node で直接実行できるようにするためである（03 §5）。これらのプロジェクトに `allowImportingTsExtensions: true` を置き、Biome の `useImportExtensions` をこの3ディレクトリで有効にする（T11）
- `.dependency-cruiser.mjs` に tech-spec §4.2 の規則をすべて入れる（`core-is-pure`、`types-only-from-core`、`no-react-outside-ui`、`workers-not-imported`、`workers-isolated`、`no-circular`、`no-orphans`、`not-reachable-from-entry`）。orphan は「依存も被依存も無い」モジュールだけなので、エントリとテストから到達できないモジュールを禁止する規則を足した。`options.tsPreCompilationDeps: "specify"` を指定する。`no-orphans` の除外には `*.test.ts` と `*.spec.ts` を入れる
- **一度だけ行う検証**（結果を PR に記録する。恒久的なテストにはしない）
  1. `src/simulation/` に `arr[0] + 1` を書いても `tsc -b` が通り、同じ式を `src/ui/` に書くと失敗する
  2. `src/simulation/` から `react` を import すると、dependency-cruiser と `tsc -b` が失敗する
  3. `src/dem/` で `document` を参照すると、`tsc -b` が失敗する
  4. `.ts` の拡張子を付けた相対 import が、sim・core の型宣言の出力と、それを参照する側の解決の両方で通る

### 4.6 テスト

- Vitest は `node` 環境のみ。カバレッジは `@vitest/coverage-v8` で、閾値は tech-spec §11.5 のとおり（01 で対象になるのは `src/dem/` の 85%）
- `tileMath` のテスト: 緯度経度とグローバルピクセル座標の往復、北緯 35° の z17 での地上解像度が約 0.978m（誤差 0.001m 以内）、範囲にかかるタイルの列挙
- Playwright は Chromium で全件を回し、`@webkit` タグを付けたテスト（02 の DEM 復号の確認）だけを WebKit でも回す（R01-4）。`vite preview` で本番ビルドを配信してテストする。地理院への通信は `browserContext.route()` で自作の単色 PNG に差し替える
- E2E:
  1. 地図の canvas が表示される
  2. 地図タイルのリクエストが 1 件以上、差し替えた画像で応答される
  3. 出典の文字列が表示される
  4. ルート要素に `data-worker-ready="true"` が付く
  5. 初期化スクリプトで `getContext('webgl2')` が `null` を返すようにすると、非対応の画面が出る
  6. 応答ヘッダに CSP が含まれ、ページの読み込み中に CSP 違反（`securitypolicyviolation` イベント）が 1 件も起きない（§4.8）

### 4.7 CI/CD

`ci.yml` を `pull_request`、`main` への `push`、`v*` のタグの `push`、週 1 回の `schedule` で動かす。

| ジョブ | 内容 | 必須 |
|---|---|---|
| `quality` | `biome ci`、`tsc -b`、`depcruise src` | ○ |
| `test` | `vitest run --coverage` | ○ |
| `build` | `vite build`、バンドル予算の検査、ライセンス検査 | ○ |
| `e2e` | `playwright install --with-deps chromium webkit`、`playwright test`（WebKit は `@webkit` タグのテストのみ） | ○ |
| `audit` | `pnpm audit --audit-level=high`。PR では警告のみ。`schedule` で検出したら Issue を起票（このジョブだけ `issues: write` に昇格する） | × |
| `deploy-preview` | PR のとき。`CLOUDFLARE_ENV=staging` でビルドし、ステージング用の Worker に `wrangler versions upload --preview-alias pr-<番号>` で PR ごとのプレビュー URL を発行し、ジョブのサマリに出す（本番の Worker には触れない） | × |
| `deploy-staging` | `main` への push のとき。上の必須ジョブの成功が前提。`CLOUDFLARE_ENV=staging` でビルドし、ステージング用の Worker（`raintrace-staging`）へ `wrangler deploy`（`@cloudflare/vite-plugin` は環境をビルド時に決めるので、`--env` は使わない） | — |
| `deploy-production` | `v*` のタグの push のとき（タグ付きリリース）。そのコミットで必須ジョブを回し直し、成功したら本番の Worker（`raintrace`）へ `wrangler deploy` | — |

- 共通: `permissions: contents: read`、`concurrency` で古い実行を取り消す、すべての Action を SHA でピン留め（tech-spec §13.4）
- セットアップ: `actions/checkout` → `pnpm/action-setup`（`packageManager` を読む）→ `actions/setup-node`（`node-version-file: .nvmrc`、`cache: pnpm`）→ `pnpm install --frozen-lockfile`
- デプロイは第三者の Action を使わず、`pnpm exec wrangler` を直接呼ぶ（ピン留めする Action を増やさないため）。Secrets は `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID`。ステージングのジョブには `staging`、本番のジョブには `production` の GitHub environment を付ける

### 4.8 CSP とレスポンスヘッダ（R01-7）

`public/_headers` で、Cloudflare の Static Assets に次のヘッダを付ける。

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp;
  connect-src 'self' https://cyberjapandata.gsi.go.jp;
  worker-src 'self';
  object-src 'none';
  form-action 'self';
  frame-ancestors 'none';
  base-uri 'self'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

- `style-src 'unsafe-inline'` は、Emotion が実行時にスタイルを挿入するために必要である
- MapLibre の内部の Worker は、`setWorkerUrl()` で同一オリジンのファイルを渡して起動する（MapLibre 6 は、Worker の URL がクロスオリジンのときだけ blob URL を使う）。そのため `worker-src` に `blob:` は要らない。E2E で違反が 0 件であることを確かめた
- MapLibre などが上記以外を必要とした場合は、E2E の 6（CSP 違反の検出）で気づける。追加する場合は理由を PR に書く
- 将来 Rust WASM を入れる場合（tech-spec §6.4）は、`script-src` に `'wasm-unsafe-eval'` が必要になる
- **`_headers` は Cloudflare 側の仕組みなので、E2E の配信元である `vite preview` で適用されるとは限らない。** 01 で、preview の応答に CSP が付くかを確かめる（E2E の 6）。付かない場合は、CSP の定義を1か所（例: `csp.config.ts`）に置き、そこから `_headers` と `vite.config.ts` の `preview.headers` の両方を生成して、二重管理を避ける。01 の実装で、`@cloudflare/vite-plugin` を使うと preview の応答に CSP が付くことを確かめたので、この仕組みは作っていない

### 4.9 バンドル予算

- `vite build` の `build.manifest: true` で生成されるマニフェストから、初期ロードのチャンク（エントリとその静的 import）と、遅延ロードのチャンクを分ける
- `scripts/check-bundle-size.mjs`（依存なし。`node:fs` と `node:zlib` のみ）が gzip 後のサイズを集計し、初期ロード 400KB・総量 1.2MB（tech-spec §14.2）を超えたら失敗させる。チャンクごとの表も出力する
- `manualChunks` で「地図系（maplibre-gl）」「UI 系（react、react-dom、@mui、@emotion）」「アプリ本体」に分ける
- チャンクの間で同じモジュールが重複して含まれていないかも報告する（05 で加わる Three.js などの遅延チャンクとの重複に気づくため）
- 01 の実測値をもとに、チャンク別の予算を tech-spec §14.2 に書き込む（T6）

### 4.10 ライセンス検査

`scripts/check-licenses.mjs` が `pnpm licenses list --json --prod` の結果を読み、GPL・AGPL・LGPL の系統が含まれていたら失敗させる。判定できないライセンスは警告に留める。基準は R01-1 の裁定に合わせて調整する。

### 4.11 Cloudflare

- `wrangler.jsonc`: `name: "raintrace"`、`compatibility_date`（固定した wrangler の workerd が対応する最新の日付。実装した日の 2026-09-10 は workerd が受け付けなかった）、`assets: { not_found_handling: "single-page-application" }`（`directory` は `@cloudflare/vite-plugin` が決める）。ビルドの情報（`dist/.vite/`）は `public/.assetsignore` で配信から外す。ステージング用に `env.staging`（Worker 名 `raintrace-staging`）を定義する（R01-3）
- Worker のスクリプトは持たない（静的配信のみ）
- `@cloudflare/vite-plugin` は tech-spec §3.1 のとおり導入する（R01-8 で承認）。preview に `_headers` の CSP が効かない場合は、§4.8 のとおり1か所の定義から `preview.headers` も生成する

### 4.12 Renovate（R01-2: 後回し）

01 では導入しない。導入するまでは、依存の更新と GitHub Actions の SHA の更新を手で行い、どちらも公開から 10 日を過ぎた版を選ぶ（tech-spec §13）。導入の時期は tech-spec §17 で管理する。

## 5. ユーザーの手作業

実装役の権限では行えない、または行うべきでない作業。01 の実装中に案内する。

1. Cloudflare の API トークンを作る（Workers のデプロイ権限のみ）
2. GitHub の Secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録する
3. GitHub の `staging` と `production` の environment を作る
4. `main` のブランチ保護で、必須チェック（`quality`・`test`・`build`・`e2e`）を設定する
5. 本番へのリリースは、`v*` のタグ（例: `v0.1.0`）を push して行う（R01-3）

## 6. エラー処理

| 事象 | 挙動 |
|---|---|
| WebGL 2 に非対応 | 非対応である旨の画面を出し、地図を生成しない |
| Worker が 5 秒以内に応答しない | コンソールにエラーを出し、`data-worker-ready="false"` を付ける。01 では画面の機能に影響しない |
| 地図タイルの読み込み失敗 | MapLibre の既定の挙動（そのタイルが空白になる） |

## 7. 完了条件

1. PR で CI の必須ジョブがすべて成功し、プレビュー URL で地図が表示される
2. `main` へのマージでステージングの URL に、`v*` のタグの push で本番の URL に配信される
3. §4.5 の一度だけ行う検証の 3 点を、PR に記録している
4. リポジトリ内で `pnpm config get minimumReleaseAge` が `14400` を返す（リポジトリの設定が効いている）
5. `allowBuilds` に加えたパッケージとその理由を、PR に記録している
6. バンドルの実測値とチャンク別の予算を、tech-spec §14.2 に反映している
7. Firefox と Safari で、プレビュー URL の地図が表示されることを手動で確認している（R01-4）
8. プレビューと本番の両方で、応答ヘッダに CSP が付いている

## 8. 裁定が必要な論点

> 裁定（2026-09-10）: R01-1 は公開・MIT で承認。R01-2 は後回し（01 では Renovate を入れない）。R01-3 は変更（PR ごとにプレビュー、`main` への push でステージング、タグ付きリリースで本番）。R01-8 は導入で承認。その他は推奨どおり承認。本文は裁定を反映済み。

| ID | 論点 | 推奨 | 理由 |
|---|---|---|---|
| R01-1 | ライセンスとリポジトリの公開・非公開 | 公開、MIT | tech-spec §17 で「実装開始前に決める」とした事項。公開すれば GitHub Actions と Renovate を無料で使え、Secrets は Actions の仕組みで守られる。依存ライブラリの多くと相性がよい。tech-spec §16.3・§17 に反映する（T7） |
| R01-2 | Renovate を 01 で導入するか | 導入する | 最初から lockfile の保守とクールダウンつきの更新を回せる。GitHub App に書き込み権限を渡すため、R01-1 と併せて判断する |
| R01-3 | デプロイ先と方式 | `raintrace.<アカウント>.workers.dev`。`main` への push で本番、PR ごとにプレビュー | 独自ドメインは PoC には不要。後から追加できる |
| R01-4 | CI の E2E のブラウザ | Chromium で全件。WebKit では 02 の DEM 復号の確認（`@webkit` タグ）だけを回す | base-spec §58 は4ブラウザを対象とするが、全ブラウザで毎回回すと CI が遅く不安定になる。一方、R02-5 で OffscreenCanvas を必須にするので、最大のリスクは WebKit にある。その部分だけを CI で押さえ、全体は各 spec の完了時に Firefox と Safari で手動確認する |
| R01-5 | 地図の初期表示 | 日本全体（北緯 36.0°・東経 138.0°、ズーム 5） | URL に位置が無いときの既定。国内のどこでも使うアプリなので、特定の地域に寄せない |
| R01-6 | 最小の Worker（ping）を含めるか | 含める | Worker のバンドル、tsconfig の分割、依存規則を、中身の薄いうちに通しておける。02 で本物に置き換える |
| R01-7 | CSP を 01 で入れるか | 入れる。フォントは外部から読まず、システムフォントにする | 外部タイルを読むだけの静的サイトなので、許可するオリジンが少なく書きやすい。後から入れると、何が壊れるかの切り分けが難しくなる。tech-spec に方針の節を新設する（T8） |
| R01-8 | `@cloudflare/vite-plugin` を入れるか | 01 で、`vite preview` に `_headers` の CSP が効くかを確かめて決める。効くなら入れ、効かなければ Worker のスクリプトができるまで入れない | レビュー役の提案。Worker のスクリプトを持たない間、プラグインの役割は dev と preview を workerd で動かすことだけで、その価値は CSP を preview で確かめられるかにかかる。tech-spec §3.1 はプラグインの使用を決めていたので、入れない場合は改訂になる（T12） |

## 9. 後続への引き継ぎ

- 02: `protocol.ts` と `SimulationClient` を拡張して、DEM の読み込みを載せる。`tileMath.ts` をそのまま使う
- 06: バンドル予算とチャンク構成
