/** 画面に出す文字列（tech-spec §9.4）。コンポーネントに文字列リテラルを直接書かない */
export const strings = {
  attribution: {
    text: '地図・標高データ：国土地理院',
    url: 'https://maps.gsi.go.jp/development/ichiran.html',
  },
  map: {
    ariaLabel: '地図',
  },
  unsupported: {
    title: 'このブラウザには対応していません',
    body: 'raintrace には WebGL 2 と OffscreenCanvas が必要です。Chrome、Edge、Firefox、Safari の最新版でお試しください。',
    missing: {
      webgl2: 'WebGL 2 が使えません',
      offscreenCanvas: 'OffscreenCanvas が使えません',
    },
  },
} as const
