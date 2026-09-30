import { describe, expect, it } from 'vitest'
import type { TerrainGeo } from '../shared/protocol'
import type { OutflowCells } from '../simulation/outflowCells'
import type { TerrainAnalysis } from '../simulation/terrain/analyzeTerrain'
import { makeDepression } from '../simulation/testing/terrainGrids.test-support'
import { packTerrain } from './terrainResult'

const geo: TerrainGeo = {
  level: 1,
  z: 17,
  originX: 1000,
  originY: 2000,
  size: 4,
  cellSizeM: 1,
  corners: [
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ],
  breakdown: {},
  invalidRatio: 0,
}

function makeGrid() {
  return {
    elevation: Float32Array.from([1, 2, 3, 4]),
    validMask: Uint8Array.from([1, 1, 1, 0]),
    width: 2,
    height: 2,
    cellSizeM: 1,
    invalidRatio: 0.25,
  }
}

const depression = makeDepression({ spillElevation: 3 })

/** 2 × 2 の範囲の流出の表（中身は packTerrain が触れないので、形だけ合わせる） */
function makeOutflow(): OutflowCells {
  return {
    nearest: Int32Array.from([0, 1, 2, -1]),
    band: Int32Array.from([0, 1, 2]),
  }
}

function makeAnalysis(): TerrainAnalysis {
  return {
    lowestIndex: 0,
    flowDirection: Uint8Array.from([1, 2, 3, 4]),
    fill: Float32Array.from([1, 2, 3, 4]),
    labels: Int32Array.from([0, 1, 0, 0]),
    depressions: [depression],
    elevationRange: { min: 1, max: 4 },
  }
}

describe('packTerrain', () => {
  it('payload の elevation・validMask は grid と中身が同じで、buffer は別', () => {
    const grid = makeGrid()
    const { payload } = packTerrain(grid, makeAnalysis(), geo, makeOutflow())
    expect(payload.elevation).toEqual(grid.elevation)
    expect(payload.elevation.buffer).not.toBe(grid.elevation.buffer)
    expect(payload.validMask).toEqual(grid.validMask)
    expect(payload.validMask.buffer).not.toBe(grid.validMask.buffer)
  })

  it('transfer は payload の elevation・validMask と analysis の flowDirection・fill・labels と流出の表の nearest・band（mask は送らない。spec 08 §5.3）の buffer を含み、grid の buffer を含まない（grid はエンジンに渡す）', () => {
    const grid = makeGrid()
    const analysis = makeAnalysis()
    const outflow = makeOutflow()
    const { payload, transfer } = packTerrain(grid, analysis, geo, outflow)
    expect(transfer).toEqual([
      payload.elevation.buffer,
      payload.validMask.buffer,
      analysis.flowDirection.buffer,
      analysis.fill.buffer,
      analysis.labels.buffer,
      outflow.nearest.buffer,
      outflow.band.buffer,
    ])
    expect(transfer).not.toContain(grid.elevation.buffer)
    expect(transfer).not.toContain(grid.validMask.buffer)
  })

  it('payload は geo をそのまま持ち、meta を持たない', () => {
    const grid = makeGrid()
    const { payload } = packTerrain(grid, makeAnalysis(), geo, makeOutflow())
    expect(payload.geo).toBe(geo)
    expect(payload).not.toHaveProperty('meta')
  })

  it('payload は Worker で作った流出の表をそのまま outflow に持つ（spec 07 §5.1。複製せずに移す）', () => {
    const outflow = makeOutflow()
    const { payload } = packTerrain(makeGrid(), makeAnalysis(), geo, outflow)
    expect(payload.outflow).toBe(outflow)
  })
})
