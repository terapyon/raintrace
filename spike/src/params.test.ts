import { describe, expect, it } from 'vitest'
import { parseParams } from './params'
import { FILM_DEPTH_M } from './scenes'

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
      demFill: 'zero',
      filmDepth: FILM_DEPTH_M,
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
      demFill: 'zero',
      filmDepth: FILM_DEPTH_M,
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

  it('曲面の膜の水（bowlFilm）を読む', () => {
    expect(parseParams('?water=bowlFilm').water).toBe('bowlFilm')
  })

  it('無効画素の扱い（demFill）を読む', () => {
    expect(parseParams('?demFill=nearest').demFill).toBe('nearest')
    expect(parseParams('?demFill=x').demFill).toBe('zero')
  })

  it('曲面の膜の水深（filmDepth）を読む。既定は 1cm、範囲の外は既定値（Task 5b）', () => {
    expect(parseParams('?filmDepth=0.2').filmDepth).toBe(0.2)
    expect(parseParams('').filmDepth).toBe(FILM_DEPTH_M)
    expect(parseParams('?filmDepth=0').filmDepth).toBe(FILM_DEPTH_M)
    expect(parseParams('?filmDepth=10').filmDepth).toBe(FILM_DEPTH_M)
  })
})
