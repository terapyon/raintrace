# 局所雨水流動・湛水3Dシミュレータ 仕様書

Version: 0.1  
Status: Draft / PoC Specification  
対象: Webブラウザアプリケーション

---

# 1. 概要

## 1.1 目的

国土地理院が公開する数値標高モデル（DEM）を利用し、任意の地点・範囲に降雨が発生したと仮定した場合に、

- 水がどの方向へ流れるか
- どこに水が集まるか
- どこに水が溜まるか
- 水位が上昇した結果、どこから越流するか

を計算し、地形とともに3Dで可視化するWebアプリケーションを構築する。

ユーザーが地図上で降雨地点を指定し、降雨量・降雨範囲を設定することで、雨水が地形に沿って移動していく様子をインタラクティブに確認できることを主目的とする。

---

# 2. アプリケーションの位置づけ

本アプリは、正式な洪水予測・浸水予測・河川氾濫解析を行うシステムではない。

初期版では、

**DEM上に存在する地表面の高低差に基づく簡易的な表面水流動モデル**

を提供する。

したがって、以下は初期モデルでは考慮しない。

- 下水道
- 排水ポンプ
- 側溝
- 暗渠
- 河川流量
- 河川水位
- 潮位
- 土壌への浸透
- 蒸発
- 建物内部への流入
- 道路縁石などの微小構造物
- 正確な流速
- 流体力学的乱流

本アプリの結果は、

> 「この地形に、この量の水を置いた場合、地形だけを考えると水がどのように移動・滞留する可能性があるか」

を理解するためのシミュレーション結果として扱う。

---

# 3. データソース

## 3.1 ベースマップ

国土地理院「地理院タイル」を利用する。

候補：

- 標準地図
- 淡色地図
- 航空写真

地理院タイルは、Webアプリケーションからリアルタイムに読み込む用途では、原則として出典を明示して利用できる。 citeturn614975search1

画面上には以下を表示する。

> 地図・標高データ：国土地理院

---

# 4. 標高データ

## 4.1 使用するDEM

優先順位を以下とする。

1. DEM1A
2. DEM5A
3. DEM5B
4. DEM5C
5. DEM10B

DEM1Aが利用可能な地域ではDEM1Aを優先する。

国土地理院のDEM1Aは航空レーザ測量成果から作成された1mメッシュ標高データである。DEM5Aは同じく航空レーザ測量成果から作成された5mメッシュである。 citeturn614975search4

標高タイルとしては現在、以下の最大ズームレベルまで提供されている。

- DEM1A: z17
- DEM5A/B/C: z15
- DEM10B: z14 citeturn614975search1


---

# 5. 標高タイルの取得

初期実装ではPNG標高タイルを利用する。

例：

```text
DEM1A
https://cyberjapandata.gsi.go.jp/xyz/dem1a_png/{z}/{x}/{y}.png
```

標高タイルは通常の地図タイルと同一のXYZタイル座標を利用し、1タイル256×256ピクセルで構成される。PNG形式では標高値がRGB値として格納されている。 citeturn614975search0

テキスト形式の標高タイルについては更新が停止されているため、新規実装ではPNG形式を基本とする。 citeturn614975search1

---

# 6. 標高とシミュレーション精度の考え方

重要な点として、

**シミュレーションの水位刻み**

と、

**DEMそのものの測量精度**

は区別する。

本システムでは、

```text
水位計算分解能 = 0.1m
```

を標準とする。

つまり、

- 0.1m
- 0.2m
- 0.3m
- 0.4m

というように10cm単位で水深を扱うことができる。

ただし、

> 「10cm単位で計算している」  
> ≠  
> 「標高が10cm精度で正しい」

である。

UIおよびドキュメントでは、この点を明確に表示する。

---

# 7. DEM上の構造物について

国土地理院の標高モデルは、基本的に地表面を表現するものである。

建物、高架橋などの構造物の高さを反映するモデルではない。 citeturn614975search3

したがって初期モデルでは、

```text
住宅
道路
高架
堤防
縁石
```

などが実際の水流を妨げていても、DEM上でその構造が表現されていない場合には考慮されない。

これを本システムの主要な制約事項とする。

---

# 8. 初期シミュレーション対象範囲

初期PoCでは、

```text
500m × 500m
```

を標準シミュレーション範囲とする。

選択可能候補：

```text
250m × 250m
500m × 500m
1000m × 1000m
```

初期リリースでは500m固定でもよい。

---

# 9. 内部グリッド

DEM1A利用時：

```text
500 × 500 cells
= 250,000 cells
```

を基本とする。

各セルは最低限以下を保持する。

```typescript
interface TerrainCell {
    elevation: number;
    waterDepth: number;
}
```

必要に応じて以下を追加する。

```typescript
interface TerrainCell {
    elevation: number;
    waterDepth: number;

    surfaceHeight: number;

    flowX: number;
    flowY: number;

    velocity?: number;

    isBoundary: boolean;
    isSink: boolean;
}
```

ただし`surfaceHeight`は保持せず、以下から都度計算してもよい。

```text
surfaceHeight =
    elevation + waterDepth
```

---

# 10. 降雨設定

## 10.1 基本設定

ユーザーが地図をクリックして降雨中心を指定する。

設定値：

```text
降雨中心
降雨半径
降雨量
```

初期値：

```text
降雨半径：10m
降雨量：100mm
```

---

# 11. 降雨量から水量への変換

例えば、

```text
半径 = 10m
降雨量 = 100mm = 0.1m
```

の場合、

降雨面積：

```text
π × 10²
≈ 314.16m²
```

水量：

```text
314.16 × 0.1
≈ 31.4m³
```

とする。

この水量を対象セルへ分配する。

---

# 12. 降雨分布

Version 0.1では、

**均一降雨**

を採用する。

つまり指定円内の各セルに同じ降雨量を加える。

将来的には以下を追加できる。

- ガウス分布型
- レーダー雨量入力
- 時間変化降雨
- 移動する雨域

---

# 13. 水流シミュレーション基本モデル

初期実装では、

**mass-conserving grid water model**

を採用する。

各セルについて、

```text
H = terrainElevation + waterDepth
```

を水面標高とする。

周囲セルとの水面標高差を調べ、水面標高が低いセルに対して水を移動させる。

---

# 14. 近傍セル

基本モデルは8近傍とする。

```text
NW N NE
 W C E
SW S SE
```

つまり、

```text
D8 neighborhood
```

を利用する。

---

# 15. 流量計算

セル`i`の水面標高：

```text
Hi = Zi + Wi
```

隣接セル`j`：

```text
Hj = Zj + Wj
```

とする。

```text
ΔH = Hi - Hj
```

が正の場合、セル`i`からセル`j`へ水が流れる候補となる。

---

# 16. 最初のPoCアルゴリズム

PoCでは物理的な流速まで再現せず、

```text
ΔH > threshold
```

となる周囲セルへ水を移動する。

複数の流出先がある場合には、

```text
flow ∝ ΔH
```

として高さ差に比例して配分する。

---

# 17. 質量保存

アルゴリズムでは必ず、

```text
Σ water before
=
Σ water after
+ outflow
```

を維持する。

ただし、シミュレーション範囲外へ流出した水は、

```text
outflow
```

として記録する。

---

# 18. 境界条件

対象領域端まで達した水については、

**領域外へ流出**

したものとして処理する。

UIでは、

```text
領域外流出量
```

として表示する。

---

# 19. 窪地

周囲より低いセル群は、

```text
sink
```

または、

```text
depression
```

として扱う。

水は窪地に蓄積する。

---

# 20. 水位上昇

窪地内では水の追加に伴って、

```text
terrainElevation + waterDepth
```

が上昇する。

周辺セルより水面標高が低いうちは滞留する。

---

# 21. 越流

水面が窪地の出口となる標高まで上昇すると、

```text
spill point
```

を越えて隣接領域へ水が流れる。

この挙動を視覚的な重要イベントとして扱う。

例：

```text
Simulation event

12.4 sec
Depression A reached spill elevation 12.7m

↓
Overflow started
```

---

# 22. 高速化

単純な全セル反復：

```text
250,000 cells
×
iteration
```

を毎回行う方法は避ける。

以下の方式を検討する。

```text
Active Cell Set
```

つまり、

```text
水の存在するセル
+
その周辺
```

のみを更新対象とする。

---

# 23. Active Cell方式

例えば、

```typescript
Set<number> activeCells
```

を持つ。

水が移動した場合のみ、

```text
移動元
移動先
移動先周辺
```

を次回更新対象にする。

これにより、

500m四方で水が一部地域しか移動していない場合、

250,000セルすべてを計算する必要がなくなる。

---

# 24. Web Worker

シミュレーションはUIスレッドから分離する。

```text
Main Thread
  |
  | DEM
  ↓
Web Worker
  |
  | simulation
  ↓
water-depth buffer
```

とする。

目的：

- UIフリーズ防止
- シミュレーション高速化
- 将来的な並列化

---

# 25. データ構造

JavaScriptオブジェクトを250,000個生成する方式は避ける。

原則としてTypedArrayを利用する。

例：

```typescript
const elevation =
    new Float32Array(width * height);

const water =
    new Float32Array(width * height);
```

必要であれば、

```typescript
const nextWater =
    new Float32Array(width * height);
```

も利用する。

---

# 26. GPU利用

初期バージョンではCPU + Web Workerを基本とする。

将来的には、

```text
WebGPU Compute Shader
```

を利用してセル計算をGPU化できる設計とする。

シミュレーションエンジンと表示エンジンは分離し、

```text
Simulation Engine
        |
        ↓
Water Grid
        |
        ↓
Renderer
```

という構造にする。

---

# 27. 地図表示

地図レンダリングには、

**MapLibre GL JS**

を第一候補とする。

MapLibre GL JSはブラウザ上でWebGLを利用して地図をレンダリングでき、`raster-dem`ソースを利用した3D terrainをサポートする。 citeturn530990search0turn530990search5

ただし、MapLibreの標準`raster-dem`はMapbox Terrain RGBまたはMapzen Terrarium形式を前提としている。国土地理院DEM PNGをそのままterrain sourceとして渡せるとは限らないため、DEMデコード層を独立させる。 citeturn530990search1

---

# 28. 3D地形

DEMから取得した標高を利用して3D地形を表示する。

表示には以下を検討する。

第一候補：

```text
MapLibre GL JS
+
Custom WebGL Layer
```

必要に応じて、

```text
Three.js
```

をCustom Layer内部で利用する。

MapLibreはCustom Layerを利用して同一WebGLコンテキスト上に独自3D描画を追加できる。 citeturn530990search8

---

# 29. 地形の高さ強調

平地では10～50cmの標高差が視覚的に分かりにくい。

そのため、

```text
Vertical Exaggeration
```

を提供する。

候補：

```text
1x
2x
5x
10x
```

ただし水深計算そのものには影響させない。

あくまで表示上の倍率とする。

---

# 30. 水面表示

水を3Dメッシュとして描画する。

頂点のZ値：

```text
terrainElevation
+
waterDepth
```

とする。

一定水深以下の場合には描画しない。

初期閾値：

```text
1cm
```

---

# 31. 水深表示

水深に応じて連続的または段階的に表示する。

標準表示区分：

```text
0–10cm
10–30cm
30–50cm
50–100cm
100cm以上
```

加えて、

```text
10cm刻み表示
```

モードを用意してもよい。

---

# 32. 流向表示

流れが存在するセルには、

```text
→
↘
↓
```

のようなベクトル表示を重ねる。

大量に表示すると見づらいため、

```text
5m
10m
20m
```

程度でサンプリングする。

---

# 33. アニメーション

Simulation Engineが一定時間ごとに状態を更新する。

UI側では、

```text
Simulation Time
```

を表示する。

ただし初期モデルでは現実時間との厳密な対応を保証しない。

そのため初期UIでは、

```text
Step 1
Step 2
Step 3
```

または、

```text
Simulation time
```

という表現を使用し、

「実時間10秒後」

などとは表示しない。

---

# 34. 再生コントロール

最低限以下を提供する。

```text
▶ Play

⏸ Pause

⏮ Reset
```

追加候補：

```text
速度
0.25x
0.5x
1x
2x
4x
```

---

# 35. 地図操作

ユーザーは、

- パン
- ズーム
- 回転
- Pitch変更

を行える。

シミュレーション中でも視点変更可能とする。

---

# 36. 地点選択

地図クリックで降雨中心を指定する。

クリック地点には、

```text
Rain Marker
```

を表示する。

選択地点変更時にはシミュレーションをResetする。

---

# 37. UI構成

基本レイアウト：

```text
┌──────────────────────────────┐
│                              │
│                              │
│          3D MAP              │
│                              │
│                 ☔           │
│                ~~~~~         │
│             → → →            │
│                              │
├──────────────────────────────┤
│ Rain                         │
│                              │
│ Rainfall      [ 100 ] mm     │
│ Radius        [ 10 ] m       │
│                              │
│ ▶ Start   ⏸ Pause   Reset    │
└──────────────────────────────┘
```

PCではサイドパネルでもよい。

---

# 38. 統計表示

シミュレーション中に以下を表示する。

```text
投入水量
現在領域内に存在する水量
領域外流出量
最大水深
湛水面積
```

例：

```text
Rain water       31.4 m³
Stored           18.2 m³
Outflow          13.2 m³
Max depth        0.43 m
Flooded area     82 m²
```

---

# 39. セル情報

地図上のセルをクリックした場合、

```text
Elevation
Water depth
Water surface elevation
```

を表示する。

例：

```text
Elevation
12.43 m

Water depth
0.37 m

Water level
12.80 m
```

---

# 40. DEM情報表示

現在のシミュレーションで使用しているDEMを表示する。

例：

```text
Elevation data

DEM1A
Grid resolution: approximately 1m
Source: Geospatial Information Authority of Japan
```

DEM1Aがない場合：

```text
DEM5A

Fine terrain simulation is limited because
1m DEM is unavailable in this area.
```

---

# 41. DEM選択

初期版では自動選択する。

```text
DEM1A available
       ↓ YES
      DEM1A

       ↓ NO
DEM5A/B/C available
       ↓
      DEM5

       ↓ NO
     DEM10
```

---

# 42. データ取得構造

推奨構造：

```text
Browser
   |
   +-- GSI Map Tiles
   |
   +-- GSI DEM Tiles
   |
   ↓
DEM Decoder
   |
   ↓
Terrain Grid
   |
   ↓
Simulation Worker
   |
   ↓
Water Grid
   |
   ↓
Renderer
```

---

# 43. モジュール構成

```text
src/

  map/
    MapController.ts
    GsiTileSource.ts

  dem/
    DemTileLoader.ts
    GsiDemDecoder.ts
    DemGrid.ts

  simulation/
    SimulationEngine.ts
    WaterGrid.ts
    FlowSolver.ts
    Rainfall.ts
    Boundary.ts

  workers/
    simulation.worker.ts

  renderer/
    TerrainRenderer.ts
    WaterRenderer.ts
    FlowRenderer.ts

  ui/
    SimulationControls.ts
    StatisticsPanel.ts
```

---

# 44. Simulation Engine API

例：

```typescript
interface SimulationConfig {
    width: number;
    height: number;

    cellSize: number;

    timestep: number;
}

interface Rainfall {
    x: number;
    y: number;

    radius: number;
    amountMm: number;
}
```

---

# 45. Simulation API

```typescript
simulation.loadTerrain(dem);

simulation.addRainfall({
    x,
    y,
    radius: 10,
    amountMm: 100
});

simulation.step();

simulation.reset();
```

---

# 46. 計算結果

```typescript
interface SimulationResult {
    waterDepth: Float32Array;

    totalWater: number;
    storedWater: number;
    outflowWater: number;

    maxDepth: number;
    floodedArea: number;
}
```

---

# 47. 精度確認

シミュレーションの最低限のテストとして、

## 平面

完全に平らなDEMに水を置いた場合：

```text
水面が均等になる
```

こと。

## 傾斜面

```text
＼
 ＼
  ＼
```

では、

```text
高 → 低
```

へ流れること。

## 単純窪地

```text
\   /
 \_/
```

で水が蓄積すること。

## 越流

```text
\__/\__
```

で水位上昇後に低い峠から次の窪地へ流れること。

---

# 48. 質量保存テスト

各stepについて、

```text
initial water
+
added rain
=
current water
+
outflow
```

が数値誤差範囲内で成立すること。

これはSimulation Engineの最重要テストとする。

---

# 49. 数値誤差

浮動小数点誤差を考慮し、

```text
epsilon
```

を定義する。

候補：

```text
1e-5 m
```

実際の値は実験で決定する。

---

# 50. データキャッシュ

一度取得したDEMタイルはブラウザ内でキャッシュ可能とする。

候補：

```text
IndexedDB
```

ただし初期PoCではHTTPキャッシュのみでもよい。

---

# 51. バックエンド

Version 0.1では、

**バックエンドなし**

を目標とする。

```text
Static Web Application
```

としてホスティング可能にする。

候補：

- Firebase Hosting
- Cloudflare Pages
- GitHub Pages

---

# 52. プライバシー

地点選択・シミュレーションについて、サーバへ位置情報を保存しない。

基本設計：

```text
DEM download
↓
Browser
↓
Simulation
↓
Browser
```

とする。

---

# 53. 将来的な機能

## 53.1 複数降雨地点

複数地点から同時に雨を降らせる。

---

## 53.2 降雨時間

例：

```text
100 mm/hour
for
30 minutes
```

のような時間雨量モデル。

---

## 53.3 レーダー雨量

気象レーダー等から取得した雨量分布を入力する。

---

## 53.4 浸透

土地利用や土壌によって、

```text
infiltrationRate
```

を設定する。

---

## 53.5 蒸発

長時間モデルでは蒸発を考慮する。

---

## 53.6 河川

河川を独立したFlow Channelとして扱う。

---

## 53.7 建物

建築物ポリゴンを、

```text
flow obstacle
```

として追加する。

---

## 53.8 道路

道路標高、側溝、縁石を追加できる構造を検討する。

---

## 53.9 LiDAR

国土地理院DEMより高解像度なLiDARデータをユーザーが読み込めるようにする。

候補形式：

```text
GeoTIFF
LAS
LAZ
CSV
```

---

# 54. 将来的な高度水理モデル

初期のセル間水移動モデルから、

```text
Shallow Water Equations
```

を用いた2次元浅水流モデルへ発展可能とする。

ただし初期実装の対象外とする。

---

# 55. 開発フェーズ

## Phase 1

**DEM Viewer**

実装内容：

- 地理院地図表示
- 地点選択
- DEM取得
- DEMデコード
- 標高表示
- 3D terrain

---

## Phase 2

**Static Water**

実装内容：

- 水量投入
- 窪地検出
- 水の平衡計算
- 湛水域表示

この段階では時間変化は扱わなくてもよい。

---

## Phase 3

**Dynamic Water**

実装内容：

- Step simulation
- 流向
- 水移動
- 越流
- アニメーション

---

## Phase 4

**Rain Simulation**

実装内容：

- 降雨量
- 降雨範囲
- 降雨時間
- 水量換算

---

## Phase 5

**Performance**

- Web Worker
- Active Cells
- TypedArray
- 必要に応じWebGPU

---

# 56. PoCで特に重要な検証

最初に確認すべきなのは3D描画ではなく、

**DEMから本当に期待した窪地・流路が得られるか**

である。

そのため最初のPoCでは、

```text
地図
↓
DEM取得
↓
500m × 500m grid
↓
最低地点
↓
流向
↓
sink
↓
spill point
```

までを先に検証する。

---

# 57. 初期PoC完成条件

以下が動けばVersion 0.1 PoC完成とする。

1. 日本国内の地図を表示できる
2. 任意地点をクリックできる
3. 周囲500mのDEMを取得できる
4. 3D地形を表示できる
5. 指定地点・指定半径に水を追加できる
6. 水が高所から低所へ移動する
7. 窪地に水が溜まる
8. 水位上昇によって越流する
9. 水深を3D表示できる
10. 総水量が保存される
11. 領域外流出量を計算できる
12. Resetできる

---

# 58. 非機能要件

## ブラウザ

初期対応：

```text
Chrome
Edge
Safari
Firefox
```

最新版を対象とする。

WebGPUを使用する場合も、WebGPUを必須要件にはしない。

---

## 操作性

地図選択からシミュレーション開始まで、

```text
3操作以内
```

を目標とする。

例：

```text
1. 地点をクリック
2. 降雨量を指定
3. Start
```

---

# 59. 注意表示

画面上には常時、またはSimulation開始時に以下を表示する。

> 本シミュレーションは地形標高データを用いた簡易モデルです。  
> 実際の浸水・洪水・災害を予測するものではありません。  
> 建物、道路構造、下水道、河川流量、排水設備等は考慮されていません。

---

# 60. 技術スタック候補

```text
TypeScript
Vite
MapLibre GL JS
WebGL / Three.js
Web Worker
TypedArray
Vitest
```

将来：

```text
WebGPU
```

---

# 61. 設計上の重要原則

本システムでは、

```text
DEM
Simulation
Rendering
UI
```

を明確に分離する。

特に、

```text
Simulation Engine
```

はMapLibreやThree.jsに依存させない。

これにより、

```text
Browser renderer
CLI
Node.js simulation
Python validation implementation
WebGPU implementation
```

などへ展開できる。

---

# 62. 初期開発で優先しないもの

以下はVersion 0.1では実装しない。

```text
本格的な洪水予測
気象予測
河川氾濫
地下排水
建物内部
リアルタイム気象
リアルタイムセンサー
AI
機械学習
```

まず、

> DEM上で水が正しく下り、溜まり、越流する

ことに集中する。

---

# 63. プロジェクトの中心となる問い

初期開発では、次の問いを軸とする。

> 1m〜5m程度の公開DEMを利用して、ブラウザ上で局所的な水の流れと湛水を、ユーザーが直感的に理解できる形で表現できるか。

技術的には、

> 25万セル程度の地形に対するmass-conservingな水流シミュレーションをブラウザ上でインタラクティブに実行できるか。

を主要な検証対象とする。

---

# 64. 将来的な方向性

このプロジェクトは最終的には、

```text
標高を見る地図

        ↓

地形の意味を理解する地図

        ↓

地形に何かが起きた場合を
試せる地図
```

へ発展させる。

雨だけでなく、

```text
水を流す
水位を上げる
堤防を置く
道路を塞ぐ
土地を盛る
```

といった操作を可能にすることで、

**地形をインタラクティブに実験できる3Dシミュレーション環境**

へ発展させることを長期的な方向性とする。