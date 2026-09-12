/** 最新の値だけを intervalMs ごとに渡す（最初の値はすぐ）。統計の 10Hz への間引き（tech-spec §5.1） */
export interface Throttle<T> {
  push(value: T): void
  /** 待っている値があればすぐ渡す */
  flush(): void
  /** 待っている値を捨てる */
  cancel(): void
}

export function createThrottle<T>(
  intervalMs: number,
  emit: (value: T) => void,
  now: () => number = Date.now,
): Throttle<T> {
  let last = Number.NEGATIVE_INFINITY
  let pending: { value: T } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = (): void => {
    clearTimeout(timer)
    timer = undefined
  }
  const fire = (): void => {
    clear()
    if (pending === null) return
    const { value } = pending
    pending = null
    last = now()
    emit(value)
  }
  return {
    push(value) {
      pending = { value }
      const wait = last + intervalMs - now()
      if (wait <= 0) fire()
      else if (timer === undefined) timer = setTimeout(fire, wait)
    },
    flush: fire,
    cancel() {
      clear()
      pending = null
    },
  }
}
