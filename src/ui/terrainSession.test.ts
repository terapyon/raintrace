import { describe, expect, it } from 'vitest'
import { pixelToLonLat } from '../dem/tileMath'
import type { TerrainPayload } from '../shared/protocol'
import { createAppStore } from '../state/appStore'
import { memoryStorage } from '../state/memoryStorage.test-support'
import { createSettingsStore } from '../state/settingsStore'
import { TerrainSession } from './terrainSession'

const geo = { z: 17, originX: 1000, originY: 2000, size: 2 } as TerrainPayload['geo']
const terrain = {
  geo,
  elevation: Float32Array.of(12, 12, 12, 12),
  validMask: Uint8Array.of(1, 1, 1, 1),
}
const history = {
  pastElevation: Float32Array.of(9, 9, 9, 9),
  deltaCorrected: Float32Array.of(3, 3, 3, 3),
}

/** 地形と結果を持つ TerrainSession（通信は使わない） */
function sessionWith(clientTerrain: typeof terrain = terrain) {
  const store = createAppStore()
  const simulation = { onTerrain: () => () => {}, onWater: () => () => {} }
  const client = { terrain: clientTerrain, water: null, onCrash: () => () => {} }
  const session = new TerrainSession(
    client as never,
    store,
    simulation as never,
    createSettingsStore(memoryStorage()),
  )
  ;(session.fillHistory as { result: () => unknown }).result = () => history
  return { store, session }
}

describe('TerrainSession.cellInfo の盛土の履歴（spec 09 §6.6）', () => {
  const p = pixelToLonLat(geo.originX + 0.5, geo.originY + 0.5, geo.z)

  it('オフなら昔の標高・差を足さない', () => {
    const { session } = sessionWith()
    expect(session.cellInfo(p.lon, p.lat)).not.toHaveProperty('pastM')
  })

  it('オンなら、今の地形でも昔の地形（3D の「昔」）でも昔の標高・差を足す', () => {
    const { store, session } = sessionWith()
    store.getState().setFillHistoryEnabled(true)
    expect(session.cellInfo(p.lon, p.lat)).toMatchObject({ pastM: 9, deltaM: 3 })
    store.getState().setTerrainEpoch('past')
    expect(session.cellInfo(p.lon, p.lat)).toMatchObject({ pastM: 9, deltaM: 3 })
  })

  it('崩れた後を表示している間は、昔の標高・差を足さない（ruling R8）', () => {
    const { store, session } = sessionWith()
    store.getState().setFillHistoryEnabled(true)
    store.getState().setCollapseView('after')
    expect(session.cellInfo(p.lon, p.lat)).not.toHaveProperty('pastM')
    store.getState().setCollapseView('before')
    expect(session.cellInfo(p.lon, p.lat)).toMatchObject({ pastM: 9 })
  })

  it('崩れる前へ戻す差し替えの途中（エンジンはまだ崩れた後でありうる）も、昔の標高・差を足さない', () => {
    const { store, session } = sessionWith()
    store.getState().setFillHistoryEnabled(true)
    store.getState().setCollapseSwapping(true)
    expect(session.cellInfo(p.lon, p.lat)).not.toHaveProperty('pastM')
    store.getState().setCollapseSwapping(false)
    expect(session.cellInfo(p.lon, p.lat)).toMatchObject({ pastM: 9 })
  })
})

describe('TerrainSession.cellInfo の水路の溝ありの崩れる前', () => {
  const p = pixelToLonLat(geo.originX + 0.5, geo.originY + 0.5, geo.z)

  it('今の標高は溝のない読み込んだ地形から読み、昔の標高・差も足す。崩れた後は今のエンジンの地形のまま', () => {
    // エンジンが持つのは溝（−2 m）を掘った地形。読み込んだ地形は 12 m
    const carved = { ...terrain, elevation: Float32Array.of(10, 10, 10, 10) }
    const { store, session } = sessionWith(carved)
    store.getState().setFillHistoryEnabled(true)
    // 溝ありの崩れる前を表示している状態（CollapseSession が基の地形を返す）
    ;(session.collapse as { uncarvedTerrain: () => unknown }).uncarvedTerrain = () => terrain
    expect(session.cellInfo(p.lon, p.lat)).toMatchObject({ elevationM: 12, pastM: 9, deltaM: 3 })
    // 溝ありを表示していなければ、エンジンの地形の標高
    ;(session.collapse as { uncarvedTerrain: () => unknown }).uncarvedTerrain = () => null
    expect(session.cellInfo(p.lon, p.lat)).toMatchObject({ elevationM: 10 })
  })
})
