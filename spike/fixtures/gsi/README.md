# スパイク S の実データ（DEM1A、渋谷駅付近）

- 出典: 国土地理院「地理院タイル」標高タイル（DEM1A）。出典: 国土地理院
- URL: `https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/17/{x}/{y}.png`（`src/dem/demSources.ts` の `demTileUrl('dem1a', tile)` と同じ）
- 範囲: 北緯 35.658°・東経 139.7016° を中心とする 500m 四方（z17、N = 516。R02-7 の渋谷駅付近）にかかる x 116398〜116400・y 51622〜51624 の 9 枚
- 取得: `node spike/scripts/dem-tiles.ts > spike/out/dem-tiles.sh && sh spike/out/dem-tiles.sh`（取得日: 2026-09-12）
- 使い方: 自動の実行では `spike/e2e/support/views.ts` の `routeSpikeDem` がこのファイルで応答する。手動の計測（Task 8）では地理院から取得する
- 404 だったタイル: なし
- SHA-256（`sha256sum spike/fixtures/gsi/*.png` の出力）:
  - `0063f610459ceacf621f2fdd5b07efbbba6969ac8fd7300448a62e355b23f4cb  dem1a-17-116398-51622.png`
  - `be87878c388332850b80bfdb5705ec113b760ff6b92902e72f6b6e1a90cb0fba  dem1a-17-116398-51623.png`
  - `2cb6cb1879a97959164b97106c3c3642a0522bc1f4d5921fb356ad565afc2cd8  dem1a-17-116398-51624.png`
  - `cb2e977f7099debaf5b59d3ec1cb517d78c921836d6736b8106bd79a9a437ce7  dem1a-17-116399-51622.png`
  - `5ef12f364f65fb52b81048490d98a306f12c678ed6c9be877b72face58faf053  dem1a-17-116399-51623.png`（中央。`tests/fixtures/gsi/README.md` の値と一致）
  - `0f85a0d8c44668707d35193b7af8a47cc5bb14da8e282829682f17e193da9f7c  dem1a-17-116399-51624.png`
  - `979a1c5b1fa0e4dcb95c4026361edf39e9b57b75511c6a5a3531f9a140310e5a  dem1a-17-116400-51622.png`
  - `9a0f6a8ea4806c3ae94fdfe08e1136a6f5b71f444b09fbe02b4bdae9a10367a2  dem1a-17-116400-51623.png`
  - `2db18e4d48d0ababec34e651b44a26b6e62d0a0cc44cf8a39c20f6b3e84d7cf5  dem1a-17-116400-51624.png`
