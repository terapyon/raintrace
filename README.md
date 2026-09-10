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
| `pnpm preview` | 本番ビルドの配信（Cloudflare の workerd） |
| `pnpm lint` | Biome |
| `pnpm typecheck` | `tsc -b` |
| `pnpm depcheck` | dependency-cruiser によるレイヤー規則の検査 |
| `pnpm test` | ユニットテスト |
| `pnpm test:e2e` | 本番ビルドに対する E2E |

## 出典

地図・標高データ：[国土地理院](https://maps.gsi.go.jp/development/ichiran.html)

## ライセンス

[MIT](LICENSE)
