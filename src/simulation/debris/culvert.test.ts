import { describe, expect, it } from 'vitest'
import { analyzeDepressions } from '../terrain/analyzeDepressions.ts'
import { CULVERT_BLOCK_DEPOSIT_M } from './constants.ts'
import type { CulvertInput } from './culvert.ts'
import { carveCulvert, culvertBlocked, findCulvert } from './culvert.ts'
import { SIZE, terrain, valleyWithCrossFill, valleyWithFill } from './testTerrain.test-support.ts'

function buildInput(
  elevation: Float32Array,
  validMask: Uint8Array,
  removed: Float32Array,
  past: Float32Array,
  maxLengthM?: number,
): CulvertInput {
  const analysis = analyzeDepressions(terrain(elevation, validMask))
  const candidate = new Uint8Array(removed.length)
  for (let i = 0; i < removed.length; i++) candidate[i] = removed[i]! > 0 ? 1 : 0
  return {
    elevation,
    past,
    validMask,
    candidate,
    labels: analysis.labels,
    depressions: analysis.depressions,
    size: SIZE,
    cellSizeM: 5,
    ...(maxLengthM === undefined ? {} : { maxLengthM }),
  }
}

function crossFillInput(maxLengthM?: number) {
  const { grid, removed, past } = valleyWithCrossFill()
  return {
    grid,
    removed,
    past,
    input: buildInput(grid.elevation, grid.validMask, removed, past, maxLengthM),
  }
}

describe('findCulvert', () => {
  it('(a) 谷をまたぐ盛土: 水路が pit から出口まで 4 近傍でつながり、bed は下流へ増えず、候補のセルを通る', () => {
    const { input } = crossFillInput()
    const culvert = findCulvert(input)
    expect(culvert).not.toBeNull()
    const c = culvert!
    const dep = input.depressions.find((d) => d.id === c.depressionId)!
    expect(c.path[0]).toBe(dep.pitIndex)
    for (let k = 1; k < c.path.length; k++) {
      const a = c.path[k - 1]!
      const b = c.path[k]!
      const manhattan =
        Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE)) + Math.abs((a % SIZE) - (b % SIZE))
      expect(manhattan).toBe(1)
      expect(c.bed[k]!).toBeLessThanOrEqual(c.bed[k - 1]!)
    }
    const last = c.path[c.path.length - 1]!
    expect(input.labels[last]).not.toBe(dep.id)
    expect(input.candidate[last]).toBe(0)
    expect(input.elevation[last]!).toBeLessThan(input.elevation[dep.pitIndex]!)
    expect(Array.from(c.path).some((i) => input.candidate[i] === 1)).toBe(true)
    expect(c.lengthM).toBe((c.path.length - 1) * 5)
    expect(c.ends.length).toBeGreaterThan(0)
    for (const i of c.ends) expect(input.candidate[i]).toBe(0)
  })

  it('(b) carveCulvert した今の地形では、pit を含む窪地が無いか、容量が元の 10% 未満', () => {
    const { grid, input } = crossFillInput()
    const culvert = findCulvert(input)!
    const dep = input.depressions.find((d) => d.id === culvert.depressionId)!
    const carved = carveCulvert(grid.elevation, culvert)
    const after = analyzeDepressions(terrain(carved, grid.validMask))
    const id = after.labels[dep.pitIndex]!
    if (id !== 0) {
      const d = after.depressions.find((x) => x.id === id)!
      expect(d.capacityM3).toBeLessThan(dep.capacityM3 * 0.1)
    }
    // 元の配列は書き換えない
    expect(carved).not.toBe(grid.elevation)
  })

  it('culvertBlocked: ends のセルに 0.5 m で true、0.49 m で false、ends 以外に 5 m でも false', () => {
    const { input } = crossFillInput()
    const culvert = findCulvert(input)!
    const end = culvert.ends[0]!
    const mk = (fill: (d: Float32Array) => void) => {
      const d = new Float32Array(SIZE * SIZE)
      fill(d)
      return d
    }
    expect(
      culvertBlocked(
        culvert,
        mk((d) => {
          d[end] = CULVERT_BLOCK_DEPOSIT_M
        }),
      ),
    ).toBe(true)
    expect(
      culvertBlocked(
        culvert,
        mk((d) => {
          d[end] = 0.49
        }),
      ),
    ).toBe(false)
    const ends = new Set(culvert.ends)
    expect(
      culvertBlocked(
        culvert,
        mk((d) => {
          for (let i = 0; i < d.length; i++) if (!ends.has(i)) d[i] = 5
        }),
      ),
    ).toBe(false)
  })

  it('(d) 谷の斜面に載せただけの盛土（valleyWithFill）では null', () => {
    const { grid, removed } = valleyWithFill(3)
    const past = new Float32Array(grid.elevation.length)
    for (let i = 0; i < past.length; i++) past[i] = grid.elevation[i]! - removed[i]!
    expect(findCulvert(buildInput(grid.elevation, grid.validMask, removed, past))).toBeNull()
  })

  it('昔の地形の NaN が谷を横切ってふさぐと null（Review Focus 3）', () => {
    // 盛土の南端の次の行（行 30）の全列。南の出口へ行く道がすべて切れる
    const { grid, removed, past } = valleyWithCrossFill()
    const blocked = past.slice()
    for (let c = 0; c < SIZE; c++) blocked[30 * SIZE + c] = Number.NaN
    expect(findCulvert(buildInput(grid.elevation, grid.validMask, removed, blocked))).toBeNull()
  })

  it('道の長さが maxLengthM を超えると null（(a) の道の長さより 1 セル分短い maxLengthM）（Review Focus 4）', () => {
    const base = findCulvert(crossFillInput().input)!
    expect(findCulvert(crossFillInput(base.lengthM).input)).not.toBeNull()
    expect(findCulvert(crossFillInput(base.lengthM - 5).input)).toBeNull()
  })

  it('範囲の中に pit より低いセルが無いと null（Review Focus 4）', () => {
    const { grid, removed, past } = valleyWithCrossFill()
    const raised = grid.elevation.slice()
    for (let r = 30; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) raised[r * SIZE + c] = Math.max(raised[r * SIZE + c]!, 250)
    }
    expect(findCulvert(buildInput(raised, grid.validMask, removed, past))).toBeNull()
  })
})
