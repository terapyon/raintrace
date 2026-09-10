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
  cssVariables: true,
  typography: { fontFamily: systemFontFamily },
})
