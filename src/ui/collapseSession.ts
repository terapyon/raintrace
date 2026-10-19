import {
  CollapseError,
  CompareError,
  type CompareProgress,
  type SimulationClient,
  TerrainLoadError,
} from '../bridge/SimulationClient'
import { removedThickness } from '../dem/fillHistory/removedThickness'
import type {
  CollapsePayload,
  CompareSide,
  DammedSiteSummary,
  TerrainPayload,
} from '../shared/protocol'
import { FLOODED_DEPTH_M } from '../simulation/constants'
import {
  type AppStore,
  type CollapseState,
  type CompareStats,
  type CompareSummary,
  IDLE_COMPARE,
} from '../state/appStore'
import type { SettingsStore } from '../state/settingsStore'
import type { FillHistorySession } from './fillHistorySession'
import { rainfallInput, type SimulationSession } from './simulationSession'

/** 地図とのつなぎ（TerrainSession が渡す）。showTerrain は地図を動かさずに地形の重ね描きを描き直す（ruling R1） */
export interface CollapseMapHooks {
  container: HTMLElement
  showTerrain(terrain: TerrainPayload): void
}

type View = 'before' | 'after'

function pickStats(side: CompareSide): CompareStats {
  const { maxDepth, floodedArea, storedWater, outflowWater } = side.stats
  return { maxDepth, floodedArea, storedWater, outflowWater }
}

/**
 * 比べた結果の要約（spec 10 §5.3）。damMaxDepthM はせき止められた場所（崩れた後の地形の labels が dams の
 * id のセル）の、崩れた後の水深の最大。newWaterAreaM2 は崩れた後は 1 cm 以上・前は 1 cm 未満のセルの面積
 */
export function compareSummary(
  result: { before: CompareSide; after: CompareSide },
  afterTerrain: TerrainPayload,
  dams: readonly DammedSiteSummary[],
): CompareSummary {
  const ids = new Set(dams.map((d) => d.depressionId))
  const before = result.before.depth
  const after = result.after.depth
  const { labels } = afterTerrain
  // 水深は Float32 の写し。エンジンの判定（Float64 で 1 cm 以上）と合うよう、閾値も Float32 に丸めて比べる
  const flooded = Math.fround(FLOODED_DEPTH_M)
  let newCells = 0
  let damMax: number | null = null
  for (let i = 0; i < after.length; i++) {
    const depth = after[i] ?? 0
    if (depth >= flooded && (before[i] ?? 0) < flooded) newCells += 1
    if (ids.has(labels[i] ?? 0) && (damMax === null || depth > damMax)) damMax = depth
  }
  const cellSizeM = afterTerrain.geo.cellSizeM
  return {
    before: pickStats(result.before),
    after: pickStats(result.after),
    damMaxDepthM: damMax,
    newWaterAreaM2: newCells * cellSizeM * cellSizeM,
  }
}

/**
 * 両側の合計の残りの目安（秒）。Worker の残りは今の側の分だけなので、崩れる前を計算している間は、
 * 崩れた後も今の速さで同じだけかかると見て、崩れる前の全体（残り ÷ (1 − 進み具合)）を足す（目安。
 * 崩れた後の地形の方が水の動きが多く遅くなることもある）
 */
function totalRemainingS(progress: CompareProgress): number | null {
  const { side, fraction, remainingS } = progress
  if (remainingS === null) return null
  if (side === 'after') return remainingS
  return fraction < 1 ? remainingS + remainingS / (1 - fraction) : null
}

/**
 * 盛土が崩れたと仮定した場合の計算・崩れる前後の切り替え・比べる計算をつなぐ（spec 10）。React の外に置く。
 * 大きな配列（崩れた後の地形・比べた水深）はここに持ち、ストアには小さな要約だけを入れる。
 * 基の地形（崩れる前。最後に読み込んだ地形）はここで持ち、client.terrain（差し替えで変わる）は使わない（ruling R8）
 */
export class CollapseSession {
  private readonly client: SimulationClient
  private readonly app: AppStore
  private readonly simulation: SimulationSession
  private readonly fillHistory: FillHistorySession
  private readonly settings: SettingsStore
  private base: TerrainPayload | null = null
  private center: { lon: number; lat: number } | null = null
  private payload: CollapsePayload | null = null
  private compared: { before: CompareSide; after: CompareSide } | null = null
  /** エンジンが持つ（または差し替えを頼んだ）地形。ストアの view は差し替えが済んでから変わる */
  private engine: View = 'before'
  private computeGeneration = 0
  private compareGeneration = 0
  private viewGeneration = 0
  private comparing = false
  private map: CollapseMapHooks | null = null
  private readonly listeners = new Set<() => void>()

  constructor(
    client: SimulationClient,
    app: AppStore,
    simulation: SimulationSession,
    fillHistory: FillHistorySession,
    settings: SettingsStore,
  ) {
    this.client = client
    this.app = app
    this.simulation = simulation
    this.fillHistory = fillHistory
    this.settings = settings
    simulation.onTerrain((terrain, info) => {
      // 崩れる前後の切り替えは自分で起こしたもの。基の地形は変わらない
      if (info.variant) return
      // 新しい地点の読み込み（null）でも、新しい地形でも、エンジンは崩れる前（読み込んだ地形）になる。
      // 降雨中心は TerrainSession が terrainReady に渡すのと同じ、選んだ地点
      this.base = terrain
      this.center = terrain === null ? null : this.app.getState().selected
      this.viewGeneration += 1
      this.engine = 'before'
      this.app.getState().setCollapseSwapping(false)
      this.writeView('before')
      this.discard(false)
    })
    client.onCrash(() => this.onCrash())
    app.subscribe((state, previous) => {
      if (state.collapse === previous.collapse) return
      if (!discarded(state.collapse, previous.collapse)) return
      // 地点の変更では差し替えない（すぐに新しい地形の読み込みが始まり、差し替えに勝つ）
      this.discard(state.selected === previous.selected)
    })
  }

  /** 地図の要素と描き直しを受け取る。戻り値で外す */
  attachMap(hooks: CollapseMapHooks): () => void {
    this.map = hooks
    this.writeView(this.app.getState().collapse.view)
    return () => {
      if (this.map === hooks) this.map = null
    }
  }

  /** 大きな配列を含む今の結果。無ければ null */
  result(): CollapsePayload | null {
    return this.payload
  }

  /** 比べた水深と統計。無ければ null */
  compareResult(): { before: CompareSide; after: CompareSide } | null {
    return this.compared
  }

  /** 結果・比べた結果ができた・消えたことを知らせる（地図の重ね描きと 3D）。戻り値で外す */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 開いている候補・割合・プリセットで、崩れた後の地形を計算する（09 の ΔZ補正 から崩れる厚さを作る） */
  async compute(): Promise<void> {
    const { collapse } = this.app.getState()
    const { candidateId, ratio, presetId } = collapse
    const fill = this.fillHistory.result()
    const base = this.base
    const terrainId = this.client.baseTerrainId
    if (candidateId === null || fill === null || base === null || terrainId === null) return
    if (collapse.status === 'computing' || collapse.status === 'ready') return
    const generation = ++this.computeGeneration
    const actions = this.app.getState()
    actions.setCollapseComputing()
    const removed = removedThickness(fill.deltaCorrected, fill.candidateLabels, candidateId, ratio)
    let result: CollapsePayload
    try {
      result = await this.client.collapse(
        { terrainId, terrain: base, removed, candidateId, ratio, presetId },
        (fraction) => {
          if (generation === this.computeGeneration) actions.setCollapseProgress(fraction)
        },
      )
    } catch (error) {
      if (generation !== this.computeGeneration) return
      // 置き換わった依頼は、置き換えた側が結果を入れる
      if (error instanceof CollapseError && error.reason === 'superseded') return
      actions.setCollapseResult('failed', null)
      console.error(error)
      return
    }
    // 古い依頼・閉じた後・今の基の地形と違う地形の応答は捨てる
    if (generation !== this.computeGeneration || result.terrainId !== this.client.baseTerrainId) {
      return
    }
    this.payload = result
    this.notify()
    actions.setCollapseResult('ready', {
      candidateId: result.candidateId,
      ratio: result.ratio,
      presetId: result.presetId,
      collapsedM3: result.collapsedM3,
      depositedM3: result.depositedM3,
      outsideM3: result.outsideM3,
      dams: result.dams,
    })
    // 計算した土砂を地図・3D に出す（spec 10 §1.3 手順 3）。「崩れる前」へはいつでも戻せる
    await this.setView('after')
  }

  /**
   * 崩れる前・後を表示する。エンジンの地形を差し替え、再生をリセットし（variant）、地図を動かさずに描き直す。
   * 差し替えの途中はストアの swapping を立てる（再生の命令を差し替えの間に挟ませない。Task 6 のレビュー M1）
   */
  async setView(view: View): Promise<void> {
    if (view === 'after' && this.payload === null) return
    if (view === this.engine && view === this.app.getState().collapse.view) return
    await this.show(view)
  }

  /** 今の雨の設定で、崩れる前と後を雨が降り終わるまで計算して比べる（spec 10 §5.3） */
  async compare(): Promise<void> {
    const payload = this.payload
    const base = this.base
    const center = this.center
    if (payload === null || base === null || center === null) return
    this.stopCompare()
    const generation = ++this.compareGeneration
    this.comparing = true
    const actions = this.app.getState()
    const { rainfall, area } = this.settings.getState()
    const running = {
      ...IDLE_COMPARE,
      status: 'running' as const,
      side: 'before' as const,
      settings: { ...rainfall, sizeM: area.sizeM },
    }
    actions.setCompare(running)
    const rain = rainfallInput(rainfall, base.geo, center)
    let result: { before: CompareSide; after: CompareSide }
    try {
      result = await this.client.compareCollapse(base, payload.after, rain, (progress) => {
        if (generation !== this.compareGeneration) return
        actions.setCompare({
          ...running,
          side: progress.side,
          progress: progress.fraction,
          remainingS: totalRemainingS(progress),
        })
      })
    } catch (error) {
      if (generation !== this.compareGeneration) return
      this.comparing = false
      const reason = error instanceof CompareError ? error.reason : 'internal'
      // 置き換わった比較は、置き換えた側（新しい比較・地点の変更）が状態を入れる
      if (reason === 'superseded') return
      if (reason === 'cancelled') {
        actions.setCompare(IDLE_COMPARE)
        return
      }
      actions.setCompare({ ...IDLE_COMPARE, status: 'failed' })
      console.error(error)
      return
    }
    if (generation !== this.compareGeneration) return
    this.comparing = false
    this.compared = result
    this.notify()
    actions.setCompare({
      status: 'done',
      side: null,
      progress: 1,
      remainingS: null,
      summary: compareSummary(result, payload.after, payload.dams),
      settings: running.settings,
    })
  }

  /** 比べる計算を取り消す（compare.status は idle、summary は null） */
  cancelCompare(): void {
    this.stopCompare()
    this.app.getState().setCompare(IDLE_COMPARE)
  }

  /** 走っている比較を取り消し、比べた結果を捨てる（ストアは変えない）。捨てたら知らせる */
  private stopCompare(): void {
    if (this.dropCompare()) this.notify()
  }

  /** stopCompare の知らせない版。比べた結果を捨てたら true */
  private dropCompare(): boolean {
    this.compareGeneration += 1
    if (this.comparing) {
      this.comparing = false
      this.client.cancelCompare()
    }
    if (this.compared === null) return false
    this.compared = null
    return true
  }

  /**
   * 結果・比べる計算・進行中の依頼を捨てる（閉じる・割合やプリセットの変更・候補の変更・盛土の履歴を切る・
   * 地点の変更。Review Focus 1）。swapBack なら、崩れた後のエンジンを基の地形に戻す
   */
  private discard(swapBack: boolean): void {
    this.computeGeneration += 1
    let changed = this.dropCompare()
    if (this.payload !== null) {
      this.payload = null
      changed = true
    }
    if (changed) this.notify()
    if (swapBack && this.engine === 'after') void this.show('before')
  }

  /**
   * Worker の異常終了。新しい Worker には地形が無いので差し替えは頼まず、エンジン・表示を崩れる前にして閉じる。
   * 待っていた依頼（計算・比較・差し替え）は SimulationClient が失敗させ、世代が進んでいるので捨てる
   */
  private onCrash(): void {
    const showingAfter = this.app.getState().collapse.view === 'after'
    this.viewGeneration += 1
    this.engine = 'before'
    // 比べる計算は SimulationClient が既に失敗させている（取り消しを送る相手もいない）
    this.comparing = false
    const actions = this.app.getState()
    actions.setCollapseSwapping(false)
    // 閉じると、購読の discard が結果を捨てる（エンジンは before なので差し替えない）
    actions.closeCollapse()
    if (showingAfter && this.base !== null) this.map?.showTerrain(this.base)
    this.writeView('before')
  }

  private async show(view: View): Promise<void> {
    const terrain = view === 'after' ? this.payload?.after : this.base
    const center = this.center
    if (terrain === undefined || terrain === null || center === null) return
    const generation = ++this.viewGeneration
    // 差し替えを頼んだ時点で、Worker のエンジンはこの地形になりうる（取り消しで基に戻すかの判断に使う）
    this.engine = view
    const actions = this.app.getState()
    actions.setCollapseSwapping(true)
    try {
      await this.client.swapTerrain(terrain)
    } catch (error) {
      if (generation !== this.viewGeneration) return
      this.engine = this.app.getState().collapse.view
      actions.setCollapseSwapping(false)
      // 地点の読み込みに置き換わった。新しい地形が来れば崩れる前に戻る
      if (!(error instanceof TerrainLoadError && error.reason === 'superseded')) {
        console.error(error)
      }
      return
    }
    // 差し替えの間に閉じた・別の切り替えをした・地点を変えた
    if (generation !== this.viewGeneration) return
    // 昔の地形（3D）の表示は終える。崩れる前後はどちらも今の地形の上の話
    actions.setTerrainEpoch('now')
    this.simulation.terrainReady(terrain, center, { variant: true })
    this.map?.showTerrain(terrain)
    actions.setCollapseView(view)
    actions.setCollapseSwapping(false)
    this.writeView(view)
  }

  /** 地図の要素に今の表示を書く（E2E が読む） */
  private writeView(view: View): void {
    if (this.map !== null) this.map.container.dataset.collapseView = view
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}

/** ストアの操作で結果が無効になった（候補・割合・プリセットが変わった、または idle に戻された） */
function discarded(current: CollapseState, previous: CollapseState): boolean {
  return (
    current.candidateId !== previous.candidateId ||
    current.ratio !== previous.ratio ||
    current.presetId !== previous.presetId ||
    (current.status === 'idle' && previous.status !== 'idle')
  )
}
