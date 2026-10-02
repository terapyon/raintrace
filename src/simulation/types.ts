/**
 * エンジンのインターフェースと型（tech-spec §6.2、spec 03 §3.10、spec 08 §5.1）。
 * 実装（TsSimulationEngine、将来の WASM 実装）はこのインターフェースだけを満たす
 */

export interface TerrainMeta {
  /** 列数 */
  width: number
  /** 行数 */
  height: number
  /** セルの一辺（m）。tech-spec §7.6 */
  cellSizeM: number
}

/** 雨（spec 08 §4.1〜§4.3、§5.1）。時間雨量 × 継続時間で、円か範囲全体に降らせる */
export interface RainfallInput {
  /** グリッドの北西端から東向きの距離（m） */
  x: number
  /** グリッドの北西端から南向きの距離（m） */
  y: number
  /** 円の半径（m）。wholeRange のときは使わない */
  radiusM: number
  /** 時間雨量（mm/h）。durationS = 0 のときは一度に置く雨の量（mm） */
  intensityMmPerH: number
  /** 継続時間（s）。0 は開始のときに一度に置く（テスト用。UI からは選べない） */
  durationS: number
  /** 範囲全体に降らせる（R08-4） */
  wholeRange: boolean
}

export interface SimulationEvent {
  /** 窪地の最低点の水位が spill 標高 − 1cm に達した（base-spec §21） */
  type: 'spill'
  step: number
  /** 経過時間（s） */
  timeS: number
  depressionId: number
  spillElevation: number
}

/** 自動停止の理由（spec 08 §3.9）。settled は水の動きがほぼ止まった、cap は雨がやんでから上限の時間に達した */
export type StopReason = 'settled' | 'cap'

export interface StepStats {
  /** 実行済みの step 数（base-spec §33 の「Step N」） */
  step: number
  /** 累積の投入水量（m³） */
  totalWater: number
  /** 領域内にある現在の水量 Σ h × A（m³） */
  storedWater: number
  /** 累積の領域外流出量（m³） */
  outflowWater: number
  /** 最大水深（m） */
  maxDepth: number
  /** 水深が描画閾値（1cm）以上のセルの面積（m²） */
  floodedArea: number
  /**
   * 雨が終わっていて、すべての面の流速が停止の流速未満という状態が SETTLE_HOLD_S 続いた（どのセルの水深も
   * DRY_DEPTH_M 以下ならすぐ。spec 08 §3.9）。雨の間は常に false
   */
  settled: boolean
  /** totalWater − storedWater − outflowWater（m³） */
  massError: number
  /** この step で起きた越流イベント */
  events: SimulationEvent[]
  /** 経過時間（s）。降雨の開始が 0 */
  timeS: number
  /** この step の時間刻み（s） */
  dtS: number
  /** この step の終わりの時点で雨が降っている */
  raining: boolean
  /** 累積雨量（mm）= 時間雨量 × min(t, T_rain) / 3600。durationS = 0 の雨は置いた量 */
  rainDepthMm: number
  /** この step の流出量 ÷ dtS（m³/s）。統計の「流出の速さ」（spec 08 §6.2） */
  outflowRateM3PerS: number
  /** 自動停止の理由。止める条件に当たらなければ null（spec 08 §3.9、R08-6） */
  stopReason: StopReason | null
}

export interface SimulationEngine {
  loadTerrain(elevation: Float32Array, validMask: Uint8Array, meta: TerrainMeta): void
  /**
   * 雨を登録する（spec 08 §4.2）。reset の後、最初の step の前（t = 0）に呼ぶ。最初の step の後に呼ぶと Error。
   * t = 0 での 2 回目は前の登録を置き換える（一度に置いた水はそのまま残る）。
   * 雨の間は各 step の終わりに投入する。durationS = 0 はここで一度に置く
   */
  setRainfall(rain: RainfallInput): void
  step(): StepStats
  /** 水・流量・経過時間・統計・越流の通知済みの記録を戻し、雨の登録を消す。地形と窪地の一覧は残す */
  reset(): void
  /**
   * 内部の水深配列。呼び出し側は読み取り専用として扱い、転送バッファへのコピー元にのみ使う。
   * step() のたびに別の配列に入れ替わるので、step() の後は呼び直す
   */
  waterDepth(): Float64Array
  /** 越流イベントの判定に使う窪地（実装 spec 02 の地形解析の結果） */
  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void
  /**
   * 各セルの中心の流速（m/s。x は東、y は南が正。spec 08 §3.10）。水の流れの矢印用。
   * 戻り値の配列はエンジンが使い回し、次の flowVectors()・loadTerrain で上書きされる。呼び出し側はすぐに読み切る
   */
  flowVectors(): { x: Float32Array; y: Float32Array }
}
