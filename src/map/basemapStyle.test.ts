import { describe, expect, it } from 'vitest'
import { createGsiStyle, GSI_BASEMAP_TILES } from './basemapStyle'

const attribution = { text: '地図・標高データ：国土地理院', url: 'https://example.jp/' }

describe('createGsiStyle', () => {
  it.each([
    ['std', 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
    ['pale', 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
    ['photo', 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'],
  ] as const)('%s は地理院の %s のタイルをズーム 2〜18 で読む', (basemap, url) => {
    expect(GSI_BASEMAP_TILES[basemap]).toBe(url)
    const style = createGsiStyle(basemap, attribution)
    const source = style.sources[`gsi-${basemap}`]
    expect(source).toMatchObject({
      type: 'raster',
      tiles: [url],
      tileSize: 256,
      minzoom: 2,
      maxzoom: 18,
    })
    expect(style.layers).toEqual([
      { id: `gsi-${basemap}`, type: 'raster', source: `gsi-${basemap}` },
    ])
  })

  it('出典はリンクとして常に付ける（tech-spec §16.1）', () => {
    const source = createGsiStyle('photo', attribution).sources['gsi-photo']
    expect(source).toMatchObject({
      attribution: `<a href="${attribution.url}" target="_blank" rel="noopener noreferrer">${attribution.text}</a>`,
    })
  })
})
