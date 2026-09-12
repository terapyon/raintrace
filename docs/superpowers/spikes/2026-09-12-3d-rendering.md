# Spike S: 3D 描画方式の比較 — 報告

- Status: 下書き（spike/3d-rendering で書き足している）
- 日付: 2026-09-12（開始）
- spec: `docs/superpowers/specs/2026-09-10-S-3d-rendering-spike-design.md`
- 計画: `docs/superpowers/plans/2026-09-12-S-3d-rendering-spike.md`
- コード: ブランチ `spike/3d-rendering`（マージしない）

## 1. 結論

（Task 10 で書く）

## 2. 環境

| 項目 | 値 |
|---|---|
| 起点のコミット | f199a02 |
| MapLibre GL JS | 6.6.0 |
| three | 0.185.1（@types/three 0.185.4、推移的依存 0 個。開発時のみ） |
| three の扱い | スパイクのブランチ（`spike/3d-rendering`）だけの依存。`main` には入っていない |
| 自動の計測 | Playwright 1.62.1 の Chromium、`--enable-unsafe-swiftshader`、960 × 600、deviceScaleFactor 1 |
| 本番のバンドル（スパイクの前） | 初期ロード 388.7 KB / 総量 525.0 KB |

## 3. 判定の方法

- 入力: 合成の場面（計画 D4）と、実データの場面（渋谷駅付近の DEM1A の実タイル 9 枚。`spike/fixtures/gsi/`、取得日と出典は同じ場所の README。範囲の最低・最高の標高、無効セル、満水の最大の水深は `spike/results/real-scene.md` の値を Task 1 Step 14 で写す）

（Task 3 で書く: 可視率・ちらつきの定義と閾値、計画 D9）

## 4. 候補ごとの結果

| 観点 | A | A' | B | B-raw |
|---|---|---|---|---|
| 合格基準 1（1cm の膜: 可視率の最小・ちらつきの最大） | | | | |
| 合格基準 2（倍率の一致） | | | | |
| 合格基準 3（fps、自動は参考・実 GPU は手動） | | | | |
| バンドル（gzip） | | | | |
| 複雑さ（行数・回避策の数） | | | | |
| 継ぎ目 | — | — | | |
| z-fighting の対策の効果 | | | | |
| Custom Layer の API | | | | |
| 流れの矢印（symbol レイヤー） | | | — | — |

## 5. Custom Layer の API（MapLibre 6.6.0）

（Task 2 で書く）

## 6. 1 日目の中間の判定

（Task 4 で書く）

## 7. スクリーンショット

（Task 3・5・6・7 で足す）

## 8. 推奨と理由

（Task 10 で書く）

## 9. tech-spec §5.5 の改訂案（T9）

（Task 10 で書く）

## 10. 05 への申し送り

（Task 10 で書く）

## 11. 未確認の事項

- raster-dem の `encoding: 'custom'`（GSI の係数 655.36・2.56・0.01）で `addProtocol` を省く方法は試していない。正の標高だけなら線形に読めるが、負の標高と無効値（2^23）で崩れる
- B・B-raw の流れの矢印（インスタンス描画）は比べていない（05 で作る。計画 D20）
- 無効セルを含む DEM: 無効の頂点（標高 0・水深 0）が水のある有効セルの隣にあると、`v_depth` の補間で細い三角形が z = 0 まで落ちる。05 では、無効の頂点の高さを隣の有効セルに寄せるか、その三角形を捨てる必要がある。実データ（渋谷の実タイル）には無効セルがある（02 の手動確認で 0.2%、線路に沿った線）ので、`real` のコンタクトシートで現れたかどうかと、そのコマを書く
