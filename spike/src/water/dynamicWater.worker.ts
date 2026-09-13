/**
 * 毎フレーム変わる水深（計画 D16）。固定の水のあるセルに、2〜4cm の波を足して返す。
 * 受け取ったバッファに書いて転送で返す（1 回に N² × 4 バイト、N = 516 で約 1.07MB）。
 * DOM と WebWorker の lib を同じプロジェクトに置かないため、self の型は必要な分だけ書く（tech-spec §10.3）
 */
interface InitMessage {
  type: 'init'
  base: Float32Array
  n: number
}
interface FrameMessage {
  type: 'frame'
  buffer: Float32Array
  elapsedMs: number
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InitMessage | FrameMessage>) => void) | null
  postMessage(message: unknown, transfer: Transferable[]): void
}

// 型を明示する。TS 6 では new Float32Array(0) が Float32Array<ArrayBuffer> と推論され、受け取った配列を代入できない（P17）
let base: Float32Array = new Float32Array(0)
let n = 0

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'init') {
    base = message.base
    n = message.n
    return
  }
  const out = message.buffer
  const phase = message.elapsedMs * 0.002
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col
      const b = base[i] ?? 0
      out[i] =
        b > 0 ? b + 0.02 * (2 + Math.sin(col * 0.05 + phase) * Math.cos(row * 0.05 - phase)) : 0
    }
  }
  scope.postMessage({ type: 'frame', buffer: out }, [out.buffer])
}
