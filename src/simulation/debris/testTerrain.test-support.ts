import type { DebrisGrid } from './runout.ts'

export const SIZE = 60
export const CELL = 5
export const VALLEY_COL = 30
/** 谷筋の縦断の勾配（1 セルで下る高さ） */
export const VALLEY_DROP = 0.25
/** 東西の斜面の 1 セルあたりの高さ（30°） */
const SIDE_RISE = Math.tan(Math.PI / 6) * CELL

/** 南北に下る V 字の谷（北が上流）。東西の斜面は 30° */
function valley(r: number, c: number): number {
  return 200 - VALLEY_DROP * r + SIDE_RISE * Math.abs(c - VALLEY_COL)
}

/** 盛土: 谷の上流寄りの東の斜面に、厚さ t の土を載せる */
export const FILL = { r0: 14, r1: 22, c0: 32, c1: 37 }
function inFill(r: number, c: number): boolean {
  return r >= FILL.r0 && r <= FILL.r1 && c >= FILL.c0 && c <= FILL.c1
}

/** 盛土を載せた谷。removed = 盛土の厚さ（全部崩す） */
export function valleyWithFill(thickness: number): { grid: DebrisGrid; removed: Float32Array } {
  const elevation = new Float32Array(SIZE * SIZE)
  const removed = new Float32Array(SIZE * SIZE)
  const validMask = new Uint8Array(SIZE * SIZE).fill(1)
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = inFill(r, c) ? thickness : 0
      elevation[r * SIZE + c] = valley(r, c) + t
      removed[r * SIZE + c] = t
    }
  }
  return { grid: { elevation, validMask, size: SIZE, cellSizeM: CELL }, removed }
}

export function terrain(elevation: Float32Array, validMask: Uint8Array) {
  return { elevation, validMask, width: SIZE, height: SIZE, cellSizeM: CELL }
}
