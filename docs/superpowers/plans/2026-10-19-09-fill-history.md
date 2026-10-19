# Spec 09 盛土の履歴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 昔（DEM10B）と今の標高タイルの差をブラウザの Worker で計算し、「標高差の大きい範囲」とその参考の体積・根拠を地図とパネルに出し、3D で昔と今の地形を切り替えられるようにする。

**Architecture:** 純粋な計算（昔の標高の補間・ずれの補正・かたまりの抽出・根拠のラスタ化）は `src/dem/fillHistory/` に置く。Worker は新しいメッセージ `fillHistory` を受け、`dem_png` z14・A54（サイトの静的ファイル）・人工地形タイルを取得して計算し、結果を返す。メインでは `FillHistorySession`（`src/ui/`）が地形の読み込みとオン・オフに合わせて計算を頼み、`FillHistoryOverlay`（`src/map/`）が描き、パネルの `FillHistorySection` が一覧と注意書きを出す。

**Tech Stack:** TypeScript 6、React 19 + MUI 9、MapLibre GL 6.6、zustand 5、Vitest 4、Playwright 1.62。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-10-18-09-fill-history-design.md`（以下「spec」）。ブランチ `feat/09-fill-history`（4c976f0 の上に積む）。

## Global Constraints

- 画面の文字はすべて日本語。文字列は `src/ui/strings.ts` に置き、コンポーネントに直接書かない（tech-spec §9.4）
- 画面の言葉（spec 6.4）: 候補は「標高差の大きい範囲」、体積は「標高差から出した参考の体積」（短くは「参考の体積」）。「盛土の候補」「盛土相当」「危険」「危険盛土」「崩壊確率」を画面に出さない。根拠は「根拠: 強い／中くらい／限られる」
- 計算はすべてブラウザ（Worker）。標高から作ったものをサーバーで作らない・置かない・配信しない（R09-7）
- 閾値: 盛土の候補のセルは ΔZ補正 ≥ +5 m、切土の候補のセルは ΔZ補正 ≤ −5 m（R09-2）。かたまりは 4 近傍、500 m² 未満を捨てる（R09-3）。根拠の「重なる」はセルの 10% 以上
- 体積の表示は有効数字 2 桁（例「約 4.5 万 m³」）
- 新しい依存を足さない（pnpm の 10 日の待ち期間。足す必要が出たら止めて相談）
- dependency-cruiser の規則（`core-is-pure`・`workers-isolated`・`map-types-only`・`types-only-from-core`・`not-reachable-from-entry`）を守る。`pnpm depcheck` が通る
- バンドル: 初期ロード 500 KB・合計 1.2 MB（`pnpm size`）。盛土の履歴のパネルの部品は初期ロードに入ってよいが、増えが 15 KB（gzip）を超えたら止めて相談
- 人工地形タイルは `https://cyberjapandata.gsi.go.jp/xyz/experimental_landformclassification2/{z}/{x}/{y}.geojson`
- 出典の文言（spec 6.5）: いつも「解析・シミュレーション表示：地理院タイル（標高タイル）を加工して RainTrace が作成」。オンのときだけ「大規模盛土造成地：国土数値情報（大規模盛土造成地データ）（国土交通省）を加工して作成」
- 各タスクの終わりに `pnpm lint && pnpm typecheck && pnpm test` が通る。E2E は Task 13 と最後にまとめて回す（Chromium）

## Review Focus

1. **計算中に地形が変わる**（別の地点を選ぶ・範囲の大きさを変える・オフにする）→ 古い結果を描かない。`requestId` と `terrainId` で捨てる（Task 9 のテスト「古い応答を捨てる」）
2. **範囲の一部が海・無効、または `dem_png` が 404** → そのセルは差を出さず、全部無効なら「比べられるセルがありません」で止まり、例外にならない（Task 5・Task 8 のテスト）
3. **人工地形・A54 の取得に失敗する** → 根拠から外して知らせ、標高差の表示は続く（Task 8 のテスト）
4. **ベースマップを切り替える** → 標高差・A54・人工地形のレイヤーが戻る（Task 10 のテスト「restore で足し直す」）
5. **3D で「昔」を表示中に新しい地点を読み込む・盛土の履歴をオフにする・2D に戻す** → 「今」に戻り、水の表示も戻る（Task 12 のテスト）

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/map/basemapStyle.ts`・`src/ui/strings.ts` | 出典の文言（Task 1） |
| `docs/perf/2026-10-19-fill-history-precheck.md` | 着手前の確かめの記録（Task 2） |
| `scripts/build-a54.ts`・`public/data/a54/` | A54 を静的ファイルに変換したもの（Task 3） |
| `src/dem/fillHistory/constants.ts` | 閾値などの定数 |
| `src/dem/fillHistory/resamplePast.ts` | 昔の標高を今の格子に補間（Task 4） |
| `src/dem/fillHistory/correctedDelta.ts` | 差とずれの補正（Task 5） |
| `src/dem/fillHistory/findCandidates.ts` | かたまりの抽出と統計（Task 6） |
| `src/dem/fillHistory/evidence.ts` | ポリゴンのラスタ化と根拠の段階（Task 7） |
| `src/workers/fillHistory.ts` | Worker の中の取得と計算の組み立て（Task 8） |
| `src/shared/protocol.ts`・`src/workers/simulation.worker.ts` | メッセージ（Task 8） |
| `src/bridge/SimulationClient.ts` | `computeFillHistory`（Task 9） |
| `src/state/appStore.ts` | 盛土の履歴の小さな状態（Task 9） |
| `src/ui/fillHistorySession.ts` | オン・オフと地形に合わせた計算の依頼、結果の保持（Task 9） |
| `src/map/fillColormap.ts`・`src/map/FillHistoryOverlay.ts`・`src/map/layerIds.ts` | 地図の描画（Task 10） |
| `src/ui/components/FillHistorySection.tsx`・`src/ui/cellInfo.ts`・`CellInfoPopover.tsx` | パネルとセルの情報（Task 11） |
| `src/map/view3d/View3d.ts`・`src/ui/view3dSession.ts`・`src/ui/components/TerrainEpochToggle.tsx` | 3D の昔と今（Task 12） |
| `tests/e2e/fillHistory.spec.ts`・`tests/e2e/support/gsi.ts` | E2E（Task 13） |
| `scripts/fill-history-check.ts`・`docs/perf/2026-10-19-fill-history.md` | 実際の場所での確かめ（Task 14） |
| `docs/superpowers/specs/2026-09-10-00-overview.md` ほか | 文書の更新（Task 15） |

---

### Task 1: 出典に「加工して作成」を足す（今の画面にも）

spec 6.5「いつも出す（今の雨のシミュレーションにも付ける。09 の最初の作業）」。

**Files:**
- Modify: `src/map/basemapStyle.ts`（`Attribution`・`createGsiStyle`）
- Modify: `src/ui/strings.ts:3-6`
- Test: `src/map/basemapStyle.test.ts`

**Interfaces:**
- Produces: `interface Attribution { text: string; url: string; note: string }`。`createGsiStyle` の出典の HTML は `<a …>{text}</a> ／ {note}`

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('出典は国土地理院へのリンクのあとに、加工して作成した旨を続ける（spec 09 §6.5）', () => {
  const style = createGsiStyle('pale', {
    text: '地図・標高データ：国土地理院',
    url: 'https://maps.gsi.go.jp/development/ichiran.html',
    note: '解析・シミュレーション表示：地理院タイル（標高タイル）を加工して RainTrace が作成',
  })
  const source = style.sources['gsi-pale'] as { attribution: string }
  expect(source.attribution).toBe(
    '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地図・標高データ：国土地理院</a> ／ 解析・シミュレーション表示：地理院タイル（標高タイル）を加工して RainTrace が作成',
  )
})
```

- [ ] **Step 2: 走らせて失敗を確かめる** — `pnpm vitest run src/map/basemapStyle.test.ts`、期待: FAIL（`note` が無い）
- [ ] **Step 3: 実装する** — `Attribution` に `note` を足し、`strings.attribution.note` に上の文言を置く。他の `Attribution` の利用箇所（`MapController`・テストの偽物）をすべて直す
- [ ] **Step 4: 走らせて通ることを確かめる** — `pnpm lint && pnpm typecheck && pnpm test`、期待: PASS
- [ ] **Step 5: コミット** — `出典に「地理院タイル（標高タイル）を加工して RainTrace が作成」を足す`

---

### Task 2: 着手前の確かめ（spec §8.2）

コードは書かない。結果を `docs/perf/2026-10-19-fill-history-precheck.md` に記録する。外れたら、記録してコントローラー（とユーザー）に報告し、後のタスクの該当部分を止める。

**Files:**
- Create: `docs/perf/2026-10-19-fill-history-precheck.md`

**Interfaces:**
- Produces: 人工地形の属性名と「盛土地・埋立地」などのコード値（Task 8 が使う）。A54 の版・大きさ・属性名（Task 3 が使う）

- [ ] **Step 1: P3 人工地形** — `https://cyberjapandata.gsi.go.jp/xyz/experimental_landformclassification2/16/{x}/{y}.geojson` を熱海（35.1224, 139.0706）の z16 タイルで 1 枚取り、地物の properties のキーと値を記録する。https://github.com/gsi-cyberjapan/experimental_landformclassification の説明（style.js など）から、分類のコードと名前（切土地・農耕平坦化地・干拓地・盛土地・埋立地・改変工事中）の対応を記録する
- [ ] **Step 2: P4・P5 A54** — https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A54-2023.html で 2023 年版より新しい版が無いか確かめる。全国の GeoJSON（都道府県ごとの ZIP）の合計の大きさ、地物の数、属性名（`A54_001` など）を記録する。ダウンロードした ZIP はリポジトリに入れない（`/tmp` 以外の作業用ディレクトリ、例えば `.handoff/a54-src/`）
- [ ] **Step 3: P1・P2 計測時期** — 熱海の DEM1A・酒々井の DEM5A が、それぞれの事故・盛土の前か後かを、公開情報（地理院の「基盤地図情報 数値標高モデル」の整備状況の説明、年度別の航空レーザ計測の範囲など）で調べる。分からなければ「不明」と書く（止めない）
- [ ] **Step 4: 記録をコミット** — `spec 09 の着手前の確かめ（人工地形の属性・A54 の大きさ・計測時期）`

---

### Task 3: A54 を静的ファイルにする

spec 4.4・R09-6。サイトの `public/` から配信する。形を変えない（クリップも単純化もしない。座標を小数 6 桁に丸めるだけ）ので、加工は「形式の変換と分割」だけ。

**Files:**
- Create: `scripts/build-a54.ts`（`node scripts/build-a54.ts <GeoJSON のあるディレクトリ> <出力先>` で動く。Node の組み込みだけを使う）
- Create: `public/data/a54/10/{x}/{y}.json`（生成物）、`public/data/a54/SOURCE.md`
- Test: `scripts/build-a54.test.ts`

**Interfaces:**
- Produces: タイル `public/data/a54/10/{x}/{y}.json` は `{ "features": [{ "type": "valley" | "side" | "unclassified", "rings": [[[lon, lat], ...], ...] }] }`。ポリゴンの外接矩形が重なる z10 タイルすべてに同じ地物を入れる（重複してよい）。地物の無いタイルはファイルを作らない
- Produces: `export const A54_TILE_Z = 10` を `src/dem/fillHistory/constants.ts` に置く（Task 8 が使う）

- [ ] **Step 1: 失敗するテストを書く** — `scripts/build-a54.test.ts` で、関数 `tilesForFeature(feature): Array<{x,y}>` と `convertFeature(geojsonFeature): A54Feature` を確かめる
  - 谷埋め型（`A54_001 === 1`）→ `'valley'`、腹付け型（2）→ `'side'`、9 → `'unclassified'`（属性名は Task 2 の記録に合わせる）
  - MultiPolygon は複数の地物に分ける
  - 座標は小数 6 桁に丸める
  - 外接矩形が z10 タイルの境をまたぐと、両方のタイルを返す
- [ ] **Step 2: 走らせて失敗を確かめる** — `pnpm vitest run scripts/build-a54.test.ts`
- [ ] **Step 3: 実装する** — `tilesForFeature`・`convertFeature` と、ディレクトリを読み込んで書き出す `main`。`SOURCE.md` には、元のデータ（国土数値情報 大規模盛土造成地 A54 2023 年版）、取得日、URL、加工の内容（GeoJSON から z10 タイルごとの JSON に分割、座標を小数 6 桁に丸めた）、出典の文言、ライセンス（CC BY 4.0、PDL1.0）を書く
- [ ] **Step 4: 生成して大きさを確かめる** — `node scripts/build-a54.ts .handoff/a54-src public/data/a54`。合計の大きさとファイル数を記録に足す。**合計が 30 MB を超える、またはファイル数が 5,000 を超えるなら、コミットせずに止めて相談する**。1 ファイルが 25 MiB を超えないこと
- [ ] **Step 5: 通ることを確かめる** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build`。`dist/data/a54/` に出ること
- [ ] **Step 6: コミット** — `国土数値情報 A54（大規模盛土造成地）を z10 のタイルに分けた静的ファイルにする`

---

### Task 4: 昔の標高を今の格子に補間する

spec 3.1。`dem_png` z14 の画素の**中心**（画素 i の中心は i + 0.5）を基準に双線形補間する（05 の S で見つけた画素の角と中心の取り違えに注意）。

**Files:**
- Create: `src/dem/fillHistory/constants.ts`、`src/dem/fillHistory/resamplePast.ts`
- Test: `src/dem/fillHistory/resamplePast.test.ts`

**Interfaces:**
- Consumes: `TileLookup`・`DemTileData`（`src/dem/DemGrid.ts`）、`TileCoord`・`TILE_SIZE`・`tilesInPixelRect`（`src/dem/tileMath.ts`）
- Produces:
  - `export const PAST_Z = 14`
  - `export interface GridFrame { z: number; originX: number; originY: number; size: number; cellSizeM: number }`（`TerrainGeo` を構造的に代入できる）
  - `export function pastTileCoords(frame: GridFrame): TileCoord[]` — 範囲を z14 に写し、周りに 1 画素足した矩形を覆うタイル
  - `export function resamplePast(frame: GridFrame, lookup: TileLookup): Float32Array` — 長さ size²。補間に使う 4 画素のどれかが無効（タイルが無い・`validMask` が 0）なら `NaN`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// 1 枚の z14 タイルで、標高 = 画素の列番号（x）とする
it('z14 の格子ではそのまま画素の値になる', () => { /* frame.z = 14、origin を画素に合わせる → past[i] === 列番号 */ })
it('z17 では画素の中心を基準に補間する: z17 のセル (8k+3.5)/8 = k+0.4375 → x 方向の値は k + 0.4375 − 0.5 の補間', () => {
  // frame = { z: 17, originX: 8 * 100, originY: 8 * 100, size: 16, cellSizeM: 1 }
  // セル (col=3, row=3) の中心は z17 で 803.5 → z14 で 100.4375 → u = 99.9375 → 列番号の値 99.9375
  expect(past[3 * 16 + 3]).toBeCloseTo(99.9375, 6)
})
it('4 画素のどれかが無効なら NaN', () => { /* validMask の 1 画素を 0 にし、その周りのセルが NaN */ })
it('タイルが無ければ NaN（海・404）', () => { /* lookup が undefined を返す */ })
it('タイルの境をまたぐ補間は隣のタイルを読む', () => { /* 2 枚のタイル。境のセルが両側の値の間 */ })
it('pastTileCoords は周りの 1 画素を含めて覆う', () => { /* 範囲が z14 のタイルの左端ちょうどから始まると、左隣のタイルも入る */ })
```

- [ ] **Step 2: 走らせて失敗を確かめる** — `pnpm vitest run src/dem/fillHistory/resamplePast.test.ts`
- [ ] **Step 3: 実装する** — セルの中心の z14 の座標は `p = (origin + i + 0.5) / 2^(z − 14)`、補間の座標は `u = p − 0.5`、`i0 = floor(u)`、重み `u − i0`
- [ ] **Step 4: 走らせて通ることを確かめる**
- [ ] **Step 5: コミット** — `spec 09: 昔の標高（dem_png z14）を今の格子に補間する`

---

### Task 5: 差とずれの補正

spec 3.2・3.3（R09-4）。

**Files:**
- Create: `src/dem/fillHistory/correctedDelta.ts`
- Modify: `src/dem/fillHistory/constants.ts`（`OFFSET_EXCLUDE_M = 5`）
- Test: `src/dem/fillHistory/correctedDelta.test.ts`

**Interfaces:**
- Produces: `export function correctedDelta(current: Float32Array, validMask: Uint8Array, past: Float32Array): { delta: Float32Array; offsetM: number } | null`
  - `delta[i]` は ΔZ補正 = 今 − 昔 − offsetM。今が無効（`validMask` 0）か昔が `NaN` のセルは `NaN`
  - offsetM: 有効なセルの ΔZ の中央値 m1 を取り、|ΔZ − m1| ≤ `OFFSET_EXCLUDE_M` のセルだけでもう一度中央値を取った値（2 回で止める）。2 回目に残るセルが無ければ m1
  - 有効なセルが 1 つも無ければ `null`

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('全体のずれ +0.5・+2・−3 m を取り除く（草案 §79）', () => {
  for (const shift of [0.5, 2, -3]) {
    // 昔: 傾斜面、今: 昔 + shift、ただし 10% のセルに +10 m の台
    const { delta, offsetM } = correctedDelta(current, mask, past)!
    expect(offsetM).toBeCloseTo(shift, 6)
    expect(delta[flatIndex]).toBeCloseTo(0, 6)
    expect(delta[blockIndex]).toBeCloseTo(10, 6)
  }
})
it('台が多くても（40%）、外れを除いた 2 回目の中央値はずれに近い', () => { /* offsetM が shift ± 0.01 */ })
it('今が無効・昔が NaN のセルは NaN', () => {})
it('有効なセルが無ければ null', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**（中央値は `Float64Array` に写して `sort`）
- [ ] **Step 5: コミット** — `spec 09: 標高差を出し、範囲の中央値でずれを補正する`

---

### Task 6: 標高差の大きい範囲（かたまり）を見つける

spec 3.4。

**Files:**
- Create: `src/dem/fillHistory/findCandidates.ts`
- Modify: `src/dem/fillHistory/constants.ts`（`FILL_THRESHOLD_M = 5`、`FILL_MIN_AREA_M2 = 500`）
- Test: `src/dem/fillHistory/findCandidates.test.ts`

**Interfaces:**
- Consumes: `GridFrame`（Task 4）
- Produces:
  - `export interface CandidateStats { id: number; cellCount: number; areaM2: number; maxRiseM: number; volumeM3: number; centroid: { col: number; row: number }; bbox: { col0: number; row0: number; col1: number; row1: number } }`（col1・row1 は含む）
  - `export function findCandidates(delta: Float32Array, frame: GridFrame): { labels: Int32Array; candidates: CandidateStats[] }`
  - `labels` は候補のセルに候補の `id`（1 から、面積の大きい順に振り直す）、それ以外は 0。捨てたかたまりのセルも 0
  - `volumeM3 = Σ delta × cellSizeM²`（かたまりのセルだけ）、`areaM2 = cellCount × cellSizeM²`、`centroid` はセルの番号の平均（小数）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('盛る: 高さ 10 m・20×20 セル（1 m セル）の台 → 候補 1 つ、面積 400 m² は 500 m² 未満で捨てる', () => {})
it('盛る: 高さ 10 m・30×30 セルの台 → 面積 900、最大 10、体積 9000', () => {
  expect(candidates).toEqual([expect.objectContaining({ id: 1, areaM2: 900, maxRiseM: 10, volumeM3: 9000 })])
})
it('削る: −10 m の穴 → 候補は出ない（切土は一覧に出さない）', () => {})
it('+4.99 m は候補にならない、+5 m はなる', () => {})
it('斜めにだけ接する 2 つの台は別のかたまり（4 近傍）', () => {})
it('1 セルだけの +10 m は捨てられる', () => {})
it('id は面積の大きい順', () => {})
it('NaN のセルは候補にならず、かたまりを分ける', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**（幅優先の塗り。再帰を使わない）
- [ ] **Step 5: コミット** — `spec 09: 標高差 +5 m 以上のかたまりを見つけ、面積・最大・参考の体積を出す`

---

### Task 7: 根拠（A54・人工地形）のラスタ化と段階

spec 3.5。

**Files:**
- Create: `src/dem/fillHistory/evidence.ts`
- Modify: `src/dem/fillHistory/constants.ts`（`EVIDENCE_MIN_FRACTION = 0.1`）
- Test: `src/dem/fillHistory/evidence.test.ts`

**Interfaces:**
- Consumes: `GridFrame`・`CandidateStats`（Task 4・6）、`pixelToLonLat`（`src/dem/tileMath.ts`）
- Produces:
  - `export type LonLatRing = ReadonlyArray<readonly [number, number]>`
  - `export interface EvidencePolygon { rings: readonly LonLatRing[]; a54Type?: 'valley' | 'side' | 'unclassified' }`（最初の環が外周、残りが穴）
  - `export function rasterizePolygons(frame: GridFrame, polygons: readonly EvidencePolygon[]): Int32Array` — セルの中心がポリゴンの中なら、そのポリゴンの番号 + 1。中に無ければ 0。穴の中は外。外接矩形で先に絞る
  - `export type EvidenceLevel = 'strong' | 'moderate' | 'limited'`
  - `export interface CandidateEvidence { level: EvidenceLevel; sources: Array<'a54' | 'landform'>; a54Type?: 'valley' | 'side' | 'unclassified' }`
  - `export function classifyEvidence(labels: Int32Array, candidates: readonly CandidateStats[], a54: { mask: Int32Array; polygons: readonly EvidencePolygon[] } | null, landform: Int32Array | null): Map<number, CandidateEvidence>` — 候補のセルのうち `EVIDENCE_MIN_FRACTION` 以上が A54 の中 → `strong`（`a54Type` は最も多く重なった A54 の型）。そうでなく人工地形の中 → `moderate`。それ以外 → `limited`。両方なら `strong` で `sources` は両方。`null`（読めなかった）は重ならないとみなす

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('正方形のポリゴンの中のセルだけが 1 になる。穴の中は 0', () => {})
it('候補の 10% が A54 と重なれば strong、9% なら重ならない', () => {})
it('人工地形だけ → moderate、両方 → strong で sources は 2 つ、無し → limited', () => {})
it('A54 が null（読めなかった）でも例外にならず、人工地形で判定する', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**（点と多角形は偶奇の交差の判定）
- [ ] **Step 5: コミット** — `spec 09: A54・人工地形のポリゴンを格子に写し、根拠の段階を決める`

---

### Task 8: Worker で取得して計算する

spec 4.1・4.5。Worker は格子を持たないので、メインが今の標高とマスクの写しを送る。

**Files:**
- Modify: `src/shared/protocol.ts`
- Create: `src/workers/fillHistory.ts`
- Modify: `src/workers/simulation.worker.ts`（switch に `fillHistory`）
- Test: `src/workers/fillHistory.test.ts`

**Interfaces:**
- Consumes: Task 4〜7 の関数、`createGsiTileFetcher`（`src/workers/demLoader.ts`）、`A54_TILE_Z`
- Produces（`src/shared/protocol.ts`）:

```ts
export interface FillCandidate {
  id: number
  areaM2: number
  maxRiseM: number
  volumeM3: number
  centroid: { lon: number; lat: number }
  evidence: 'strong' | 'moderate' | 'limited'
  evidenceSources: Array<'a54' | 'landform'>
  a54Type?: 'valley' | 'side' | 'unclassified'
}
export interface FillHistoryPayload {
  terrainId: number
  pastElevation: Float32Array // NaN は無効
  deltaCorrected: Float32Array // NaN は無効
  candidateLabels: Int32Array
  offsetM: number
  candidates: FillCandidate[] // 根拠が強い順、次に体積の大きい順
  a54Polygons: Array<{ rings: Array<Array<[number, number]>>; a54Type: 'valley' | 'side' | 'unclassified' }> // 範囲にかかる分だけ（地図に描く）
  landformPolygons: Array<{ rings: Array<Array<[number, number]>>; code: string }>
  a54Available: boolean
  landformAvailable: boolean
}
// MainToWorkerMessage に足す
| { type: 'fillHistory'; requestId: number; terrainId: number; geo: TerrainGeo; elevation: Float32Array; validMask: Uint8Array }
// WorkerToMainMessage に足す
| { type: 'fillHistoryReady'; requestId: number; result: FillHistoryPayload }
| { type: 'fillHistoryFailed'; requestId: number; reason: 'unavailable' | 'no-overlap' | 'network' | 'internal'; message: string }
```

- `src/workers/fillHistory.ts`:
  - `export async function computeFillHistory(input: { terrainId: number; geo: TerrainGeo; elevation: Float32Array; validMask: Uint8Array }, deps: { fetchDem: FetchDemTile; fetchJson: (url: string) => Promise<unknown | null> }): Promise<FillHistoryPayload>`
  - `geo.level === 3` → `FillHistoryError('unavailable')`。`correctedDelta` が `null` → `FillHistoryError('no-overlap')`
  - `dem_png` は `pastTileCoords` の分を `fetchDem('dem10b', tile)`。404 は `TileLookup` で `undefined`
  - A54 は `/data/a54/10/{x}/{y}.json`（範囲を覆う z10 タイル）。404 は地物なし。ネットワークの失敗・形式の誤りは `a54Available: false`
  - 人工地形は範囲を覆う z16 タイル。Task 2 の記録の属性で「盛土地・埋立地」を根拠に使い、地図には切土地・改変工事中も含めて返す。失敗は `landformAvailable: false`
  - `fetchJson` は 404 で `null`、それ以外の失敗で reject。本物は `fetch` に `createGsiTileFetcher` と同じ再試行（0.5・1・2 秒）と 20 秒の上限
- Worker は `fillHistory` を受けたら `computeFillHistory` を走らせ、`fillHistoryReady`（配列は Transferable）か `fillHistoryFailed` を返す。新しい `fillHistory` や `loadTerrain` が来たら前の計算を `AbortController` で取り消し、応答を送らない

- [ ] **Step 1: 失敗するテストを書く**（`fetchDem`・`fetchJson` は偽物）

```ts
it('段 3 の地形は unavailable', async () => {})
it('dem_png がすべて 404 なら no-overlap', async () => {})          // Review Focus 2
it('人工地形の取得が失敗しても、標高差と候補は返り landformAvailable は false', async () => {}) // Review Focus 3
it('A54 のタイルが 404 なら地物なしで a54Available は true、失敗なら false', async () => {})
it('台のある地形で候補が 1 つ返り、中心の経緯度が台の中心', async () => {})
it('候補の並びは根拠が強い順、次に体積の大きい順', async () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 09: Worker で昔の標高・A54・人工地形を取得し、標高差の大きい範囲を計算する`

---

### Task 9: メインの依頼・状態・後始末

spec 4.6。オン・オフは保存しない画面の一時状態にする（私の判断。設定の schema を変えない）。

**Files:**
- Modify: `src/bridge/SimulationClient.ts`
- Modify: `src/state/appStore.ts`
- Create: `src/ui/fillHistorySession.ts`
- Modify: `src/ui/terrainSession.ts`（`FillHistorySession` を作り、`attach` でつなぐ）
- Test: `src/bridge/SimulationClient.test.ts`、`src/state/appStore.test.ts`、`src/ui/fillHistorySession.test.ts`

**Interfaces:**
- Produces（`SimulationClient`）: `computeFillHistory(terrainId: number, terrain: TerrainPayload): Promise<FillHistoryPayload>`。`elevation`・`validMask` は `slice()` して転送する。前の依頼は `FillHistoryLoadError('superseded')` で失敗させる。Worker の異常終了で `FillHistoryLoadError('worker')`
- Produces（`appStore`）:

```ts
export type FillHistoryStatus = 'off' | 'loading' | 'ready' | 'unavailable' | 'no-overlap' | 'failed'
export interface FillHistorySummary {
  offsetM: number
  candidates: FillCandidate[]
  a54Available: boolean
  landformAvailable: boolean
}
// AppState に足す
fillHistory: { enabled: boolean; status: FillHistoryStatus; summary: FillHistorySummary | null; selectedId: number | null }
terrainEpoch: 'now' | 'past'
// AppActions に足す
setFillHistoryEnabled(enabled: boolean): void   // false で status 'off'・summary null・selectedId null・terrainEpoch 'now'
setFillHistoryResult(status: FillHistoryStatus, summary: FillHistorySummary | null): void
selectFillCandidate(id: number | null): void
setTerrainEpoch(epoch: 'now' | 'past'): void
```

  `selectPoint` は `fillHistory` を `{ enabled: そのまま, status: enabled ? 'loading' : 'off', summary: null, selectedId: null }` に、`terrainEpoch` を `'now'` に戻す
- Produces（`FillHistorySession`）:
  - `constructor(client: SimulationClient, app: AppStore, simulation: SimulationSession)`
  - `result(): FillHistoryPayload | null`（大きな配列はストアに置かない）
  - `onResult(listener: (result: FillHistoryPayload | null) => void): () => void`（overlay と 3D が購読する）
  - 地形が読み込まれた（`simulation.onTerrain`）とき、または `enabled` が true になったときに、地形があれば `computeFillHistory` を頼む。応答の `terrainId` が今の地形と違えば捨てる

- [ ] **Step 1: 失敗するテストを書く**

```ts
// fillHistorySession.test.ts（client は偽物）
it('オンにすると今の地形で依頼し、結果で ready と summary を入れる', async () => {})
it('計算中に新しい地形が来たら、古い応答を捨て、新しい地形で依頼し直す', async () => {})   // Review Focus 1
it('計算中にオフにしたら、応答が来ても描かない（result は null のまま）', async () => {})   // Review Focus 1
it('unavailable・no-overlap の失敗はその status に、network・internal・worker は failed に', async () => {})
// appStore.test.ts
it('オフのままなら、地形を読み込んでも computeFillHistory を呼ばない（spec 4.1 オフのときに通信を増やさない）', async () => {})
it('selectPoint で fillHistory はオンのまま loading に戻り、terrainEpoch は now に戻る', () => {})
it('setFillHistoryEnabled(false) で terrainEpoch は now に戻る', () => {})              // Review Focus 5
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 09: 盛土の履歴の計算をメインから頼み、状態と結果を持つ`

---

### Task 10: 地図に描く

spec 4.2。

**Files:**
- Create: `src/map/fillColormap.ts`、`src/map/FillHistoryOverlay.ts`
- Modify: `src/map/layerIds.ts`
- Modify: `src/ui/terrainSession.ts`（`onRestyle` で `restore`、`FillHistorySession.onResult` で `show`）
- Test: `src/map/fillColormap.test.ts`、`src/map/layerIds.test.ts`、`src/map/FillHistoryOverlay.test.ts`

**Interfaces:**
- Produces（`layerIds.ts`）: `export const FILL_LAYER_IDS = { delta: 'fill-delta', landform: 'fill-landform', a54: 'fill-a54', markers: 'fill-markers' } as const`。`OVERLAY_LAYER_ORDER` に、`TERRAIN_LAYER_IDS.depressions` の直後へ `delta`・`landform`・`a54` の順、`TERRAIN_LAYER_IDS.markers` の直後に `markers` を入れる
- Produces（`fillColormap.ts`）: `export function fillDeltaRgba(delta: Float32Array, labels: Int32Array, size: number, selectedId: number | null): Uint8ClampedArray`
  - |Δ| < 5 または NaN → 透明（α 0）
  - Δ ≥ 5 → 赤系。+5 で薄く、+20 以上で濃い（線形。色は `overlayColors.ts` に定数で置く）
  - Δ ≤ −5 → 青系（対称）
  - 候補の縁のセル（4 近傍に別の label がある候補のセル）→ 濃い灰の縁。`selectedId` の縁は目立つ色（黄）
- Produces（`FillHistoryOverlay`）: `constructor(map, whenMapLoaded)`、`show(result: FillHistoryPayload, geo: TerrainGeo, selectedId: number | null): void`、`setSelected(id: number | null): void`、`clear(): void`、`restore(): void`
  - delta: canvas ソースを `geo.corners` に置く（`TerrainOverlay` と同じ作り）
  - a54・landform: GeoJSON ソースで線と薄い塗り。a54 のソースに `attribution: strings.fillHistory.a54Attribution` を渡す（map は strings を import できないので、文言はコンストラクタで受ける）
  - markers: 候補の中心の circle と、`#id` の symbol
- `terrainSession`: 地図で `fill-markers` に当たったクリックは `selectFillCandidate(id)` にする（既存の `markersAt` と同じく ±4 px）。オフ・新しい地点で `clear()`

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('fillDeltaRgba: +4.9 は透明、+5 は赤、−5 は青、NaN は透明', () => {})
it('fillDeltaRgba: 選んだ候補の縁は黄、他の縁は灰', () => {})
it('OVERLAY_LAYER_ORDER: fill-delta は窪地の上・水深の下、fill-markers は一番上', () => {})
it('FillHistoryOverlay.restore で 4 つのレイヤーを足し直す（ベースマップの切り替え）', () => {}) // Review Focus 4（偽の map）
it('clear で 4 つのレイヤーとソースを外す', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 09: 標高差・A54・人工地形・候補の印を地図に重ねる`

---

### Task 11: パネルとセルの情報

spec 6.1〜6.4・6.6。spec 6.3 の「一覧の行を押すとポップオーバーを開く」は、**パネルの中に選んだ候補の詳しい欄を開く**形にする（計画で決めたこと。スマートフォンの下のパネルでもポップオーバーと重ならない。10 の「崩れたと仮定する」のボタンもこの欄に入れる）。

**Files:**
- Modify: `src/ui/strings.ts`（`fillHistory` の項）
- Create: `src/ui/components/FillHistorySection.tsx`
- Modify: `src/ui/components/Panel.tsx`（表示の設定の後、越流の一覧の前に置く）
- Modify: `src/ui/cellInfo.ts`、`src/ui/components/CellInfoPopover.tsx`、`src/ui/components/CellInfoHost.tsx`
- Modify: `src/ui/format.ts`（`formatVolumeApprox`）
- Test: `src/ui/components/FillHistorySection.test.tsx`、`src/ui/cellInfo.test.ts`、`src/ui/format.test.ts`

**Interfaces:**
- Consumes: `AppStore` の `fillHistory`（Task 9）、`FillHistorySession.result()`
- Produces:
  - `formatVolumeApprox(m3: number): string` — 有効数字 2 桁。1 万 m³ 以上は「約 4.5 万 m³」、未満は「約 4,500 m³」、100 未満は「約 50 m³」
  - `cellInfoAt(terrain, water, lon, lat, history?: { past: Float32Array; delta: Float32Array })` は、`history` があれば `kind: 'value'` に `pastM: number | null; deltaM: number | null` を足す（NaN は null）
- 文言（`strings.fillHistory`。spec 6.2〜6.5 の文をそのまま使う）:
  - `title: '盛土の履歴'`、`enable: '昔と今の地形を比べる'`
  - `unavailable: 'この範囲は今の地形も 10 m の標高（DEM10B）のため、昔と比べられません'`
  - `noOverlap: '昔と今の両方に標高があるセルがありません'`
  - `failed: '昔の標高を読み込めませんでした'`
  - `landformFailed: '人工地形の分類を読み込めませんでした。根拠の判定に使っていません'`
  - `a54Failed: '大規模盛土造成地のデータを読み込めませんでした。根拠の判定に使っていません'`
  - `past: '昔: 10 m の標高（DEM10B。1/25,000 地形図から作成。地形の時期は地域によりおおむね 1990〜2000 年頃）'`
  - `now: (dem: string) => \`今: ${dem}\``（`formatDemLabel` の結果を入れる）
  - `offset: (m: string) => \`昔と今の標高の基準のずれ ${m} m を差し引いています\``
  - `listTitle: '標高差の大きい範囲'`、`none: '+5 m 以上の標高差の大きい範囲はありません'`
  - 行: `#${id}`、面積、最大の上昇（`+${m} m`）、`参考の体積 ${formatVolumeApprox}`、`根拠: 強い／中くらい／限られる`
  - 詳しい欄: 上に加えて、A54 と重なれば「大規模盛土造成地に含まれます（谷埋め型／腹付け型）」、人工地形と重なれば「人工地形の分類で盛土地とされています」
  - `notice`: spec 6.4 の注意書きの全文
  - `a54Attribution: '大規模盛土造成地：国土数値情報（大規模盛土造成地データ）（国土交通省）を加工して作成'`
  - セルの情報: `pastElevation: '昔の標高'`、`nowElevation: '今の標高'`、`delta: '差（補正後）'`
- 一覧の行を押すと `selectFillCandidate(id)` と、地図を候補の中心へ `easeTo`（`TerrainSession` に `focusFillCandidate(id)` を足す）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('スイッチをオンにすると setFillHistoryEnabled(true)', async () => {})
it('ready で一覧が根拠の強い順に出て、行を押すと選ばれ、詳しい欄が開く', async () => {})
it('A54 と重なる候補の詳しい欄に「大規模盛土造成地に含まれます（谷埋め型）」', () => {})
it('unavailable・no-overlap・failed・landformFailed の文言が出る', () => {})
it('オンの間は注意書きが出て、文言に「危険」「盛土の候補」「盛土相当」を含まない', () => {
  expect(document.body.textContent).not.toMatch(/危険|盛土の候補|盛土相当|崩壊確率/)
})
it('formatVolumeApprox: 45169 → 約 4.5 万 m³、4520 → 約 4,500 m³、48 → 約 48 m³', () => {})
it('cellInfoAt: history があれば昔の標高と差を返し、NaN は null', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 09: パネルに盛土の履歴の一覧と注意書きを出し、セルの情報に昔の標高と差を足す`

---

### Task 12: 3D で昔と今を切り替える

spec 4.3・R09-5。

**Files:**
- Modify: `src/map/view3d/View3d.ts`（`setPastElevation`、`ensureRange`）
- Modify: `src/ui/view3dSession.ts`（`View3dLike` に `setPastElevation`、ストアの `terrainEpoch` と `FillHistorySession.onResult` を購読）
- Create: `src/ui/components/TerrainEpochToggle.tsx`（`ViewModeToggle` の下。3D で `fillHistory.status === 'ready'` のときだけ出す）
- Modify: `src/ui/App.tsx`、`src/ui/strings.ts`（`epoch: { label: '地形の時期', past: '昔', now: '今' }`）
- Test: `src/ui/view3dSession.test.ts`、`src/ui/components/TerrainEpochToggle.test.tsx`

**Interfaces:**
- Produces: `View3dLike.setPastElevation(past: Float32Array | null): void`。`View3d` は past が非 null のとき、`ensureRange` で `fillInvalidNearest(past, mask = Number.isFinite で作る, size, size)` を範囲の標高にし、`this.range` を作り直して `terrain3d.setRange` を呼び（generation が進む）、水面を外す（`removeWater`。`ensureWater` を呼ばない）。null に戻すと今の地形の範囲と水面に戻す
- `View3dSession` は `terrainEpoch === 'past'` かつ結果があるときだけ `setPastElevation(result.pastElevation)`、それ以外は `null`

- [ ] **Step 1: 失敗するテストを書く**（`View3dLike` は偽物）

```ts
it('3D で「昔」にすると setPastElevation に昔の標高が渡る', () => {})
it('「昔」のまま新しい地点を読み込むと null に戻る（terrainEpoch は now）', () => {})    // Review Focus 5
it('「昔」のまま盛土の履歴をオフにすると null に戻る', () => {})                       // Review Focus 5
it('「昔」のまま 2D に戻すと null に戻る（terrainEpoch を now に戻す）', () => {})        // Review Focus 5
it('TerrainEpochToggle は 3D かつ ready のときだけ出る', () => {})
```

- [ ] **Step 2〜4: 失敗 → 実装 → 通過**
- [ ] **Step 5: コミット** — `spec 09: 3D で範囲の中の地形を昔と今で切り替える（昔のときは水を隠す）`

---

### Task 13: E2E

spec 7.2。

**Files:**
- Modify: `tests/e2e/support/gsi.ts`（応答に PNG の `Buffer` を返せるようにし、人工地形の GeoJSON を返す `landform` を足す。`encodeDemPng(width, height, elevationAt: (x, y) => number | null): Buffer` を足す）
- Create: `tests/e2e/fillHistory.spec.ts`
- Create: `tests/fixtures/fill/a54.json`（範囲にかかる 1 つの A54 のポリゴン）

**Interfaces:**
- Consumes: `routeGsi`、`acknowledgeDisclaimer`、`clickMap`、`waitTerrain`、`switchTo3d`、`mapElement`

- 地形の作り: `dem1a_png` は標高 10 m の平面に、各タイルの中央 64×64 画素だけ 30 m の台。`dem_png` は 10 m の平面。台はセルの 25% 未満なので中央値のずれは 0 で、台が「標高差の大きい範囲」になる
- A54 は `context.route('**/data/a54/**', …)` で、クリックする地点の z10 タイルにだけ `a54.json` を返す

- [ ] **Step 1: テストを書く**

```ts
test('オンにすると標高差のレイヤーと一覧が出て、行を押すと詳しい欄が開く', async ({ page }) => {
  // 'fill-delta' が data-overlay-layers に入る。一覧の 1 行目に「根拠: 強い」
})
test('今の地形が DEM10B の範囲では、比べられないと知らせる', async () => {
  // dem1a・dem5 を missing、dem_png だけ。文言 strings.fillHistory.unavailable
})
test('人工地形の取得が失敗しても、一覧は出て、失敗の知らせが出る', async () => {})
test('3D で「昔」にすると水の 3D レイヤーが消え、「今」で戻る', async () => {})
test('出典に「加工して RainTrace が作成」と、オンのとき A54 の出典が出る', async () => {})
```

- [ ] **Step 2: 走らせる** — `pnpm build && pnpm exec playwright test --project=chromium --project=chromium-3d tests/e2e/fillHistory.spec.ts`、期待: PASS
- [ ] **Step 3: 全体の E2E** — `pnpm exec playwright test --project=chromium --project=chromium-3d`、期待: 既存の 51 件を含めてすべて PASS
- [ ] **Step 4: コミット** — `spec 09: 盛土の履歴の E2E`

---

### Task 14: 実際の場所での確かめと性能の記録

spec 3.6・7.3。合否はユーザーが見て決める（数値で判定しない）。

**Files:**
- Create: `scripts/fill-history-check.ts`（`node scripts/fill-history-check.ts <lat> <lon> <sizeM>`。実際の地理院タイルを取り、`src/dem/fillHistory/` の関数で計算し、使った DEM・ずれ・候補（面積・最大・体積）・計算時間を出す。PNG の復号は `tests/e2e/support/png.ts` の `decodePng` を使う）
- Create: `docs/perf/2026-10-19-fill-history.md`

- [ ] **Step 1: 熱海と酒々井で走らせる** — 熱海 `35.1224 139.0706 500`・`1000`、酒々井 `35.7086 140.2634 500`・`1000`
- [ ] **Step 1b: 位置のずれの記録（spec 7.1・草案 §78）** — スクリプトに `--shift-past <m>` を足し、昔の標高を東へ 1・2・5 m ずらして熱海で走らせ、ずらさないときより増えた候補の数と面積を記録する（合否ではなく記録）
- [ ] **Step 2: アプリでスクリーンショットを撮る** — `pnpm build && node scripts/preview.mjs` で開き、同じ地点で盛土の履歴をオンにし、2D と 3D の「昔」「今」を撮る（`.handoff/09-screenshots/`）
- [ ] **Step 3: 記録する** — 場所・範囲・使った DEM・ずれの補正値・候補の面積と体積と根拠・計算時間（目安 1 秒以内。超えたら記録して報告）・スクリーンショットの場所。Task 2 の計測時期の調べの結果と並べる
- [ ] **Step 4: コミット** — `spec 09: 熱海と酒々井で盛土の履歴を確かめた記録`

---

### Task 15: 文書を更新する

**Files:**
- Modify: `docs/superpowers/specs/2026-09-10-00-overview.md`（§3 に 09・10 の行、§6 に R09-1〜R09-7。裁定の列は「承認（推奨どおり）（2026-10-19）」、R09-1 と Q1 はユーザー）
- Modify: `specs/tech-spec.md`（§7.4 に `dem_png` を盛土の履歴でも使うこと、§16 の出典、§14.2 の測った大きさ）
- Modify: `docs/superpowers/specs/2026-10-18-09-fill-history-design.md`（Status を「実装済み」に。計画で決めたこと〈オン・オフは保存しない、詳しい欄はパネルの中〉を本文に反映）

- [ ] **Step 1: 書き換える**
- [ ] **Step 2: 全部の確かめ** — `pnpm lint && pnpm typecheck && pnpm test && pnpm depcheck && pnpm build && pnpm size && pnpm licenses`、期待: すべて通る
- [ ] **Step 3: コミット** — `spec 09: overview・tech-spec・spec の状態を更新する`
