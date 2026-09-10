/** I/O を持たない非同期の道具。取得そのものは Worker が行い、ここでは再試行と同時数だけを扱う */

export interface RetryOptions {
  delaysMs: readonly number[] // 再試行の前に待つ時間。要素の数が再試行の最大回数
  sleep: (ms: number) => Promise<void>
  shouldRetry: (error: unknown) => boolean
}

/** 地理院のタイルの再試行の間隔（spec 02 §4.3: 0.5 秒・1 秒・2 秒で最大 3 回） */
export const GSI_RETRY_DELAYS_MS: readonly number[] = [500, 1000, 2000]

export async function retry<T>(task: () => Promise<T>, options: RetryOptions): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (error) {
      const delay = options.delaysMs[attempt]
      if (delay === undefined || !options.shouldRetry(error)) throw error
      await options.sleep(delay)
    }
  }
}

/** 同時に動く非同期の処理を max 件までに抑える（spec 02 §4.3: 同時に取得するのは最大 6 件） */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: (() => void)[] = []
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}
