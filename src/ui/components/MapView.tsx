import Box from '@mui/material/Box'
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { MapController } from '../../map/MapController'
import type { SettingsStore } from '../../state/settingsStore'
import { strings } from '../strings'

const MapControllerContext = createContext<MapController | null>(null)

/** 子孫から地図を操作するためのフック。地図の生成前は null */
export function useMapController(): MapController | null {
  return useContext(MapControllerContext)
}

interface Props {
  settings: SettingsStore
  children?: ReactNode
}

/** 全画面の地図。生成は依存配列を空にした useEffect の中だけで行う（tech-spec §5.3） */
export function MapView({ settings, children }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [controller, setController] = useState<MapController | null>(null)
  const basemap = useStore(settings, (s) => s.map.basemap)

  // 生成はこの effect だけで行う（tech-spec §5.3）。settings はアプリで 1 つなので、実質 1 回
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const created = new MapController(
      container,
      strings.attribution,
      settings.getState().map.basemap,
    )
    created.map.once('load', () => {
      container.dataset.mapLoaded = 'true'
    })
    setController(created)
    return () => {
      delete container.dataset.mapLoaded
      created.destroy()
      setController(null)
    }
  }, [settings])

  useEffect(() => {
    controller?.setBasemap(basemap)
  }, [controller, basemap])

  return (
    <MapControllerContext value={controller}>
      <Box
        ref={containerRef}
        component="main"
        aria-label={strings.map.ariaLabel}
        sx={{ position: 'fixed', inset: 0 }}
      />
      {children}
    </MapControllerContext>
  )
}
