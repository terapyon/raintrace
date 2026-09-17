# Spec D 配信を Cloudflare Pages に移す Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 配信先を Cloudflare Workers（Static Assets）から Cloudflare Pages（Direct Upload、project `raintrace` の 1 つ）に移し、PR → `pr-<n>.raintrace.pages.dev`、`main` → `main.raintrace.pages.dev`、`v*` のタグ → 本番（`raintrace.pages.dev` と独自ドメイン `raintrace.terapyon.net`）の 3 段にする。手元の `pnpm preview` と E2E も Pages のローカルの実装（`wrangler pages dev`）にそろえ、デプロイの後に本物の応答を検査する。

**Architecture:** `@cloudflare/vite-plugin` と `wrangler.jsonc`・`public/.assetsignore` を外す。ビルドの情報（`dist/.vite/`）は Vite のプラグインで `build-info/` に移し、`dist/` には配信するファイルだけを置く（`pnpm size` が守る）。`pnpm preview` は `scripts/preview.mjs`（`--strictPort` を受けて捨て、ポートが使用中なら失敗する包み）から `wrangler pages dev dist` を起動する。CI の deploy の 3 ジョブは `wrangler pages deploy` を `--branch "$PAGES_BRANCH"` で呼び、`production` はタグのジョブの `env` にだけ書く。上げた後に `scripts/check-deployed-headers.mjs`（依存なし、`fetch` のみ）が CSP・`Cache-Control`・ビルドの情報・SPA・noindex を確かめる。アプリのコード（`src/`）は変えない。

**Tech Stack:** 01〜05 の構成（Vite 8.2.2、TypeScript 6、Vitest 4、Playwright 1.62、Biome 2.5）。wrangler 4.127.1（`pages dev`・`pages deploy`）。依存は足さず、`@cloudflare/vite-plugin@1.54.2` を外すだけ

**Spec:** `docs/superpowers/specs/2026-09-17-D-pages-deploy-design.md`（190ece1 でレビュー役が承認。R-D1〜R-D8 は裁定済み、**R-D9 は未裁定**）。あわせて `specs/tech-spec.md` §3・§7.7・§12.3、`docs/superpowers/specs/2026-09-10-00-overview.md` §6（R01-3・R01-8）・§7、spec 01 §4.7・§4.8

**前提:** ワークツリー `/home/terapyon/dev/terapyon/raintrace/.claude/worktrees/agent-abb19734b402c33ec`、ブランチ `feat/D-pages-deploy`（05 の最終 `b3a8916` の上に spec D の 3 コミット、head `190ece1`）。PR の base は `feat/05-3d-rendering`（R-D7）。計画そのものは本計画のコミット 1 つ。Task 1 はその次から

## Global Constraints

- **作業はこのワークツリーだけで行う。** メインのチェックアウト（`/home/terapyon/dev/terapyon/raintrace`、`feat/06-performance`）には触れない。06 の計測（ポート 4175、重い CPU）が動いている
- **ポート**: 4175 は使わない。E2E は `playwright.config.ts` の 4173 に固定なので、**E2E を回す前にコントローラーに「4173 を使ってよいか（メインで E2E・計測が動いていないか）」を確かめる**。手元の確かめは 4190・4191 を使う（`ss -ltn '( sport = :4190 or sport = :4191 )'` で空きを確かめる）。06 の計測（`pnpm perf:fps`）はこのワークツリーでは回さない
- **認証情報を持たない。** `wrangler login`・`wrangler pages project create`・`wrangler pages deploy`・`wrangler delete`、Cloudflare のダッシュボード、GitHub の Secrets・Variables・Environments の設定、value-domain の DNS は、すべて【手動・ユーザー】の手順としてコントローラーに渡す（下の「ユーザーの手作業」）。実装役は実行しない
- **依存を足さない。** 外すのは `@cloudflare/vite-plugin` だけ。`pnpm-workspace.yaml` の `minimumReleaseAge: 14400`・`minimumReleaseAgeStrict: true`（10 日のクールダウン）を守る。pnpm が新しい版の解決や承認を求めたら、承認せずに止めてコントローラーに上げる。変更の後に `pnpm install --frozen-lockfile` が差分なく通ること。`pnpm-lock.yaml` の差分は削除（と、それに伴う peer の文脈のキーの書き換え）だけで、**新しい版の行が 1 つも増えない**こと
- **06 との重なり（spec D §4.6）**: D は 05 の時点のファイルだけを直す。`tests/perf/support.ts`（06 にだけある）・`playwright.perf.config.ts`・tech-spec §14・overview §6 の R05-6・R06 の行には触れない。06 は D のマージの後、M3 か M4 の後に D の上へリベースして合わせる（Task 7 の申し送りに書く）
- **本番を取り違えない（spec D §4.7）**: `production` という文字列をブランチ名として書くのは、`ci.yml` の `deploy-production` の `env`（`PAGES_BRANCH: production`）と、`package.json` の `deploy:production:manual` だけ。第三者の Action（`cloudflare/wrangler-action`）は使わない。Actions の SHA のピン留め、`permissions: contents: read`、`concurrency` は変えない
- 固定の値（spec D から）:
  - Pages の project: `raintrace`、production branch: `production`、既定のホスト: `raintrace.pages.dev`
  - 3 段の `--branch`: `pr-<PR 番号>`・`main`・`production`。3 段とも `--commit-dirty=true`、ワークフローの `env` に `WRANGLER_SEND_METRICS: false`
  - 独自ドメイン: `raintrace.terapyon.net`。検査はリポジトリの変数 `vars.PRODUCTION_URL` があるときだけ
  - noindex の `_headers` の規則: `https://:project.pages.dev/*` と `https://:alias.:project.pages.dev/*` に `X-Robots-Tag: noindex`
  - デプロイの後の検査の再試行: 5 秒おきに 6 回
  - ビルドの情報の置き場所: `build-info/`（gitignore）
  - `pages dev` の compatibility date: `2026-09-04`（`wrangler.jsonc` から移す。wrangler 4.127.1 の workerd が対応する最新の日付）
- **R-D9（environment `production` の承認者）は未裁定。** 計画はどちらの裁定にも依存しない。承認者の設定は GitHub の画面の設定でリポジトリのファイルに現れないので、ユーザーが「付ける」と裁定したときだけ手作業 U4 で行う
- 書式と lint は Biome（2 スペース、シングルクォート、セミコロンなし、行幅 100）。コメントとテスト名は日本語
- 各 Task の終わりのゲート: `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test`。ビルドに触れる Task は加えて `pnpm build && pnpm size && pnpm run licenses`。E2E（Task 3・7）は、コントローラーの許可の後に `pnpm test:e2e`（手元に WebKit が無ければ `pnpm build && pnpm exec playwright test --project=chromium` とし、その旨を記録）
- 1 Task 1 コミット（Task 1 はコミットしない）。コミットメッセージは日本語で、本文の後に空行を 1 つ置き、末尾に `Co-Authored-By: Claude <モデル名> <noreply@anthropic.com>` を付ける（下の各 Task のコミット例では省略しているが、必ず付ける）。push はしない（ユーザーがまとめて行う）
- 記録: 実装の途中の事実と申し送りは、ワークツリーの `.handoff/D-pages-deploy.md`（gitignore。コントローラーがメインのチェックアウトの `.handoff/` に写す）に書く

## 計画で決めたこと（spec と指示に無い細部）

1. **ビルドの情報は Vite のプラグインで移す**（`vite.config.ts` の `moveBuildInfoOutOfDist`、`writeBundle` の `order: 'post'`）。`package.json` の `build` の後ろに移す手順を足す方法は、`build:perf` や素の `vite build` で漏れるので採らない。`dist/.vite/` をまるごと `build-info/` に改名する（`build-info/manifest.json`・`build-info/chunk-modules.json`）。`chunkModulesReport` の `emitFile` の `fileName` は `.vite/chunk-modules.json` のまま（移すのはプラグインの 1 か所）。`.vite/` が無ければビルドを失敗させる
2. **`dist/` に置いてはならないものを `pnpm size` で検査する**（`scripts/lib/distContents.mjs`）。対象は `.vite`・`wrangler.json`・`.assetsignore`・`404.html`（Pages の SPA の判定が外れる）・`_worker.js`（Functions になり `_headers` が効かない）。`wrangler pages deploy` は `dist/` の全ファイルを上げるので、CI の `build` ジョブで食い止める
3. **`scripts/preview.mjs` は常に strict**（ポートが使用中なら起動せずに失敗）。`--strictPort` は受けて捨てる。引数の読み取りは `scripts/lib/previewArgs.mjs`（単体テストあり）。未知の引数は失敗させる（打ち間違いを黙って通さない）。既定のポートは 4173（`vite preview` と同じ）。wrangler は `node_modules/wrangler/bin/wrangler.js` を `process.execPath` で直接起動し、`--compatibility-date 2026-09-04 --show-interactive-dev-session=false`、`WRANGLER_SEND_METRICS=false` を渡す。`SIGINT`・`SIGTERM` は子に渡す
4. **`check-deployed-headers` の判定を純粋な `scripts/lib/deployedHeaders.mjs` に分け、単体テストを持たせる。** spec §6 は「小さいので単体テストを持たない」とするが、`scripts/lib/*.test.mjs` の既存の形に合わせる追加で、spec の内容は変えない（PR の「spec との差異」に書く）。CLI は `--noindex` か `--indexable` を必須にする（期待を書き忘れて noindex の検査が空振りしないように）。応答の取得は `redirect: 'manual'`（予期しないリダイレクトを 200 でないとして検出する）。SPA のフォールバックは「`/no-such-path` が 200 で、本文が `/` と同じ」で確かめる。`/` の応答ヘッダーを全部ログに出す（spec §4.4 の未確認〈Pages の既定のヘッダー〉の記録）
5. **ホスト名をワークフローの `env` の `PAGES_HOST: raintrace.pages.dev` に分ける。** project の作成で接尾辞が付いた場合（spec §4.1 の未確認）に 1 行だけ直せばよい。`PAGES_PROJECT: raintrace` と並べる
6. **本番の守りは `if [ "$PAGES_BRANCH" = production ]; then echo "::error::…"; exit 1; fi`**（spec の 1 行の検査と同じ意味で、失敗の理由をログに出す）
7. **`deploy-main` の `--commit-message` は付けない**（spec §4.2 の表のとおり）
8. **tech-spec は §8 の表の 4 節（§3.1・§3.2・§3.4・§12.3）に加え、Workers での配信を前提にした文をすべて直す**: §1 の表（ビルド・ホスティング）、§1.1 の「Cloudflare Pages」の行、§4.1 の構成図（`wrangler.jsonc`・`worker/`）、§7.3、§7.7、§13.3、§18 の 1、§19 の §51 の行。§14 は 06 の範囲なので触れない。overview §7 に T15 を足す
9. **overview §6 の R-D1〜R-D9 の行は表の末尾（RB-1 の行の後）に足す。** 06 が直す R05-6・R06 の行から離し、リベースの衝突を避ける
10. **E2E に 1 件足す**（spec §6）: `/no-such-path` を開いても地図が出る。`/.vite/` のテストは中身を変えず、コメントだけ Pages の規則に直す
11. **Task 2（ビルドの情報を移す）を Task 3（配信を `pages dev` に替える）より先にする。** 逆にすると、`pages dev` が `dist/.vite/manifest.json` を配信して E2E の `/.vite/` のテストが落ちる間ができる
12. **手元からの試しのデプロイ（spec §5.1 の手順 3）はユーザーの手作業 U3。** Task 5 の後ならいつでもよく、結果は Task 7 で記録し、出力の文言が想定（下の事実）と違えば Task 7 でサマリの `grep` を直す
13. wrangler 4.127.1 のコードで確かめた事実（計画の作成時、`node_modules/wrangler/wrangler-dist/cli.js`）: `pages deploy` の出力は `Deployment complete! Take a peek over at <deployment の URL>` と、別名があれば次の行に `Deployment alias URL: <別名の URL>`。`pages dev` の既定の IP は `localhost`、`--port` を指定するとその値をそのまま使う（空きのポートを探さない）。compatibility date を渡さないと `No compatibility_date was specified. Using the default compatibility date: …` の警告を出す。`--show-interactive-dev-session` は真偽のオプション

## 着手前に確かめること（Task 1 で実装役が確かめ、失敗なら止める）

| # | 未確認 | 確かめ方 | 失敗したとき |
|---|---|---|---|
| P1 | `wrangler pages dev` が `_headers` を実際の応答に付ける（CSP・`X-Content-Type-Options`・`/assets/*` の `Cache-Control`） | Task 1 Step 3 | **止めてコントローラーに上げる**（R-D3 の条件。(a) に切り替えるかはユーザーが決める） |
| P2 | `pages dev` が SPA のフォールバック（無いパスに 200 で `index.html`）を行う | Task 1 Step 3 | **止めて上げる** |
| P3 | `_headers` に絶対 URL の規則（`https://:project.pages.dev/*`）を足しても、ほかの規則が効き続ける（パースで壊れない） | Task 1 Step 3 | **止めて上げる**（noindex の置き方を spec で決め直す） |
| P4 | ポートが使用中のときの `pages dev --port` の振る舞い | Task 1 Step 4 | 止めない。包みの事前の検査で失敗させる（決めたこと 3） |
| P5 | compatibility date の要否 | Task 1 Step 3 | 止めない。包みで `2026-09-04` を渡す |
| P6 | `Host` ヘッダーを `*.pages.dev` にしたとき、手元で noindex の規則が当たるか | Task 1 Step 3（参考） | 止めない。本物は U3 と CI の検査で確かめる |

## ユーザーの手作業（コントローラーが順に渡す。実装役は行わない）

| # | 時期 | 内容 | spec |
|---|---|---|---|
| U1 | いつでも（Task 1 と並行でよい） | Pages の project を作る。表示された URL（接尾辞の有無）と production branch を知らせる | §4.1、§5.1 の 1 |
| U2 | U1 の後 | API トークンに Account → Cloudflare Pages → Edit を足す（Workers の権限は残す） | §4.8、§5.1 の 2 |
| U3 | Task 5 の後（U1・U2 の後） | ワークツリーで手元から `--branch d-trial` に試しに上げ、出力と検査の結果を知らせる | §5.1 の 3 |
| U4 | 不要（R-D9 は挟まない、2026-09-17 裁定） | GitHub の environment `production` に Required reviewers は設定しない | §4.7、R-D9 |
| U5 | Task 7 の後 | D を push して PR（base `feat/05-3d-rendering`）を作り、`deploy-preview` の検査が緑かを見る | §5.1 の 4 |
| U6 | 01〜05 のマージの後（06 の M4 の計測の最中を避ける） | D をマージし、`deploy-main` の検査が緑かを見る。Firefox・Safari で `https://main.raintrace.pages.dev/` の地図を見る | §5.1 の 5、§6 の手動 |
| U7 | U6 の後 | `v*` のタグを push し、`deploy-production` の検査が緑かを見る。`https://raintrace.pages.dev/` を見る | §5.1 の 6 |
| U8 | U7 の後 | 独自ドメイン: ダッシュボードで登録 → value-domain に CNAME → Active を待つ → 検査 → 変数 `PRODUCTION_URL` を登録。Firefox・Safari で見る。`curl -sI` を記録 | §4.3、§5.1 の 7 |
| U9 | U8 の後（R-D5 の条件がそろった後） | 旧 Workers（`raintrace-staging`・`raintrace`）を消し、トークンを絞り、（任意）environment `staging` を消し、`.handoff/README.md` を Pages の手順に直す | §4.9、§5.1 の 8 |

各手順の本文（そのまま送る文面）は Task 7 の Step 4 にある。U1・U2 は Task 1 の開始と同時に送ってよい（U1 の結果の URL は Task 5 の `PAGES_HOST` に使う。Task 5 までに届かなければ `raintrace.pages.dev` のまま進め、届いた時点で直す）。

## ファイル構成

| ファイル | 変更 | 責務 | Task |
|---|---|---|---|
| `vite.config.ts` | 変更 | `moveBuildInfoOutOfDist` を足す（2）。`cloudflare()` を外す（3） | 2・3 |
| `scripts/check-bundle-size.mjs` | 変更 | 読み先を `build-info/` に（2）。`dist/` の中身の検査（3） | 2・3 |
| `scripts/lib/distContents.mjs`・`.test.mjs` | 新規 | `dist/` に置いてはならないものの判定 | 3 |
| `tests/perf/fps.perf.ts` | 変更 | 94 行目の読み先を `build-info/manifest.json` に | 2 |
| `.gitignore` | 変更 | `build-info/` を足す | 2 |
| `scripts/preview.mjs` | 新規 | `pnpm preview` の包み（`wrangler pages dev dist`） | 3 |
| `scripts/lib/previewArgs.mjs`・`.test.mjs` | 新規 | 包みの引数の読み取り | 3 |
| `package.json`・`pnpm-lock.yaml` | 変更 | plugin を外す、`preview`、`deploy:production:manual` | 3 |
| `pnpm-workspace.yaml` | 変更 | `allowBuilds` のコメント（必要なら項目） | 3 |
| `wrangler.jsonc`・`public/.assetsignore` | 削除 | Workers の設定 | 3 |
| `public/_headers` | 変更 | `*.pages.dev` の noindex の 2 規則 | 3 |
| `playwright.config.ts` | 変更 | コメントだけ | 3 |
| `tests/e2e/smoke.spec.ts` | 変更 | `/.vite/` のコメント、SPA のフォールバックの 1 件 | 3 |
| `scripts/lib/deployedHeaders.mjs`・`.test.mjs` | 新規 | デプロイした応答の判定（純粋） | 4 |
| `scripts/check-deployed-headers.mjs` | 新規 | 取得・再試行・ログ（CLI） | 4 |
| `.github/workflows/ci.yml` | 変更 | deploy の 3 ジョブ | 5 |
| `specs/tech-spec.md` | 変更 | 決めたこと 8 の節 | 6 |
| `docs/superpowers/specs/2026-09-10-00-overview.md` | 変更 | R01-3・R01-8 の追記、R-D1〜R-D9、T15 | 6 |
| `docs/superpowers/specs/2026-09-10-01-foundation-design.md` | 変更 | 冒頭の Status に 1 行 | 6 |
| `README.md` | 変更 | コマンドの表、配信先 | 6 |
| `.handoff/D-pages-deploy.md` | 新規（gitignore） | 事実・手作業の結果・PR の本文・06 への申し送り | 1・7 |

## spec D との対応

| spec D | Task |
|---|---|
| §4.1 project、§4.3 独自ドメイン、§4.8 トークン、§4.9 後始末 | U1・U2・U8・U9（Task 7 で文面） |
| §4.2 3 段・noindex・`--commit-dirty=true` | 3（`_headers`）、5（CI） |
| §4.4 `_headers`・SPA の互換性 | 1（確かめ）、3（E2E）、4（本物の応答） |
| §4.5 plugin を外す（R-D3）、`dist/.vite/`（R-D4） | 1、2、3 |
| §4.6 06 との重なり | Global Constraints、7（申し送り） |
| §4.7 CI・守り・`deploy:production:manual`・R-D9 | 3（package.json）、5、U4 |
| §5.1 移行の順序 | U1〜U9 |
| §5.2 デプロイの後の検査 | 4、5 |
| §6 テスト | 2・3（ビルド・E2E）、4（単体）、7（全体）、U6・U8（手動） |
| §7 完了条件 | 7（1〜6 のうち実装役が確かめられるもの）、U5〜U9 |
| §8 記録の更新（R-D8） | 6 |

---

### Task 1: 未確認の確かめ（`pages dev` の `_headers`・SPA・ポート。spec D §4.5・§4.6）

コミットしない。結果を `.handoff/D-pages-deploy.md` の「§1 Task 1 の事実」に書き、コントローラーに報告する。**P1〜P3 のどれかが失敗したら、ここで止める。**

**Files:**
- Create: `.handoff/D-pages-deploy.md`（gitignore）

**Interfaces:**
- Consumes: なし
- Produces: P1〜P6 の結果（Task 3 の `scripts/preview.mjs` のフラグと、`public/_headers` の noindex の規則を採るかの判断）

- [ ] **Step 1: 準備を確かめる**

```bash
W=/home/terapyon/dev/terapyon/raintrace/.claude/worktrees/agent-abb19734b402c33ec
git -C $W status --short          # 空であること
git -C $W log --oneline -1        # 本計画のコミット
test -d $W/node_modules || (cd $W && pnpm install --frozen-lockfile)
ss -ltn '( sport = :4190 or sport = :4191 )'   # 何も表示されないこと
```

- [ ] **Step 2: ビルドして、Pages に上げる形の複製を作る**

plugin はまだ入っているので、`dist/` には `wrangler.json`・`.assetsignore`・`.vite/` が混ざる。複製から消し、spec D §4.2 の noindex の規則を足す（本物の `public/_headers` は Task 3 で直す）。wrangler の設定ファイルを読ませないため、複製は scratch の下に置き、そこを cwd にする。

```bash
cd $W && pnpm build
S=$(mktemp -d)
cp -r $W/dist "$S/site"
rm -rf "$S/site/.vite" "$S/site/wrangler.json" "$S/site/.assetsignore"
cat >> "$S/site/_headers" <<'EOF'

# *.pages.dev は索引させない（spec D §4.2、R-D6）
https://:project.pages.dev/*
  X-Robots-Tag: noindex

https://:alias.:project.pages.dev/*
  X-Robots-Tag: noindex
EOF
ls -a "$S/site"; echo "S=$S"
```

- [ ] **Step 3: `pages dev` を起動し、応答を確かめる（P1・P2・P3・P5・P6）**

まず compatibility date を渡さずに起動してログを見る（P5）。Bash の `run_in_background` で起動する。

```bash
cd "$S" && WRANGLER_SEND_METRICS=false node $W/node_modules/wrangler/bin/wrangler.js pages dev site --port 4190 --show-interactive-dev-session=false
```

起動したら（`until curl -s -o /dev/null http://localhost:4190/; do sleep 1; done` を 60 秒で打ち切る）、ログの compatibility date の警告と、待ち受けのアドレスを記録して止める。次に `--compatibility-date 2026-09-04` を付けて同じく起動し、以下を確かめる。

```bash
B=http://localhost:4190
curl -sI $B/ | tee "$S/root.txt"
# P1: content-security-policy に default-src 'self'、x-content-type-options: nosniff、
#     referrer-policy: strict-origin-when-cross-origin があり、cache-control に immutable が無い。x-robots-tag が無い
A=$(curl -s $B/ | grep -Eo '/assets/[^"]+\.js' | head -1); echo "asset=$A"
curl -sI "$B$A"
# P1: cache-control が public, max-age=31536000, immutable
echo "fallback=$(curl -s -o "$S/fallback.html" -w '%{http_code}' $B/no-such-path)"
curl -s $B/ -o "$S/root.html" && cmp "$S/root.html" "$S/fallback.html" && echo "P2 同じ本文"
# P2: 200 で、本文が / と同じ
curl -s $B/.vite/manifest.json | grep -c '"isEntry"'   # 0
# P3: 上の P1 が、絶対 URL の規則を足した _headers で通っていること自体が確かめ
for h in raintrace.pages.dev main.raintrace.pages.dev pr-1.raintrace.pages.dev raintrace.terapyon.net; do
  echo "== Host: $h"; curl -sI -H "Host: $h" $B/ | grep -i -E 'x-robots-tag|content-security-policy' || true
done
# P6（参考）: pages.dev の 3 つは x-robots-tag: noindex、terapyon.net には無い、が期待。手元で当たらなくても止めない
```

終わったら `pages dev` を止める（`TaskStop` か `kill`）。

- [ ] **Step 4: ポートが使用中のときの振る舞いを確かめる（P4）**

```bash
node -e "require('node:net').createServer().listen(4191, '127.0.0.1', () => console.log('holding 4191'))" &
HOLD=$!
cd "$S" && timeout 30 env WRANGLER_SEND_METRICS=false node $W/node_modules/wrangler/bin/wrangler.js pages dev site --port 4191 --compatibility-date 2026-09-04 --show-interactive-dev-session=false; echo "exit=$?"
kill $HOLD
```

記録すること: 失敗して終わるか（終了コードとメッセージ）、別のポートで起動するか、起動したように見えて応答しないか。どれでも Task 3 の包みが事前に検査する。

- [ ] **Step 5: 記録して、止めるかを決める**

`.handoff/D-pages-deploy.md` を作り、次の形で書く。

```markdown
# D の申し送り（gitignore。コントローラーがメインの .handoff/ に写す）

## §1 Task 1 の事実（YYYY-MM-DD、wrangler 4.127.1）

| # | 結果 | 根拠（ヘッダー・ログの抜粋） |
|---|---|---|
| P1 | 通った / 通らなかった | `content-security-policy: …` など |
| P2 | | |
| P3 | | |
| P4 | 失敗して終わる / 別のポート / … | |
| P5 | 警告のみ / 起動しない | |
| P6 | 手元で当たる / 当たらない（参考） | |

待ち受けのアドレス: …
```

P1〜P3 がすべて通れば Task 2 へ進む。**どれかが通らなければ、ここで止め、表をコントローラーに送る**（R-D3: `pages dev` が `_headers` を適用しないなら (a) に切り替えるかはユーザーの判断）。`rm -rf "$S"`。

---

### Task 2: ビルドの情報を `dist/` の外（`build-info/`）へ移す（spec D §4.5、R-D4）

plugin はまだ外さない（Task 3）。この Task の終わりでも E2E は `vite preview`（workerd）で通る。

**Files:**
- Modify: `vite.config.ts`
- Modify: `scripts/check-bundle-size.mjs:19,41-43`
- Modify: `tests/perf/fps.perf.ts:94`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: なし
- Produces: ビルドの後に `build-info/manifest.json`（Vite のマニフェスト）と `build-info/chunk-modules.json`（`{ main, workers }`）がある。`dist/.vite/` は無い。Task 3 の `distContents` と Task 7 の申し送り（06 の `tests/perf/support.ts` の読み先）がこのパスを使う

- [ ] **Step 1: いまの出力を確かめる（変更前）**

```bash
cd $W && pnpm build && ls -a dist dist/.vite && test ! -e build-info && echo "build-info なし"
```

Expected: `dist/.vite/manifest.json`・`dist/.vite/chunk-modules.json` があり、`build-info` は無い。

- [ ] **Step 2: `vite.config.ts` にプラグインを足す**

import を次にする（`cloudflare` の行はこの Task では残す）。

```ts
import { existsSync, renameSync, rmSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
```

`chunkModulesReport` の JSDoc の 1 行目を「メインと Worker の各チャンクに入ったモジュールを chunk-modules.json に書き出す（出力の後に build-info/ へ移る）。」に直す。`workerChunkModulesCollector` の後に足す:

```ts
/** ビルドの情報（Vite のマニフェストと chunk-modules.json）の置き場所。gitignore する */
const BUILD_INFO_DIR = 'build-info'

/**
 * 出力の後に dist/.vite/ を build-info/ へ移す（spec D §4.5、R-D4）。Cloudflare Pages の
 * wrangler pages deploy は dist の全ファイルを上げ、.assetsignore を読まないので、dist には配信するファイルだけを置く。
 * scripts/check-bundle-size.mjs と tests/perf/fps.perf.ts が build-info/ を読む
 */
function moveBuildInfoOutOfDist(): Plugin {
  let root = ''
  let outDir = ''
  return {
    name: 'raintrace:build-info',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = resolve(config.root, config.build.outDir)
    },
    writeBundle: {
      order: 'post',
      sequential: true,
      handler() {
        const from = resolve(outDir, '.vite')
        const to = resolve(root, BUILD_INFO_DIR)
        rmSync(to, { recursive: true, force: true })
        if (!existsSync(from)) {
          this.error(`${from} がありません（build.manifest と chunkModulesReport を確かめる）`)
        }
        renameSync(from, to)
      },
    },
  }
}
```

`plugins` を次にする:

```ts
  plugins: [react(), cloudflare(), chunkModulesReport(), moveBuildInfoOutOfDist()],
```

- [ ] **Step 3: `scripts/check-bundle-size.mjs` の読み先を直す**

19 行目の `const manifest = …` を次に置き換える（`const dist = 'dist'` は残す）:

```js
/** ビルドの情報は dist の外に置く（vite.config.ts の moveBuildInfoOutOfDist。spec D R-D4） */
const buildInfo = 'build-info'
const manifestPath = join(buildInfo, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`${manifestPath} がありません。先に pnpm build を実行してください`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
```

41〜43 行目を次にする:

```js
const reportPath = join(buildInfo, 'chunk-modules.json')
if (!existsSync(reportPath)) {
  violations.push(
    `${reportPath} がありません（vite.config.ts の chunkModulesReport と moveBuildInfoOutOfDist を確かめる）`,
  )
```

- [ ] **Step 4: `tests/perf/fps.perf.ts` の 94 行目を直す**

```ts
  const manifest = new URL('../../build-info/manifest.json', import.meta.url)
```

同じ関数の 1 つ目のエラーメッセージを `'build-info/manifest.json がありません。先に pnpm build:perf を実行してください'` にする。直前の JSDoc の「先に dist を見て区別する」を「先にビルドの情報（build-info/）を見て区別する」にする。

- [ ] **Step 5: `.gitignore` に足す**

`dist/` の次の行に:

```
# ビルドの情報（Vite のマニフェストと chunk-modules.json）。dist の外に置く（spec D R-D4）
build-info/
```

- [ ] **Step 6: ビルドとバンドルの検査を通す**

```bash
cd $W && pnpm build && ls -a dist && test ! -e dist/.vite && ls build-info && pnpm size && git status --short
```

Expected: `dist/` に `.vite` が無い（この時点では `wrangler.json`・`.assetsignore` は残る）。`build-info/` に `manifest.json`・`chunk-modules.json`。`pnpm size` が 05 と同じ表（初期ロード 427.5 KB 前後）を出して終了コード 0。`git status` に `build-info/` が出ない。

`pnpm build:perf` でも移ることを確かめ、通常のビルドに戻す:

```bash
cd $W && pnpm build:perf && grep -c perfHook build-info/manifest.json && pnpm build
```

Expected: `grep -c` が 1 以上。

- [ ] **Step 7: ゲートを通してコミットする**

```bash
cd $W && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test && pnpm run licenses
git add vite.config.ts scripts/check-bundle-size.mjs tests/perf/fps.perf.ts .gitignore
git commit -m "ビルドの情報（Vite のマニフェストと chunk-modules.json）を dist/.vite から build-info/ へ移す。Pages は dist の全ファイルを上げるため。pnpm size と fps の計測の読み先を合わせる（spec D §4.5、R-D4）"
```

E2E はこの Task では回さない（配信の仕組みは変わらず、`/.vite/` のテストは dist に無いので通る。Task 3 でまとめて回す）。

---

### Task 3: `pnpm preview` を `wrangler pages dev` に替え、`@cloudflare/vite-plugin`・`wrangler.jsonc` を外す（spec D §4.2・§4.4・§4.5・§4.6、R-D3）

**Files:**
- Create: `scripts/lib/previewArgs.mjs`、`scripts/lib/previewArgs.test.mjs`、`scripts/preview.mjs`
- Create: `scripts/lib/distContents.mjs`、`scripts/lib/distContents.test.mjs`
- Modify: `scripts/check-bundle-size.mjs`、`vite.config.ts`、`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`public/_headers`、`playwright.config.ts`、`tests/e2e/smoke.spec.ts`
- Delete: `wrangler.jsonc`、`public/.assetsignore`

**Interfaces:**
- Consumes: Task 1 の P4・P5（フラグ）、Task 2 の `build-info/`
- Produces:
  - `parsePreviewArgs(argv: string[]): { port: number }`、`DEFAULT_PREVIEW_PORT = 4173`（`scripts/lib/previewArgs.mjs`）
  - `forbiddenDistEntries(names: string[]): string[]`、`FORBIDDEN_DIST_ENTRIES: { name: string, reason: string }[]`（`scripts/lib/distContents.mjs`）
  - `pnpm preview [--port <n>] [--strictPort]` → `wrangler pages dev dist`（06 の `playwright.perf.config.ts` の `pnpm preview --port 4175 --strictPort` もそのまま動く）
  - `pnpm deploy:production:manual`

- [ ] **Step 1: 引数の読み取りの失敗するテストを書く**

`scripts/lib/previewArgs.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { DEFAULT_PREVIEW_PORT, parsePreviewArgs } from './previewArgs.mjs'

describe('parsePreviewArgs', () => {
  it('引数が無ければ既定のポート 4173', () => {
    expect(DEFAULT_PREVIEW_PORT).toBe(4173)
    expect(parsePreviewArgs([])).toEqual({ port: 4173 })
  })

  it('--port <番号> と --strictPort（E2E と 06 の計測の webServer の形）を読む', () => {
    expect(parsePreviewArgs(['--port', '4175', '--strictPort'])).toEqual({ port: 4175 })
  })

  it('--port=<番号> の形も読む', () => {
    expect(parsePreviewArgs(['--strictPort', '--port=4190'])).toEqual({ port: 4190 })
  })

  it('知らない引数は例外（打ち間違いを黙って通さない）', () => {
    expect(() => parsePreviewArgs(['--host'])).toThrow('--host')
  })

  it('ポートの値が無い・数でない・範囲の外なら例外', () => {
    expect(() => parsePreviewArgs(['--port'])).toThrow('--port')
    expect(() => parsePreviewArgs(['--port', 'abc'])).toThrow('abc')
    expect(() => parsePreviewArgs(['--port', '0'])).toThrow('0')
    expect(() => parsePreviewArgs(['--port=70000'])).toThrow('70000')
  })
})
```

- [ ] **Step 2: `dist/` の中身の判定の失敗するテストを書く**

`scripts/lib/distContents.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { FORBIDDEN_DIST_ENTRIES, forbiddenDistEntries } from './distContents.mjs'

describe('forbiddenDistEntries', () => {
  it('配信するファイルだけなら空', () => {
    expect(forbiddenDistEntries(['_headers', 'assets', 'index.html'])).toEqual([])
  })

  it('置いてはならないものを 1 つずつ、名前と理由を添えて報告する', () => {
    const names = FORBIDDEN_DIST_ENTRIES.map((entry) => entry.name)
    expect(names).toEqual(['.vite', 'wrangler.json', '.assetsignore', '404.html', '_worker.js'])
    const messages = forbiddenDistEntries(['index.html', ...names])
    expect(messages).toHaveLength(names.length)
    for (const [i, name] of names.entries()) {
      expect(messages[i]).toContain(`dist/${name}`)
    }
  })
})
```

- [ ] **Step 3: テストが落ちることを確かめる**

Run: `cd $W && pnpm exec vitest run scripts/lib/previewArgs.test.mjs scripts/lib/distContents.test.mjs`
Expected: FAIL（`previewArgs.mjs`・`distContents.mjs` が見つからない）

- [ ] **Step 4: 2 つの lib を書く**

`scripts/lib/previewArgs.mjs`:

```js
/** pnpm preview（scripts/preview.mjs）の引数の読み取り（spec D §4.6）。I/O を持たない */

/** vite preview の既定と同じ。E2E（4173）と 06 の計測（4175）は明示する */
export const DEFAULT_PREVIEW_PORT = 4173

/**
 * wrangler pages dev には --strictPort が無い。包みは常に「使用中なら失敗」なので、受けて捨てる
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ port: number }}
 */
export function parsePreviewArgs(argv) {
  let port = DEFAULT_PREVIEW_PORT
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--strictPort') continue
    let value
    if (arg === '--port') {
      i++
      value = argv[i]
    } else if (arg.startsWith('--port=')) {
      value = arg.slice('--port='.length)
    } else {
      throw new Error(`pnpm preview が知らない引数です: ${arg}（使えるのは --port <番号> と --strictPort）`)
    }
    const parsed = Number(value)
    if (value === undefined || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`--port の値が正しくありません: ${value}`)
    }
    port = parsed
  }
  return { port }
}
```

`scripts/lib/distContents.mjs`:

```js
/** dist/ に置いてはならないものの判定（spec D §4.4・§4.5）。I/O を持たない */

/**
 * wrangler pages deploy は dist の全ファイルを上げる（外すのは _headers・_redirects・_worker.js などだけ）。
 * .assetsignore も読まない。ここに挙げたものが dist の最上位にあれば pnpm size を失敗させる
 */
export const FORBIDDEN_DIST_ENTRIES = [
  { name: '.vite', reason: 'ビルドの情報は build-info/ に置く（vite.config.ts の moveBuildInfoOutOfDist、R-D4）' },
  { name: 'wrangler.json', reason: '@cloudflare/vite-plugin の出力。spec D で plugin を外した' },
  { name: '.assetsignore', reason: 'Workers の仕組みで、Pages は読まない' },
  { name: '404.html', reason: '最上位にあると Pages が SPA とみなさず、無いパスに index.html を返さなくなる' },
  { name: '_worker.js', reason: 'Pages Functions になり、_headers が効かなくなる（Functions は使わない）' },
]

/**
 * @param {string[]} names dist の最上位の名前（readdirSync('dist')）
 * @returns {string[]} 違反のメッセージ（空なら合格）
 */
export function forbiddenDistEntries(names) {
  return FORBIDDEN_DIST_ENTRIES.filter((entry) => names.includes(entry.name)).map(
    (entry) => `dist/${entry.name} があります: ${entry.reason}`,
  )
}
```

Run: `cd $W && pnpm exec vitest run scripts/lib/previewArgs.test.mjs scripts/lib/distContents.test.mjs`
Expected: PASS（7 件）

- [ ] **Step 5: `scripts/preview.mjs` を書く**

Task 1 の P5 で `--compatibility-date` を渡さないと起動しなかった場合も、渡した場合も、この形のまま（常に渡す）。P4 の結果は下のコメントの「wrangler は」の文に反映する。

```js
/**
 * pnpm preview: 本番ビルド（dist/）を wrangler pages dev（Cloudflare Pages のローカルの実装、workerd）で配信する。
 * _headers と SPA の判定を配信先と同じ製品の規則で確かめるため（spec D §4.5、R-D3）。
 * Vite の --strictPort は wrangler pages dev に無いので、受けて捨て、ポートが使用中なら起動せずに失敗する（§4.6）。
 * 使い方: pnpm preview [--port <番号>] [--strictPort]
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { parsePreviewArgs } from './lib/previewArgs.mjs'

// 固定した wrangler（4.127.1）の workerd が対応する最新の日付（wrangler.jsonc から移した）。それより新しい日付では
// 起動しない。Functions を使わないので配信の規則には影響しない。wrangler を上げるときにあわせて進める
const COMPATIBILITY_DATE = '2026-09-04'

/**
 * 使用中のポートでは失敗する（古い preview が残っていると、新しいビルドを配信していると誤解しないように。
 * playwright.config.ts の reuseExistingServer: false と同じ意図）
 * @param {number} port
 */
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', (error) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`ポート ${port} は使用中です。古い preview が残っていないか確かめてください`)
          : error,
      )
    })
    server.listen(port, () => server.close(() => resolve()))
  })
}

try {
  const { port } = parsePreviewArgs(process.argv.slice(2))
  await assertPortFree(port)
  const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
  const child = spawn(
    process.execPath,
    [
      wrangler,
      'pages',
      'dev',
      'dist',
      '--port',
      String(port),
      '--compatibility-date',
      COMPATIBILITY_DATE,
      '--show-interactive-dev-session=false',
    ],
    { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
  )
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
  child.on('exit', (code, signal) => process.exit(code ?? (signal === null ? 0 : 1)))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
```

- [ ] **Step 6: plugin と Workers の設定を外す**

```bash
cd $W && pnpm remove @cloudflare/vite-plugin
git diff --stat pnpm-lock.yaml
git diff pnpm-lock.yaml | grep -E '^\+  [^ ]' || echo "新しいパッケージの行なし"
git rm wrangler.jsonc public/.assetsignore
```

`pnpm remove` が新しい版の解決・クールダウンの承認・`allowBuilds` の追加を求めたら、承認せずに止めてコントローラーに上げる。`grep` が `+  '<name>@<version>':` の形の行（新しいパッケージのキー）を出したら、それが既存の版の peer の文脈の書き換え（例: `vite@8.2.2(@types/node@24.13.3)` の括弧の中の変化）だけかを確かめ、新しい版なら止めて上げる。

`vite.config.ts`: `import { cloudflare } from '@cloudflare/vite-plugin'` の行を消し、`plugins` を次にする:

```ts
  plugins: [react(), chunkModulesReport(), moveBuildInfoOutOfDist()],
```

`package.json` の `scripts`:

```json
    "preview": "node scripts/preview.mjs",
```

```json
    "deploy:production:manual": "pnpm build && wrangler pages deploy dist --project-name raintrace --branch production --commit-dirty=true"
```

（`deploy:production` の行を置き換える。`preview` はいまの位置のまま）

`pnpm-workspace.yaml` の `allowBuilds` の上のコメント 3 行を次にする（項目は、`pnpm install --frozen-lockfile` が求めない限り変えない）:

```yaml
  # wrangler の依存（esbuild は vite も使う）。スクリプトを実行しなくても pnpm build と
  # pnpm preview（wrangler pages dev、workerd）が動くことを実測で確認した（2026-09-10、spec D で再確認）。
  # どちらも実行ファイルをプラットフォーム別の optionalDependencies で受け取り、postinstall は主に検証を行う
```

- [ ] **Step 7: `public/_headers` に noindex の規則を足す**

ファイルの末尾に（Task 1 の Step 2 と同じ内容）:

```
# *.pages.dev は索引させない（spec D §4.2、R-D6）。1 つ目は raintrace.pages.dev（本番の deployment）、
# 2 つ目は main.・pr-<番号>.・<hash>. の別名に当たる（placeholder はピリオドを含まない）。
# 独自ドメイン raintrace.terapyon.net にはどちらも当たらず、索引される
https://:project.pages.dev/*
  X-Robots-Tag: noindex

https://:alias.:project.pages.dev/*
  X-Robots-Tag: noindex
```

- [ ] **Step 8: `pnpm size` に `dist/` の中身の検査を足す**

`scripts/check-bundle-size.mjs` の import に `import { forbiddenDistEntries } from './lib/distContents.mjs'` を足し、`const violations = [...result.violations]` の直後に:

```js
// Pages は dist の全ファイルを上げるので、配信しないものが混ざっていたら失敗する（spec D §4.5）
violations.push(...forbiddenDistEntries(readdirSync(dist)))
```

- [ ] **Step 9: `playwright.config.ts` と E2E を直す**

`playwright.config.ts` の `webServer` の上のコメント:

```ts
  // 本番ビルドを wrangler pages dev（Cloudflare Pages のローカルの実装、workerd）で配信する（spec D）。
  // pnpm preview は scripts/preview.mjs で、--strictPort を受けて捨て、使用中のポートでは失敗する。ビルドは pnpm test:e2e が先に行う
```

`tests/e2e/smoke.spec.ts` の `/.vite/` のテストのコメントを次にする（テストの中身は変えない）:

```ts
test('ビルドの情報（dist/.vite/）は配信しない', async ({ request }) => {
  // ビルドの情報は build-info/ に移すので dist に無い（spec D R-D4）。無いパスには Pages の SPA の判定で
  // index.html が返る。public/ に誤って置いたときの守りとして残す。本当の守りはデプロイの後の応答の検査
  // （scripts/check-deployed-headers.mjs）
```

その直後に 1 件足す:

```ts
test('存在しないパスを開いても地図の画面が出る（SPA のフォールバック。dist/404.html を置くと壊れる）', async ({
  page,
}) => {
  const response = await page.goto('/no-such-path')
  expect(response?.status()).toBe(200)
  await expect(page.locator(mapLoaded)).toBeAttached()
})
```

- [ ] **Step 10: ビルド・バンドル・包みの振る舞いを確かめる**

```bash
cd $W && pnpm build && ls -a dist && pnpm size && pnpm run licenses
```

Expected: `dist/` は `_headers`・`assets`・`index.html`（と `public/` にある静的ファイル）だけ。`pnpm size` が終了コード 0。

包みの確かめ（ポート 4190・4191。Bash の `run_in_background` で起動）:

```bash
cd $W && pnpm preview --port 4190 --strictPort
```

```bash
until curl -s -o /dev/null http://localhost:4190/; do sleep 1; done   # 60 秒で打ち切る
curl -sI http://localhost:4190/ | grep -i -E 'content-security-policy|cache-control|x-robots-tag'
cd $W && pnpm preview --port 4190; echo "exit=$?"     # 「ポート 4190 は使用中です」で exit=1
cd $W && pnpm preview --host; echo "exit=$?"          # 「知らない引数です: --host」で exit=1
```

起動した preview を `SIGTERM` で止め（`TaskStop` か、`pkill -TERM -f 'scripts/preview.mjs --port 4190'`）、`sleep 3; ss -ltn '( sport = :4190 )'` で何も残っていない（workerd が孤児で残らない）ことを確かめる。残ったら `.handoff/D-pages-deploy.md` に記録し、コントローラーに知らせる。

- [ ] **Step 11: ゲートと E2E を通す**

```bash
cd $W && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test
pnpm install --frozen-lockfile && git status --short   # lockfile に差分が出ないこと
```

**コントローラーに 4173 の使用の許可を得てから**:

```bash
cd $W && pnpm test:e2e
```

Expected: 全件 PASS（`smoke.spec.ts` の CSP・`Cache-Control`・`/.vite/`・新しい SPA のフォールバックを含む）。続けてもう一度 `pnpm exec playwright test --project=chromium tests/e2e/smoke.spec.ts` を回し、前回の preview が残ってポートの使用中で失敗しないことを確かめる。

失敗したら、`pages dev` と `vite preview` の違い（例: `/index.html` の拡張子の無い形へのリダイレクト、Worker のスクリプトの Content-Type）を疑い、原因を `.handoff/D-pages-deploy.md` に書いてコントローラーに上げる（テストの中身を配信に合わせて緩めない）。

- [ ] **Step 12: コミットする**

```bash
cd $W && git add -A scripts vite.config.ts package.json pnpm-lock.yaml pnpm-workspace.yaml public playwright.config.ts tests/e2e/smoke.spec.ts wrangler.jsonc
git status --short   # 意図しないファイルが無いこと
git commit -m "pnpm preview を wrangler pages dev に替え、@cloudflare/vite-plugin・wrangler.jsonc・.assetsignore を外す。preview の包みは --strictPort を受けて捨て使用中のポートで失敗する。_headers に *.pages.dev の noindex、pnpm size に dist の中身の検査、E2E に SPA のフォールバックを足し、deploy:production を deploy:production:manual に改める（spec D §4.2・§4.5〜§4.7、R-D3）"
```

---

### Task 4: デプロイの後の応答の検査（`scripts/check-deployed-headers.mjs`。spec D §5.2）

**Files:**
- Create: `scripts/lib/deployedHeaders.mjs`、`scripts/lib/deployedHeaders.test.mjs`、`scripts/check-deployed-headers.mjs`

**Interfaces:**
- Consumes: Task 3 の `pnpm preview`（手元の確かめ）
- Produces:
  - `findAssetScript(html: string): string | undefined`
  - `evaluateDeployment(responses: { root: Fetched, asset: Fetched | undefined, buildInfo: Fetched, fallback: Fetched }, expected: { noindex: boolean }): string[]`（`Fetched = { status: number, headers: Record<string, string>, body: string }`、ヘッダー名は小文字）
  - CLI: `node scripts/check-deployed-headers.mjs <URL> --noindex | --indexable`（合格で 0、違反で 1、使い方の誤りで 2）。Task 5 の CI が呼ぶ

- [ ] **Step 1: 失敗するテストを書く**

`scripts/lib/deployedHeaders.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { evaluateDeployment, findAssetScript } from './deployedHeaders.mjs'

const html =
  '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc.js"></script>' +
  '<link rel="modulepreload" crossorigin href="/assets/ui-def.js"></head><body><div id="root"></div></body></html>'

/** spec D §5.2 をすべて満たす、索引される（独自ドメインの）応答 */
function passing() {
  return {
    root: {
      status: 200,
      headers: {
        'content-security-policy': "default-src 'self'; script-src 'self'",
        'x-content-type-options': 'nosniff',
        'cache-control': 'public, max-age=0, must-revalidate',
      },
      body: html,
    },
    asset: { status: 200, headers: { 'cache-control': 'public, max-age=31536000, immutable' }, body: '' },
    buildInfo: { status: 200, headers: {}, body: html },
    fallback: { status: 200, headers: {}, body: html },
  }
}

describe('findAssetScript', () => {
  it('index.html の最初の /assets/*.js の script を返す', () => {
    expect(findAssetScript(html)).toBe('/assets/index-abc.js')
  })

  it('無ければ undefined', () => {
    expect(findAssetScript('<html><body></body></html>')).toBeUndefined()
  })
})

describe('evaluateDeployment', () => {
  it('すべて満たせば違反なし（索引される）', () => {
    expect(evaluateDeployment(passing(), { noindex: false })).toEqual([])
  })

  it('*.pages.dev で x-robots-tag: noindex があれば違反なし', () => {
    const responses = passing()
    responses.root.headers['x-robots-tag'] = 'noindex'
    expect(evaluateDeployment(responses, { noindex: true })).toEqual([])
  })

  it('noindex を期待して x-robots-tag が無ければ違反', () => {
    const violations = evaluateDeployment(passing(), { noindex: true })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('x-robots-tag')
  })

  it('索引されるべきなのに noindex が付いていれば違反', () => {
    const responses = passing()
    responses.root.headers['x-robots-tag'] = 'noindex'
    const violations = evaluateDeployment(responses, { noindex: false })
    expect(violations).toHaveLength(1)
    expect(violations[0]).toContain('noindex')
  })

  it('/ が 200 でなければ違反', () => {
    const responses = passing()
    responses.root.status = 500
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('500')
  })

  it('CSP・nosniff が無ければそれぞれ違反', () => {
    const responses = passing()
    delete responses.root.headers['content-security-policy']
    delete responses.root.headers['x-content-type-options']
    const violations = evaluateDeployment(responses, { noindex: false })
    expect(violations).toHaveLength(2)
    expect(violations.join('\n')).toContain('content-security-policy')
    expect(violations.join('\n')).toContain('x-content-type-options')
  })

  it('/ の cache-control に immutable があれば違反（RB-1）', () => {
    const responses = passing()
    responses.root.headers['cache-control'] = 'public, max-age=31536000, immutable'
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('immutable')
  })

  it('/assets/*.js が長期キャッシュでなければ違反', () => {
    const responses = passing()
    responses.asset.headers['cache-control'] = 'public, max-age=0, must-revalidate'
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('/assets/')
  })

  it('/assets/*.js の script が見つからなければ違反', () => {
    const responses = passing()
    responses.asset = undefined
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('/assets/')
  })

  it('/.vite/manifest.json がビルドの情報を返せば違反', () => {
    const responses = passing()
    responses.buildInfo.body = '{"index.html":{"file":"assets/index-abc.js","isEntry":true}}'
    expect(evaluateDeployment(responses, { noindex: false }).join('\n')).toContain('/.vite/')
  })

  it('無いパスが 200 で / と同じ本文でなければ違反（SPA のフォールバック）', () => {
    const notFound = passing()
    notFound.fallback = { status: 404, headers: {}, body: 'Not Found' }
    expect(evaluateDeployment(notFound, { noindex: false }).join('\n')).toContain('/no-such-path')
    const otherBody = passing()
    otherBody.fallback.body = '<html>404</html>'
    expect(evaluateDeployment(otherBody, { noindex: false }).join('\n')).toContain('/no-such-path')
  })
})
```

- [ ] **Step 2: テストが落ちることを確かめる**

Run: `cd $W && pnpm exec vitest run scripts/lib/deployedHeaders.test.mjs`
Expected: FAIL（`deployedHeaders.mjs` が見つからない）

- [ ] **Step 3: 判定を書く**

`scripts/lib/deployedHeaders.mjs`:

```js
/** デプロイした URL の応答の判定（spec D §5.2）。E2E の smoke.spec.ts の 3 件と同じ内容を本物の応答で確かめる。I/O を持たない */

/**
 * @typedef {{ status: number, headers: Record<string, string>, body: string }} Fetched
 * headers の名前は小文字（fetch の Headers から Object.fromEntries で作る）
 */

/** 無いパスの例。SPA のフォールバックの確かめに使う */
export const MISSING_PATH = '/no-such-path'

/**
 * index.html が読む /assets/*.js の最初の script のパス
 * @param {string} html
 * @returns {string | undefined}
 */
export function findAssetScript(html) {
  return html.match(/<script\b[^>]*\ssrc="(\/assets\/[^"]+\.js)"/)?.[1]
}

/**
 * @param {{ root: Fetched, asset: Fetched | undefined, buildInfo: Fetched, fallback: Fetched }} responses
 *   root は /、asset は findAssetScript のパス、buildInfo は /.vite/manifest.json、fallback は MISSING_PATH
 * @param {{ noindex: boolean }} expected *.pages.dev なら noindex: true、独自ドメインなら false（R-D6）
 * @returns {string[]} 違反（空なら合格）
 */
export function evaluateDeployment(responses, expected) {
  const { root, asset, buildInfo, fallback } = responses
  const violations = []

  if (root.status !== 200) violations.push(`/ の status が ${root.status}（200 を期待）`)
  if (!(root.headers['content-security-policy'] ?? '').includes("default-src 'self'")) {
    violations.push("/ の content-security-policy に default-src 'self' が無い（_headers）")
  }
  if (root.headers['x-content-type-options'] !== 'nosniff') {
    violations.push('/ の x-content-type-options が nosniff でない（_headers）')
  }
  if ((root.headers['cache-control'] ?? '').includes('immutable')) {
    violations.push('/ の cache-control に immutable がある（index.html は毎回検証させる。RB-1）')
  }

  if (asset === undefined) {
    violations.push('index.html に /assets/*.js の script が見つからない')
  } else {
    const cacheControl = asset.headers['cache-control'] ?? ''
    if (asset.status !== 200 || !cacheControl.includes('max-age=31536000') || !cacheControl.includes('immutable')) {
      violations.push(
        `/assets/*.js が長期キャッシュでない（status ${asset.status}、cache-control: ${cacheControl}。RB-1）`,
      )
    }
  }

  if (buildInfo.body.includes('"isEntry"')) {
    violations.push('/.vite/manifest.json がビルドの情報を配信している（R-D4）')
  }

  if (fallback.status !== 200 || fallback.body !== root.body) {
    violations.push(
      `${MISSING_PATH} が index.html を返さない（status ${fallback.status}。SPA のフォールバック。dist/404.html を疑う）`,
    )
  }

  const robots = root.headers['x-robots-tag'] ?? ''
  if (expected.noindex && !robots.includes('noindex')) {
    violations.push('/ の x-robots-tag に noindex が無い（*.pages.dev は索引させない。R-D6）')
  }
  if (!expected.noindex && robots.includes('noindex')) {
    violations.push(`/ に noindex が付いている（x-robots-tag: ${robots}。独自ドメインは索引させる。R-D6）`)
  }

  return violations
}
```

Run: `cd $W && pnpm exec vitest run scripts/lib/deployedHeaders.test.mjs`
Expected: PASS（13 件）

- [ ] **Step 4: CLI を書く**

`scripts/check-deployed-headers.mjs`:

```js
/**
 * デプロイした URL の応答を検査する（spec D §5.2）。依存なし（fetch のみ）。CI の deploy の 3 ジョブの最後に回す。
 * 使い方: node scripts/check-deployed-headers.mjs <URL> --noindex | --indexable
 *   --noindex: *.pages.dev（x-robots-tag: noindex を期待）、--indexable: 独自ドメイン（noindex が無いことを期待）
 * 反映の遅れに備え、5 秒おきに 6 回まで試す。/ の応答ヘッダーをすべて出す（Pages の既定のヘッダーの記録）
 */
import { setTimeout as sleep } from 'node:timers/promises'
import { evaluateDeployment, findAssetScript, MISSING_PATH } from './lib/deployedHeaders.mjs'

const ATTEMPTS = 6
const INTERVAL_MS = 5000
const USAGE = '使い方: node scripts/check-deployed-headers.mjs <URL> --noindex | --indexable'

const [base, flag, ...rest] = process.argv.slice(2)
if (base === undefined || (flag !== '--noindex' && flag !== '--indexable') || rest.length > 0) {
  console.error(USAGE)
  process.exit(2)
}
const expected = { noindex: flag === '--noindex' }

/**
 * リダイレクトは追わない（予期しないリダイレクトを 200 でないとして検出する）
 * @param {string} path
 */
async function get(path) {
  const response = await fetch(new URL(path, base), {
    redirect: 'manual',
    headers: { 'cache-control': 'no-cache' },
  })
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: await response.text(),
  }
}

let violations = []
let rootHeaders = {}
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  try {
    const root = await get('/')
    rootHeaders = root.headers
    const assetPath = findAssetScript(root.body)
    violations = evaluateDeployment(
      {
        root,
        asset: assetPath === undefined ? undefined : await get(assetPath),
        buildInfo: await get('/.vite/manifest.json'),
        fallback: await get(MISSING_PATH),
      },
      expected,
    )
  } catch (error) {
    violations = [`取得に失敗した: ${error instanceof Error ? error.message : error}`]
  }
  if (violations.length === 0) break
  console.log(`試行 ${attempt}/${ATTEMPTS}: 違反 ${violations.length} 件`)
  if (attempt < ATTEMPTS) await sleep(INTERVAL_MS)
}

console.log(`${base} の / の応答ヘッダー:`)
for (const [name, value] of Object.entries(rootHeaders).sort(([a], [b]) => a.localeCompare(b))) {
  console.log(`  ${name}: ${value}`)
}
if (violations.length > 0) {
  for (const message of violations) console.error(message)
  process.exit(1)
}
console.log(`OK: ${base}（${expected.noindex ? 'noindex' : '索引される'}）`)
```

Biome がループの中の `await` を指摘したら（`noAwaitInLoops`）、再試行は順に行う必要があるので、その行に `// biome-ignore lint/performance/noAwaitInLoops: 再試行は順に待つ` を付ける。

- [ ] **Step 5: 手元の `pages dev` に当てて確かめる**

```bash
cd $W && pnpm build
```

`run_in_background` で `cd $W && pnpm preview --port 4190` を起動し、応答を待ってから:

```bash
cd $W && node scripts/check-deployed-headers.mjs http://localhost:4190 --indexable; echo "exit=$?"
```

Expected: ヘッダーの一覧と `OK: http://localhost:4190（索引される）`、`exit=0`（手元の `localhost` には noindex の規則が当たらない）。

```bash
cd $W && node scripts/check-deployed-headers.mjs http://localhost:4190 --noindex; echo "exit=$?"
```

Expected: 6 回試して（約 25 秒）`x-robots-tag に noindex が無い` の 1 件、`exit=1`。

```bash
cd $W && node scripts/check-deployed-headers.mjs http://localhost:4190; echo "exit=$?"   # 使い方、exit=2
```

preview を止め、ポートが空いたことを確かめる。

- [ ] **Step 6: ゲートを通してコミットする**

```bash
cd $W && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test
git add scripts/lib/deployedHeaders.mjs scripts/lib/deployedHeaders.test.mjs scripts/check-deployed-headers.mjs
git commit -m "デプロイした URL の応答の検査を足す: CSP・nosniff・/ と /assets/* の Cache-Control・/.vite/ を配信しないこと・SPA のフォールバック・*.pages.dev の noindex と独自ドメインの索引を、5 秒おきに 6 回まで確かめる。判定は純粋な関数に分けて単体テストを持たせる（spec D §5.2）"
```

---

### Task 5: CI の deploy の 3 ジョブを Pages に書き換える（spec D §4.2・§4.7・§5.2）

**Files:**
- Modify: `.github/workflows/ci.yml`（最上位の `env` を足し、`deploy-preview`・`deploy-staging`・`deploy-production` を置き換える。`quality`・`test`・`build`・`e2e`・`audit` は変えない）

**Interfaces:**
- Consumes: Task 3 の `pnpm build`（`dist/` は配信するものだけ）、Task 4 の CLI
- Produces: ジョブ `deploy-preview`・`deploy-main`・`deploy-production`。リポジトリの変数 `PRODUCTION_URL`（任意、U8 でユーザーが登録）。Secrets の名前は変えない

- [ ] **Step 1: 最上位の `env` を足す**

`defaults:` のブロックの後、`concurrency:` の前に:

```yaml
env:
  # Cloudflare Pages の project（spec D §4.1）と、その既定の URL のホスト。作成時に接尾辞が付いたら PAGES_HOST だけを直す
  PAGES_PROJECT: raintrace
  PAGES_HOST: raintrace.pages.dev
  WRANGLER_SEND_METRICS: false
```

（U1 で知らされた URL が `raintrace.pages.dev` と違えば、`PAGES_HOST` をその値にする）

- [ ] **Step 2: deploy の 3 ジョブを置き換える**

`deploy-preview:` から末尾までを、次に置き換える:

```yaml
  deploy-preview:
    # 同じリポジトリのブランチからの PR のみ（フォークには Secrets が渡らない）。
    # Pages の project のプレビューの deployment（ブランチ pr-<番号>）に上げ、本番（production）には触れない
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      # 別名は pr-<番号>.<PAGES_HOST>。PR ごとに一意で、ブランチ名に依存しない（英小文字・数字・ハイフンのまま残る）
      PAGES_BRANCH: pr-${{ github.event.pull_request.number }}
      PR_NUMBER: ${{ github.event.pull_request.number }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - run: pnpm build
      - name: プレビューに上げる
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        # dist は Git の管理外なので --commit-dirty=true（付けないと警告）。GITHUB_SHA は PR のマージコミット（表示用）
        run: |
          if [ "$PAGES_BRANCH" = production ]; then
            echo "::error::プレビューのジョブが本番（production）に上げようとした（spec D §4.7）"
            exit 1
          fi
          pnpm exec wrangler pages deploy dist --project-name "$PAGES_PROJECT" --branch "$PAGES_BRANCH" \
            --commit-hash "$GITHUB_SHA" --commit-message "PR #${PR_NUMBER} ${GITHUB_SHA::7}" --commit-dirty=true | tee deploy.log
          {
            echo "### プレビュー"
            grep -Eo 'https://[^ ]+\.pages\.dev' deploy.log | sort -u | sed 's/^/- /' || true
          } >> "$GITHUB_STEP_SUMMARY"
      - name: 応答を検査する
        run: node scripts/check-deployed-headers.mjs "https://${PAGES_BRANCH}.${PAGES_HOST}" --noindex

  deploy-main:
    # main への push。Pages のプレビューの別名 main.<PAGES_HOST>（独自ドメインなし、noindex）。必須ジョブの成功が前提。
    # ステージングの環境は置かない（spec D R-D1）
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    needs: [quality, test, build, e2e]
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      PAGES_BRANCH: main
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - run: pnpm build
      - name: main の別名に上げる
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          if [ "$PAGES_BRANCH" = production ]; then
            echo "::error::main のジョブが本番（production）に上げようとした（spec D §4.7）"
            exit 1
          fi
          pnpm exec wrangler pages deploy dist --project-name "$PAGES_PROJECT" --branch "$PAGES_BRANCH" \
            --commit-hash "$GITHUB_SHA" --commit-dirty=true | tee deploy.log
          {
            echo "### main"
            grep -Eo 'https://[^ ]+\.pages\.dev' deploy.log | sort -u | sed 's/^/- /' || true
          } >> "$GITHUB_STEP_SUMMARY"
      - name: 応答を検査する
        run: node scripts/check-deployed-headers.mjs "https://${PAGES_BRANCH}.${PAGES_HOST}" --noindex

  deploy-production:
    # タグ付きリリース（R01-3、spec D §4.2）。タグの push でも必須ジョブが回り、その成功が前提
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
    needs: [quality, test, build, e2e]
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    environment: production
    env:
      # ブランチ名 production を書くのはここだけ（spec D §4.7）。Pages の project の production branch と同じ名前
      PAGES_BRANCH: production
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: ./.github/actions/setup
      - run: pnpm build
      - name: 本番に上げる
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          pnpm exec wrangler pages deploy dist --project-name "$PAGES_PROJECT" --branch "$PAGES_BRANCH" \
            --commit-hash "$GITHUB_SHA" --commit-message "$GITHUB_REF_NAME" --commit-dirty=true | tee deploy.log
          {
            echo "### 本番"
            grep -Eo 'https://[^ ]+\.pages\.dev' deploy.log | sort -u | sed 's/^/- /' || true
          } >> "$GITHUB_STEP_SUMMARY"
      - name: 応答を検査する（pages.dev）
        run: node scripts/check-deployed-headers.mjs "https://${PAGES_HOST}" --noindex
      - name: 応答を検査する（独自ドメイン）
        # 独自ドメインが Active になった後に、ユーザーがリポジトリの変数 PRODUCTION_URL に
        # https://raintrace.terapyon.net を登録する（spec D §5.1 の手順 7）。未登録ならこの検査を飛ばす
        if: vars.PRODUCTION_URL != ''
        env:
          PRODUCTION_URL: ${{ vars.PRODUCTION_URL }}
        run: node scripts/check-deployed-headers.mjs "$PRODUCTION_URL" --indexable
```

- [ ] **Step 3: ワークフローを機械的に確かめる**

actionlint は入れない（依存を足さない）。YAML としての正しさと、本番の守りを確かめる（コミットしない一時の検査）:

```bash
cd $W && python3 - <<'EOF'
import re, yaml
text = open('.github/workflows/ci.yml').read()
wf = yaml.safe_load(text)
jobs = wf['jobs']
assert set(jobs) == {'quality', 'test', 'build', 'e2e', 'audit', 'deploy-preview', 'deploy-main', 'deploy-production'}, sorted(jobs)
assert wf['env'] == {'PAGES_PROJECT': 'raintrace', 'PAGES_HOST': 'raintrace.pages.dev', 'WRANGLER_SEND_METRICS': False}, wf['env']
assert jobs['deploy-preview']['env']['PAGES_BRANCH'].startswith('pr-')
assert jobs['deploy-main']['env']['PAGES_BRANCH'] == 'main'
assert jobs['deploy-production']['env']['PAGES_BRANCH'] == 'production'
assert 'environment' not in jobs['deploy-main'] and jobs['deploy-production']['environment'] == 'production'
assert jobs['deploy-main']['needs'] == jobs['deploy-production']['needs'] == ['quality', 'test', 'build', 'e2e']
for bad in ['CLOUDFLARE_ENV', 'wrangler deploy', 'versions upload', 'workers.dev', 'wrangler-action']:
    assert bad not in text, bad
deploys = re.findall(r'wrangler pages deploy[^\n]*\n[^\n]*', text)
assert len(deploys) == 3, deploys
for d in deploys:
    assert '--branch "$PAGES_BRANCH"' in d and '--commit-dirty=true' in d and '--project-name "$PAGES_PROJECT"' in d, d
lines = [l for l in text.splitlines() if 'production' in l]
print('\n'.join(lines))
print('OK')
EOF
```

Expected: `OK`。表示された `production` を含む行が、`deploy-production:`・コメント・`environment: production`・`PAGES_BRANCH: production`・2 つの守りの `if`/`echo` の行だけであることを目で確かめる。

```bash
cd $W && git grep -n -- '--branch production' -- ':!docs' ':!specs'
```

Expected: `package.json` の `deploy:production:manual` の 1 行だけ。

- [ ] **Step 4: ゲートを通してコミットする**

```bash
cd $W && pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test
git add .github/workflows/ci.yml
git commit -m "CI のデプロイを Cloudflare Pages に移す: PR は pr-<番号>、main への push は main の別名（deploy-staging を deploy-main に改め environment staging を外す）、v* のタグは production。ブランチ名はジョブの env の PAGES_BRANCH で組み立て、プレビューと main のジョブでは production を拒む。上げた後に応答を検査し、独自ドメインは vars.PRODUCTION_URL があるときだけ検査する（spec D §4.2・§4.7・§5.2）"
```

この Task の後、コントローラーは U3（手元からの試しのデプロイ）をユーザーに渡してよい（U1・U2 が済んでいれば）。

---

### Task 6: 記録の更新（tech-spec・overview・spec 01・README。spec D §8、R-D8）

**Files:**
- Modify: `specs/tech-spec.md`、`docs/superpowers/specs/2026-09-10-00-overview.md`、`docs/superpowers/specs/2026-09-10-01-foundation-design.md`、`README.md`

**Interfaces:**
- Consumes: Task 1〜5 の結果（`scripts/preview.mjs`・`deploy:production:manual`・ジョブ名・`build-info/`）
- Produces: 文書だけ

各置き換えは `Edit` で行う（該当の文が見つからなければ、近くの文を読んで同じ意味の箇所を直し、報告に書く）。

- [ ] **Step 1: tech-spec §1・§1.1**

§1 の表:
- `| ビルド | Vite | \`@cloudflare/vite-plugin\` 併用 |` → `| ビルド | Vite | ビルドの情報は \`build-info/\`（配信する \`dist/\` の外。実装 spec D） |`
- `| ホスティング | Cloudflare Workers (Static Assets) | §3 |` → `| ホスティング | Cloudflare Pages（Direct Upload） | §3 |`

§1.1 の表の `| Cloudflare Pages | Cloudflare は新規プロジェクトについて Workers Static Assets を推奨方針としている |` を次にする:

```markdown
| Cloudflare Workers（Static Assets） | 独自ドメインを付ける方法（Custom Domains・Routes）がどちらも Cloudflare 上の有効なゾーンを要し、DNS を外部（value-domain.com）に置いたままでは付けられない。01〜05 は Workers で配信し、実装 spec D（2026-09-17）で Pages に移した |
```

- [ ] **Step 2: tech-spec §3.1・§3.2・§3.4**

§3.1 の本文とコードブロックを次にする:

````markdown
Vite でビルドした React SPA を、**Cloudflare Pages**（Direct Upload。CI から `wrangler pages deploy` で上げる）で配信する。手元の `pnpm preview` は `wrangler pages dev`（Pages のローカルの実装、workerd）で `dist/` を配信し、E2E はこれに対して回す（実装 spec D、2026-09-17。01〜05 は `@cloudflare/vite-plugin` 経由の Workers の Static Assets だった）。

```
src/              React SPA（クライアントのみ）
public/_headers   レスポンスヘッダ（§7.7）
scripts/preview.mjs  pnpm preview（wrangler pages dev dist）
dist/             ビルド成果物。配信するファイルだけを置く（Pages はディレクトリの全ファイルを上げる）
build-info/       ビルドの情報（Vite のマニフェスト・チャンクのモジュール一覧。gitignore）
```
````

§3.2 の 2 つ目の箇条を次にする:

```markdown
- 将来バックエンドが必要になった場合は、その時点で Pages Functions か別の Worker を選ぶ。基本仕様の「バックエンドが必要になったらその時に選定する」方針と整合する
- 独自ドメイン（サブドメイン）を外部 DNS の CNAME で付けられる。Workers はゾーンを Cloudflare に置く必要がある（実装 spec D §3.2）
```

§3.4 の表と次の段落を次にする:

```markdown
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
```

- [ ] **Step 3: tech-spec §4.1・§7.3・§7.7・§12.3・§13.3・§18・§19**

- §4.1 の構成図: `  worker/                 Cloudflare Worker（初期は静的配信のみ。src/workers/ の Web Worker とは別物）` の行を消す。`  wrangler.jsonc` の行を消す。`playwright.perf.config.ts` の行の後に `  scripts/preview.mjs     pnpm preview（wrangler pages dev。実装 spec D）` を足す（`scripts/` の行が既にあればその下に）
- §7.3（633 行目付近）: `Cloudflare Workers の Static Assets は \`_headers\` ファイルで` → `Cloudflare Pages は \`_headers\` ファイルで`
- §7.7 の 1 行目: `Cloudflare の Static Assets の \`_headers\` で、CSP などのレスポンスヘッダを付ける（2026-09-10 裁定）。` → `Cloudflare Pages の \`_headers\` で、CSP などのレスポンスヘッダを付ける（2026-09-10 裁定。配信先は実装 spec D で Workers の Static Assets から Pages に移した）。`
- §7.7 の `- 具体的なポリシーと、\`vite preview\` での扱いは実装 spec 01 §4.8 で定める` → `- 具体的なポリシーは実装 spec 01 §4.8 で定める。手元では \`pnpm preview\`（\`wrangler pages dev\`）が同じ \`_headers\` を適用し、E2E で確かめる（実装 spec D §4.5）`
- §7.7 の末尾に箇条を足す: `- \`*.pages.dev\`（本番の \`raintrace.pages.dev\` と、\`main.\`・\`pr-<番号>.\` などの別名）には \`X-Robots-Tag: noindex\` を付ける。独自ドメインには付けない（実装 spec D R-D6）`
- §12.3 の表の `deploy` の行: `| \`deploy-preview\`・\`deploy-main\`・\`deploy-production\` | PR で \`pr-<番号>.raintrace.pages.dev\`、\`main\` への push で \`main.raintrace.pages.dev\`、\`v*\` のタグの push で本番（§3.4）。\`main\` と本番は必須ジョブの成功が前提。上げた後に応答を検査する（\`scripts/check-deployed-headers.mjs\`） |`
- §12.3 の `build` の行: `| \`build\` | \`vite build\` + バンドルサイズ検査（§14.2）。\`dist/\` に配信しないもの（\`.vite\`・\`404.html\` など）が無いことも検査する |`
- §13.3（1108 行目付近）: `wrangler と vite の依存の esbuild と workerd も \`false\` で明記している（スクリプトを実行しなくても build と preview が動くことを、実装 spec 01 で確認した）。` → `wrangler の依存の esbuild と workerd（esbuild は vite も使う）も \`false\` で明記している（スクリプトを実行しなくても build と preview〈\`wrangler pages dev\`〉が動くことを、実装 spec 01 と D で確認した）。`
- §18 の 1: `1. **Vite + React SPA を Cloudflare Pages（Direct Upload）で配信**する。バックエンドは持たない（§3、§7.1）`
- §19 の `| §51 ホスティング候補 | §3 | Cloudflare Workers（Static Assets） |` → `| §51 ホスティング候補 | §3 | Cloudflare Pages（Direct Upload。01〜05 は Workers の Static Assets、実装 spec D で移行） |`

確かめ:

```bash
cd $W && grep -n -E 'vite-plugin|wrangler\.jsonc|Static Assets|ステージング|raintrace-staging|workers\.dev' specs/tech-spec.md
```

Expected: 残るのは、移行の経緯として書いた §1.1・§3.1・§7.7・§19 の文だけ（§14 に該当があれば 06 の範囲なので触れず、報告に書く）。

- [ ] **Step 4: overview**

`docs/superpowers/specs/2026-09-10-00-overview.md` §6:

- R01-3 の行の裁定の欄の末尾に足す: `。**変更（2026-09-17、spec D R-D1）**: ステージングを廃止。PR → \`pr-<番号>.raintrace.pages.dev\`、\`main\` への push → Pages のプレビューの別名 \`main.raintrace.pages.dev\`、\`v*\` のタグ → 本番 \`raintrace.terapyon.net\``
- R01-8 の行の裁定の欄の末尾に足す: `。**spec D で外した**（\`pnpm preview\` を \`wrangler pages dev\` に替えた、2026-09-17、R-D3）`
- 表の末尾（RB-1 の行の直後）に 9 行を足す:

```markdown
| R-D1 | ステージングの表し方（spec D） | project を 2 つ（本番とステージング） | — | 変更（2026-09-17）: ステージングを置かない。project は `raintrace` の 1 つ。PR → `pr-<n>`、`main` → `main.raintrace.pages.dev`（noindex）、`v*` → 本番（`raintrace.terapyon.net`）。R01-3 の変更 |
| R-D2 | ステージングに独自ドメインを付けるか | 付けない | — | 不要（R-D1 でステージングを置かないため）（2026-09-17） |
| R-D3 | E2E のヘッダーの検査の方式 | `@cloudflare/vite-plugin` と `wrangler.jsonc` を外し、`pnpm preview` を `wrangler pages dev dist` にする。デプロイの後に本物の応答を検査する | — | 承認（2026-09-17）。R01-8 を覆す |
| R-D4 | `dist/.vite/` の置き場所 | ビルドの後に `build-info/` へ移す | — | 承認（2026-09-17） |
| R-D5 | 旧 Workers を消す時期 | 01〜05 と D のマージの後、本番と独自ドメインで検査が通った後 | — | 承認（2026-09-17）: 対象は `raintrace`・`raintrace-staging` |
| R-D6 | `workers.dev`・`pages.dev` の URL | `workers.dev` は Worker ごと消す。`*.pages.dev` は `_headers` で noindex | — | 承認（2026-09-17）: 独自ドメインは索引されるまま |
| R-D7 | spec D の実装をどこに積むか | 05 の上に積み、05 の直後・06 より前にマージ。06 は M3 か M4 の後に D の上へリベース | — | 承認（2026-09-17） |
| R-D8 | 記録の更新 | tech-spec・overview の R01-3・R01-8 を実装の中で改める | — | 承認（2026-09-17） |
| R-D9 | environment `production` に承認者を必須にするか | 推奨しない（ユーザーの判断。材料は spec D §4.7） | レビュー役が論点として追加（2026-09-17） | 未裁定 |
```

§7 の表の T14 の行の後に:

```markdown
| T15 | §1、§1.1、§3.1〜§3.4、§4.1、§7.3、§7.7、§12.3、§13.3、§18、§19 | 配信を Cloudflare Pages（Direct Upload、project 1 つ）に移し、ステージングを廃止する。`@cloudflare/vite-plugin` と `wrangler.jsonc` を外し、ビルドの情報を `build-info/` に置く | spec D（R-D1・R-D3・R-D4・R-D8） |
```

表の直後の段落の末尾に 1 文を足す: `T15 は spec D のブランチ（2026-09-17）で反映した。`

§3 の D の行の「裁定は spec D §9（R-D1〜R-D8）」を「裁定は spec D §9（R-D1〜R-D8。R-D9 は未裁定）」にする。

- [ ] **Step 5: spec 01 と README**

`docs/superpowers/specs/2026-09-10-01-foundation-design.md` の冒頭の `- Status: …` の行の直後に:

```markdown
- 追記（2026-09-17）: デプロイは spec D で Cloudflare Pages に移した（ステージングを廃止し、`@cloudflare/vite-plugin` と `wrangler.jsonc` を外した）。本文は当時の設計の記録として書き換えない
```

`README.md` のコマンドの表:
- `pnpm preview` の行: `| \`pnpm preview\` | 本番ビルドの配信（\`wrangler pages dev\`。Cloudflare Pages のローカルの実装。\`--port <番号>\` で変える） |`
- `pnpm size` の行: `| \`pnpm size\` | バンドル予算と \`dist/\` の中身の検査（\`pnpm build\` の後。ビルドの情報は \`build-info/\`） |`
- `pnpm deploy:production` の行を次にする: `| \`pnpm deploy:production:manual\` | CI が使えないときの緊急用に、手元から本番へ出す（\`wrangler login\` が要る）。通常のリリースは \`v*\` のタグの push（\`pnpm deploy\` は pnpm の組み込みのコマンドと同名なので避けた） |`

表の後、「## 出典」の前に:

```markdown
## 配信

Cloudflare Pages（Direct Upload）で配信します。デプロイは GitHub Actions が行います（[spec D](docs/superpowers/specs/2026-09-17-D-pages-deploy-design.md)）。

| 段 | トリガ | URL |
|---|---|---|
| プレビュー | Pull Request | `https://pr-<番号>.raintrace.pages.dev/` |
| `main` | `main` への push | `https://main.raintrace.pages.dev/` |
| 本番 | `v*` のタグの push | `https://raintrace.terapyon.net/` |
```

- [ ] **Step 6: 残りを確かめてコミットする**

```bash
cd $W && git grep -n -E 'vite-plugin|wrangler\.jsonc|CLOUDFLARE_ENV|raintrace-staging|workers\.dev|dist/\.vite|deploy:production\b[^:]|assetsignore' -- ':!docs/superpowers/specs/2026-09-10-01-foundation-design.md' ':!docs/superpowers/specs/2026-09-10-0[2-6]*' ':!docs/superpowers/specs/2026-09-17-D-pages-deploy-design.md' ':!docs/superpowers/plans' ':!docs/superpowers/spikes'
```

Expected: 残るのは、経緯として書いた tech-spec・overview の文、`scripts/lib/distContents.mjs` の理由の文、`smoke.spec.ts` のテスト名（`dist/.vite/`）とコメントだけ。それ以外が出たら直す。

```bash
cd $W && pnpm format && pnpm lint
git add specs/tech-spec.md docs/superpowers/specs/2026-09-10-00-overview.md docs/superpowers/specs/2026-09-10-01-foundation-design.md README.md
git commit -m "配信先の変更を記録に反映する: tech-spec の §1・§3・§4.1・§7.3・§7.7・§12.3・§13.3・§18・§19 を Pages とステージングの廃止に、overview の R01-3・R01-8 に追記し R-D1〜R-D9（R-D9 は未裁定）と T15 を足す。spec 01 の Status に 1 行、README に preview・deploy:production:manual・配信先（spec D §8、R-D8）"
```

---

### Task 7: 全体の確かめ・試しのデプロイの結果・申し送り（spec D §5.1・§6・§7）

**Files:**
- Modify: `.handoff/D-pages-deploy.md`（gitignore）
- Modify（U3 の結果しだい）: `.github/workflows/ci.yml`、`scripts/check-deployed-headers.mjs`、`scripts/lib/deployedHeaders.mjs`（`.test.mjs`）

**Interfaces:**
- Consumes: Task 1〜6、U1・U3 の結果
- Produces: PR の本文、ユーザーに渡す手作業の文面（U4〜U9）、06 への申し送り

- [ ] **Step 1: 全体のゲート**

```bash
cd $W && git status --short   # 空
pnpm install --frozen-lockfile && git status --short   # 空のまま
pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage
pnpm build && ls -a dist && test ! -e dist/.vite && test ! -e dist/wrangler.json && test ! -e dist/.assetsignore && pnpm size && pnpm run licenses
```

**コントローラーの許可の後に** `pnpm test:e2e`。結果（件数、WebKit を回したか）を記録する。

- [ ] **Step 2: U3（試しのデプロイ）の結果を取り込む**

U3 の結果が届いていれば、`.handoff/D-pages-deploy.md` の「§2 試しのデプロイ」に、wrangler の出力（URL の行）、検査のヘッダーの一覧（Pages の既定のヘッダー。spec §4.4 の未確認）、`x-robots-tag` の有無を書く。

- 出力に `https://…pages.dev` の URL が無い・形が違う → ジョブのサマリの `grep -Eo` を実際の形に合わせて直す
- 検査が落ちた → 原因が配信の規則の違い（例: `/no-such-path` のリダイレクト、ヘッダーの重複でカンマ区切り）なら判定を直し、`deployedHeaders.test.mjs` にその形のテストを足す。`_headers` の規則が当たっていない（noindex が無い・CSP が無い）なら、直さずにコントローラーに上げる（spec の方式に関わる）
- U1 の URL に接尾辞が付いていた → `ci.yml` の `PAGES_HOST` と、README・tech-spec §3.4 の URL を直す

直したら、Task のゲート（`pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test`）を通し、1 コミット:

```bash
cd $W && git commit -am "手元からの試しのデプロイ（d-trial）の結果に合わせて、<直したこと> を直す（spec D §5.1 の手順 3）"
```

直すものが無ければコミットしない。U3 がまだ届いていなければ、この Step を保留にして Step 3 へ進み、届いた時点で戻る（PR の push は U3 の後が望ましいが、U3 を待たずに U5 に進むかはコントローラーが決める）。

- [ ] **Step 3: 06 への申し送りを書く**

`.handoff/D-pages-deploy.md` の「§3 06 への申し送り（spec D §4.6）」:

```markdown
06（feat/06-performance）は D のマージの後、M3 か M4 の後（M4 の前後の計測の途中は避ける。R-D7）に D の上へリベースし、次を 1 コミットで合わせる。

1. `tests/perf/support.ts` の `assertPerfBuild`（74 行目付近）: `'../../dist/.vite/manifest.json'` → `'../../build-info/manifest.json'`、メッセージの `dist がありません` → `build-info/manifest.json がありません`
2. 06 の計画の `dist/.vite/manifest.json` を読む箇所（`grep -n 'dist/.vite' docs/superpowers/plans/*06*`。`grep -c perfHook dist/.vite/manifest.json`、Task 30 の Step 2 など約 10 か所）を `build-info/manifest.json` に
3. 06 が `vite.config.ts` の chunk-modules の出力に足したものがあれば、`moveBuildInfoOutOfDist` の後に `build-info/` に来ることを確かめる
4. `.gitignore`: D の `build-info/` と 06 の `.cache/` の両方を残す
5. overview §6 と tech-spec は節や行が違う（D は R01-3・R01-8・表の末尾の R-D 行・§7 の T15、tech-spec §1〜§4・§7・§12・§13・§18・§19。06 は R05-6・R06 の行と tech-spec §14）ので、衝突の解消で足りる見込み
6. `playwright.perf.config.ts` の `pnpm preview --port 4175 --strictPort` はそのまま動く（`scripts/preview.mjs` が `--strictPort` を受けて捨てる）
7. リベースの後に isolate の 1 変種を 1 回回し、配信の実体の差（vite preview → wrangler pages dev）で fps が変わっていないことを確かめる（R06-4 の前後同条件）
```

- [ ] **Step 4: ユーザーに渡す手作業の文面を書く**

`.handoff/D-pages-deploy.md` の「§4 ユーザーの手作業」に、次をそのまま書く（コントローラーが順に渡す）。U1〜U3 はすでに渡していれば結果を書き添える。

```text
【手動・ユーザー】U1 Pages の project を作る（spec D §4.1。所要 約 3 分）
1. ワークツリー（/home/terapyon/dev/terapyon/raintrace/.claude/worktrees/agent-abb19734b402c33ec）で:
   pnpm exec wrangler login        （まだなら）
   pnpm exec wrangler pages project create raintrace --production-branch production
2. 表示された URL（raintrace.pages.dev か、接尾辞付きか）を知らせてください
3. pnpm exec wrangler pages project list の raintrace の行（production branch が production か）を知らせてください

【手動・ユーザー】U2 API トークンに Pages の権限を足す（spec D §4.8。所要 約 3 分）
1. Cloudflare のダッシュボード → My Profile → API Tokens → GitHub の Secret CLOUDFLARE_API_TOKEN に入れたトークンを Edit
2. Permissions に Account → Cloudflare Pages → Edit を足す。Workers の権限は消さない（01〜05 の PR が Workers に上げ続けるため）
3. 対象のアカウントは 1 つのまま。Secret の値は変わらないので GitHub 側の作業は無し

【手動・ユーザー】U3 手元からの試しのデプロイ（spec D §5.1 の手順 3。U1・U2 の後。所要 約 5 分）
ワークツリーで（メインのチェックアウトではなく）:
   pnpm build
   WRANGLER_SEND_METRICS=false pnpm exec wrangler pages deploy dist --project-name raintrace --branch d-trial --commit-dirty=true
   node scripts/check-deployed-headers.mjs https://d-trial.raintrace.pages.dev --noindex
   （U1 で接尾辞が付いていたら、URL の raintrace.pages.dev をその名前に）
出力の全文を知らせてください。別名 d-trial は消せずに残りますが、noindex のプレビューなので害はありません

【手動・ユーザー】U4 R-D9: environment production の承認者（裁定が「付ける」のときだけ。所要 約 2 分）
GitHub のリポジトリ → Settings → Environments → production → Required reviewers にご自分を足して Save。
以後、v* のタグの deploy-production は承認するまで保留になります。「付けない」なら何もしません

【手動・ユーザー】U5 D の push と PR（spec D §5.1 の手順 4）
.handoff/ の push の手順どおり feat/D-pages-deploy を push し、base を feat/05-3d-rendering にして PR を作る（本文は §5）。
CI の deploy-preview が緑で、サマリに https://pr-<番号>.raintrace.pages.dev が出ることを確かめてください。
認証で落ちたら（Account Settings: Read などが要る。spec D §4.8 の未確認）、ログのエラーを知らせてください

【手動・ユーザー】U6 マージと main（spec D §5.1 の手順 5。06 の M4 の計測の最中は避ける）
01〜05 を順にマージした後に D をマージ。deploy-main が緑であることを確かめ、
Firefox と Safari で https://main.raintrace.pages.dev/ を開いて地図が出ることを見てください

【手動・ユーザー】U7 本番のリリース（spec D §5.1 の手順 6）
v* のタグを push。deploy-production が緑であること（U4 を付けたなら承認の後）、https://raintrace.pages.dev/ で地図が出ることを確かめてください

【手動・ユーザー】U8 独自ドメイン（spec D §4.3・§5.1 の手順 7。証明書の発行を待つ時間を含め 数分〜数十分）
1. 先にダッシュボード: Workers & Pages → raintrace → Custom domains → Set up a custom domain → raintrace.terapyon.net
2. 後に value-domain.com の DNS の設定: CNAME  raintrace → raintrace.pages.dev（U1 の実際のホスト名）
3. dig +short CNAME raintrace.terapyon.net で raintrace.pages.dev. が返ること
4. ダッシュボードの状態が Active になるまで待つ。検証用のレコード（TXT など）を求められたら value-domain に足す
5. ワークツリーで: node scripts/check-deployed-headers.mjs https://raintrace.terapyon.net --indexable （OK になること）
6. curl -sI https://raintrace.terapyon.net/ の結果を知らせてください（PR に記録します）
7. GitHub → Settings → Secrets and variables → Actions → Variables に PRODUCTION_URL = https://raintrace.terapyon.net を登録
8. Firefox と Safari で https://raintrace.terapyon.net/ の地図と証明書を見る

【手動・ユーザー】U9 旧 Workers の後始末（spec D §4.9。01〜05 と D がマージ済みで、U7・U8 の検査が通った後）
1. pnpm exec wrangler delete --name raintrace-staging
   pnpm exec wrangler delete --name raintrace   （本番は未リリースなら存在しない。あれば消す）
   （フラグが違えばダッシュボードの Workers & Pages → 該当の Worker → Settings → Delete）
2. API トークンから Workers の権限を外す（または Pages の Edit だけのトークンを作り直して Secret を差し替える）
3. （任意）GitHub の environment staging を消す
4. .handoff/README.md の Workers の手順（「01 の push の前に」「deploy-preview を直す」「マージの後に」のステージングの確認）を Pages の手順に書き換える
5. 行った日付を .handoff/ に記録（spec D §7 の 7）
```

- [ ] **Step 5: PR の本文を書く**

`.handoff/D-pages-deploy.md` の「§5 PR の本文」に（`writing-pr-descriptions` の形で）:

- 概要: 配信を Workers から Pages（Direct Upload）へ。ステージングを廃止し 3 段に。独自ドメインは外部 DNS の CNAME
- 変更: Task 2〜6 のコミットの要点（1 行ずつ）
- spec との差異: 決めたこと 4（`deployedHeaders` の単体テスト）、決めたこと 2（`pnpm size` の `dist/` の検査）、決めたこと 5（`PAGES_HOST`）、決めたこと 8（tech-spec の直した節が §8 の表より多い）
- 確かめ: Task 1 の P1〜P6、E2E の件数、U3 の結果、`pnpm size` の値
- マージの前後の手作業: U5〜U9 の要約。R-D9 は未裁定
- 06 への影響: §3 の要約
- 末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

- [ ] **Step 6: 報告**

コントローラーに次を送る: コミットの一覧（`git -C $W log --oneline 190ece1..HEAD`）、ゲートと E2E の結果、U3 の取り込みの状態（済み・保留）、`.handoff/D-pages-deploy.md` の場所（メインのチェックアウトの `.handoff/` に写す）、U4〜U9 を渡す順序。

---

## Self-Review（計画の作成者が確かめたこと）

- spec §2 の「含む」の各項目: project と 3 段（Task 5、U1）、独自ドメイン（U8）、`_headers` と SPA（Task 1・3・4）、plugin を外す（Task 3）、`dist/.vite/`（Task 2）、`ci.yml` と応答の検査（Task 4・5）、トークン（U2・U9）、旧 Workers（U9）、記録の更新（Task 6、`.handoff/README.md` は U9）
- spec §7 の完了条件: 1〜3 は U5〜U8、4 は Task 3・7、5 は Task 7 Step 1、6 は Task 6、7 は U9
- R-D9 に依存する手順は U4 だけで、リポジトリのファイルは変えない
- 名前の一致: `moveBuildInfoOutOfDist`・`build-info/`（Task 2・3・6・7）、`parsePreviewArgs`・`DEFAULT_PREVIEW_PORT`（Task 3）、`forbiddenDistEntries`・`FORBIDDEN_DIST_ENTRIES`（Task 3）、`findAssetScript`・`evaluateDeployment`・`MISSING_PATH`（Task 4）、`PAGES_PROJECT`・`PAGES_HOST`・`PAGES_BRANCH`（Task 5・7）、`deploy:production:manual`（Task 3・5・6）
