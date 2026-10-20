import { FillHistoryLoadError, type SimulationClient } from '../bridge/SimulationClient'
import type { FillHistoryPayload, TerrainPayload } from '../shared/protocol'
import type { AppStore, FillHistoryStatus } from '../state/appStore'
import type { SimulationSession } from './simulationSession'

/**
 * 盛土の履歴の依頼と結果（spec 09 §4.6）。React の外に置く。
 * 機能がオンで地形があるときだけ Worker に頼む（オフのときに通信を増やさない）。
 * 大きな配列はここに持ち、ストアには小さな要約だけを入れる
 */
export class FillHistorySession {
  private readonly client: SimulationClient
  private readonly app: AppStore
  private terrain: TerrainPayload | null = null
  private payload: FillHistoryPayload | null = null
  /** 依頼の世代。地形の変更・オフで進め、古い依頼の応答を捨てる */
  private generation = 0
  private readonly listeners = new Set<(result: FillHistoryPayload | null) => void>()

  constructor(client: SimulationClient, app: AppStore, simulation: SimulationSession) {
    this.client = client
    this.app = app
    simulation.onTerrain((terrain, info) => {
      // 崩れる前後の切り替えでは、結果は崩れる前の地形のもの。保ち、計算し直さない
      if (info.variant) return
      this.terrain = terrain
      // 新しい地点の読み込み（null）でも、新しい地形でも、前の結果と進行中の依頼は無効
      this.discard()
      this.request()
    })
    app.subscribe((state, previous) => {
      if (state.fillHistory.enabled === previous.fillHistory.enabled) return
      this.discard()
      this.request()
    })
  }

  /** 大きな配列を含む今の結果。無ければ null */
  result(): FillHistoryPayload | null {
    return this.payload
  }

  /** 結果ができた・消えた（null）ことを知らせる（地図の重ね描きと 3D）。戻り値で外す */
  onResult(listener: (result: FillHistoryPayload | null) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private discard(): void {
    this.generation += 1
    this.setPayload(null)
  }

  private setPayload(payload: FillHistoryPayload | null): void {
    if (this.payload === payload) return
    this.payload = payload
    for (const listener of this.listeners) listener(payload)
  }

  private request(): void {
    const terrain = this.terrain
    const terrainId = this.client.baseTerrainId
    if (!this.app.getState().fillHistory.enabled || terrain === null || terrainId === null) return
    const generation = this.generation
    this.app.getState().setFillHistoryResult('loading', null)
    this.client.computeFillHistory(terrainId, terrain).then(
      (result) => {
        // 古い依頼、オフにした後、今の地形と違う地形の応答は描かない
        if (generation !== this.generation || result.terrainId !== this.client.baseTerrainId) return
        this.setPayload(result)
        this.app.getState().setFillHistoryResult('ready', {
          offsetM: result.offsetM,
          candidates: result.candidates,
          a54Available: result.a54Available,
          landformAvailable: result.landformAvailable,
        })
      },
      (error: unknown) => {
        if (generation !== this.generation) return
        const reason = error instanceof FillHistoryLoadError ? error.reason : 'internal'
        // 置き換わった依頼は、置き換えた側が結果を入れる
        if (reason === 'superseded') return
        const status: FillHistoryStatus =
          reason === 'unavailable' || reason === 'no-overlap' ? reason : 'failed'
        this.app.getState().setFillHistoryResult(status, null)
        if (status === 'failed') console.error(error)
      },
    )
  }
}
