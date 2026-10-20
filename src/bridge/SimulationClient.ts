import type {
  CollapsePayload,
  CollapseRatio,
  FillHistoryFailureReason,
  FillHistoryPayload,
  FrameMessage,
  MainToWorkerMessage,
  PlaybackSpeed,
  SimFailureReason,
  SimulationCommand,
  TerrainErrorReason,
  TerrainPayload,
  WorkerToMainMessage,
} from '../shared/protocol'

/** SimulationClient が使う Worker の機能。テストでは偽物に差し替える */
export interface WorkerPort {
  postMessage(message: MainToWorkerMessage, transfer?: Transferable[]): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerToMainMessage>) => void,
  ): void
  addEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void
  removeEventListener(
    type: 'message',
    listener: (event: MessageEvent<WorkerToMainMessage>) => void,
  ): void
  removeEventListener(type: 'error' | 'messageerror', listener: (event: Event) => void): void
  terminate(): void
}

/** Vite が Worker をバンドルできるよう、new Worker(new URL(...)) をこの形のまま書く */
export function createSimulationWorker(): WorkerPort {
  return new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), {
    type: 'module',
    name: 'simulation',
  })
}

export const PING_TIMEOUT_MS = 5000
/** 読み込みの進捗がこの時間止まったら、Worker が止まったとみなす（02 の申し送り L14） */
export const LOAD_STALL_TIMEOUT_MS = 30_000

export class TerrainLoadError extends Error {
  readonly reason: TerrainErrorReason
  constructor(reason: TerrainErrorReason, message: string) {
    super(message)
    this.reason = reason
  }
}

/** 盛土の履歴の失敗の理由。superseded: 新しい依頼に置き換わった。worker: Worker が異常終了した */
export type FillHistoryErrorReason = FillHistoryFailureReason | 'superseded' | 'worker'

export class FillHistoryLoadError extends Error {
  readonly reason: FillHistoryErrorReason
  constructor(reason: FillHistoryErrorReason, message: string) {
    super(message)
    this.reason = reason
  }
}

/** メインが受け取った frame。water は次の frame が届くまで手元に置く。runId は FrameMessage と同じ */
export interface FrameView {
  water: Float32Array<ArrayBuffer>
  arrows: Float32Array | null
  stats: FrameMessage['stats']
  stepsPerSecond: number
  /** 実際の倍率。FrameMessage と同じ */
  simSecondsPerSecond: number
  runId: number
}

export type RainfallInput = Extract<SimulationCommand, { type: 'start' }>['rain']

interface PendingPing {
  resolve: () => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface PendingTerrain {
  requestId: number
  resolve: (terrain: TerrainPayload) => void
  reject: (error: TerrainLoadError) => void
  onProgress: ((done: number, started: number) => void) | undefined
}

interface PendingSwap {
  requestId: number
  /** 差し替える地形。成功したら this.terrain になる */
  terrain: TerrainPayload
  resolve: () => void
  reject: (error: TerrainLoadError) => void
}

interface PendingFillHistory {
  requestId: number
  /** 依頼した時点の地形（loadTerrain の requestId）。応答のときの今の地形と比べる */
  terrainId: number
  resolve: (result: FillHistoryPayload) => void
  reject: (error: FillHistoryLoadError) => void
}

/** 崩れた後の計算の失敗の理由。superseded: 新しい依頼か地形の読み込みに置き換わった。worker: Worker が異常終了した */
export type CollapseErrorReason = 'internal' | 'superseded' | 'worker'

export class CollapseError extends Error {
  readonly reason: CollapseErrorReason
  constructor(reason: CollapseErrorReason, message: string) {
    super(message)
    this.reason = reason
  }
}

/** 崩れた後の計算の依頼。terrain は崩れる前の（読み込んだ）地形、removed は崩れる厚さ（m） */
export interface CollapseRequest {
  terrainId: number
  terrain: TerrainPayload
  removed: Float32Array
  /** 09 の結果の pastElevation（offsetM を足す前）と offsetM */
  pastElevation: Float32Array
  offsetM: number
  candidateId: number
  ratio: CollapseRatio
  presetId: string
}

interface PendingCollapse {
  requestId: number
  /** 依頼した時点の読み込んだ地形の id。応答のときの今の地形と比べる（ruling R7） */
  baseTerrainId: number | null
  onProgress: ((fraction: number) => void) | undefined
  resolve: (result: CollapsePayload) => void
  reject: (error: CollapseError) => void
}

/**
 * メインスレッドで Worker を所有する（tech-spec §5.1）。アプリで 1 つだけ作る（01 の申し送り H2）。
 * 読み込んだ地形と最新の水深の配列はここに持ち、React やストアには載せない
 */
export class SimulationClient {
  terrain: TerrainPayload | null = null
  /**
   * エンジンが今持つ地形の id。loadTerrain の requestId、または差し替え（swapTerrain）の requestId。
   * frame・simFailed の terrainId と比べる。差し替えのたびに新しくなるので、前の地形の frame は捨てられる
   */
  terrainId: number | null = null
  /**
   * 最後に loadTerrain で読み込んだ地形の id（差し替えでは変わらない）。盛土の履歴・崩れた後の計算は
   * 読み込んだ地形に属するので、その依頼と応答の突き合わせはこちらで行う（terrainId だと、差し替えのたびに
   * 履歴の結果が古いものとして捨てられてしまう。spec 10 §5.2）
   */
  baseTerrainId: number | null = null
  /** 最新の frame の水深。次の frame が届くまで、表示とセル情報に使う（tech-spec §5.2） */
  water: Float32Array<ArrayBuffer> | null = null
  private worker: WorkerPort
  private readonly createWorker: () => WorkerPort
  private readonly pendingPings = new Map<number, PendingPing>()
  private pendingTerrain: PendingTerrain | null = null
  private pendingSwap: PendingSwap | null = null
  private pendingFillHistory: PendingFillHistory | null = null
  private pendingCollapse: PendingCollapse | null = null
  private readonly frameListeners = new Set<(frame: FrameView) => void>()
  private readonly simFailedListeners = new Set<(reason: SimFailureReason, runId: number) => void>()
  private readonly crashListeners = new Set<() => void>()
  private watchdog: ReturnType<typeof setTimeout> | undefined
  private crashed = false
  private disposed = false
  private nextId = 1

  private readonly onMessage = (event: MessageEvent<WorkerToMainMessage>): void => {
    const message = event.data
    switch (message.type) {
      case 'pong': {
        const entry = this.pendingPings.get(message.id)
        if (entry !== undefined) {
          this.pendingPings.delete(message.id)
          clearTimeout(entry.timer)
          entry.resolve()
        }
        break
      }
      case 'terrainProgress':
        if (this.pendingTerrain?.requestId === message.requestId) {
          this.armWatchdog()
          this.pendingTerrain.onProgress?.(message.done, message.started)
        }
        break
      case 'terrainLoaded': {
        // Worker は要求を順に処理するので terrainLoaded は単調に届き、this.terrain は Worker のエンジンが
        // 持つ地形と同じ「最後に成功した地形」になる。画面の読み込みの状態とは別
        this.terrain = message.terrain
        this.terrainId = message.requestId
        this.baseTerrainId = message.requestId
        // 前の地形の水深は捨てる（大きさが違いうる。Worker は新しい地形のバッファを 2 枚作る）
        this.water = null
        this.takeTerrain(message.requestId)?.resolve(message.terrain)
        break
      }
      case 'terrainSwapped': {
        // loadTerrain や新しい差し替えに置き換わった古い要求の返事は、ここで捨てる
        const pending = this.pendingSwap
        if (pending === null || pending.requestId !== message.requestId) break
        this.pendingSwap = null
        this.terrain = pending.terrain
        this.terrainId = message.requestId
        this.water = null
        pending.resolve()
        break
      }
      case 'terrainFailed':
        this.takeTerrain(message.requestId)?.reject(
          new TerrainLoadError(message.reason, message.message),
        )
        break
      case 'fillHistoryReady': {
        // Worker は計算中に地形が変わったかを知らないので、直前の loadTerrain の前の地形の結果が返りうる。
        // 依頼の terrainId と応答の terrainId が、今の地形と同じものだけを通す
        const pending = this.takeFillHistory(message.requestId)
        if (pending === null) break
        if (
          message.result.terrainId === this.baseTerrainId &&
          pending.terrainId === this.baseTerrainId
        ) {
          pending.resolve(message.result)
        } else {
          pending.reject(
            new FillHistoryLoadError('superseded', '地形が変わったため結果を捨てました'),
          )
        }
        break
      }
      case 'fillHistoryFailed': {
        const pending = this.takeFillHistory(message.requestId)
        if (pending === null) break
        if (pending.terrainId === this.baseTerrainId) {
          pending.reject(new FillHistoryLoadError(message.reason, message.message))
        } else {
          pending.reject(
            new FillHistoryLoadError('superseded', '地形が変わったため結果を捨てました'),
          )
        }
        break
      }
      case 'collapseProgress': {
        const pending = this.pendingCollapse
        if (pending === null || pending.requestId !== message.requestId) break
        if (pending.baseTerrainId !== this.baseTerrainId) break
        pending.onProgress?.(message.fraction)
        break
      }
      case 'collapseReady': {
        const pending = this.takeCollapse(message.requestId)
        if (pending === null) break
        if (
          pending.baseTerrainId === this.baseTerrainId &&
          message.result.terrainId === this.baseTerrainId
        ) {
          pending.resolve(message.result)
        } else {
          pending.reject(new CollapseError('superseded', '地形が変わったため結果を捨てました'))
        }
        break
      }
      case 'collapseFailed': {
        const pending = this.takeCollapse(message.requestId)
        if (pending === null) break
        pending.reject(
          pending.baseTerrainId === this.baseTerrainId
            ? new CollapseError('internal', message.message)
            : new CollapseError('superseded', '地形が変わったため結果を捨てました'),
        )
        break
      }
      case 'frame':
        this.receiveFrame(message)
        break
      case 'simFailed':
        if (message.terrainId === this.terrainId) {
          // 失敗した start はエンジンを reset 済みで、step 0 の frame を送ってこない。前の実行の水深を
          // 出し続けないよう手元のバッファを消し、Worker にも返す（大きさは同じ地形なので合う）
          // （タスク 4 のレビューの裁定 1）。この返却は下の購読者への通知より先に起きる。安全なのは
          // SimulationSession.clearWater()（simulationSession.ts）が同じタスクの中で同期的に自分の参照を
          // 手放すからで、この経路を非同期にすると壊れる（不変条件は呼び出し順だけで保たれている）
          if (this.water !== null) {
            const buffer = this.water.buffer
            this.water = null
            this.command({ type: 'returnBuffer', buffer }, [buffer])
          }
          for (const listener of this.simFailedListeners) listener(message.reason, message.runId)
        }
        break
    }
  }

  private readonly onError = (): void => {
    // 'error' は Worker の未捕捉の例外でも発火し、Worker が止まったとは限らない。
    // 'messageerror'（返ってきたメッセージを構造化複製できなかった場合）も同じ扱いにする。
    // どちらも作り直しの契機にして扱いを決定的にする
    this.crash(new TerrainLoadError('worker', 'Worker が異常終了しました'))
  }

  constructor(createWorker: () => WorkerPort = createSimulationWorker) {
    this.createWorker = createWorker
    this.worker = this.spawnWorker()
  }

  /** ping を送り、pong が返れば解決する。timeoutMs 以内に返らなければ失敗する */
  ping(timeoutMs = PING_TIMEOUT_MS): Promise<void> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      // Worker の生成が例外を投げても、タイマーや待ちを残さないよう先に取る
      const worker = this.port()
      const timer = setTimeout(() => {
        this.pendingPings.delete(id)
        reject(new Error(`Worker が ${timeoutMs}ms 以内に応答しませんでした`))
      }, timeoutMs)
      this.pendingPings.set(id, { resolve, reject, timer })
      worker.postMessage({ type: 'ping', id })
    })
  }

  /** 地点の周囲の地形を読み込む。前の読み込みは superseded で失敗させる（spec 02 §4.3） */
  loadTerrain(
    lon: number,
    lat: number,
    sizeM: number,
    onProgress?: (done: number, started: number) => void,
  ): Promise<TerrainPayload> {
    this.pendingTerrain?.reject(
      new TerrainLoadError('superseded', '新しい地点の読み込みに置き換わりました'),
    )
    // port() が投げた場合に、reject 済みの古い entry を pendingTerrain に残さない
    this.pendingTerrain = null
    // 読み込みが差し替えに勝つ。返事を待っている差し替えは捨てる
    this.pendingSwap?.reject(
      new TerrainLoadError('superseded', '新しい地点の読み込みに置き換わりました'),
    )
    this.pendingSwap = null
    // Worker も loadTerrain で崩れた後の計算を取り消す
    this.pendingCollapse?.reject(
      new CollapseError('superseded', '新しい地点の読み込みに置き換わりました'),
    )
    this.pendingCollapse = null
    this.clearWatchdog()
    const requestId = this.nextId++
    return new Promise((resolve, reject) => {
      const worker = this.port()
      this.pendingTerrain = { requestId, resolve, reject, onProgress }
      worker.postMessage({ type: 'loadTerrain', requestId, lon, lat, sizeM })
      this.armWatchdog()
    })
  }

  /**
   * エンジンの地形を渡した地形に差し替える（崩れる前と後の切り替え。spec 10 §5.2）。タイルは読まない。
   * 成功すると terrain・terrainId が変わり、水深は捨てる（前の地形の frame は terrainId で捨てられる）。
   * 地点の読み込み中は差し替えず superseded で失敗する。新しい読み込み・差し替えが来たら古い差し替えも superseded。
   * 地形をまだ読み込んでいなければ、差し替える基が無いので internal で失敗する（Task 6 のレビュー M2）
   */
  swapTerrain(terrain: TerrainPayload): Promise<void> {
    if (this.baseTerrainId === null) {
      return Promise.reject(
        new TerrainLoadError('internal', '地形を読み込んでいないため差し替えません'),
      )
    }
    if (this.pendingTerrain !== null) {
      return Promise.reject(
        new TerrainLoadError('superseded', '地点の読み込み中のため差し替えません'),
      )
    }
    this.pendingSwap?.reject(new TerrainLoadError('superseded', '新しい差し替えに置き換わりました'))
    this.pendingSwap = null
    const requestId = this.nextId++
    return new Promise((resolve, reject) => {
      const worker = this.port()
      this.pendingSwap = { requestId, terrain, resolve, reject }
      // Worker へは写しを送る（メインの terrain はそのまま残す）
      const elevation = terrain.elevation.slice()
      const validMask = terrain.validMask.slice()
      worker.postMessage(
        {
          type: 'swapTerrain',
          requestId,
          elevation,
          validMask,
          size: terrain.geo.size,
          cellSizeM: terrain.geo.cellSizeM,
          depressions: terrain.depressions,
        },
        [elevation.buffer, validMask.buffer],
      )
    })
  }

  /**
   * 今の地形の盛土の履歴を頼む（spec 09 §4.6）。Worker は格子を持たないので、標高とマスクの写しを送る
   * （メインの地形はそのまま残す）。前の依頼は superseded で失敗させる
   */
  computeFillHistory(terrainId: number, terrain: TerrainPayload): Promise<FillHistoryPayload> {
    this.pendingFillHistory?.reject(
      new FillHistoryLoadError('superseded', '新しい依頼に置き換わりました'),
    )
    this.pendingFillHistory = null
    const requestId = this.nextId++
    return new Promise((resolve, reject) => {
      let worker: WorkerPort
      try {
        worker = this.port()
      } catch (error) {
        throw new FillHistoryLoadError(
          'worker',
          error instanceof Error ? error.message : String(error),
        )
      }
      this.pendingFillHistory = { requestId, terrainId, resolve, reject }
      const elevation = terrain.elevation.slice()
      const validMask = terrain.validMask.slice()
      worker.postMessage(
        { type: 'fillHistory', requestId, terrainId, geo: terrain.geo, elevation, validMask },
        [elevation.buffer, validMask.buffer],
      )
    })
  }

  /**
   * 盛土が崩れた後の地形を頼む（spec 10）。標高・マスク・崩れる厚さの写しを送る（メインの配列はそのまま残す）。
   * 前の依頼と、依頼の後の地形の読み込みは superseded で失敗させる。応答は baseTerrainId で突き合わせる（ruling R7）
   */
  collapse(
    request: CollapseRequest,
    onProgress?: (fraction: number) => void,
  ): Promise<CollapsePayload> {
    this.pendingCollapse?.reject(new CollapseError('superseded', '新しい依頼に置き換わりました'))
    this.pendingCollapse = null
    const requestId = this.nextId++
    return new Promise((resolve, reject) => {
      let worker: WorkerPort
      try {
        worker = this.port()
      } catch (error) {
        throw new CollapseError('worker', error instanceof Error ? error.message : String(error))
      }
      this.pendingCollapse = {
        requestId,
        baseTerrainId: this.baseTerrainId,
        onProgress,
        resolve,
        reject,
      }
      const { terrain } = request
      const elevation = terrain.elevation.slice()
      const validMask = terrain.validMask.slice()
      const removed = request.removed.slice()
      const pastElevation = request.pastElevation.slice()
      worker.postMessage(
        {
          type: 'collapse',
          requestId,
          terrainId: request.terrainId,
          geo: terrain.geo,
          elevation,
          validMask,
          removed,
          pastElevation,
          offsetM: request.offsetM,
          candidateId: request.candidateId,
          ratio: request.ratio,
          presetId: request.presetId,
        },
        [elevation.buffer, validMask.buffer, removed.buffer, pastElevation.buffer],
      )
    })
  }

  /** runId は SimulationSession が振る通し番号。そのまま Worker へ渡す（タスクレビューの追加の裁定） */
  start(rain: RainfallInput, runId: number): void {
    this.command({ type: 'start', rain, runId })
  }
  pause(): void {
    this.command({ type: 'pause' })
  }
  resume(): void {
    this.command({ type: 'resume' })
  }
  step(): void {
    this.command({ type: 'step' })
  }
  /** runId は start と同じ（タスクレビューの追加の裁定） */
  reset(runId: number): void {
    this.command({ type: 'reset', runId })
  }
  setSpeed(speed: PlaybackSpeed): void {
    this.command({ type: 'setSpeed', speed })
  }
  setArrows(visible: boolean, spacingM: number): void {
    this.command({ type: 'setArrows', visible, spacingM })
  }

  onFrame(listener: (frame: FrameView) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  onSimFailed(listener: (reason: SimFailureReason, runId: number) => void): () => void {
    this.simFailedListeners.add(listener)
    return () => {
      this.simFailedListeners.delete(listener)
    }
  }

  /** Worker の異常終了（読み込みの番犬を含む）を知らせる。再生中なら画面を「再読み込み」にする（spec 04 §10） */
  onCrash(listener: () => void): () => void {
    this.crashListeners.add(listener)
    return () => {
      this.crashListeners.delete(listener)
    }
  }

  /** Worker を終了する。待っている要求は失敗させ、タイマーを残さない。破棄した後は Worker を作り直さない */
  dispose(): void {
    this.disposed = true
    this.stop(new TerrainLoadError('worker', 'SimulationClient は破棄されました'))
  }

  private receiveFrame(message: FrameMessage): void {
    if (message.terrainId !== this.terrainId) {
      // 前の地形の frame（地点を変えた直後に届く）。表示せずにバッファだけ返す
      this.command({ type: 'returnBuffer', buffer: message.water }, [message.water])
      return
    }
    const previous = this.water
    const water = new Float32Array(message.water)
    this.water = water
    const frame: FrameView = {
      water,
      arrows: message.arrows,
      stats: message.stats,
      stepsPerSecond: message.stepsPerSecond,
      simSecondsPerSecond: message.simSecondsPerSecond,
      runId: message.runId,
    }
    try {
      for (const listener of this.frameListeners) listener(frame)
    } finally {
      // 表示とセル情報は新しい方を読むので、古い方を返す。返した後は previous に触れない（tech-spec §5.2）。
      // 購読者が例外を投げても必ず返す。返さないと Worker の 2 枚のバッファが尽き、再生が止まる（最終レビューの軽微）
      if (previous !== null) {
        this.command({ type: 'returnBuffer', buffer: previous.buffer }, [previous.buffer])
      }
    }
  }

  /**
   * 再生の命令を送る。異常終了・破棄の後は送らず、Worker も起動し直さない。
   * 新しい Worker には地形が無いので、再読み込みは地点の選び直し（読み込み）で行う（spec 04 §10）
   */
  private command(message: SimulationCommand, transfer: Transferable[] = []): void {
    if (this.crashed || this.disposed) return
    this.worker.postMessage(message, transfer)
  }

  /**
   * 要求を送る Worker。異常終了の後は、次の要求（ping・loadTerrain）のときに起動し直す（spec 02 §7）。
   * すぐに起動し直すと、スクリプトを読めない Worker（CSP で塞がれた場合など）で作り直しが止まらない。
   * 破棄した後は、異常終了の後の dispose でも Worker を作り直さない
   */
  private port(): WorkerPort {
    if (this.disposed) {
      throw new TerrainLoadError('worker', 'SimulationClient は破棄されました')
    }
    if (this.crashed) {
      try {
        this.worker = this.spawnWorker()
        this.crashed = false
      } catch (error) {
        // 起動を同期的に投げる factory（CSP で塞がれた場合など）でも、crashed は true のままにし、
        // 次の要求でまた起動を試みる
        throw new TerrainLoadError('worker', `Worker を起動できませんでした: ${String(error)}`)
      }
    }
    return this.worker
  }

  /** Worker を作って配線する（コンストラクタと、異常終了の後の作り直しで使う） */
  private spawnWorker(): WorkerPort {
    const worker = this.createWorker()
    worker.addEventListener('message', this.onMessage)
    worker.addEventListener('error', this.onError)
    worker.addEventListener('messageerror', this.onError)
    return worker
  }

  /** 異常終了として扱う。Worker を終了し、待っている要求を失敗させ、次の要求で起動し直す */
  private crash(error: TerrainLoadError): void {
    this.stop(error)
    this.crashed = true
    this.water = null
    for (const listener of this.crashListeners) listener()
  }

  private stop(error: TerrainLoadError): void {
    this.worker.removeEventListener('message', this.onMessage)
    this.worker.removeEventListener('error', this.onError)
    this.worker.removeEventListener('messageerror', this.onError)
    this.worker.terminate()
    this.failAll(error)
  }

  /** 読み込みの番犬を張り直す。進捗が止まった Worker は次のメッセージも処理できないので、異常終了と同じ扱い */
  private armWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined
      this.crash(
        new TerrainLoadError(
          'worker',
          `読み込みが ${LOAD_STALL_TIMEOUT_MS / 1000} 秒進みませんでした`,
        ),
      )
    }, LOAD_STALL_TIMEOUT_MS)
  }

  private clearWatchdog(): void {
    clearTimeout(this.watchdog)
    this.watchdog = undefined
  }

  private takeTerrain(requestId: number): PendingTerrain | null {
    const pending = this.pendingTerrain
    if (pending === null || pending.requestId !== requestId) return null
    this.pendingTerrain = null
    this.clearWatchdog()
    return pending
  }

  private takeFillHistory(requestId: number): PendingFillHistory | null {
    const pending = this.pendingFillHistory
    if (pending === null || pending.requestId !== requestId) return null
    this.pendingFillHistory = null
    return pending
  }

  private takeCollapse(requestId: number): PendingCollapse | null {
    const pending = this.pendingCollapse
    if (pending === null || pending.requestId !== requestId) return null
    this.pendingCollapse = null
    return pending
  }

  private failAll(error: TerrainLoadError): void {
    this.pendingCollapse?.reject(new CollapseError('worker', error.message))
    this.pendingCollapse = null
    this.pendingFillHistory?.reject(new FillHistoryLoadError('worker', error.message))
    this.pendingFillHistory = null
    this.pendingSwap?.reject(error)
    this.pendingSwap = null
    for (const entry of this.pendingPings.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    this.pendingPings.clear()
    this.pendingTerrain?.reject(error)
    this.pendingTerrain = null
    this.clearWatchdog()
  }
}
