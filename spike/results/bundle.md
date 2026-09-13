# バンドル（gzip level 9、1KB = 1000 バイト）

本番の総量（Task 1 Step 0、このブランチの起点 f199a02 の値）に three のチャンクを足すと: 525.0 + 126.5 = 651.5 KB（tech-spec §14.2 の総量の上限 1.2MB＝1200 KB に対して十分に下）。

05 の基準（04 の実測、2026-09-13）: 総量 565.5 + three 126.5 = 692.0 KB（上限 1.2 MB）。three を動的 import にすれば初期ロード 425.0 KB は変わらない。B-raw を採れば three 自体が無くなる（B − B-raw = 125.6 KB）。

| 候補 | チャンク | gzip (KB) | three を含む |
|---|---|---:|:---:|
| A・A' | assets/a-D6tvPKie.js<br>assets/shaders-OSVyGMS3.js<br>assets/three-DaJOaFrb.js | 131.6 | ○ |
| B | assets/b-BtGJ2I-u.js<br>assets/shaders-OSVyGMS3.js<br>assets/three-DaJOaFrb.js<br>assets/basemap-DuhWFn_C.js | 129.7 | ○ |
| B-raw | assets/braw-qWYr0vmq.js<br>assets/shaders-OSVyGMS3.js<br>assets/basemap-DuhWFn_C.js | 4.1 |  |

ページの入口（地図を含み、全候補で共通）: 250.9 KB
three のチャンク: assets/three-DaJOaFrb.js 126.5 KB
B − B-raw: 125.6 KB
