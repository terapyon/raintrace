# 地理院タイルのフィクスチャ

## dem1a-17-116399-51623.png

- 出典: 国土地理院「地理院タイル」標高タイル（DEM1A）。地図・標高データ：国土地理院（出典の明示で利用できる）
- URL: https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/17/116399/51623.png（東京都渋谷区、渋谷駅付近）
- 取得日: 2026-09-10（Last-Modified: Mon, 30 Mar 2026 01:36:56 GMT）
- SHA-256: `5ef12f364f65fb52b81048490d98a306f12c678ed6c9be877b72face58faf053`
- 内容: 256 × 256、RGB、無効画素なし
- 期待値: 最低 11.08 m、最高 23.08 m（画素 (0,0) は 15.98 m、(128,128) は 15.58 m、(255,255) は 12.18 m）
- 期待値の求め方: ブラウザの経路（createImageBitmap → OffscreenCanvas）とは別の実装として、Pillow 10.2.0（Python 3.12）で一度だけ復号した。スクリプトは次のとおり

```sh
curl -sS -H 'Origin: http://localhost' -o dem1a-17-116399-51623.png \
  https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/17/116399/51623.png
python3 - dem1a-17-116399-51623.png <<'PY'
import sys
from PIL import Image
rgb = Image.open(sys.argv[1]).convert('RGB')
values, na = [], 0
for r, g, b in rgb.getdata():
    x = (r << 16) + (g << 8) + b
    if x == 1 << 23:
        na += 1
        continue
    values.append((x - (1 << 24) if x > (1 << 23) else x) * 0.01)
print(rgb.size, 'valid', len(values), 'na', na, 'min %.2f max %.2f' % (min(values), max(values)))
PY
# (256, 256) valid 65536 na 0 min 11.08 max 23.08
```

E2E（`tests/e2e/dem.spec.ts`）では、すべての DEM の要求にこのタイルを返す。範囲は 2 タイル幅以上にわたり、タイルのすべての画素の位置が範囲に含まれるので、パネルの最低・最高はこの期待値と一致する（spec 02 §8.2）。
