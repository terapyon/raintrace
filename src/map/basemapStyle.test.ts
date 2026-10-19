import { describe, expect, it } from 'vitest'
import { createGsiStyle, GSI_BASEMAP_TILES } from './basemapStyle'

const attribution = {
  text: '地図・標高データ：国土地理院',
  url: 'https://example.jp/',
  note: '加工して作成',
}

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
      attribution: `<a href="${attribution.url}" target="_blank" rel="noopener noreferrer">${attribution.text}</a> ／ ${attribution.note}`,
    })
  })

  it('出典は国土地理院へのリンクのあとに、加工して作成した旨を続ける（spec 09 §6.5）', () => {
    const style = createGsiStyle('pale', {
      text: '地図・標高データ：国土地理院',
      url: 'https://maps.gsi.go.jp/development/ichiran.html',
      note: '解析・シミュレーション表示：地理院タイル（標高タイル）を加工して RainTrace が作成',
    })
    const source = style.sources['gsi-pale'] as { attribution: string }
    expect(source.attribution).toBe(
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地図・標高データ：国土地理院</a> ／ 解析・シミュレーション表示：地理院タイル（標高タイル）を加工して RainTrace が作成',
    )
  })
})
