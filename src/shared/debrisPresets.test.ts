import { describe, expect, it } from 'vitest'
import { DEBRIS_PRESETS, DEFAULT_DEBRIS_PRESET_ID, debrisPreset } from './debrisPresets.ts'

describe('土砂の流れやすさのプリセット', () => {
  it('id は重複しない。既定の id は表にある', () => {
    const ids = DEBRIS_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(DEFAULT_DEBRIS_PRESET_ID)
  })

  it('どの行もパラメータが論文の推奨の幅の中', () => {
    for (const { params: p } of DEBRIS_PRESETS) {
      expect(p.mu).toBeGreaterThanOrEqual(0.04)
      expect(p.mu).toBeLessThanOrEqual(0.8)
      expect(p.massToDragM).toBeGreaterThanOrEqual(20)
      expect(p.massToDragM).toBeLessThanOrEqual(150)
      expect(p.divergence).toBeGreaterThanOrEqual(1.3)
      expect(p.divergence).toBeLessThanOrEqual(3.0)
      expect(p.persistence).toBeGreaterThanOrEqual(1.5)
      expect(p.persistence).toBeLessThanOrEqual(2.0)
      expect(p.reposeDeg).toBeGreaterThanOrEqual(0)
      expect(p.reposeDeg).toBeLessThanOrEqual(45)
    }
  })

  it('無い id は既定のプリセットを返す', () => {
    expect(debrisPreset('nothing').id).toBe(DEFAULT_DEBRIS_PRESET_ID)
    expect(debrisPreset('far').id).toBe('far')
  })
})
