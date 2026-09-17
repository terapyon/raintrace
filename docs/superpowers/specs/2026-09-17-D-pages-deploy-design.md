# Spec D: 配信を Cloudflare Pages に移す（独自ドメインを外部 DNS で付ける）

- Status: 提案中（2026-09-17）
- 日付: 2026-09-17
- 対応: tech-spec §3.1・§3.2・§3.4・§12.3、spec 01 §4.7・§4.8・§4.11、overview R01-3・R01-7・R01-8
- 依存: 01（CI とデプロイの仕組み）。起点のブランチは R-D7
- 後続: なし（06 とは独立。06 の計測の `pnpm preview` との関係は §4.6）

---

## 1. 目的

本番を独自ドメイン（`raintrace.terapyon.net`）で配信する。DNS はユーザーの管理する外部の DNS（ユーザーの説明では AWS Route 53）に置いたままで、ネームサーバーは Cloudflare に移せない。

いまの配信先の Cloudflare Workers（Static Assets）は、独自ドメインを付ける 2 つの方法（Custom Domains と Routes）がどちらも **Cloudflare 上で有効なゾーン**を必要とする。一方 Cloudflare Pages は、サブドメインなら外部 DNS の CNAME で独自ドメインを付けられる。ユーザーは 2026-09-17 に Pages への移行を選んだ（別のサイトを Pages で運用済み）。

この spec は、デプロイの 3 段（R01-3: PR → プレビュー、`main` → ステージング、`v*` のタグ → 本番）を保ったまま、配信先を Pages に移す方式と手順を決める。アプリのコードは変えない。

## 2. スコープ

### 含む

- Pages の project の作り方（Direct Upload）と、デプロイの 3 段の対応
- 本番の独自ドメイン `raintrace.terapyon.net`（外部 DNS の CNAME）
- `public/_headers`（CSP・`Cache-Control`）と SPA のフォールバックが Pages でも同じに働くことの確認
- `wrangler.jsonc`・`@cloudflare/vite-plugin`・`pnpm preview` の扱いと、E2E のヘッダーの検査の保ち方
- `.github/workflows/ci.yml` の書き換え、デプロイの後の応答の検査
- API トークンの権限、Secrets
- 旧 Workers（`raintrace`・`raintrace-staging`）の後始末
- tech-spec §3・§12.3、README、`.handoff/README.md` の更新

### 含まない

- apex（`terapyon.net`）への配信（Pages でもゾーンを Cloudflare に置く必要がある。§3.2）
- DNS を Cloudflare に移すこと、ダッシュボードの Git 連携（ユーザーが除外。CI からデプロイする）
- Pages Functions・バックエンド（tech-spec §3.2 の「後付け」は、必要になった時点で別の spec で決める）
- プレビューへの Cloudflare Access（公開リポジトリの PoC なので、いまの Workers のプレビューと同じく公開のまま）
- Renovate・その他のボット（R01-2。導入しない）

## 3. 現状と問題

### 3.1 現状（b3a8916 の時点）

| 段 | トリガ | いまの手段 | URL |
|---|---|---|---|
| プレビュー | PR（同じリポジトリのブランチ） | `CLOUDFLARE_ENV=staging pnpm build` → `wrangler versions upload --preview-alias pr-<n>` | `pr-<n>-raintrace-staging.<サブドメイン>.workers.dev` |
| ステージング | `main` への push | `CLOUDFLARE_ENV=staging pnpm build` → `wrangler deploy`（Worker `raintrace-staging`） | `raintrace-staging.<サブドメイン>.workers.dev` |
| 本番 | `v*` のタグの push | `pnpm build` → `wrangler deploy`（Worker `raintrace`） | `raintrace.<サブドメイン>.workers.dev` |

- `vite.config.ts` が `@cloudflare/vite-plugin`（R01-8）を読み、`pnpm preview`（`vite preview`）が workerd の中で Workers の Static Assets と同じ規則で `dist/` を配信する。E2E（`playwright.config.ts`、ポート 4173）と 06 の計測（`playwright.perf.config.ts`、ポート 4175）はこれを使う
- `tests/e2e/smoke.spec.ts` の次の 3 件が、Cloudflare 側の規則を preview で確かめている
  1. 応答に CSP が付き、読み込み中に CSP 違反が起きない（`_headers`）
  2. `/assets/*` は `max-age=31536000, immutable`、`index.html` は `immutable` でない（`_headers`、RB-1）
  3. `/.vite/manifest.json` を配信しない（`public/.assetsignore`。無いパスには SPA のフォールバックで `index.html` が返る）
- ビルドの出力 `dist/` には、配信するファイルのほかに `.vite/`（`manifest.json`・`chunk-modules.json`。`pnpm size` が読む）、`wrangler.json`（plugin が出す。手元の絶対パスを含む）、`.assetsignore` が入る。`dist/assets/` は 12 ファイル、`dist/` 全体で約 2.7 MB、最大のファイルは約 0.96 MB（手元の `dist/`、2026-09-17）
- 本番の Worker にはまだリリースしていない（`.handoff/README.md` の記録では、`v*` のタグは 01 のマージの後に付ける予定）。ステージングの Worker `raintrace-staging` は手動で一度作り、PR #2〜#8 のプレビューがそこに上がっている

### 3.2 問題

- **Workers には外部 DNS で独自ドメインを付けられない。** Custom Domains は「An active Cloudflare zone」を前提とし（<https://developers.cloudflare.com/workers/configuration/routing/custom-domains/>）、Routes も有効なゾーンと Cloudflare でプロキシする DNS レコードを要る（<https://developers.cloudflare.com/workers/configuration/routing/routes/>）。Pages から Workers への移行ガイドの比較表も、Pages だけが Cloudflare の外のネームサーバーで CNAME の独自ドメインを付けられるとする（<https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/>）
- Pages は、サブドメインを外部 DNS の CNAME（`<project>.pages.dev` 向け）で付けられる。apex はゾーンを Cloudflare に置く必要がある（<https://developers.cloudflare.com/pages/configuration/custom-domains/>）。今回はサブドメインなので条件に合う

> **DNS の事実の確認（2026-09-17、手元の `dig`）**: `dig NS terapyon.net` は `ns1.value-domain.com.`・`ns2.value-domain.com.` を返した（SOA も value-domain）。ユーザーの説明の Route 53 と一致しない。どちらの DNS でも CNAME を 1 件足すだけなので方式は変わらないが、**CNAME を登録する先（value-domain か Route 53 か、あるいは `raintrace` のサブドメインを Route 53 に委任する予定か）はユーザーに確かめる**。`dig CAA terapyon.net` は空で、証明書の発行を妨げる CAA は無い。

## 4. 方式

### 4.1 Pages の project（Direct Upload）

- CI から `wrangler pages deploy` で上げる **Direct Upload** の project を作る。Direct Upload の project は、後から Git 連携に切り替えられない（<https://developers.cloudflare.com/pages/get-started/direct-upload/>）。ユーザーは Git 連携を使わないので問題ない
- project は **2 つ**に分ける（R-D1）。いまの Workers の 2 つ（`raintrace`・`raintrace-staging`）と同じ分け方で、PR のプレビューは本番の project に触れない（spec 01 §4.7 の方針を保つ）

| project | production branch | 用途 | 既定の URL |
|---|---|---|---|
| `raintrace` | `main` | 本番（`v*` のタグ）。独自ドメイン `raintrace.terapyon.net` | `raintrace.pages.dev` |
| `raintrace-staging` | `main` | ステージング（`main` への push）と PR のプレビュー | `raintrace-staging.pages.dev`、`pr-<n>.raintrace-staging.pages.dev` |

- 作り方（ユーザーの手作業、一度だけ）:

  ```sh
  pnpm exec wrangler pages project create raintrace --production-branch main
  pnpm exec wrangler pages project create raintrace-staging --production-branch main
  ```

  （<https://developers.cloudflare.com/workers/wrangler/commands/pages/>）
- `--production-branch` の名前は、`wrangler pages deploy --branch` に渡す値との照合にだけ使う（Direct Upload なので Git のブランチとは結び付かない）。`--branch` が production branch と同じなら本番の deployment、違えばプレビューの deployment になる
- **未確認**: `<project>.pages.dev` のサブドメインが他のアカウントに使われているとき、Cloudflare が名前に接尾辞を足すか。作った後に表示される URL を、CI とこの spec の表に反映する

### 4.2 デプロイの 3 段の対応

| 段 | トリガ | ビルド | デプロイ | URL |
|---|---|---|---|---|
| プレビュー | PR（同じリポジトリのブランチ。フォークは Secrets が無いので従来どおり除外） | `pnpm build` | `wrangler pages deploy dist --project-name raintrace-staging --branch pr-<n> --commit-hash <sha> --commit-message "PR #<n> <sha7>"` | `pr-<n>.raintrace-staging.pages.dev`（ブランチの別名。PR の最新を指す）と、deployment ごとの `<hash>.raintrace-staging.pages.dev` |
| ステージング | `main` への push（必須ジョブの成功が前提） | `pnpm build` | `wrangler pages deploy dist --project-name raintrace-staging --branch main --commit-hash <sha>` | `raintrace-staging.pages.dev` |
| 本番 | `v*` のタグの push（必須ジョブの成功が前提） | `pnpm build` | `wrangler pages deploy dist --project-name raintrace --branch main --commit-hash <sha> --commit-message <tag>` | `raintrace.terapyon.net`、`raintrace.pages.dev` |

- ブランチの別名は英小文字にされ、英数字以外はハイフンになる（<https://developers.cloudflare.com/pages/configuration/preview-deployments/>）。`pr-<n>` はそのままの形で残る。**未確認**: 別名の長さの上限（`pr-<n>` は短いので影響しない見込み）
- プレビューの deployment には Pages が `X-Robots-Tag: noindex` を付ける（同上）。ステージングと本番は production の deployment なので付かない。`*.pages.dev` の重複を検索に載せないため、`public/_headers` に `https://:project.pages.dev/*` の規則で `X-Robots-Tag: noindex` を足す（R-D6。絶対 URL の規則は <https://developers.cloudflare.com/pages/configuration/headers/>。`:project` はピリオドを含まないので、プレビューの `pr-<n>.raintrace-staging.pages.dev` には当たらない。当たらなくても Pages の既定で noindex）。独自ドメインには当たらない
- `CLOUDFLARE_ENV=staging` は要らなくなる（ビルドは 3 段とも同じ。どの project に上げるかは `--project-name` で決まる）
- ジョブのサマリには、`wrangler pages deploy` の出力から `https://…pages.dev` の URL を拾って出す（いまの `grep -Eo` と同じ形）。**未確認**: 出力の文言（deployment の URL と別名の URL の両方が出るか）。計画の最初の Task で手元の実行から確かめる
- プレビューの deployment は数の上限が無い（<https://developers.cloudflare.com/pages/platform/limits/>）。PR を閉じても消さない（いまの Workers のプレビューと同じ）

### 4.3 独自ドメイン（`raintrace.terapyon.net`）

手順（<https://developers.cloudflare.com/pages/configuration/custom-domains/>）:

1. **先に**ダッシュボードの Workers & Pages → `raintrace` → Custom domains → Set up a custom domain で `raintrace.terapyon.net` を登録する。ドキュメントは、ダッシュボードで結び付けずに CNAME だけを作ると名前が解決されない（522）と明記している
2. 外部 DNS に CNAME `raintrace.terapyon.net` → `raintrace.pages.dev`（§4.1 の実際のサブドメイン）を登録する（登録先は §3.2 の確認のとおり）
3. ダッシュボードの状態が Active になり、証明書が発行されるのを待つ
4. `curl -sI https://raintrace.terapyon.net/` で CSP・`Cache-Control` を確かめる（§5.2 の検査を独自ドメインにも当てる）

- CAA は無い（§3.2）ので、証明書の発行は妨げられない見込み
- **未確認**: 外部 DNS のときの証明書の検証の方式と所要時間（ドキュメントは Cloudflare のゾーンの場合だけを書いている）。Active にならない場合は、ダッシュボードが示す検証用のレコード（TXT など）を足す
- 独自ドメインは本番の project にだけ付ける。**ステージングに独自ドメインを付ける場合**（R-D2）: ブランチの別名に独自ドメインを付ける方法（<https://developers.cloudflare.com/pages/how-to/custom-branch-aliases/>）は「proxied Cloudflare DNS record」のときだけ働き、外部 DNS では production branch に送られる。つまり **1 つの project のブランチの別名には、外部 DNS で独自ドメインを付けられない**。R-D1 で project を 2 つに分けておけば、`staging.raintrace.terapyon.net` → `raintrace-staging.pages.dev` の CNAME で付けられる（ステージングは `raintrace-staging` の production の deployment なので）
- 独自ドメインを外すときは、CNAME を消してからダッシュボードで外す（同ドキュメント）

### 4.4 `_headers`・SPA のフォールバックの互換性

| 項目 | Workers Static Assets（いま） | Pages | 扱い |
|---|---|---|---|
| `_headers` | 対応 | 対応。出力のディレクトリに置く。規則は 100 件まで、1 行 2,000 文字まで。`_headers` の値は Cloudflare の既定のヘッダーを上書きする。複数の規則が当たればすべてを受け継ぐ（<https://developers.cloudflare.com/pages/configuration/headers/>） | そのまま使う。CSP の行は約 330 文字で上限の内 |
| 既定の `Cache-Control` | — | `public, max-age=0, must-revalidate`、`ETag` を常に付ける（<https://developers.cloudflare.com/pages/configuration/serving-pages/>） | `/assets/*` は `_headers` が上書きする。`index.html` は既定のまま（RB-1 の意図どおり） |
| SPA のフォールバック | `not_found_handling: "single-page-application"` を明示 | 最上位に `404.html` が無ければ SPA とみなし、すべてのパスを `/` に合わせる（同上） | `dist/` に `404.html` は無い。設定は要らない。今後 `public/404.html` を置かないこと（spec に注記し、E2E で確かめる） |
| `.html` の扱い | 既定の `html_handling` | `/index.html` などは拡張子の無い形へリダイレクトする（同上） | 入口は `/` だけなので影響しない |
| 配信から外すファイル | `.assetsignore` | `.assetsignore` は使わない（Workers 側の仕組み。移行ガイドの比較表）。**`wrangler pages deploy` はディレクトリの全ファイルを上げる**（workers-sdk の issue #14500: <https://github.com/cloudflare/workers-sdk/issues/14500>） | `dist/` から配信しないファイルを無くす（§4.5）。**未確認**: ドット始まりのディレクトリ（`.vite/`）が上がるか。上がる前提で扱う |
| 上限 | — | Free で 20,000 ファイル、1 ファイル 25 MiB（<https://developers.cloudflare.com/pages/platform/limits/>） | いまは約 15 ファイル・最大 0.96 MB で十分に内側 |
| Functions | — | `_headers` は Functions の応答には効かない | Functions は使わない（`functions/`・`_worker.js` を置かない） |

- **未確認**: Pages が既定で付けるその他のヘッダー（`Access-Control-Allow-Origin` など）。`_headers` で付けている 3 つ（CSP・`X-Content-Type-Options`・`Referrer-Policy`）と重なる場合は、`_headers` の値が優先する（上の上書きの規則）。§5.2 のデプロイ後の検査で実際の応答を記録する

### 4.5 `wrangler.jsonc`・`@cloudflare/vite-plugin`・E2E のヘッダーの検査

Pages に移ると、`@cloudflare/vite-plugin` と `wrangler.jsonc`（Workers の設定）は**デプロイには使われない**。plugin を残す意味は、preview を workerd で動かして `_headers` を E2E で確かめることだけになる（R01-8 のときと同じ理由）。3 案を比べる（R-D3）。

| 案 | 内容 | 利点 | 欠点 |
|---|---|---|---|
| (a) plugin を残す | `vite preview` は今のまま Workers の Static Assets の規則で配信。デプロイだけ Pages | 変更が最小。06 の計測の配信も変わらない | E2E が確かめるのは**配信先と違う製品**の規則（SPA の判定・`.assetsignore`・既定のヘッダーが異なる）。Workers の形の `wrangler.jsonc` が残り、`wrangler pages deploy` は「`pages_build_output_dir` が無いので手元の開発にだけ使う」旨の警告を出す（<https://developers.cloudflare.com/pages/functions/wrangler-configuration/>）。plugin が `dist/wrangler.json`・`dist/.assetsignore` を出し続けるので、アップロードの前に消す手順が要る |
| (b) `wrangler pages dev` に替える（推奨） | plugin と Workers の設定を外し、`pnpm preview` を `wrangler pages dev dist --port <port>` にする | E2E が**配信先と同じ製品**のローカルの実装（workerd）で `_headers`・SPA の判定を確かめる。設定が 1 つの製品にそろい、`dist/` に Workers 用の出力が混ざらない | `wrangler pages dev` が `_headers` を手元で適用するかを、ドキュメントでは確かめられなかった（**未確認**。Workers の `wrangler dev` は適用するという報告はある）。`--strictPort` に当たるフラグがあるか**未確認**。R01-8 の裁定と tech-spec §3.1 を改める |
| (c) ヘッダーを Vite で付ける | `_headers` を 1 か所の定義から生成し、`vite preview` の `preview.headers` にも渡す（spec 01 §4.8 で作らなかった仕組み） | wrangler に依存しない | `_headers` のパスの照合を自前で再現することになり、Pages の実際の規則との違いを検査できない。workerd の配信でなくなる |

**推奨は (b)**。あわせて、どの案でも **デプロイの後に実際の URL の応答を検査する**（§5.2）。E2E は手元の実装で規則を、デプロイ後の検査は本物の応答を確かめ、両方で抜けを塞ぐ。

(b) の具体:

- `vite.config.ts` から `cloudflare()` を外す。`chunkModulesReport` と Worker のチャンクの収集は plugin に依存しない（Vite の `worker.plugins` と `generateBundle`）ので、そのまま動く見込み
- `package.json`: `@cloudflare/vite-plugin` を devDependencies から外す。`wrangler` は `pages deploy`・`pages dev` に使うので残す。`preview` を `wrangler pages dev dist` に、`deploy:production` を `pnpm build && wrangler pages deploy dist --project-name raintrace --branch main` にする
- `wrangler.jsonc`: 消す。Pages の設定ファイルにする（`pages_build_output_dir`）と、`wrangler pages deploy` が `name` を project 名として使いうるので、2 つの project に上げる CI では `--project-name` とどちらが優先するかの確認が要る（**未確認**）。Functions を使わないので `compatibility_date` も要らない。`pages dev` が compatibility date を求める場合は、CLI のフラグで渡す
- `public/.assetsignore`: 消す（Pages は読まない）
- `dist/.vite/`: **ビルドの後に `dist/` の外（例: `build-info/`、gitignore する）へ移す**。E2E もデプロイも同じ `dist/` を扱い、「配信しない」を E2E で確かめられる。`scripts/check-bundle-size.mjs` の読み先を合わせる。デプロイのジョブだけで消す方法は、E2E が見る `dist/` と上げる `dist/` が食い違うので採らない
- `pnpm-workspace.yaml` の `allowBuilds` は、plugin を外した後の `pnpm install` が求めるものだけにする（workerd・esbuild は wrangler の依存として残る見込み）
- **(b) が成り立たない場合**（`pages dev` が `_headers` を適用しない、など）は、計画の最初の Task で分かった時点で止め、(a) に切り替えるかをユーザーに上げる

### 4.6 06 の計測との関係

- `playwright.perf.config.ts`（06、ポート 4175）は `pnpm preview --port 4175 --strictPort` を呼ぶ。スクリプト名 `preview` と引数の形を保てば、06 のブランチの設定を変えずに済む。`--strictPort` を `pages dev` が受け付けない場合は、`preview` のスクリプトの側で吸収する（例: `node scripts/preview.mjs` が `--strictPort` を受けて捨てる）
- 配信の仕組みが変わっても、fps・step の所要時間など 06 の計測値は描画と Worker の処理で決まり、静的配信の実装には依存しない見込み。ただし 06 の計測の途中で配信を差し替えない（R-D7 の順序で避ける）

### 4.7 CI の書き換え

`.github/workflows/ci.yml` の deploy の 3 ジョブだけを書き換える。`quality`・`test`・`build`・`e2e`・`audit` は、`pnpm build` の中身が変わる以外はそのまま。

- `deploy-preview`: `CLOUDFLARE_ENV` を外し、`pnpm exec wrangler pages deploy dist --project-name raintrace-staging --branch "pr-${PR_NUMBER}" --commit-hash "${GITHUB_SHA}" --commit-message "PR #${PR_NUMBER} ${GITHUB_SHA::7}"`。サマリに URL を出す。続けて §5.2 の検査を別名の URL（`https://pr-${PR_NUMBER}.raintrace-staging.pages.dev`）に当てる
  - 注意: `pull_request` の `GITHUB_SHA` はマージコミットの SHA。いまと同じ扱い（表示用）なので変えない
- `deploy-staging`: `wrangler pages deploy dist --project-name raintrace-staging --branch main --commit-hash "${GITHUB_SHA}"`、続けて検査を `https://raintrace-staging.pages.dev` に
- `deploy-production`: `wrangler pages deploy dist --project-name raintrace --branch main --commit-hash "${GITHUB_SHA}" --commit-message "${GITHUB_REF_NAME}"`、続けて検査を `https://raintrace.pages.dev` と（独自ドメインが Active になった後は）`https://raintrace.terapyon.net` に
- project 名は、ワークフローの `env`（例: `PAGES_PROJECT_STAGING: raintrace-staging`）に 1 か所で置く
- 第三者の Action（`cloudflare/wrangler-action`）は使わない（spec 01 §4.7。ドキュメントの例は Action を使うが、`pnpm exec wrangler` で同じことができる）
- Secrets の名前（`CLOUDFLARE_API_TOKEN`・`CLOUDFLARE_ACCOUNT_ID`）とリポジトリの単位に置くことは変えない。environment `staging`・`production` も変えない
- `concurrency`・`permissions: contents: read` も変えない

### 4.8 API トークンの権限

- Pages の Direct Upload に要る権限は **Account → Cloudflare Pages → Edit**（<https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/>）。**未確認**: `wrangler pages deploy` が他の読み取り権限（Account Settings: Read など）を要るか。最初の PR のプレビューで確かめる
- 移行の間は、01〜05 の PR（マージ前の古いワークフロー）が Workers にプレビューを上げ続けるので、**いまのトークンに Pages の Edit を足す**（Workers の権限はしばらく残す）。旧 Workers を消した後（§4.9）に、Workers の権限を外すか、Pages の Edit だけのトークンに作り直して Secret の値を差し替える
- トークンの対象のアカウントは 1 つに絞る（既存の Pages のサイトと同じアカウントでよい）

### 4.9 旧 Workers の後始末

R-D5 の時期に、ユーザーが手元で行う。

1. 01〜05 と D がすべて `main` にマージされ、開いている PR が Pages にプレビューを上げていることを確かめる（`raintrace-staging` の Worker に上げるワークフローが残っていない）
2. ステージング（`raintrace-staging.pages.dev`）と本番（`raintrace.terapyon.net`）で §5.2 の検査が通っていることを確かめる
3. Worker を消す（**未確認**: `wrangler delete` のフラグ。`--name` で名前を指定する想定）

   ```sh
   pnpm exec wrangler delete --name raintrace-staging
   pnpm exec wrangler delete --name raintrace   # 本番は未リリースなら存在しない。あれば消す
   ```

   D のブランチでは `wrangler.jsonc` を消しているので、`--name` を明示する。ダッシュボード（Workers & Pages → 該当の Worker → Settings → Delete）でもよい
4. トークンから Workers の権限を外す（§4.8）
5. `.handoff/README.md` の Workers の手順（「01 の push の前に」「deploy-preview を直す」）を、Pages の手順に書き換える（`.handoff/` は gitignore なので、ユーザーの手元で）

## 5. 移行の手順

### 5.1 順序（ダウンタイムを出さない）

本番はまだリリースしていない（§3.1）ので、利用者に見える停止は生じない。ステージングと PR のプレビューも、Workers と Pages が並んで動く期間を置き、切れ目を作らない。

| # | 誰が | 作業 | この時点の配信 |
|---|---|---|---|
| 1 | ユーザー | 外部 DNS の登録先を確かめる（§3.2 の注記） | Workers のみ |
| 2 | ユーザー | Pages の project を 2 つ作る（§4.1）。表示された `pages.dev` のサブドメインを実装役に伝える | Workers のみ |
| 3 | ユーザー | トークンに Pages の Edit を足す（§4.8） | Workers のみ |
| 4 | 実装役 | D を実装する（§4.5・§4.7）。手元で E2E を通し、`wrangler pages deploy` を手元から一度 `raintrace-staging` に `--branch d-trial` で上げて出力と応答を確かめる（トークンはユーザーの手元の `wrangler login` で。実装役が行えない場合はユーザーに依頼） | Workers と Pages（試し） |
| 5 | ユーザー | D を push して PR を作る。PR の `deploy-preview` が Pages に上がり、検査が通る | Workers（01〜05 の PR）と Pages（D の PR） |
| 6 | ユーザー | 01〜05、D の順にマージする（R-D7）。D のマージで `deploy-staging` が Pages に上がる | ステージングは Pages。01〜05 のマージの時点では Workers のステージングにも上がる |
| 7 | ユーザー | `v*` のタグを push し、`raintrace` の project に本番を上げる。`raintrace.pages.dev` で確かめる | 本番は Pages |
| 8 | ユーザー | 独自ドメインを付ける（§4.3。ダッシュボードが先、CNAME が後）。Active になったら確かめる | 本番は `raintrace.terapyon.net` |
| 9 | ユーザー | 旧 Workers を消し、トークンを絞る（§4.9、R-D5） | Pages のみ |

- `workers.dev` の URL は、手順 9 で Worker ごと消える（R-D6）。README・spec に `workers.dev` の URL を載せている箇所は D の中で Pages の URL に改める（利用者向けに公開した URL ではないので、転送は置かない）

### 5.2 デプロイの後の応答の検査

`scripts/check-deployed-headers.mjs`（依存なし、`fetch` のみ）を足し、デプロイの 3 ジョブの最後に URL を渡して実行する。確かめること（E2E の 3 件と同じ内容を、本物の応答で）:

1. `/` の応答が 200 で、`content-security-policy` に `default-src 'self'` を含む。`x-content-type-options: nosniff`
2. `/` の `cache-control` が `immutable` を含まない
3. `index.html` が参照する `/assets/*.js` の 1 つの `cache-control` が `max-age=31536000` と `immutable` を含む
4. `/.vite/manifest.json` の本文が `"isEntry"` を含まない（ビルドの情報を配信していない）
5. 存在しないパス（例: `/no-such-path`）が 200 で `index.html` を返す（SPA のフォールバック）
6. `*.pages.dev` の本番・ステージングは `x-robots-tag` に `noindex` を含む（R-D6 を採った場合）

- 反映の遅れに備え、数回の再試行（例: 5 秒おきに 6 回）を入れる
- デプロイのジョブは必須のチェックではない（`deploy-preview` は × のまま）ので、検査の失敗はマージを妨げないが、ジョブの赤で気づける

## 6. テスト

- **E2E**（`pnpm test:e2e`、Chromium、ポート 4173）: 配信が `wrangler pages dev` に替わっても、`smoke.spec.ts` の 3 件（CSP・`Cache-Control`・`/.vite/` を配信しない）とそれ以外の全件が通る。テストの中身は変えない。`/.vite/` のテストのコメント（`not_found_handling`）だけを Pages の規則に合わせて直す
- **E2E に 1 件足す**: 存在しないパス（`/no-such-path`）を開いても地図の画面が出る（SPA の判定。`404.html` を誤って置いたときに気づく）
- **単体**: 変更なし（アプリのコードに触れない）。`scripts/check-deployed-headers.mjs` は小さいので単体テストを持たず、PR のプレビューでの実行を確かめとする
- **ビルド**: `pnpm build` の後に `dist/` に `wrangler.json`・`.assetsignore`・`.vite/` が無く、`pnpm size` が移した先の情報を読んで通る
- **CI**: D の PR で `deploy-preview` の検査が緑。`main` へのマージの後に `deploy-staging` の検査が緑。タグの push の後に `deploy-production` の検査が緑
- **手動**: Firefox と Safari でステージングと本番の URL の地図が表示される（spec 01 の完了条件 7 と同じ）。`curl -sI https://raintrace.terapyon.net/` の結果を PR に記録する

## 7. 完了条件

1. PR ごとに `pr-<n>.raintrace-staging.pages.dev` のプレビューが発行され、ジョブのサマリに URL が出て、§5.2 の検査が通る
2. `main` への push で `raintrace-staging.pages.dev` に、`v*` のタグの push で `raintrace` の project（`raintrace.pages.dev`）に配信され、それぞれ §5.2 の検査が通る
3. `https://raintrace.terapyon.net/` で地図が表示され、証明書が有効で、§5.2 の検査が通る
4. E2E が全件通り、CSP・`Cache-Control`・`/.vite/` の 3 件が `wrangler pages dev`（R-D3 で (b) を採った場合）の配信で確かめられている
5. `pnpm lint`・`pnpm typecheck`・`pnpm depcheck`・`pnpm test`・`pnpm build`・`pnpm size`・`pnpm run licenses` が通る
6. tech-spec §3.1・§3.2・§3.4・§12.3、README（`pnpm preview`・`pnpm deploy:production` の説明）、overview（§3 の D の行、§6 に R-D の行、§7 に T15）を更新している
7. 旧 Workers の後始末（§4.9）を、R-D5 の時期に行ったことを `.handoff/` に記録している

## 8. tech-spec の改訂（T15）

| tech-spec | 内容 |
|---|---|
| §3.1 | 「`@cloudflare/vite-plugin` 経由で Cloudflare Workers の Static Assets として配信」を「Cloudflare Pages（Direct Upload）で配信」に改める。`wrangler.jsonc` を図から外す |
| §3.2 | 「同一 Worker に API ルートを後付けできる」を、「必要になった時点で Pages Functions か別の Worker を選ぶ」に改める |
| §3.4 | 表を §4.2 の 3 段に改める。トークンの権限を「Pages の Edit のみ」に |
| §12.3 | `deploy` の行にデプロイの後の応答の検査を足す |

spec 01 は当時の設計の記録として本文を書き換えず、冒頭の Status に「デプロイは spec D で Pages に移した」旨の 1 行を足す。

## 9. 裁定が必要な論点

| ID | 論点 | 推奨 | 理由 |
|---|---|---|---|
| R-D1 | ステージングの表し方 | project を 2 つ（`raintrace`＝本番、`raintrace-staging`＝ステージングと PR のプレビュー）。どちらも production branch は `main` | いまの Workers の分け方と同じで、PR のプレビューが本番の project に触れない。1 つの project でステージングを `--branch staging` の別名にする案は、外部 DNS ではブランチの別名に独自ドメインを付けられず（§4.3）、ステージングにドメインを付ける道が閉じる。1 つの project にする利点は project が 1 つ減ることだけ |
| R-D2 | ステージングに独自ドメイン（`staging.raintrace.terapyon.net`）を付けるか | 付けない（`raintrace-staging.pages.dev` で足りる）。必要になったら R-D1 の 2 project なら CNAME 1 件で後から付けられる | PoC で、ステージングを見るのは開発者だけ。DNS のレコードと証明書の管理を増やさない |
| R-D3 | E2E のヘッダーの検査の方式 | (b) `@cloudflare/vite-plugin` と `wrangler.jsonc` を外し、`pnpm preview` を `wrangler pages dev dist` にする。どの案でも、デプロイの後に本物の応答を検査する（§5.2）。`pages dev` が `_headers` を適用しないと分かれば、その時点で (a) に切り替えるかを上げる | E2E が配信先と同じ製品の規則を確かめられ、設定と出力が Pages にそろう。(a) は違う製品の規則を確かめ続けることになり、(c) は規則の照合を自前で再現することになる。R01-8 の裁定（plugin の導入）を覆すので裁定が要る |
| R-D4 | `dist/.vite/` の置き場所 | ビルドの後に `dist/` の外（`build-info/`）へ移し、`pnpm size` の読み先を合わせる | Pages は `.assetsignore` を読まず、ディレクトリの全ファイルを上げる。E2E とデプロイが同じ `dist/` を扱い、「配信しない」を E2E で確かめ続けられる |
| R-D5 | 旧 Workers を消す時期 | 01〜05 と D がマージされ、ステージングと本番（独自ドメイン）で §5.2 の検査が通った後（§5.1 の手順 9） | それまでは 01〜05 の PR のワークフローが `raintrace-staging` の Worker にプレビューを上げる。先に消すとそれらの `deploy-preview` が赤になる（必須ではないが、確認の材料が消える） |
| R-D6 | `workers.dev`・`pages.dev` の URL を残すか | `workers.dev` は Worker ごと消す（転送は置かない）。`pages.dev` は消せないので残し、`_headers` の `https://:project.pages.dev/*` に `X-Robots-Tag: noindex` を付けて、独自ドメインと重複して検索に載らないようにする | `workers.dev` の URL は開発者しか使っておらず、残すと古い版が並んで見え続ける。Pages はプレビューにしか noindex を付けない |
| R-D7 | この spec の実装をどこに積むか | 05（`b3a8916`）の上に積み、PR の base は `feat/05-3d-rendering`。05 の直後・06 より前にマージし、06 は D の上に載せ替える。06 の計測（M2 以降）の最中は D をマージしない | 01〜05 は Workers のデプロイを持ったまま積まれている。main へのマージの後に始めると、独自ドメインが 01〜05 のマージ待ちになる。D が触るのは設定と CI だけで、06 と重なるのは `pnpm preview` の呼び方だけ（§4.6 でスクリプト名と引数を保つので、06 の設定は変えずに済む見込み） |
| R-D8 | tech-spec と R01-8 の改訂 | T15（§8）として承認し、overview §6 の R01-8 の行に「spec D で外した」旨を追記する | 配信先の変更は tech-spec §3 の決定の変更で、R01-3（3 段の流れ）は保つが手段が変わる |
