import { useEffect } from 'react'
import type { TerrainSession } from '../terrainSession'
import { useMapController } from './MapView'

/** 地図ができたら、読み込みの流れを地図につなぐ */
export function TerrainSessionBinder({ session }: { session: TerrainSession }) {
  const controller = useMapController()
  useEffect(
    () => (controller === null ? undefined : session.attach(controller)),
    [controller, session],
  )
  return null
}
