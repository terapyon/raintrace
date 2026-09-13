import type { Scene } from '../types'

/** Worker に水深を作らせ、転送で受け取る。バッファ 2 枚を往復させ、前の要求が戻るまで次を出さない */
export class DynamicWater {
  readonly roundTripMs: number[] = []
  private readonly worker: Worker
  private readonly spare: Float32Array[]
  private pending = false
  private sentAt = 0

  constructor(scene: Scene, onFrame: (depth: Float32Array) => void) {
    const n = scene.range.size
    this.worker = new Worker(new URL('./dynamicWater.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.postMessage({ type: 'init', base: scene.depth.slice(), n })
    this.spare = [new Float32Array(n * n), new Float32Array(n * n)]
    this.worker.onmessage = (event: MessageEvent<{ buffer: Float32Array }>) => {
      this.roundTripMs.push(performance.now() - this.sentAt)
      this.pending = false
      // setDepth はテクスチャ用の配列へ写すので、受け取ったバッファはすぐ使い回せる
      onFrame(event.data.buffer)
      this.spare.push(event.data.buffer)
    }
  }

  request(elapsedMs: number): void {
    if (this.pending) return
    const buffer = this.spare.pop()
    if (buffer === undefined) return
    this.pending = true
    this.sentAt = performance.now()
    this.worker.postMessage({ type: 'frame', buffer, elapsedMs }, [buffer.buffer])
  }

  dispose(): void {
    this.worker.terminate()
  }
}
