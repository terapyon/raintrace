import { describe, expect, it } from 'vitest'
import type { PlaybackSpeed } from '../shared/protocol'
import type { StepStats } from '../simulation/types'
import { PlaybackScheduler, TICK_INTERVAL_MS } from './playbackScheduler'

interface Options {
  stepMs?: number
  settleAt?: number
  buffers?: number
  speed?: PlaybackSpeed
}

function stats(step: number, settled: boolean): StepStats {
  return {
    step,
    totalWater: 0,
    storedWater: 0,
    outflowWater: 0,
    maxDepth: 0,
    floodedArea: 0,
    settled,
    massError: 0,
    events: [],
  }
}

/**
 * 偽の時計とタイマー。step は時計を stepMs 進め、settleAt 回目で settled を返す。
 * frame は buffers 枚まで送れ、returnBuffer で 1 枚戻る
 */
function harness({
  stepMs = 1,
  settleAt = Number.POSITIVE_INFINITY,
  buffers = Number.POSITIVE_INFINITY,
  speed = 1,
}: Options = {}) {
  const clock = { now: 0 }
  let steps = 0
  let free = buffers
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const frames: { step: number; settled: boolean; stepsPerSecond: number }[] = []
  const stepsPerTick: number[] = []
  const scheduler = new PlaybackScheduler({
    now: () => clock.now,
    setTimer: (run, delayMs) => {
      const id = nextId++
      timers.set(id, { at: clock.now + delayMs, run })
      return id
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
    step: () => {
      clock.now += stepMs
      steps++
      return stats(steps, steps >= settleAt)
    },
    sendFrame: (s, stepsPerSecond) => {
      if (free <= 0) return false
      free--
      frames.push({ step: s.step, settled: s.settled, stepsPerSecond })
      return true
    },
  })
  scheduler.setSpeed(speed)
  /** 最も早いタイマーを 1 つ動かす（時計をその時刻まで進める）。無ければ何もしない */
  const tick = (): void => {
    let first: [number, { at: number; run: () => void }] | undefined
    for (const entry of timers) if (first === undefined || entry[1].at < first[1].at) first = entry
    if (first === undefined) return
    timers.delete(first[0])
    clock.now = Math.max(clock.now, first[1].at)
    const before = steps
    first[1].run()
    stepsPerTick.push(steps - before)
  }
  return {
    scheduler,
    frames,
    stepsPerTick,
    timers,
    clock,
    steps: () => steps,
    ticks: (n: number) => {
      for (let k = 0; k < n; k++) tick()
    },
    returnBuffer: () => {
      free++
      scheduler.bufferReturned()
    },
  }
}

describe('PlaybackScheduler: 速度（spec 04 §5.2、R04-5）', () => {
  it.each([
    [1, [1, 1, 1, 1]],
    [0.5, [0, 1, 0, 1]],
    [0.25, [0, 0, 0, 1, 0, 0, 0, 1]],
    [2, [2, 2]],
    [4, [4, 4]],
  ] as const)(
    '%s x の 1 tick あたりの step 数（端数は次の tick へ繰り越す）',
    (speed, expected) => {
      const h = harness({ speed })
      h.scheduler.play()
      h.ticks(expected.length)
      expect(h.stepsPerTick).toEqual(expected)
    },
  )

  it('速度を変えると、それまでの端数は捨てる', () => {
    const h = harness({ speed: 0.25 })
    h.scheduler.play()
    h.ticks(3)
    h.scheduler.setSpeed(0.5)
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([0, 0, 0, 0, 1])
  })
})

describe('PlaybackScheduler: 時間予算', () => {
  it('12ms を使い切ったら打ち切る。上限に届かなかった分は次の tick へ繰り越さない', () => {
    const h = harness({ speed: 4, stepMs: 5 })
    h.scheduler.play()
    h.ticks(3)
    expect(h.stepsPerTick).toEqual([3, 3, 3])
  })

  it('「最速」は上限を持たず、時間予算だけで回す', () => {
    const h = harness({ speed: 'max', stepMs: 1 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([12, 12])
  })

  it('1 step が予算を超えても、1 tick に少なくとも 1 step は回す', () => {
    const h = harness({ speed: 'max', stepMs: 20 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([1, 1])
  })

  it('次の tick は、1/60 秒からその tick の所要時間を引いた後。所要時間が 1/60 秒を超えたらすぐ', () => {
    const fast = harness({ stepMs: 5 })
    fast.scheduler.play()
    fast.ticks(1)
    expect([...fast.timers.values()][0]?.at).toBeCloseTo(TICK_INTERVAL_MS, 9)
    const slow = harness({ speed: 'max', stepMs: 20 })
    slow.scheduler.play()
    slow.ticks(1)
    expect([...slow.timers.values()][0]?.at).toBe(20)
  })

  it('実行速度（step／秒）を 1 秒の窓で測り、frame に付ける', () => {
    const h = harness({ stepMs: 0 })
    h.scheduler.play()
    h.ticks(70)
    expect(h.scheduler.stepsPerSecond).toBeGreaterThan(59)
    expect(h.scheduler.stepsPerSecond).toBeLessThan(62)
    expect(h.frames.at(-1)?.stepsPerSecond).toBe(h.scheduler.stepsPerSecond)
  })
})

describe('PlaybackScheduler: frame（tech-spec §5.2）', () => {
  it('返却済みのバッファが無ければ frame を見送り、返却されたら最新の統計で送る', () => {
    const h = harness({ buffers: 1 })
    h.scheduler.play()
    h.ticks(3)
    expect(h.frames.map((f) => f.step)).toEqual([1])
    h.returnBuffer()
    expect(h.frames.map((f) => f.step)).toEqual([1, 3])
  })

  it('step の無い tick（0.25x の 3 tick）では frame を送らない', () => {
    const h = harness({ speed: 0.25 })
    h.scheduler.play()
    h.ticks(3)
    expect(h.frames).toEqual([])
  })

  it('discardPending で保留中の frame を捨てる（reset・地形の差し替え）', () => {
    const h = harness({ buffers: 0 })
    h.scheduler.play()
    h.ticks(1)
    h.scheduler.discardPending()
    h.returnBuffer()
    expect(h.frames).toEqual([])
  })
})

describe('PlaybackScheduler: 平衡での自動停止', () => {
  it('settled の step で止まり、タイマーを残さない。その frame はバッファが返却され次第送る', () => {
    const h = harness({ buffers: 0, settleAt: 3 })
    h.scheduler.play()
    h.ticks(10)
    expect(h.steps()).toBe(3)
    expect(h.scheduler.isRunning).toBe(false)
    expect(h.timers.size).toBe(0)
    expect(h.frames).toEqual([])
    h.returnBuffer()
    expect(h.frames).toEqual([{ step: 3, settled: true, stepsPerSecond: 0 }])
  })

  it('1 tick の途中で settled になったら、その tick の残りの step を回さない', () => {
    const h = harness({ speed: 4, settleAt: 2 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([2])
  })
})

describe('PlaybackScheduler: 一時停止と Step', () => {
  it('pause でタイマーを外し、play で再開する', () => {
    const h = harness()
    h.scheduler.play()
    h.ticks(2)
    h.scheduler.pause()
    expect(h.timers.size).toBe(0)
    h.ticks(3)
    expect(h.steps()).toBe(2)
    h.scheduler.play()
    h.ticks(1)
    expect(h.steps()).toBe(3)
  })

  it('stepOnce は一時停止中だけ 1 step 進めて frame を送る。再生中は何もしない', () => {
    const h = harness()
    h.scheduler.stepOnce()
    expect(h.steps()).toBe(1)
    expect(h.frames.map((f) => f.step)).toEqual([1])
    h.scheduler.play()
    h.scheduler.stepOnce()
    expect(h.steps()).toBe(1)
  })
})

describe('PlaybackScheduler: 止めたら実行速度を 0 に戻す（Step・Reset・平衡の frame に古い値を載せない）', () => {
  it('pause で 0 にし、その後の Step の frame も 0', () => {
    const h = harness({ stepMs: 0 })
    h.scheduler.play()
    h.ticks(70)
    expect(h.scheduler.stepsPerSecond).toBeGreaterThan(59)
    h.scheduler.pause()
    expect(h.scheduler.stepsPerSecond).toBe(0)
    h.scheduler.stepOnce()
    expect(h.frames.at(-1)?.stepsPerSecond).toBe(0)
  })

  it('再開（play）の最初の 1 秒の frame は、前の再生の値ではなく 0', () => {
    const h = harness({ stepMs: 0 })
    h.scheduler.play()
    h.ticks(70)
    h.scheduler.pause()
    h.scheduler.play()
    h.ticks(1)
    expect(h.scheduler.stepsPerSecond).toBe(0)
    expect(h.frames.at(-1)?.stepsPerSecond).toBe(0)
  })

  it('平衡で自動で止まったら 0 にし、平衡の frame にも 0 を載せる', () => {
    const h = harness({ stepMs: 0, settleAt: 100 })
    h.scheduler.play()
    h.ticks(99)
    expect(h.frames.at(-1)?.stepsPerSecond).toBeGreaterThan(59)
    h.ticks(1)
    expect(h.scheduler.isRunning).toBe(false)
    expect(h.scheduler.stepsPerSecond).toBe(0)
    expect(h.frames.at(-1)).toEqual({ step: 100, settled: true, stepsPerSecond: 0 })
  })
})

describe('PlaybackScheduler: 1 step の所要時間（計測用の onStepTime。spec 06 §3、計画で決めたこと 1）', () => {
  /**
   * step ごとに時計を stepMs[k] 進める。onStepTime を渡すかを選べる。play の直後の tick を 1 回だけ回す。
   * settleAt 回目の step で settled を返す
   */
  function timed(
    stepMs: readonly number[],
    speed: PlaybackSpeed,
    withTiming: boolean,
    settleAt = Number.POSITIVE_INFINITY,
  ) {
    const clock = { now: 0 }
    let nowCalls = 0
    let k = 0
    const times: number[] = []
    const timers: (() => void)[] = []
    const scheduler = new PlaybackScheduler({
      now: () => {
        nowCalls++
        return clock.now
      },
      setTimer: (run) => {
        timers.push(run)
        return timers.length
      },
      clearTimer: () => {},
      step: () => {
        clock.now += stepMs[k % stepMs.length] ?? 1
        k++
        return stats(k, k >= settleAt)
      },
      sendFrame: () => true,
      ...(withTiming ? { onStepTime: (ms: number) => times.push(ms) } : {}),
    })
    scheduler.setSpeed(speed)
    scheduler.play()
    timers.shift()?.()
    return { scheduler, times, nowCalls: () => nowCalls, steps: () => k }
  }

  it('「最速」: 予算の判定で読む now() の差を 1 step の時間として渡す（最後の step は予算の判定の値で閉じる）', () => {
    const t = timed([5, 3, 4], 'max', true)
    expect(t.steps()).toBe(3)
    expect(t.times).toEqual([5, 3, 4])
  })

  it('速度 1: ループを上限で抜けた最後の step は、実行速度の窓の now() で閉じる', () => {
    const t = timed([7], 1, true)
    expect(t.steps()).toBe(1)
    expect(t.times).toEqual([7])
  })

  it('平衡で止まった tick の最後の step も数える', () => {
    const t = timed([2, 6], 'max', true, 2)
    expect(t.steps()).toBe(2)
    expect(t.times).toEqual([2, 6])
  })

  it('now() の呼び出し回数は onStepTime の有無で変わらない（タイマーの呼び出しを増やさない）', () => {
    // play 1 + tick の開始 1 + 予算の判定 4 + 実行速度の窓 1 + 次の tick の予約 1 = 8（「最速」・5・3・4 ms）
    expect(timed([5, 3, 4], 'max', true).nowCalls()).toBe(8)
    expect(timed([5, 3, 4], 'max', false).nowCalls()).toBe(8)
    // play 1 + tick の開始 1 + 予算の判定 1 + 実行速度の窓 1 + 次の tick の予約 1 = 5（速度 1）
    expect(timed([7], 1, true).nowCalls()).toBe(5)
    expect(timed([7], 1, false).nowCalls()).toBe(5)
  })

  it('Step ボタンの 1 step（stepOnce）は数えない', () => {
    const t = timed([5, 3, 4], 'max', true)
    t.scheduler.pause()
    t.scheduler.stepOnce()
    expect(t.times).toEqual([5, 3, 4])
  })
})
