import { describe, expect, it } from 'vitest'
import { createLimiter, retry } from './async.ts'

const recordSleep = () => {
  const waits: number[] = []
  return {
    waits,
    sleep: async (ms: number): Promise<void> => {
      waits.push(ms)
    },
  }
}

describe('retry', () => {
  it('失敗したら決めた間隔で再試行し、成功したらその値を返す', async () => {
    const { waits, sleep } = recordSleep()
    let calls = 0
    const value = await retry(
      async () => {
        calls++
        if (calls < 3) throw new Error('一時的な失敗')
        return 'ok'
      },
      { delaysMs: [500, 1000, 2000], sleep, shouldRetry: () => true },
    )
    expect(value).toBe('ok')
    expect(waits).toEqual([500, 1000])
  })

  it('間隔を使い切ったら最後のエラーで失敗する（最大 3 回の再試行 = 4 回の試行）', async () => {
    const { waits, sleep } = recordSleep()
    let calls = 0
    await expect(
      retry(
        async () => {
          calls++
          throw new Error(`失敗 ${calls}`)
        },
        { delaysMs: [500, 1000, 2000], sleep, shouldRetry: () => true },
      ),
    ).rejects.toThrow('失敗 4')
    expect(waits).toEqual([500, 1000, 2000])
  })

  it('再試行しないエラー（取り消しなど）はすぐに失敗する', async () => {
    const { waits, sleep } = recordSleep()
    await expect(
      retry(async () => Promise.reject(new Error('取り消し')), {
        delaysMs: [500],
        sleep,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('取り消し')
    expect(waits).toEqual([])
  })
})

describe('createLimiter', () => {
  it('同時に動くのは上限の数まで。終わったものの後に次が動く', async () => {
    const limit = createLimiter(2)
    let active = 0
    let peak = 0
    const gates: (() => void)[] = []
    const tasks = Array.from({ length: 5 }, () =>
      limit(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => gates.push(resolve))
        active--
      }),
    )
    const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
    await flush()
    expect(active).toBe(2)
    while (gates.length > 0) {
      gates.shift()?.()
      await flush()
    }
    await Promise.all(tasks)
    expect(peak).toBe(2)
  })
})
