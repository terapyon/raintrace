/**
 * schedule() を呼ぶたびタイマーを延ばし、最後の呼び出しから delayMs 経ったら 1 回だけ emit を呼ぶ
 * （URL の書き込みの間引き。spec 04 §7）
 */
export interface Debounce {
  schedule(): void
  /** 待っているタイマーを消す（emit しない） */
  cancel(): void
}

export function createDebounce(emit: () => void, delayMs: number): Debounce {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    schedule() {
      clearTimeout(timer)
      timer = setTimeout(emit, delayMs)
    },
    cancel() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
