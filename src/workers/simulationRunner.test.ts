import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FrameMessage, WorkerToMainMessage } from '../shared/protocol'
import { TsSimulationEngine } from '../simulation/TsSimulationEngine'
import { gridFromRows, makeDepression } from '../simulation/terrain/testGrids'
import type { TerrainGrid } from '../simulation/terrain/types'
import { TICK_INTERVAL_MS } from './playbackScheduler'
import { ARROW_INTERVAL_MS, SimulationRunner } from './simulationRunner'

afterEach(() => {
  vi.restoreAllMocks()
})

/** 5 × 5 の盆地（縁 10m、床 0m、セル 1m）。center が null なら中央のセルを無効にする */
function basin(center: number | null = 0): TerrainGrid {
  return gridFromRows([
    [10, 10, 10, 10, 10],
    [10, 0, 0, 0, 10],
    [10, 0, center, 0, 10],
    [10, 0, 0, 0, 10],
    [10, 10, 10, 10, 10],
  ])
}

const RAIN = { x: 2.5, y: 2.5, radiusM: 1, amountMm: 100 }

/**
 * 偽の時計・タイマーと、転送を本当に行う post（structuredClone の transfer で元の ArrayBuffer を切り離す。
 * Runner が転送した後のバッファに触れると TypeError になる）
 */
function setup() {
  const clock = { now: 0 }
  const timers = new Map<number, { at: number; run: () => void }>()
  let nextId = 1
  const posted: WorkerToMainMessage[] = []
  const runner = new SimulationRunner({
    post: (message, transfer) => {
      posted.push(structuredClone(message, { transfer }))
    },
    now: () => clock.now,
    setTimer: (run, delayMs) => {
      const id = nextId++
      timers.set(id, { at: clock.now + delayMs, run })
      return id
    },
    clearTimer: (handle) => {
      timers.delete(handle as number)
    },
  })
  const frames = (): FrameMessage[] => posted.filter((m): m is FrameMessage => m.type === 'frame')
  let returned = 0
  return {
    runner,
    posted,
    frames,
    timers,
    /** タイマーを n 回（無くなるまで）動かす */
    run(n: number): void {
      for (let k = 0; k < n; k++) {
        let first: [number, { at: number; run: () => void }] | undefined
        for (const entry of timers)
          if (first === undefined || entry[1].at < first[1].at) first = entry
        if (first === undefined) return
        timers.delete(first[0])
        clock.now = Math.max(clock.now, first[1].at)
        first[1].run()
      }
    },
    /** まだ返していない frame のバッファをすべて返す（メインの SimulationClient の役） */
    returnAll(): void {
      const list = frames()
      for (; returned < list.length; returned++) {
        const frame = list[returned]
        if (frame !== undefined) runner.handle({ type: 'returnBuffer', buffer: frame.water })
      }
    },
  }
}

describe('SimulationRunner: 地形の受け渡し（02・03 の申し送り）', () => {
  it('setDepressions には significant の窪地だけを、loadTerrain の後に渡す（エンジンは絞らない）', () => {
    const load = vi.spyOn(TsSimulationEngine.prototype, 'loadTerrain')
    const set = vi.spyOn(TsSimulationEngine.prototype, 'setDepressions')
    const { runner } = setup()
    runner.loadTerrain(1, basin(), [
      makeDepression({ id: 1, pitIndex: 12, spillElevation: 5, significant: true }),
      makeDepression({ id: 2, pitIndex: 6, spillElevation: 5, significant: false }),
    ])
    expect(set).toHaveBeenCalledTimes(1)
    expect(set.mock.calls[0]?.[0].map((d) => d.id)).toEqual([1])
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(set.mock.invocationCallOrder[0] ?? 0)
  })
})

describe('SimulationRunner: 再生と frame（spec 04 §5、tech-spec §5.2）', () => {
  it('start で雨を置いて再生し、frame の水深はエンジンの水深を単精度にしたもの', () => {
    const h = setup()
    h.runner.loadTerrain(7, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(1)
    const frame = h.frames()[0]
    expect(frame?.terrainId).toBe(7)
    expect(frame?.step).toBe(1)
    expect(frame?.stats.totalWater).toBeCloseTo((Math.PI * 100) / 1000, 12)
    const water = new Float32Array(frame?.water ?? new ArrayBuffer(0))
    expect(water.length).toBe(25)
    expect(water.reduce((a, d) => a + d, 0)).toBeCloseTo(frame?.stats.storedWater ?? 0, 5)
  })

  it('バッファが 2 枚とも手元に無ければ frame を見送り、返却されると最新の状態で送る', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(5)
    expect(h.frames().map((f) => f.step)).toEqual([1, 2])
    h.returnAll()
    expect(h.frames().map((f) => f.step)).toEqual([1, 2, 5])
  })

  it('大きさの違うバッファの返却は捨てる（前の地形のバッファ）', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(3)
    h.runner.handle({ type: 'returnBuffer', buffer: new ArrayBuffer(8) })
    expect(h.frames()).toHaveLength(2)
  })

  it('平衡に達すると自動で止まり、その frame（settled）を送る', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'setSpeed', speed: 4 })
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    for (let n = 0; n < 5000 && h.timers.size > 0; n++) {
      h.run(1)
      h.returnAll()
    }
    expect(h.timers.size).toBe(0)
    expect(h.frames().at(-1)?.stats.settled).toBe(true)
  })

  it('setSpeed(4) なら 1 tick に 4 step', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'setSpeed', speed: 4 })
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(1)
    expect(h.frames()[0]?.step).toBe(4)
  })

  it('pause で止まり、step で 1 step 進み、resume で続く', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.runner.handle({ type: 'pause' })
    h.run(3)
    expect(h.frames()).toEqual([])
    h.runner.handle({ type: 'step' })
    expect(h.frames().map((f) => f.step)).toEqual([1])
    h.returnAll()
    h.runner.handle({ type: 'resume' })
    h.run(1)
    expect(h.frames().map((f) => f.step)).toEqual([1, 2])
  })

  it('reset で水と統計を消し、step 0 の frame（水深 0）を送る。runId は reset のもの', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(1)
    h.returnAll()
    h.runner.handle({ type: 'reset', runId: 2 })
    const last = h.frames().at(-1)
    expect(last?.step).toBe(0)
    expect(last?.stats.totalWater).toBe(0)
    expect(new Float32Array(last?.water ?? new ArrayBuffer(0)).every((d) => d === 0)).toBe(true)
    expect(last?.runId).toBe(2)
    expect(h.timers.size).toBe(0)
  })

  it('1 tick の途中の step で起きた越流イベントも、その tick の frame に入れる（最後の step の分だけにしない）', () => {
    const h = setup()
    // 床の中央を最低点とし、spill 標高を床と同じ 0m にする（雨が落ちた step 1 で通知される）。
    // 4x の 1 tick は step 1〜4 で、frame の統計は step 4 のもの（step 4 の events は空）
    h.runner.loadTerrain(1, basin(), [makeDepression({ id: 3, pitIndex: 12, spillElevation: 0 })])
    h.runner.handle({ type: 'setSpeed', speed: 4 })
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(1)
    const frame = h.frames()[0]
    expect(frame?.step).toBe(4)
    expect(frame?.stats.events.map((e) => [e.depressionId, e.step])).toEqual([[3, 1]])
  })

  it('frame を見送った間の越流イベントは、次に送れた frame に入れる', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [makeDepression({ id: 3, pitIndex: 12, spillElevation: 0 })])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(4)
    h.returnAll()
    const events = h.frames().flatMap((f) => f.stats.events)
    expect(events.map((e) => e.depressionId)).toEqual([3])
  })
})

describe('SimulationRunner: runId（タスクレビューの重要な指摘・追加の裁定）', () => {
  it(
    'frame は最後に受けた start・reset の runId を持つ。バッファが尽きた congestion の下で ' +
      'reset の直後に start しても、reset の step 0 の frame は送られず、後で送られる frame は ' +
      'start の runId を持つ（reset の保留 frame が start の discardPending で消えるケース）',
    () => {
      const h = setup()
      h.runner.loadTerrain(1, basin(), [])
      h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
      // バッファ 2 枚を使い切る（返却しない）。reset の step 0 の frame が送れない状況を作る
      h.run(5)
      expect(h.frames().map((f) => f.step)).toEqual([1, 2])
      expect(h.frames().every((f) => f.runId === 1)).toBe(true)

      // バッファが無いまま reset（ZERO_STATS は保留のまま送れない）→ すぐに start。
      // start の suspend()（discardPending）が reset の保留 frame を消す
      h.runner.handle({ type: 'reset', runId: 2 })
      h.runner.handle({ type: 'start', rain: RAIN, runId: 3 })

      // バッファを返し、新しい実行（runId 3）の frame を送らせる
      h.returnAll()
      h.run(5)
      h.returnAll()

      const frames = h.frames()
      // reset（runId 2）の frame は 1 枚も送られていない
      expect(frames.some((f) => f.runId === 2)).toBe(false)
      // 最初の 2 枚（runId 1）より後に届いた frame は、すべて start（runId 3）のもの
      const newFrames = frames.slice(2)
      expect(newFrames.length).toBeGreaterThan(0)
      expect(newFrames.every((f) => f.runId === 3)).toBe(true)
    },
  )
})

describe('SimulationRunner: 水の流れの矢印', () => {
  it('表示なら [列, 行, 方位, 大きさ] を送り、非表示に切り替えると長さ 0 を 1 回、その後は null', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    // 間隔 5m・セル 1m では中央のセル (2, 2) だけを見る。中央に対称な雨だと中央のベクトルは 0 になるので、
    // 北西のセル (1, 1) に雨を置き、1 step 後に中央から南東へ流れる状態を作る
    h.runner.handle({
      type: 'start',
      rain: { x: 1.5, y: 1.5, radiusM: 0.4, amountMm: 1000 },
      runId: 1,
    })
    h.runner.handle({ type: 'pause' })
    h.runner.handle({ type: 'step' })
    h.returnAll()
    // 止まっている間の切り替えは、今の状態の frame を送り直して反映する
    h.runner.handle({ type: 'setArrows', visible: true, spacingM: 5 })
    const shown = h.frames().at(-1)?.arrows
    expect(shown?.length).toBeGreaterThan(0)
    expect((shown?.length ?? 1) % 4).toBe(0)
    h.returnAll()
    h.runner.handle({ type: 'setArrows', visible: false, spacingM: 5 })
    expect(h.frames().at(-1)?.arrows?.length).toBe(0)
    h.returnAll()
    h.runner.handle({ type: 'step' })
    expect(h.frames().at(-1)?.arrows).toBeNull()
  })

  it('非表示の間は flowVectors を呼ばない', () => {
    const flow = vi.spyOn(TsSimulationEngine.prototype, 'flowVectors')
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(2)
    expect(flow).not.toHaveBeenCalled()
  })

  it('再生中は矢印を ARROW_INTERVAL_MS ごとにしか計算しない。間の frame は arrows: null で、setArrows は間引きを上書きする', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'setArrows', visible: true, spacingM: 5 })
    // 止まっている間の setArrows は今の状態（雨の前）の frame をすぐに送る。そのバッファを返しておく
    h.returnAll()
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    // tick は TICK_INTERVAL_MS（≈16.7ms）ごと。ARROW_INTERVAL_MS（100ms）を跨ぐまでの tick 数
    const ticksToBoundary = Math.ceil(ARROW_INTERVAL_MS / TICK_INTERVAL_MS)
    const arrowLengths: (number | null)[] = []
    for (let n = 0; n <= ticksToBoundary; n++) {
      h.run(1)
      h.returnAll()
      const arrows = h.frames().at(-1)?.arrows ?? null
      arrowLengths.push(arrows === null ? null : arrows.length)
    }
    // start 直後の frame（tick 0）は必ず矢印を計算する（計画で決めたこと 3）
    expect(arrowLengths[0]).not.toBeNull()
    // 100ms に届くまでの間の frame は、前の矢印のまま（null）
    expect(arrowLengths.slice(1, ticksToBoundary)).toEqual(
      Array.from({ length: ticksToBoundary - 1 }, () => null),
    )
    // 100ms に届いた（またはまたいだ）frame は矢印を計算し直す
    expect(arrowLengths[ticksToBoundary]).not.toBeNull()

    // 再生中の setArrows は間引きを無視し、次の frame で必ず矢印を送る
    h.runner.handle({ type: 'setArrows', visible: true, spacingM: 10 })
    h.run(1)
    h.returnAll()
    expect(h.frames().at(-1)?.arrows).not.toBeNull()
  })

  it('平衡に達した frame も、間引きの間隔にかかわらず矢印を送る', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'setArrows', visible: true, spacingM: 5 })
    h.returnAll()
    h.runner.handle({ type: 'setSpeed', speed: 4 })
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    for (let n = 0; n < 5000 && h.timers.size > 0; n++) {
      h.run(1)
      h.returnAll()
    }
    expect(h.timers.size).toBe(0)
    const last = h.frames().at(-1)
    expect(last?.stats.settled).toBe(true)
    expect(last?.arrows).not.toBeNull()
  })
})

describe('SimulationRunner: 失敗と地形の差し替え', () => {
  it('降雨中心に標高データが無ければ、simFailed（no-elevation-at-rain-center）を送り、再生しない', () => {
    const h = setup()
    h.runner.loadTerrain(4, basin(null), [])
    h.runner.handle({ type: 'start', rain: { ...RAIN, radiusM: 0.4 }, runId: 1 })
    expect(h.posted).toMatchObject([
      { type: 'simFailed', terrainId: 4, reason: 'no-elevation-at-rain-center' },
    ])
    expect(h.timers.size).toBe(0)
  })

  it('エンジンがほかのエラー（半径が大きすぎる RangeError）を投げたら、simFailed（internal）を送り、再生しない', () => {
    const h = setup()
    h.runner.loadTerrain(5, basin(), [])
    // 5 × 5・セル 1m の半径の上限は (5 + 5) × 1 = 10m（planRainfall）
    h.runner.handle({ type: 'start', rain: { ...RAIN, radiusM: 11 }, runId: 1 })
    expect(h.posted).toMatchObject([{ type: 'simFailed', terrainId: 5, reason: 'internal' }])
    expect(h.timers.size).toBe(0)
  })

  it('地形を読み込み直すと前の地形の再生を止め、新しい terrainId の frame を送る', () => {
    const h = setup()
    h.runner.loadTerrain(1, basin(), [])
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(1)
    h.runner.loadTerrain(2, basin(), [])
    expect(h.timers.size).toBe(0)
    h.runner.handle({ type: 'start', rain: RAIN, runId: 1 })
    h.run(1)
    expect(h.frames().map((f) => f.terrainId)).toEqual([1, 2])
  })
})
