import { isValidAmountMm, isValidRadiusM, type RangeSizeM } from '../state/persistedSettings'

// 数字だけを受け付ける（Number() は '1e3'・'0x10'・' ' なども数にする）
const INTEGER = /^\d+$/
const DECIMAL = /^\d+(\.\d+)?$/

/** 雨量（1〜1000mm の整数）。範囲外・数でなければ null（spec 04 §9） */
export function parseAmountMm(text: string): number | null {
  const trimmed = text.trim()
  if (!INTEGER.test(trimmed)) return null
  const value = Number(trimmed)
  return isValidAmountMm(value) ? value : null
}

/** 半径（1m〜範囲の一辺の半分）。範囲外・数でなければ null（spec 04 §9） */
export function parseRadiusM(text: string, sizeM: RangeSizeM): number | null {
  const trimmed = text.trim()
  if (!DECIMAL.test(trimmed)) return null
  const value = Number(trimmed)
  return isValidRadiusM(value, sizeM) ? value : null
}
