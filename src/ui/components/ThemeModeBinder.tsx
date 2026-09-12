import { useColorScheme } from '@mui/material/styles'
import { useEffect } from 'react'
import { useStore } from 'zustand'
import type { SettingsStore } from '../../state/settingsStore'

/** 設定のテーマ（light・dark・system）を MUI の配色に結ぶ（tech-spec §9.2）。保存は設定のストアが行う */
export function ThemeModeBinder({ settings }: { settings: SettingsStore }) {
  const mode = useStore(settings, (s) => s.map.theme)
  const { setMode } = useColorScheme()
  useEffect(() => {
    setMode(mode)
  }, [setMode, mode])
  return null
}
