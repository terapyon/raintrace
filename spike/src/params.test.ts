import { describe, expect, it } from 'vitest'
import { parseParams } from './params'

describe('parseParams', () => {
  it('引数が無ければ既定値になる', () => {
    expect(parseParams('')).toEqual({
      candidate: null,
      scene: 'synthetic',
      water: 'fixed',
      exaggeration: 1,
      pitch: 60,
      zoom: 17,
      zfix: 'offset',
      capture: false,
      skirt: true,
      probe: null,
    })
  })

  it('候補・場面・視点・対策を読む', () => {
    const params = parseParams(
      '?candidate=braw&scene=real&water=film&exaggeration=10&pitch=85&zoom=15&zfix=none&capture=1&skirt=0&probe=fps',
    )
    expect(params).toEqual({
      candidate: 'braw',
      scene: 'real',
      water: 'film',
      exaggeration: 10,
      pitch: 85,
      zoom: 15,
      zfix: 'none',
      capture: true,
      skirt: false,
      probe: 'fps',
    })
  })

  it('知らない値と範囲の外の数値は既定値にする', () => {
    const params = parseParams('?candidate=c&scene=x&pitch=90&zoom=19&exaggeration=-1')
    expect(params.candidate).toBeNull()
    expect(params.scene).toBe('synthetic')
    expect(params.pitch).toBe(60)
    expect(params.zoom).toBe(17)
    expect(params.exaggeration).toBe(1)
  })
})
