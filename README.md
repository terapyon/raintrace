# raintrace

国土地理院の標高データ（DEM）を使い、雨水が地表を流れて窪地に溜まる様子をブラウザで確かめる、局所雨水流動・湛水シミュレータです。

- 基本仕様: [specs/base-spec.md](specs/base-spec.md)
- 技術仕様: [specs/tech-spec.md](specs/tech-spec.md)
- 実装 spec: [docs/superpowers/specs/](docs/superpowers/specs/)

## 開発

Node 24 と pnpm 12（`package.json` の `packageManager` の版）が必要です。

```sh
pnpm install
pnpm dev
```

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー |
| `pnpm build` | 型検査と本番ビルド |
| `pnpm preview` | 本番ビルドの配信（`wrangler pages dev`。Cloudflare Pages のローカルの実装。`--port <番号>` で変える） |
| `pnpm lint` | Biome |
| `pnpm typecheck` | `tsc -b` |
| `pnpm depcheck` | dependency-cruiser によるレイヤー規則の検査 |
| `pnpm test` | ユニットテスト |
| `pnpm test:e2e` | 本番ビルドに対する E2E |
| `pnpm size` | バンドル予算と `dist/` の中身の検査（`pnpm build` の後。ビルドの情報は `build-info/`） |
| `pnpm deploy:production:manual` | CI が使えないときの緊急用に、手元から本番へ出す（`wrangler login` が要る）。通常のリリースは `v*` のタグの push（`pnpm deploy` は pnpm の組み込みのコマンドと同名なので避けた） |
| `pnpm run licenses` | 本番の依存のライセンスの検査（`pnpm licenses` は pnpm の組み込みのコマンドと同名なので `run` を付ける） |

## 配信

Cloudflare Pages（Direct Upload）で配信します。デプロイは GitHub Actions が行います（[spec D](docs/superpowers/specs/2026-09-17-D-pages-deploy-design.md)）。

| 段 | トリガ | URL |
|---|---|---|
| プレビュー | Pull Request | `https://pr-<番号>.raintrace.pages.dev/` |
| `main` | `main` への push | `https://main.raintrace.pages.dev/` |
| 本番 | `v*` のタグの push | `https://raintrace.terapyon.net/` |

## 出典

地図・標高データ：[国土地理院](https://maps.gsi.go.jp/development/ichiran.html)

## ライセンス

[MIT](LICENSE)
