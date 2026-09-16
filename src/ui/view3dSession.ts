import type { Basemap } from '../map/basemapStyle'
import type { MapController } from '../map/MapController'
import { DEFAULT_VIEW3D_OPTIONS, type View3dOptions } from '../map/view3d/options'
import type { View3dInit, View3dRendering } from '../map/view3d/View3d'
import type { WaterPalette } from '../map/waterColormap'
import type { TerrainPayload } from '../shared/protocol'
import type { AppStore, ViewMode } from '../state/appStore'
import type { SettingsStore } from '../state/settingsStore'
import type { SimulationSession } from './simulationSession'

/** View3d（map/view3d/View3d.ts）の、ここから使う部分。テストでは偽物に差し替える */
export interface View3dLike {
  setTerrain(terrain: TerrainPayload | null): void
  setEnabled(enabled: boolean): void
  setExaggeration(value: number): void
  setBasemap(basemap: Basemap): void
  setWater(water: Float32Array | null): void
  setPalette(palette: WaterPalette): void
  restore(): void
  dispose(): void
}

export type View3dFactory = (controller: MapController, init: View3dInit) => View3dLike

/** 3D のコード（map/view3d・renderer・three）は、3D に切り替えたときに初めて読む（tech-spec §14.2、spec 05 §3.8） */
async function loadView3d(): Promise<View3dFactory> {
  const { View3d } = await import('../map/view3d/View3d')
  return (controller, init) => new View3d(controller, init)
}

/**
 * 2D と 3D の切り替え（spec 05 §3.6、R05-1）と、3D の表示へのつなぎ。React の外に置く。
 * 表示の方式はアプリのストア、垂直強調とベースマップは設定のストア、地形は SimulationSession から受ける
 */
export class View3dSession {
  private readonly simulation: SimulationSession
  private readonly app: AppStore
  private readonly settings: SettingsStore
  private readonly load: () => Promise<View3dFactory>
  private options: View3dOptions = DEFAULT_VIEW3D_OPTIONS
  private controller: MapController | null = null
  private view: View3dLike | null = null
  private loading: Promise<View3dLike | null> | null = null
  private terrain: TerrainPayload | null = null
  private water: Float32Array | null = null

  constructor(
    simulation: SimulationSession,
    app: AppStore,
    settings: SettingsStore,
    load: () => Promise<View3dFactory> = loadView3d,
  ) {
    this.simulation = simulation
    this.app = app
    this.settings = settings
    this.load = load
    simulation.onTerrain((terrain) => {
      this.terrain = terrain
      this.view?.setTerrain(terrain)
    })
    simulation.onWater((water) => {
      this.water = water
      this.view?.setWater(water)
    })
  }

  /** 3D の選択肢（計測用のフック perfHook が、最初に 3D にする前に呼ぶ） */
  setOptions(patch: Partial<View3dOptions>): void {
    this.options = { ...this.options, ...patch }
  }

  /** 計測用のフックが地図に触れるため */
  mapController(): MapController | null {
    return this.controller
  }

  /** 地図につなぐ。onRestyle は TerrainSession の購読（04 の重ね描きの足し直し）の後に登録する。戻り値で外す */
  attach(controller: MapController): () => void {
    this.controller = controller
    const offRestyle = controller.onRestyle(() => this.view?.restore())
    const offApp = this.app.subscribe((state, previous) => {
      if (state.viewMode !== previous.viewMode) void this.applyMode(state.viewMode)
    })
    const offSettings = this.settings.subscribe((state, previous) => {
      const exaggeration = state.display.verticalExaggeration
      if (exaggeration !== previous.display.verticalExaggeration) {
        this.view?.setExaggeration(exaggeration)
      }
      if (state.display.waterDepthPalette !== previous.display.waterDepthPalette) {
        this.view?.setPalette(state.display.waterDepthPalette)
      }
      if (state.map.basemap !== previous.map.basemap) this.view?.setBasemap(state.map.basemap)
    })
    if (this.app.getState().viewMode === '3d') void this.applyMode('3d')
    return () => {
      offRestyle()
      offApp()
      offSettings()
      this.view?.dispose()
      this.view = null
      this.loading = null
      this.controller = null
      // 3D の間に外した（StrictMode は付け外しを 2 回行う）ときも、2D の水深の canvas を戻す
      this.simulation.setDepthCanvasVisible(true)
    }
  }

  private async applyMode(mode: ViewMode): Promise<void> {
    if (mode === '2d') {
      this.view?.setEnabled(false)
      // 読み込みの途中で戻した（まだ作っていない）なら、読み込み中の知らせを消す
      if (this.view === null) this.app.getState().setView3dStatus('off')
      return
    }
    const view = await this.ensureView()
    if (view !== null && this.app.getState().viewMode === '3d') view.setEnabled(true)
  }

  private ensureView(): Promise<View3dLike | null> {
    if (this.view !== null) return Promise.resolve(this.view)
    if (this.loading !== null) return this.loading
    const controller = this.controller
    if (controller === null) return Promise.resolve(null)
    this.app.getState().setView3dStatus('loading')
    const loading = this.load()
      .then((create): View3dLike | null => {
        // 読み込みの間に外された
        if (this.controller !== controller) return null
        // 外して付け直した（StrictMode）後の別の読み込みが、先に作った
        if (this.view !== null) return this.view
        const { display, map } = this.settings.getState()
        const view = create(controller, {
          options: this.options,
          basemap: map.basemap,
          exaggeration: display.verticalExaggeration,
          palette: display.waterDepthPalette,
          onRendering: (rendering) => this.onRendering(rendering),
        })
        view.setTerrain(this.terrain)
        view.setWater(this.water)
        this.view = view
        return view
      })
      // .then の第 2 引数は load() 自体の rejection しか拾わず、上の onFulfilled（create・View3d の
      // コンストラクタ・setTerrain・setWater）が投げた例外は拾わない（R2）。.catch を続けて、
      // 生成の失敗でも状態が 'loading' のまま固まらず、rejection も unhandled にならないようにする
      .catch((error: unknown): null => {
        console.error(error)
        this.app.getState().setView3dStatus('error')
        return null
      })
      .finally(() => {
        if (this.loading === loading) this.loading = null
      })
    this.loading = loading
    return loading
  }

  private onRendering(rendering: View3dRendering): void {
    this.app.getState().setView3dStatus(rendering)
    // 3D で描いている間だけ 2D の水深の canvas を隠す（2D に落ちたら出す。spec 05 §3.6）
    this.simulation.setDepthCanvasVisible(rendering !== '3d')
  }
}
