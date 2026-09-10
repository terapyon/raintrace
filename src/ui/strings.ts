/** 画面に出す文字列（tech-spec §9.4）。コンポーネントに文字列リテラルを直接書かない */
export const strings = {
  unsupported: {
    title: 'このブラウザには対応していません',
    body: 'raintrace には WebGL 2 と OffscreenCanvas が必要です。Chrome、Edge、Firefox、Safari の最新版でお試しください。',
    missing: {
      webgl2: 'WebGL 2 が使えません',
      offscreenCanvas: 'OffscreenCanvas が使えません',
    },
  },
} as const
