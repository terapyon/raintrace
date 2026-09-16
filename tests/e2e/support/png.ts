import { inflateSync } from 'node:zlib'

/**
 * 8 bit・非インターレースの PNG だけを読む最小限のデコーダー（node:zlib の inflateSync だけを使う。
 * 画像ライブラリを新しく増やさない）。Playwright の page.screenshot() が出す PNG（RGB か RGBA、8 bit、
 * 非インターレース）を読めれば足りる。3D の水面が実際に描かれることを E2E で確かめるための道具
 * （Task 8 の申し送りの反映）
 */
export interface DecodedPng {
  width: number
  height: number
  /** 3（RGB）か 4（RGBA） */
  channels: number
  data: Uint8Array
}

export function decodePng(buffer: Buffer): DecodedPng {
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('PNG の署名がありません')
  }
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  const idatChunks: Buffer[] = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const data = buffer.subarray(dataStart, dataStart + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      const bitDepth = data[8]
      colorType = data[9] as number
      const interlace = data[12]
      if (bitDepth !== 8) throw new Error(`8 bit 以外の PNG は扱えません（bitDepth=${bitDepth}）`)
      if (interlace !== 0) throw new Error('インターレースの PNG は扱えません')
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset = dataStart + length + 4
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : null
  if (channels === null) throw new Error(`colorType ${colorType} の PNG は扱えません`)
  const raw = inflateSync(Buffer.concat(idatChunks))
  const stride = width * channels
  const out = new Uint8Array(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filterType = raw[pos]
    pos += 1
    const rowStart = y * stride
    const prevRowStart = rowStart - stride
    for (let x = 0; x < stride; x++) {
      const rawX = raw[pos + x] ?? 0
      const a = x >= channels ? (out[rowStart + x - channels] ?? 0) : 0
      const b = y > 0 ? (out[prevRowStart + x] ?? 0) : 0
      const c = y > 0 && x >= channels ? (out[prevRowStart + x - channels] ?? 0) : 0
      let value: number
      switch (filterType) {
        case 0:
          value = rawX
          break
        case 1:
          value = rawX + a
          break
        case 2:
          value = rawX + b
          break
        case 3:
          value = rawX + Math.floor((a + b) / 2)
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          value = rawX + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default:
          throw new Error(`未知の filter type ${filterType}`)
      }
      out[rowStart + x] = value & 0xff
    }
    pos += stride
  }
  return { width, height, channels, data: out }
}

/**
 * 水の LUT の配色（map/waterColormap.ts の帯。B が R・G より十分大きい青）に寄った画素の割合。
 * 差分ではなく各フレームを単独で分類するので、SwiftShader の描画のわずかな揺れ（同じ静止した場面でも
 * 1 秒後には過半数の画素が変わって見えるほどのノイズが実測された）に影響されない
 */
export function waterColoredFraction(img: DecodedPng): number {
  const { width, height, channels, data } = img
  const total = width * height
  let count = 0
  for (let i = 0; i < total; i++) {
    const o = i * channels
    const r = data[o] ?? 0
    const b = data[o + 2] ?? 0
    if (b - r > 40 && b > 100) count++
  }
  return count / total
}
