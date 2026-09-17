import { describe, expect, it } from 'vitest'
import { uploadCanvasSource } from './WaterOverlay'

describe('uploadCanvasSource（止まっている間は再描画させない。spec 06 §5.2）', () => {
  it('play の後に pause を呼ぶ（pause が _playing の間に prepare で 1 回だけ転送する）', () => {
    const calls: string[] = []
    uploadCanvasSource({ play: () => calls.push('play'), pause: () => calls.push('pause') })
    expect(calls).toEqual(['play', 'pause'])
  })

  it('ソースが無い・まだ読み込まれていない（play が無い）ときは何もしない', () => {
    expect(() => uploadCanvasSource(undefined)).not.toThrow()
    const calls: string[] = []
    uploadCanvasSource({ pause: () => calls.push('pause') })
    expect(calls).toEqual([])
  })
})
