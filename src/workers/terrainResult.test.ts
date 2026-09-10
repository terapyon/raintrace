import { describe, expect, it } from 'vitest'
import type { TerrainGeo } from '../shared/protocol'
import type { TerrainAnalysis } from '../simulation/terrain/analyzeTerrain'
import { makeDepression } from '../simulation/terrain/testGrids'
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
  it('payload の elevation・validMask は retained.grid と中身が同じで、buffer は別', () => {
    const grid = makeGrid()
    const { retained, payload } = packTerrain(7, grid, makeAnalysis(), geo)
    expect(payload.elevation).toEqual(retained.grid.elevation)
    expect(payload.elevation.buffer).not.toBe(retained.grid.elevation.buffer)
    expect(payload.validMask).toEqual(retained.grid.validMask)
    expect(payload.validMask.buffer).not.toBe(retained.grid.validMask.buffer)
  })

  it('transfer は payload の elevation・validMask と analysis の flowDirection・fill・labels の buffer を含み、retained.grid の buffer を含まない', () => {
    const grid = makeGrid()
    const analysis = makeAnalysis()
    const { retained, payload, transfer } = packTerrain(7, grid, analysis, geo)
    expect(transfer).toEqual([
      payload.elevation.buffer,
      payload.validMask.buffer,
      analysis.flowDirection.buffer,
      analysis.fill.buffer,
      analysis.labels.buffer,
    ])
    expect(transfer).not.toContain(retained.grid.elevation.buffer)
    expect(transfer).not.toContain(retained.grid.validMask.buffer)
  })

  it('retained は requestId・width・height・cellSizeM・depressions を持つ', () => {
    const grid = makeGrid()
    const analysis = makeAnalysis()
    const { retained } = packTerrain(7, grid, analysis, geo)
    expect(retained.requestId).toBe(7)
    expect(retained.grid.width).toBe(2)
    expect(retained.grid.height).toBe(2)
    expect(retained.grid.cellSizeM).toBe(1)
    expect(retained.depressions).toEqual(analysis.depressions)
  })

  it('payload は geo をそのまま持ち、meta を持たない', () => {
    const grid = makeGrid()
    const { payload } = packTerrain(7, grid, makeAnalysis(), geo)
    expect(payload.geo).toBe(geo)
    expect(payload).not.toHaveProperty('meta')
  })
})
