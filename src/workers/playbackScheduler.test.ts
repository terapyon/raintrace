import { describe, expect, it } from 'vitest'
import { DEFAULT_PLAYBACK_SPEED, type PlaybackSpeed } from '../shared/protocol'
import type { StepStats, StopReason } from '../simulation/types'
import { PlaybackScheduler, TICK_BUDGET_MS, TICK_INTERVAL_MS } from './playbackScheduler'

interface Options {
  /** 1 step で進める偽の時計（ms） */
  stepMs?: number
  /** 1 step の dt（シミュレーションの秒） */
  dtS?: number
  /** この step 数で自動停止する */
  stopAt?: number
  stopReason?: StopReason
  buffers?: number
  speed?: PlaybackSpeed
}

function stats(step: number, timeS: number, stopReason: StopReason | null): StepStats {
  return {
    step,
    totalWater: 0,
    storedWater: 0,
    outflowWater: 0,
    maxDepth: 0,
    floodedArea: 0,
    settled: stopReason === 'settled',
    massError: 0,
    events: [],
    timeS,
    dtS: 1,
    raining: false,
    rainDepthMm: 0,
    outflowRateM3PerS: 0,
    stopReason,
  }
}

/**
 * 偽の時計とタイマー。step は時計を stepMs 進め、シミュレーションの時刻を dtS 進め、stopAt 回目で stopReason を返す。
 * frame は buffers 枚まで送れ、returnBuffer で 1 枚戻る。restartEngine はエンジンの reset（時刻 0 から）の代わり
 */
function harness({
  stepMs = 0,
  dtS = 1,
  stopAt = Number.POSITIVE_INFINITY,
  stopReason = 'settled',
  buffers = Number.POSITIVE_INFINITY,
  speed = DEFAULT_PLAYBACK_SPEED,
}: Options = {}) {
  const clock = { now: 0 }
  let steps = 0
  let simTime = 0
  let free = buffers
  let nextId = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  const frames: {
    step: number
    stopReason: StopReason | null
    stepsPerSecond: number
    simSecondsPerSecond: number
  }[] = []
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
      simTime += dtS
      return stats(steps, simTime, steps >= stopAt ? stopReason : null)
    },
    sendFrame: (s, stepsPerSecond, simSecondsPerSecond) => {
      if (free <= 0) return false
      free--
      frames.push({ step: s.step, stopReason: s.stopReason, stepsPerSecond, simSecondsPerSecond })
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
    simTime: () => simTime,
    ticks: (n: number) => {
      for (let k = 0; k < n; k++) tick()
    },
    returnBuffer: () => {
      free++
      scheduler.bufferReturned()
    },
    restartEngine: () => {
      steps = 0
      simTime = 0
    },
  }
}

describe('PlaybackScheduler: 実時間の倍率（spec 08 §6.1、R08-5）', () => {
  it.each([1, 10, 60, 600] as const)(
    '%s 倍: 実時間 1 秒（60 tick）で、シミュレーションはおよそ倍率の秒だけ進む（越えるのは最大 1 step の dt）',
    (speed) => {
      const dtS = 0.25
      const h = harness({ speed, dtS })
      h.scheduler.play()
      h.ticks(60)
      expect(h.simTime()).toBeGreaterThanOrEqual(speed - dtS)
      expect(h.simTime()).toBeLessThanOrEqual(speed + dtS)
    },
  )

  it('play の直後の最初の tick は 1 tick 分（1/60 秒）の実時間を進めたとみなし、1 step 以上回す（計画で決めたこと 17）', () => {
    const h = harness({ speed: 1, dtS: 1 })
    h.scheduler.play()
    h.ticks(1)
    expect(h.stepsPerTick).toEqual([1])
  })

  it('目標を越える 1 step は許し、越えた分は次の tick から差し引く（実時間の再生で dt 1 秒なら約 1 秒に 1 step）', () => {
    const h = harness({ speed: 1, dtS: 1 })
    h.scheduler.play()
    h.ticks(59)
    expect(h.steps()).toBe(1)
    h.ticks(3)
    expect(h.steps()).toBe(2)
  })

  it('速度を変えると、目標を今の時刻に戻す（越えた分・貯めた分を捨てる。Review Focus 3）', () => {
    const h = harness({ speed: 'max', stepMs: 1, dtS: 1 })
    h.scheduler.play()
    h.ticks(2)
    const before = h.simTime()
    h.scheduler.setSpeed(1)
    h.ticks(1)
    // 1 倍に切り替えた直後の tick は、1/60 秒ぶんの目標で 1 step だけ
    expect(h.simTime() - before).toBe(1)
  })

  it('rewind で時刻と目標を 0 に戻す（開始・Reset・地形の差し替え。前の実行の目標で一気に進まない。Review Focus 2）', () => {
    const h = harness({ speed: 60, dtS: 1 })
    h.scheduler.play()
    h.ticks(10)
    expect(h.simTime()).toBeGreaterThan(5)
    h.scheduler.pause()
    h.scheduler.rewind()
    h.restartEngine()
    h.scheduler.play()
    h.ticks(1)
    // 60 倍の最初の tick は目標 1 秒なので 1 step（dt 1 秒）。rewind しないと前の実行の時刻が目標に残る
    expect(h.stepsPerTick.at(-1)).toBe(1)
  })
})

describe('PlaybackScheduler: 時間予算', () => {
  it('12ms を使い切ったら打ち切る。目標に届かなかった分は次の tick へ繰り越さない', () => {
    // 600 倍は 1 tick に 10 秒の目標。1 step 5ms なので 3 step で予算を使い切る
    const h = harness({ speed: 600, stepMs: 5, dtS: 1 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([3, 3])
    expect(h.simTime()).toBe(6)
  })

  it('「最速」は目標を持たず、時間予算だけで回す', () => {
    const h = harness({ speed: 'max', stepMs: 1 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([TICK_BUDGET_MS, TICK_BUDGET_MS])
  })

  it('1 step が予算を超えても、1 tick に少なくとも 1 step は回す', () => {
    const h = harness({ speed: 'max', stepMs: 20 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([1, 1])
  })

  it('次の tick は、1/60 秒からその tick の所要時間を引いた後。所要時間が 1/60 秒を超えたらすぐ', () => {
    const fast = harness({ speed: 60, stepMs: 5, dtS: 1 })
    fast.scheduler.play()
    fast.ticks(1)
    expect([...fast.timers.values()][0]?.at).toBeCloseTo(TICK_INTERVAL_MS, 9)
    const slow = harness({ speed: 'max', stepMs: 20 })
    slow.scheduler.play()
    slow.ticks(1)
    expect([...slow.timers.values()][0]?.at).toBe(20)
  })

  it('実行速度（step／秒）と実際の倍率（シミュレーションの秒／実時間の秒）を 1 秒の窓で測り、frame に付ける', () => {
    // 60 倍・dt 0.5 秒: 1 tick に 2 step、1 秒に約 120 step・約 60 秒（最初の窓は play の直後の 1 tick 分を含むので
    // 61 tick ぶん。窓の端の丸めで 1 tick 前後する）
    const h = harness({ speed: 60, dtS: 0.5 })
    h.scheduler.play()
    h.ticks(70)
    expect(h.scheduler.stepsPerSecond).toBeGreaterThan(115)
    expect(h.scheduler.stepsPerSecond).toBeLessThan(125)
    expect(h.scheduler.simSecondsPerSecond).toBeGreaterThan(58)
    expect(h.scheduler.simSecondsPerSecond).toBeLessThan(63)
    expect(h.frames.at(-1)?.stepsPerSecond).toBe(h.scheduler.stepsPerSecond)
    expect(h.frames.at(-1)?.simSecondsPerSecond).toBe(h.scheduler.simSecondsPerSecond)
  })

  it('計算が追いつかないときの実際の倍率は、倍率より小さい（誤りにはしない。spec 08 §6.1）', () => {
    // 600 倍・1 step 5ms・dt 1 秒: 1 tick に 3 step しか回らず、1 秒に約 180 秒しか進まない
    const h = harness({ speed: 600, stepMs: 5, dtS: 1 })
    h.scheduler.play()
    h.ticks(70)
    expect(h.scheduler.simSecondsPerSecond).toBeGreaterThan(150)
    expect(h.scheduler.simSecondsPerSecond).toBeLessThan(200)
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

  it('step の無い tick（実時間・dt 1 秒の 2〜59 tick 目）では frame を送らない', () => {
    const h = harness({ speed: 1, dtS: 1 })
    h.scheduler.play()
    h.ticks(10)
    expect(h.frames.map((f) => f.step)).toEqual([1])
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

describe('PlaybackScheduler: 自動停止（spec 08 §3.9・§6.1）', () => {
  it.each(['settled', 'cap'] as const)(
    '%s の step で止まり、タイマーを残さない。その frame はバッファが返却され次第送る',
    (reason) => {
      const h = harness({ buffers: 0, stopAt: 3, stopReason: reason })
      h.scheduler.play()
      h.ticks(10)
      expect(h.steps()).toBe(3)
      expect(h.scheduler.isRunning).toBe(false)
      expect(h.timers.size).toBe(0)
      expect(h.frames).toEqual([])
      h.returnBuffer()
      expect(h.frames).toEqual([
        { step: 3, stopReason: reason, stepsPerSecond: 0, simSecondsPerSecond: 0 },
      ])
    },
  )

  it('1 tick の途中で止まったら、その tick の残りの step を回さない', () => {
    const h = harness({ speed: 600, stopAt: 2 })
    h.scheduler.play()
    h.ticks(2)
    expect(h.stepsPerTick).toEqual([2])
  })
})

describe('PlaybackScheduler: 一時停止と Step', () => {
  it('pause でタイマーを外し、play で再開する', () => {
    const h = harness({ speed: 60, dtS: 1 })
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

  it('stepOnce は一時停止中だけ 1 step（その時の dt）進めて frame を送る。再生中は何もしない', () => {
    const h = harness()
    h.scheduler.stepOnce()
    expect(h.steps()).toBe(1)
    expect(h.frames.map((f) => f.step)).toEqual([1])
    h.scheduler.play()
    h.scheduler.stepOnce()
    expect(h.steps()).toBe(1)
  })

  it('一時停止中の Step で進んだ時刻から再開する（目標は再開の時刻から数える）', () => {
    const h = harness({ speed: 1, dtS: 1 })
    for (let n = 0; n < 5; n++) h.scheduler.stepOnce()
    h.scheduler.play()
    h.ticks(1)
    // 目標は 5 + 1/60 秒。時刻 5 から 1 step で 6
    expect(h.simTime()).toBe(6)
  })
})

describe('PlaybackScheduler: 止めたら実行速度と実際の倍率を 0 に戻す', () => {
  it('pause で 0 にし、その後の Step の frame も 0', () => {
    const h = harness({ speed: 60, dtS: 0.5 })
    h.scheduler.play()
    h.ticks(70)
    expect(h.scheduler.stepsPerSecond).toBeGreaterThan(100)
    h.scheduler.pause()
    expect(h.scheduler.stepsPerSecond).toBe(0)
    expect(h.scheduler.simSecondsPerSecond).toBe(0)
    h.scheduler.stepOnce()
    expect(h.frames.at(-1)?.stepsPerSecond).toBe(0)
    expect(h.frames.at(-1)?.simSecondsPerSecond).toBe(0)
  })

  it('再開（play）の最初の 1 秒の frame は、前の再生の値ではなく 0', () => {
    const h = harness({ speed: 60, dtS: 0.5 })
    h.scheduler.play()
    h.ticks(70)
    h.scheduler.pause()
    h.scheduler.play()
    h.ticks(1)
    expect(h.scheduler.stepsPerSecond).toBe(0)
    expect(h.frames.at(-1)?.simSecondsPerSecond).toBe(0)
  })

  it('自動停止したら 0 にし、停止の frame にも 0 を載せる', () => {
    const h = harness({ speed: 60, dtS: 0.5, stopAt: 200 })
    h.scheduler.play()
    h.ticks(99)
    expect(h.frames.at(-1)?.stepsPerSecond).toBeGreaterThan(100)
    h.ticks(1)
    expect(h.scheduler.isRunning).toBe(false)
    expect(h.frames.at(-1)).toEqual({
      step: 200,
      stopReason: 'settled',
      stepsPerSecond: 0,
      simSecondsPerSecond: 0,
    })
  })
})

describe('PlaybackScheduler: 1 step の所要時間（計測用の onStepTime。spec 06 §3）', () => {
  /** step ごとに時計を stepMs[k] 進める。play の直後の tick を 1 回だけ回す。stopAt 回目で自動停止する */
  function timed(
    stepMs: readonly number[],
    speed: PlaybackSpeed,
    withTiming: boolean,
    stopAt = Number.POSITIVE_INFINITY,
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
        return stats(k, k, k >= stopAt ? 'settled' : null)
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

  it('実時間: 目標に届いてループを抜けた最後の step は、実行速度の窓の now() で閉じる', () => {
    const t = timed([7], 1, true)
    expect(t.steps()).toBe(1)
    expect(t.times).toEqual([7])
  })

  it('自動停止した tick の最後の step も数える', () => {
    const t = timed([2, 6], 'max', true, 2)
    expect(t.steps()).toBe(2)
    expect(t.times).toEqual([2, 6])
  })

  it('now() の呼び出し回数は onStepTime の有無で変わらない（タイマーの呼び出しを増やさない）', () => {
    // play 1 + tick の開始 1 + 予算の判定 4 + 実行速度の窓 1 + 次の tick の予約 1 = 8（「最速」・5・3・4 ms）
    expect(timed([5, 3, 4], 'max', true).nowCalls()).toBe(8)
    expect(timed([5, 3, 4], 'max', false).nowCalls()).toBe(8)
    // play 1 + tick の開始 1 + 予算の判定 1 + 実行速度の窓 1 + 次の tick の予約 1 = 5（実時間）
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
