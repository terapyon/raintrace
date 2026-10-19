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
function sessionWith() {
  const store = createAppStore()
  const simulation = { onTerrain: () => () => {}, onWater: () => () => {} }
  const client = { terrain, water: null }
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
})
