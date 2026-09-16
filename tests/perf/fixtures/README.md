# 計測の固定の DEM（spec 06 §4.1）

CPU で決まる計測（1 step の所要時間・平衡までの時間。`tests/perf/steps.perf.ts`）は、毎回同じ DEM で回す。

- 出典: 国土地理院「地理院タイル」標高タイル（DEM1A・DEM5A〜C・DEM10B）。地図・標高データ：国土地理院（出典の明示で利用できる）
- 地点: 足立区 綾瀬駅付近（35.762300, 139.824600）、渋谷駅付近（35.658000, 139.701600）、横浜 みなとみらい（35.457500, 139.632000）。範囲 500 m・1000 m（R06-1、R02-7）
- `dem-manifest.json`: URL のパスごとに、200 なら本体の SHA-256 と大きさ、404 ならその旨。**コミットする**
- 本体: `.cache/perf-dem/<SHA-256>.png`（gitignore。全部で数 MB あり、リポジトリに置かない。計画で決めたこと 5）
- 取得日: manifest を記録したコミットの日付

## 記録する（地理院に接続する）

```sh
pnpm build:perf
RAINTRACE_DEM=record pnpm perf:fps tests/perf/steps.perf.ts -g 記録
pnpm build
```

manifest の差分が出たら、地理院のタイルが更新されたか、アプリの取得するタイルが変わった。どちらかを確かめてからコミットする。

## 使う

`RAINTRACE_DEM` を省く（replay）と、`steps.perf.ts` は manifest の本体を返す。本体が無い・SHA-256 が合わない要求は止め、表の「欠け」に数え、テストを失敗にする。manifest に無い DEM の要求（3D の範囲の外のタイル）は地理院にそのまま流し、「素通し」に数える（2D の計測では 0 でなければ失敗）。

## クリックから表示まで（probe=load）だけで測る段 2 の地点（ユーザーの裁定 R5、2026-09-17）

R06-1 の 3 地点はどれも段 1（DEM1A）なので、`probe=load` の組にだけ段 2 の地点を 1 つ足す（`tests/perf/support.ts` の `LOAD_ONLY_SITES`。`RAINTRACE_LOAD=1 RAINTRACE_FPS_SITES=nemuro`）。fps・steps の組には入れない。`probe=load` は地理院に実際に接続するので、この地点の DEM は manifest に記録しない。

- 地点: 北海道根室市 根室駅付近（43.330000, 145.582800）。キーは `nemuro`
- 段: 2（DEM5A）。アプリの段の選び方（`src/dem/demSelection.ts` の `selectDem`、`src/dem/demSources.ts` の `DEM_TIERS`）で、範囲にかかるタイルを 2026-09-17 に地理院から取得して確かめた:

| 範囲 | DEM1A（z17） | DEM5A（z15） | DEM5B・DEM5C（z15） | DEM10B `dem_png`（z14） |
|---|---|---|---|---|
| 500 m | 12 タイルすべて 404（x 118539〜118542、y 47996〜47998） | 2 タイルすべて 200（29634/11999・29635/11999） | すべて 404 | 1 タイル 200（14817/5999） |
| 1000 m | 30 タイルすべて 404（x 118538〜118543、y 47995〜47999） | 4 タイルすべて 200（x 29634〜29635、y 11998〜11999） | すべて 404 | 1 タイル 200（14817/5999） |

- DEM5A の 4 タイル（Last-Modified: Mon, 30 Mar 2026 02:52:01 GMT）の有効画素: 29634/11998 は 11,496（北は海）、29635/11998 は 56,496、29634/11999 は 55,370、29635/11999 は 65,536（全画素）。標高 −0.02〜38.95 m
- 確かめ方: `computeGridRange`・`tilesInPixelRect` で範囲にかかるタイルを求め、各 URL（`https://cyberjapandata.gsi.go.jp/xyz/<dem1a_png|dem5a_png|dem5b_png|dem5c_png|dem_png>/<z>/<x>/<y>.png`）の HTTP の状態を見た。有効画素は上の Pillow のスクリプトと同じ復号で数えた
- 他の候補（同じ日）: 帯広駅付近は 500 m で DEM1A がすべて 200（段 1）。旭川駅付近は 500 m で DEM1A がすべて 404 だが 1000 m で一部 200。稚内駅付近は DEM1A がすべて 200。範囲のどちらでも DEM1A が 1 枚も無い根室を選んだ
