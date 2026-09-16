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

/**
 * キーごとに 1 つの Promise を覚える cache。容量を超えたら古いものから捨て、使ったものを新しい側へ移す。
 * 失敗（reject）は覚えない（次の要求で作り直す）
 */
export class PromiseCache<T> {
  private readonly capacity: number
  private readonly entries = new Map<string, Promise<T>>()

  constructor(capacity: number) {
    this.capacity = capacity
  }

  get size(): number {
    return this.entries.size
  }

  load(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key)
    if (hit !== undefined) {
      // 使ったものを新しい側へ移す
      this.entries.delete(key)
      this.entries.set(key, hit)
      return hit
    }
    const created = load()
    this.entries.set(key, created)
    created.catch(() => {
      if (this.entries.get(key) === created) this.entries.delete(key)
    })
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    return created
  }
}
