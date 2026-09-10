# Spec 03 実装レビュー（Task 1〜9）の反映 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** spec 03 の Task 1〜9 の実装レビュー（2026-09-11、レビュー役 raintrace-19。承認・要修正なし）の推奨と軽微のうち、03 で直すものを反映する。Task 10（満水との一致）は、02 の承認の後に 02 の上へ載せ替えてから行う（この計画には含めない）。

**Spec:** `docs/superpowers/specs/2026-09-10-03-simulation-engine-design.md`（あわせて `specs/tech-spec.md` §6）。元の計画は `docs/superpowers/plans/2026-09-10-03-simulation-engine.md`

**前提:** ブランチ `feat/03-simulation-engine`（worktree `.claude/worktrees/agent-ac26de11eb4d9ed4a`、5e24e57）の上で続けて行う

## Global Constraints

- Node 24、pnpm 12.1.0。**依存を足さない**
- 書式は Biome（`pnpm format` で整えてから `pnpm lint`）
- `src/simulation/` は純粋（外部パッケージ・自ディレクトリの外を import しない）。相対 import に `.ts` を付ける
- コメントとテストの名前は日本語。既存のコードの書き方（コメントの密度、命名）に合わせる
- コミットは Task ごとに 1 つ。メッセージは日本語で、末尾に空行を置いてから、書いたモデルの `Co-Authored-By:` の行
- **ゲート（すべての Task）:** `pnpm format && pnpm lint && pnpm typecheck && pnpm depcheck && pnpm test:coverage` がすべて成功する（`src/simulation` の行カバレッジは今 100%）

## 指摘の扱い

| 指摘 | 扱い | Task |
|---|---|---|
| 軽微 5 `setDepressions` が無効セルの最低点と非有限の spill 標高を受け入れる | RangeError にする | 1 |
| 軽微 6 深さ 1cm 以下の窪地を雨なしで通知する | 最低点に水がある（`w[pitIndex] > 0`）ことを条件に足す | 1 |
| 軽微 9 ベンチマークの引数を検査しない | 正の整数でなければ使い方を出して終了コード 1 | 1 |
| 推奨 1 tech-spec §6.2 に `waterDepth()` の入れ替わりの注意が無い | 足す | 2 |
| 推奨 3 tech-spec の「Active Cell」「Set<number>」が実装と合わない | 測定条件・移行の候補・状態の表を、spec 03 §3.5 の外接矩形の走査範囲に合わせて改める | 2 |
| 推奨 4 spec 03 §6.1 の満水との一致の許容が古い | レビュー役と合意した式に改める（実装は Task 10） | 2 |
| 推奨 2・軽微 11（円が切れたときの投入量、粗い DEM での不連続） | 04 の裁定に出す（`.handoff/03-simulation-engine.md`） | — |
| 軽微 7・8・10 | 04・06 への申し送り（同上） | — |

---

### Task 1: エンジンの入力の検査と越流の判定、ベンチマークの引数（軽微 5・6・9）

**Files:**
- Modify: `src/simulation/TsSimulationEngine.ts`
- Modify: `src/simulation/spillEvents.test.ts`
- Modify: `scripts/bench-engine.ts`

**要件:**
- 軽微 5: `setDepressions` は、今の「最低点のセル番号が整数で範囲内」の検査に加えて、次を `RangeError` にする（メッセージは既存の形に合わせ、窪地の id と値を入れる）
  - 最低点が無効セル（`validMask[pitIndex] !== 1`）
  - `spillElevation` が有限でない（`!Number.isFinite(spillElevation)`。NaN との比較は常に false になり、黙って通知しなくなる）
- 軽微 6: `detectSpills` の条件に `w[d.pitIndex] > 0 &&` を足す。コメント: 「最低点が乾いている窪地は溢れていない。深さが越流の余裕（1cm）以下の窪地が、雨なしで通知されるのを防ぐ」
- 軽微 9: `scripts/bench-engine.ts` の上限の step 数は、`Number.isInteger(maxSteps) && maxSteps > 0` でなければ、`console.error` に使い方（`usage: node scripts/bench-engine.ts [上限の step 数（正の整数）]`）を出して `process.exit(1)`

**テスト（`spillEvents.test.ts`、先に書く）:**
1. 最低点が無効セルの窪地は RangeError
2. spill 標高が NaN・Infinity の窪地は RangeError
3. 深さ 5mm の窪地（spill 標高 = 最低点の標高 + 0.005）は、雨なしで step してもイベントを出さない。最低点を含む雨を入れると、その後の step で 1 回だけ出す

ベンチマークの確かめ（テストは置かない。結果を報告に書く）: `node scripts/bench-engine.ts abc; echo $?` が使い方と 1、`node scripts/bench-engine.ts 0; echo $?` も 1、`node scripts/bench-engine.ts 3` は今までどおり表を出す

- [ ] テストを書き、失敗を確かめる
- [ ] 実装し、成功を確かめる
- [ ] ベンチマークの確かめ
- [ ] ゲート
- [ ] コミット: `エンジン: setDepressions の入力の検査、乾いた窪地を越流としない（実装レビュー 軽微 5・6）、ベンチマークの引数の検査（軽微 9）`

---

### Task 2: tech-spec と spec 03 の記述を実装に合わせる（推奨 1・3・4）

**Files:**
- Modify: `specs/tech-spec.md`
- Modify: `docs/superpowers/specs/2026-09-10-03-simulation-engine-design.md`

**要件:**
- 推奨 1（tech-spec §6.2）: `SimulationEngine` のコードの `waterDepth(): Float64Array` の上に、`src/simulation/types.ts` と同じ趣旨のコメントを置く: 「内部の水深配列（読み取り専用。転送バッファへのコピー元にのみ使う）。step() のたびに別の配列に入れ替わるので、step の後に呼び直す」
- 推奨 3（tech-spec）: 実装 spec 03 §3.5 は `Set` を採らず、濡れたセルの外接矩形で走査範囲を絞った。次を改める
  - §6.3 の測定条件「DEM1A / 500m 四方 / Active Cell 有効」→「DEM1A / 500m 四方 / 濡れたセルに絞った走査（実装 spec 03 §3.5 の外接矩形）」
  - §6.4 の移行の候補 1「Active Cell の集合管理 — JS の `Set<number>` は…」→「濡れたブロックの管理 — 実装 spec 03 §3.5 の外接矩形は、濡れた場所が散らばると広がる。ブロックをビットセットで管理する方式に移すと差が出やすい（Rust では自前のビットセットで持てる）」。候補 2 の「Active Cell 方式が効かないため」→「走査範囲を絞る方式が効かないため」
  - §8.1 の状態の表の「標高、水深、Active Cell」→「標高、水深、走査範囲」
  - §14.1 の表の「Active Cell 有効」→ §6.3 と同じ測定条件
  - base-spec の用語として「Active Cell」を引いている箇所（§6.3 の概算の前置き、§6.7 の前倒しの表、§20 の一覧など）は残す。§6.3 の最初の言及の後に「（base-spec の Active Cell は、実装 spec 03 §3.5 で濡れたセルの外接矩形の走査範囲として実装した）」を足す
  - `grep -n 'Active Cell\|Set<number>' specs/tech-spec.md` の結果を、直した後に報告に書き、残したものが base-spec の用語の引用だけであることを示す
- 推奨 4（spec 03 §6.1 の「満水との一致」の行）: 「許容は θ × 窪地の幅 + 1e-9」を次に改める:
  「有効なセルで F − 1e-9 ≤ H ≤ F + θ × (d(i) + 2) + 1e-9。d(i) は、窪地の成分ごとに、成分の外の同じ標高の隣（流出口）に接する成分内のセルを起点に BFS した距離。+2 は、流出口から池への 1 ホップと、グリッドの端・無効セルに接する流出口に残る θ 以下の水の分（仮想セルは同じ標高なので、水面差がその流出口の水深になり、θ 以下で流れが止まる）。下限は、水面が低すぎる不具合（降雨の正規化や境界の流出の誤り）を捕まえる」
  - spec 03 のほかの箇所に「窪地の幅」の許容が残っていないかを grep で確かめ、あれば同じく改める

- [ ] 文書を直し、grep の結果を確かめる
- [ ] ゲート（文書だけでも lint が Markdown を見ないことを確かめる意味で回す）
- [ ] コミット: `tech-spec §6 と spec 03 §6.1 を実装に合わせる: waterDepth の入れ替わり、濡れたセルの走査範囲、満水との一致の許容（実装レビュー 推奨 1・3・4）`
