import type { StyleSpecification } from 'maplibre-gl'

/** 設定のストアの Basemap と同じ形（map は state に依存しない） */
export type Basemap = 'std' | 'pale' | 'photo'

export interface Attribution {
  text: string
  url: string
}

/** 地理院タイルの標準地図・淡色地図・写真（ズーム 2〜18）。写真は seamlessphoto の JPEG */
export const GSI_BASEMAP_TILES: Record<Basemap, string> = {
  std: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
  pale: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
  photo: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
}

export function createGsiStyle(basemap: Basemap, attribution: Attribution): StyleSpecification {
  const id = `gsi-${basemap}`
  return {
    version: 8,
    sources: {
      [id]: {
        type: 'raster',
        tiles: [GSI_BASEMAP_TILES[basemap]],
        tileSize: 256,
        minzoom: 2,
        maxzoom: 18,
        attribution: `<a href="${attribution.url}" target="_blank" rel="noopener noreferrer">${attribution.text}</a>`,
      },
    },
    layers: [{ id, type: 'raster', source: id }],
  }
}
