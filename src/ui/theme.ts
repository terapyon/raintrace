import { createTheme } from '@mui/material/styles'

// フォントは外部から読まず、システムフォントを使う（spec 01 §4.3）
const systemFontFamily = [
  'system-ui',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  '"Hiragino Sans"',
  '"Hiragino Kaku Gothic ProN"',
  '"Noto Sans JP"',
  'Meiryo',
  'sans-serif',
].join(',')

export const theme = createTheme({
  colorSchemes: { light: true, dark: true },
  // 手動の切り替え（useColorScheme().setMode）が効くよう、<html> のクラスで配色を選ぶ。
  // light と dark の両方があると既定は 'media'（prefers-color-scheme）で、手動では変わらない
  cssVariables: { colorSchemeSelector: 'class' },
  typography: { fontFamily: systemFontFamily },
})
