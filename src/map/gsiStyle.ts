import type { StyleSpecification } from 'maplibre-gl'

/** 地理院タイルの淡色地図（ズーム 2〜18） */
export const GSI_PALE_TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'

export interface Attribution {
  text: string
  url: string
}

export function createGsiPaleStyle(attribution: Attribution): StyleSpecification {
  return {
    version: 8,
    sources: {
      'gsi-pale': {
        type: 'raster',
        tiles: [GSI_PALE_TILE_URL],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 18,
        attribution: `<a href="${attribution.url}" target="_blank" rel="noopener noreferrer">${attribution.text}</a>`,
      },
    },
    layers: [{ id: 'gsi-pale', type: 'raster', source: 'gsi-pale' }],
  }
}
