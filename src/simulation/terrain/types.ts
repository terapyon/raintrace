/** 地形解析（spec 02 §5）の入出力の型 */

export interface TerrainGrid {
  elevation: Float32Array // 行優先。index = y * width + x
  validMask: Uint8Array // 1 = 有効、0 = 無効
  width: number
  height: number
  cellSizeM: number
}

export interface Depression {
  id: number // 1 から。窪地のラベルと同じ番号
  pitIndex: number // 窪地の中で標高が最小のセル（同じなら番号が小さいもの）
  spillIndex: number // spill point（水が溢れ出るセル。窪地の外、縁の上）
  spillElevation: number // 満水時の水面 F（m）
  maxDepthM: number // max(F − Z)
  areaM2: number // セル数 × セル面積
  capacityM3: number // Σ(F − Z) × セル面積
  cellCount: number
  significant: boolean // 表示と越流イベントの対象（R02-3）
}

export interface DepressionAnalysis {
  fill: Float32Array // 満水時の水面 F。窪地の外は Z、無効セルは 0（参照しない）
  labels: Int32Array // 窪地の id。窪地の外と無効セルは 0
  depressions: Depression[] // id の順
}
