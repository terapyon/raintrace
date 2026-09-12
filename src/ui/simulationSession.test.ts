import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FakeWorker,
  frameMessage,
  simFailedMessage,
  statsAt,
} from '../bridge/fakeWorker.test-support'
import { SimulationClient } from '../bridge/SimulationClient'
import { lonLatToPixel } from '../dem/tileMath'
import type { MapController } from '../map/MapController'
import type { WaterOverlay } from '../map/WaterOverlay'
import type { TerrainPayload } from '../shared/protocol'
import { memoryStorage } from '../state/memoryStorage.test-support'
import { createSettingsStore } from '../state/settingsStore'
import { createSimulationStore } from '../state/simulationStore'
import { SimulationSession, STATS_INTERVAL_MS } from './simulationSession'

afterEach(() => {
  vi.useRealTimers()
})

const CENTER = { lon: 139.7016, lat: 35.658 }
const pc = lonLatToPixel(CENTER.lon, CENTER.lat, 17)
const geo = {
  level: 1,
  z: 17,
  originX: Math.floor(pc.x) - 256,
  originY: Math.floor(pc.y) - 256,
  size: 512,
  cellSizeM: 0.98,
} as TerrainPayload['geo']
const terrain = { geo } as TerrainPayload

/** WaterOverlay の偽物。attach() の第 2 引数（テストの差し替え口）で使う */
function fakeOverlay(): WaterOverlay & {
  show: ReturnType<typeof vi.fn>
  setWater: ReturnType<typeof vi.fn>
  setPalette: ReturnType<typeof vi.fn>
  setArrows: ReturnType<typeof vi.fn>
  setArrowsVisible: ReturnType<typeof vi.fn>
  clearArrows: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
} {
  return {
    show: vi.fn(),
    setWater: vi.fn(),
    setPalette: vi.fn(),
    setArrows: vi.fn(),
    setArrowsVisible: vi.fn(),
    clearArrows: vi.fn(),
    clear: vi.fn(),
    restore: vi.fn(),
  } as unknown as WaterOverlay & {
    show: ReturnType<typeof vi.fn>
    setWater: ReturnType<typeof vi.fn>
    setPalette: ReturnType<typeof vi.fn>
    setArrows: ReturnType<typeof vi.fn>
    setArrowsVisible: ReturnType<typeof vi.fn>
    clearArrows: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
  }
}

/** MapController の偽物。map には触れない（テストは overlay の偽物への呼び出しだけを見る） */
function fakeController(): MapController {
  return { map: {}, whenLoaded: (run: () => void) => run() } as unknown as MapController
}

function setup() {
  const worker = new FakeWorker()
  const client = new SimulationClient(() => worker)
  const store = createSimulationStore()
  const settings = createSettingsStore(memoryStorage())
  const session = new SimulationSession(client, store, settings)
  void client.loadTerrain(CENTER.lon, CENTER.lat, 500)
  const terrainId = worker.loaded(terrain)
  session.terrainReady(terrain, CENTER)
  return { worker, client, store, settings, session, terrainId }
}

describe('SimulationSession: 命令（spec 04 §3）', () => {
  it('start は降雨中心をグリッドの北西端からの m にして送り、再生中にする', () => {
    const { worker, store, session } = setup()
    session.start(100, 10)
    expect(worker.posted.at(-1)).toEqual({
      type: 'start',
      rain: {
        x: (pc.x - geo.originX) * geo.cellSizeM,
        y: (pc.y - geo.originY) * geo.cellSizeM,
        radiusM: 10,
        amountMm: 100,
      },
      runId: 1,
    })
    expect(store.getState().status).toBe('running')
  })

  it('地形が無ければ start しない', () => {
    const { worker, store, session } = setup()
    session.terrainCleared()
    session.start(100, 10)
    expect(worker.posted.some((m) => m.type === 'start')).toBe(false)
    expect(store.getState().status).toBe('idle')
  })

  it('pause・resume・reset・setSpeed はストアにも反映する', () => {
    const { store, session } = setup()
    session.start(100, 10)
    session.pause()
    expect(store.getState().status).toBe('paused')
    session.resume()
    expect(store.getState().status).toBe('running')
    session.setSpeed('max')
    expect(store.getState().speed).toBe('max')
    session.reset()
    expect(store.getState()).toMatchObject({ status: 'idle', stats: null })
  })
})

describe('SimulationSession: 地形の読み込み中は再生の命令を送らない（レビューの裁定 2）', () => {
  it('読み込み中（terrainCleared の後）は resume・step を送らない', () => {
    const { worker, session } = setup()
    session.terrainCleared()
    session.resume()
    session.step()
    expect(worker.posted.some((m) => m.type === 'resume' || m.type === 'step')).toBe(false)
  })

  it('読み込み中でも pause・reset・setSpeed は送る', () => {
    const { worker, session } = setup()
    session.terrainCleared()
    // setup() の terrainReady が setSpeed を送っているので、その後だけを見る（レビューの軽微）
    const postedBefore = worker.posted.length
    session.pause()
    session.reset()
    session.setSpeed('max')
    expect(worker.posted.slice(postedBefore).map((m) => m.type)).toEqual([
      'pause',
      'reset',
      'setSpeed',
    ])
  })

  it('読み込みが失敗した後（terrainReady が呼ばれていない）も start・resume・step を送らない', () => {
    const { worker, session } = setup()
    session.terrainCleared()
    const postedBefore = worker.posted.length
    session.start(100, 10)
    session.resume()
    session.step()
    expect(worker.posted.slice(postedBefore)).toEqual([])
  })
})

describe('SimulationSession: Worker の作り直しの後の速度の立て直し（コントローラーの追加の裁定）', () => {
  it('異常終了で作り直した Worker は速度 1 で始まるので、terrainReady のたびに今の速度を送り直す', () => {
    const worker = new FakeWorker()
    const client = new SimulationClient(() => worker)
    const store = createSimulationStore()
    const session = new SimulationSession(client, store, createSettingsStore(memoryStorage()))
    session.setSpeed('max')
    worker.crash()
    void client.loadTerrain(CENTER.lon, CENTER.lat, 500)
    worker.loaded(terrain)
    session.terrainReady(terrain, CENTER)
    // terrainReady は setSpeed の後に setArrows も送り直す（タスク 6。矢印の設定の立て直し）ので、
    // 最後のメッセージではなく、setSpeed が送られたことを見る
    expect(worker.posted.some((m) => m.type === 'setSpeed' && m.speed === 'max')).toBe(true)
  })

  it(
    '作り直した Worker は loadTerrain の直後 runId 0 から始まるので、terrainReady で session の ' +
      'runId も 0 に戻す（追加の裁定。両者が同じ基準から始まらないと runId の突き合わせがずれる）',
    () => {
      const worker = new FakeWorker()
      const client = new SimulationClient(() => worker)
      const store = createSimulationStore()
      const session = new SimulationSession(client, store, createSettingsStore(memoryStorage()))
      void client.loadTerrain(CENTER.lon, CENTER.lat, 500)
      worker.loaded(terrain)
      session.terrainReady(terrain, CENTER)
      session.start(100, 10) // runId 1
      session.reset() // runId 2

      worker.crash()
      void client.loadTerrain(CENTER.lon, CENTER.lat, 500)
      const reloadedId = worker.loaded(terrain)
      session.terrainReady(terrain, CENTER)

      // 作り直した Worker の loadTerrain 直後は runId 0（例: 止まっている間の setArrows の再送で届く frame）。
      // session の runId が 2 のままだと、この frame は「古い実行」として無視されてしまう
      worker.reply(frameMessage(reloadedId, 0, { runId: 0, stats: statsAt(0) }))
      expect(store.getState().stats?.step).toBe(0)
    },
  )
})

describe('SimulationSession: frame → ストア', () => {
  it('再生中の統計は 10Hz に間引く（最初はすぐ、次は間隔の終わりに最新のもの）', () => {
    vi.useFakeTimers()
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    worker.reply(frameMessage(terrainId, 1))
    worker.reply(frameMessage(terrainId, 2))
    worker.reply(frameMessage(terrainId, 3))
    expect(store.getState().stats?.step).toBe(1)
    vi.advanceTimersByTime(STATS_INTERVAL_MS)
    expect(store.getState().stats?.step).toBe(3)
  })

  it('settled の frame で「平衡」にし、その統計を間引かずに入れる', () => {
    vi.useFakeTimers()
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    worker.reply(frameMessage(terrainId, 1))
    worker.reply(frameMessage(terrainId, 40, { stats: statsAt(40, { settled: true }) }))
    expect(store.getState()).toMatchObject({ status: 'settled', stats: { step: 40 } })
    vi.advanceTimersByTime(STATS_INTERVAL_MS)
    expect(store.getState().stats?.step).toBe(40)
  })

  it('越流イベントは間引かずに一覧へ足す', () => {
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    const events = [{ type: 'spill' as const, step: 9, depressionId: 4, spillElevation: 12.7 }]
    worker.reply(frameMessage(terrainId, 9, { stats: statsAt(9, { events }) }))
    expect(store.getState().spills).toEqual([{ depressionId: 4, spillElevation: 12.7, step: 9 }])
  })

  it('止まっている間の frame（Step）はすぐに入れる。idle の間は settled でも状態を変えない', () => {
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10) // runId 1
    session.pause()
    worker.reply(frameMessage(terrainId, 11, { runId: 1 }))
    expect(store.getState().stats?.step).toBe(11)
    session.reset() // runId 2
    worker.reply(frameMessage(terrainId, 12, { runId: 2, stats: statsAt(12, { settled: true }) }))
    expect(store.getState().status).toBe('idle')
  })

  it(
    '実行中の Reset の後に届く古い runId の frame（Worker が reset を処理する前に送っていた分）は、' +
      '統計・越流イベントを入れない。reset の runId の frame が届くと通常に戻る（重要な指摘）',
    () => {
      const { worker, store, session, terrainId } = setup()
      session.start(100, 10) // runId 1
      worker.reply(frameMessage(terrainId, 5, { runId: 1 }))
      session.reset() // runId 2
      expect(store.getState()).toMatchObject({ status: 'idle', stats: null, spills: [] })

      // Worker が reset を処理する前に送っていた、古い runId（1）の frame が越流イベントつきで遅れて届く
      const staleEvents = [{ type: 'spill' as const, step: 6, depressionId: 1, spillElevation: 3 }]
      worker.reply(
        frameMessage(terrainId, 6, { runId: 1, stats: statsAt(6, { events: staleEvents }) }),
      )
      expect(store.getState().spills).toEqual([])
      expect(store.getState().stats).toBeNull()

      // reset の runId（2）の frame が届くと、通常の扱いに戻る
      worker.reply(frameMessage(terrainId, 0, { runId: 2, stats: statsAt(0) }))
      expect(store.getState().stats?.step).toBe(0)
      worker.reply(frameMessage(terrainId, 1, { runId: 2 }))
      expect(store.getState().stats?.step).toBe(1)
    },
  )

  it(
    'reset の直後に start しても、reset の frame が 1 枚も届かなくても start の runId の frame は ' +
      '扱われる（重要な指摘が見つけた回帰: congestion で reset の step 0 の frame が消えるケース）',
    () => {
      const { worker, store, session, terrainId } = setup()
      session.start(100, 10) // runId 1
      session.reset() // runId 2。この frame は 1 枚も届かない想定（congestion で discardPending に消える）
      session.start(200, 5) // runId 3
      worker.reply(frameMessage(terrainId, 1, { runId: 3 }))
      expect(store.getState()).toMatchObject({ status: 'running' })
      expect(store.getState().stats?.step).toBe(1)
    },
  )

  it('terrainReady の直後（runId 0）に届く frame は扱う。start の後に届く古い runId 0 の frame は無視する', () => {
    const { worker, store, session, terrainId } = setup()
    // terrainReady 直後は runId 0（例: 止まっている間の setArrows の再送で届く frame）
    worker.reply(frameMessage(terrainId, 0, { runId: 0, stats: statsAt(0) }))
    expect(store.getState().stats?.step).toBe(0)

    session.start(100, 10) // runId 1
    worker.reply(frameMessage(terrainId, 1, { runId: 1 }))
    expect(store.getState().stats?.step).toBe(1)

    // 古い runId 0 の frame が遅れて届いても無視する
    worker.reply(frameMessage(terrainId, 0, { runId: 0, stats: statsAt(0) }))
    expect(store.getState().stats?.step).toBe(1)
  })

  it('地点の読み込みを始めた後の frame は入れない', () => {
    const { worker, store, session, terrainId } = setup()
    session.terrainCleared()
    worker.reply(frameMessage(terrainId, 3))
    expect(store.getState().stats).toBeNull()
  })

  it('simFailed は理由をストアに入れ、idle に戻す', () => {
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10) // runId 1
    worker.reply(simFailedMessage(terrainId, { reason: 'no-elevation-at-rain-center' }))
    expect(store.getState()).toMatchObject({
      status: 'idle',
      error: 'no-elevation-at-rain-center',
    })
  })

  it('今の実行と runId が違う simFailed は無視する', () => {
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10) // runId 1
    session.reset() // runId 2
    // runId 1（前の実行）の simFailed が遅れて届いても、idle のまま・エラーも付かない
    worker.reply(simFailedMessage(terrainId, { runId: 1, reason: 'no-elevation-at-rain-center' }))
    expect(store.getState()).toMatchObject({ status: 'idle', error: null })
  })

  it('simFailed が届く前に間引き待ちだった統計を、後から上書きしない（間引きを止める）', () => {
    vi.useFakeTimers()
    const { worker, store, session, terrainId } = setup()
    session.start(100, 10)
    worker.reply(frameMessage(terrainId, 1))
    worker.reply(frameMessage(terrainId, 2))
    worker.reply(simFailedMessage(terrainId, { reason: 'no-elevation-at-rain-center' }))
    expect(store.getState().stats).toBeNull()
    vi.advanceTimersByTime(STATS_INTERVAL_MS)
    expect(store.getState().stats).toBeNull()
  })

  it('Worker が異常終了すると worker のエラーにする（「再読み込み」を出す。spec 04 §10）', () => {
    const { worker, store, session } = setup()
    session.start(100, 10)
    worker.crash()
    expect(store.getState()).toMatchObject({ status: 'idle', error: 'worker' })
  })

  it(
    '異常終了の後は session 自身も地形が無い状態にする。start・resume を呼んでも再生中に戻さず、' +
      'エラーも消さない（コントローラー追加の裁定）',
    () => {
      const { worker, store, session } = setup()
      session.start(100, 10)
      worker.crash()
      expect(store.getState()).toMatchObject({ status: 'idle', error: 'worker' })
      session.start(100, 10)
      expect(store.getState()).toMatchObject({ status: 'idle', error: 'worker' })
      session.resume()
      expect(store.getState()).toMatchObject({ status: 'idle', error: 'worker' })
    },
  )
})

describe('SimulationSession: 水の流れの矢印の設定', () => {
  it('地形が読み込まれたら、今の矢印の設定を Worker に送る（既定は表示・10m）', () => {
    const { worker } = setup()
    expect(worker.posted.at(-1)).toEqual({ type: 'setArrows', visible: true, spacingM: 10 })
  })

  it('setArrows は地形があれば Worker に送り、無ければ覚えるだけ', () => {
    const { worker, session } = setup()
    session.setArrows(false, 20)
    expect(worker.posted.at(-1)).toEqual({ type: 'setArrows', visible: false, spacingM: 20 })
    session.terrainCleared()
    const count = worker.posted.length
    session.setArrows(true, 5)
    expect(worker.posted).toHaveLength(count)
  })

  it('設定の矢印の表示と間隔の変更を Worker に送る', () => {
    const { worker, settings } = setup()
    settings.getState().setDisplay({ showFlowVectors: false, flowVectorSpacingM: 5 })
    expect(worker.posted.at(-1)).toEqual({ type: 'setArrows', visible: false, spacingM: 5 })
  })
})

describe('SimulationSession: attach と frame → WaterOverlay・矢印（追加の裁定 D2/D3 とは別に、runId のルーティングを確かめる）', () => {
  it('attach は今の配色・矢印の表示設定を渡し、地形があれば表示する', () => {
    const { session } = setup()
    const overlay = fakeOverlay()
    session.setPalette('continuous')
    session.setArrows(false, 20)
    session.attach(fakeController(), () => overlay)
    expect(overlay.setPalette).toHaveBeenCalledWith('continuous')
    expect(overlay.setArrowsVisible).toHaveBeenCalledWith(false)
    expect(overlay.show).toHaveBeenCalledWith(terrain.geo)
  })

  it('今の runId の frame は overlay へ水を渡し、矢印つきなら間引いて渡す', () => {
    const { worker, session, terrainId } = setup()
    const overlay = fakeOverlay()
    session.attach(fakeController(), () => overlay)
    session.start(100, 10) // runId 1
    const water = new Float32Array(4).fill(0.1)
    worker.reply(
      frameMessage(terrainId, 1, {
        water: water.buffer,
        arrows: Float32Array.of(0, 0, 90, 0.1),
      }),
    )
    expect(overlay.setWater).toHaveBeenCalledWith(expect.any(Float32Array))
    expect(overlay.setArrows).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: expect.any(Array),
    })
  })

  it(
    '古い runId の frame（Reset の後に遅れて届く分）は overlay の水・矢印を更新しない。' +
      'runId が合う frame は通常どおり反映する（client.onFrame を直接見ると素通りしてしまうための回帰）',
    () => {
      const { worker, session, terrainId } = setup()
      const overlay = fakeOverlay()
      session.attach(fakeController(), () => overlay)
      session.start(100, 10) // runId 1
      session.reset() // runId 2

      worker.reply(frameMessage(terrainId, 5, { runId: 1, arrows: Float32Array.of(0, 0, 90, 0.1) }))
      expect(overlay.setWater).not.toHaveBeenCalled()
      expect(overlay.setArrows).not.toHaveBeenCalled()

      worker.reply(
        frameMessage(terrainId, 0, { runId: 2, arrows: Float32Array.of(1, 1, 180, 0.2) }),
      )
      expect(overlay.setWater).toHaveBeenCalled()
      expect(overlay.setArrows).toHaveBeenCalled()
    },
  )

  it('今の runId の simFailed は overlay の水と矢印を消す（レビューの追加指摘: 返却済みバッファの参照を残さない）', () => {
    const { worker, session, terrainId } = setup()
    const overlay = fakeOverlay()
    session.attach(fakeController(), () => overlay)
    session.start(100, 10) // runId 1
    worker.reply(frameMessage(terrainId, 1, { arrows: Float32Array.of(0, 0, 90, 0.1) }))
    overlay.setWater.mockClear()
    worker.reply(simFailedMessage(terrainId, { runId: 1, reason: 'no-elevation-at-rain-center' }))
    expect(overlay.setWater).toHaveBeenCalledWith(null)
    expect(overlay.clearArrows).toHaveBeenCalled()
  })

  it('古い runId の simFailed は overlay に触れない', () => {
    const { worker, session, terrainId } = setup()
    const overlay = fakeOverlay()
    session.attach(fakeController(), () => overlay)
    session.start(100, 10) // runId 1
    session.reset() // runId 2
    worker.reply(simFailedMessage(terrainId, { runId: 1, reason: 'no-elevation-at-rain-center' }))
    expect(overlay.setWater).not.toHaveBeenCalled()
    expect(overlay.clearArrows).not.toHaveBeenCalled()
  })

  it('Worker の異常終了でも overlay の水と矢印を消す', () => {
    const { worker, session } = setup()
    const overlay = fakeOverlay()
    session.attach(fakeController(), () => overlay)
    session.start(100, 10)
    worker.crash()
    expect(overlay.setWater).toHaveBeenCalledWith(null)
    expect(overlay.clearArrows).toHaveBeenCalled()
  })

  it('terrainCleared は overlay を消し、矢印の間引きを取り消す', () => {
    const { session } = setup()
    const overlay = fakeOverlay()
    session.attach(fakeController(), () => overlay)
    session.terrainCleared()
    expect(overlay.clear).toHaveBeenCalled()
  })

  it('attach の戻り値で外すと、overlay を消す', () => {
    const { session } = setup()
    const overlay = fakeOverlay()
    const detach = session.attach(fakeController(), () => overlay)
    detach()
    expect(overlay.clear).toHaveBeenCalled()
  })

  it('restoreOverlay は overlay の restore を呼ぶ（ベースマップの切り替えで消えたレイヤーの足し直し）', () => {
    const { session } = setup()
    const overlay = fakeOverlay()
    session.attach(fakeController(), () => overlay)
    session.restoreOverlay()
    expect(overlay.restore).toHaveBeenCalled()
  })
})
