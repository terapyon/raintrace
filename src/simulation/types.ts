/**
 * エンジンのインターフェースと型（tech-spec §6.2、spec 03 §3.10）。
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

export interface RainfallInput {
  /** グリッドの北西端から東向きの距離（m） */
  x: number
  /** グリッドの北西端から南向きの距離（m） */
  y: number
  radiusM: number
  amountMm: number
}

export interface SimulationEvent {
  /** 窪地の最低点の水位が spill 標高 − 1cm に達した（base-spec §21） */
  type: 'spill'
  step: number
  depressionId: number
  spillElevation: number
}

export interface StepStats {
  /** 実行済みの step 数（base-spec §33 の「Step N」） */
  step: number
  /** 累積の投入水量（m³） */
  totalWater: number
  /** 領域内にある現在の水量 Σ W × A（m³） */
  storedWater: number
  /** 累積の領域外流出量（m³） */
  outflowWater: number
  /** 最大水深（m） */
  maxDepth: number
  /** 水深が描画閾値（1cm）以上のセルの面積（m²） */
  floodedArea: number
  /** この step で、θ を超える水面差による流れが1つも無かった */
  settled: boolean
  /** totalWater − storedWater − outflowWater（m³） */
  massError: number
  /** この step で起きた越流イベント */
  events: SimulationEvent[]
}

export interface SimulationEngine {
  loadTerrain(elevation: Float32Array, validMask: Uint8Array, meta: TerrainMeta): void
  addRainfall(rain: RainfallInput): void
  step(): StepStats
  reset(): void
  /**
   * 内部の水深配列。呼び出し側は読み取り専用として扱い、転送バッファへのコピー元にのみ使う。
   * step() のたびに別の配列に入れ替わるので、step() の後は呼び直す
   */
  waterDepth(): Float64Array
  /** 越流イベントの判定に使う窪地（実装 spec 02 の地形解析の結果） */
  setDepressions(list: { id: number; pitIndex: number; spillElevation: number }[]): void
  /** 現在の状態から計算した、各セルの流出のベクトル（水の流れの矢印用） */
  flowVectors(): { x: Float32Array; y: Float32Array }
}
