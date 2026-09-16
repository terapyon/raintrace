import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useState } from 'react'
import { useStore } from 'zustand'
import type { PlaybackSpeed } from '../../shared/protocol'
import { maxRadiusM, RANGE_SIZES, type RangeSizeM } from '../../state/persistedSettings'
import type { SettingsStore } from '../../state/settingsStore'
import type { SimulationStore } from '../../state/simulationStore'
import { strings } from '../strings'
import { parseAmountMm, parseRadiusM } from '../validation'
import { PlaybackControls } from './PlaybackControls'
import { RainfallControls } from './RainfallControls'

/** 再生の命令。SimulationSession がそのまま満たす */
export interface PlaybackActions {
  start(amountMm: number, radiusM: number): void
  pause(): void
  resume(): void
  step(): void
  reset(): void
  setSpeed(speed: PlaybackSpeed): void
}

interface Props {
  settings: SettingsStore
  simulation: SimulationStore
  /** 範囲を表示している（読み込みが ready） */
  hasTerrain: boolean
  actions: PlaybackActions
  /** 「再読み込み」: 同じ地点を選び直す（spec 04 §10） */
  onReload: () => void
}

/**
 * 降雨・範囲の大きさ・再生・平衡とエラーの知らせ。入力中の文字列はここに置き、有効な値だけを
 * 設定のストアに書く（計画で決めたこと 9）。範囲外の値は入力欄にエラーを出し、開始を押せなくする（spec 04 §9）
 */
export function ControlsSection({ settings, simulation, hasTerrain, actions, onReload }: Props) {
  const sizeM = useStore(settings, (s) => s.area.sizeM)
  const status = useStore(simulation, (s) => s.status)
  const speed = useStore(simulation, (s) => s.speed)
  const error = useStore(simulation, (s) => s.error)
  const settledStep = useStore(simulation, (s) =>
    s.status === 'settled' ? (s.stats?.step ?? 0) : null,
  )
  const [amountText, setAmountText] = useState(() => String(settings.getState().rainfall.amountMm))
  const [radiusText, setRadiusText] = useState(() => String(settings.getState().rainfall.radiusM))
  const amountMm = parseAmountMm(amountText)
  const radiusM = parseRadiusM(radiusText, sizeM)
  const canStart = hasTerrain && amountMm !== null && radiusM !== null && error !== 'worker'

  const onAmountChange = (text: string): void => {
    setAmountText(text)
    const value = parseAmountMm(text)
    if (value !== null)
      settings.getState().setRainfall({ ...settings.getState().rainfall, amountMm: value })
  }
  const onRadiusChange = (text: string): void => {
    setRadiusText(text)
    const value = parseRadiusM(text, sizeM)
    if (value !== null)
      settings.getState().setRainfall({ ...settings.getState().rainfall, radiusM: value })
  }
  const onSizeChange = (next: RangeSizeM): void => {
    // 設定のストアが半径を新しい範囲の半分に収めるので、入力欄も合わせる。範囲の読み込み直しは TerrainSession
    settings.getState().setAreaSize(next)
    setRadiusText(String(settings.getState().rainfall.radiusM))
  }

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="subtitle2">{strings.rainfall.title}</Typography>
      <RainfallControls
        amountText={amountText}
        radiusText={radiusText}
        maxRadiusM={maxRadiusM(sizeM)}
        amountInvalid={amountMm === null}
        radiusInvalid={radiusM === null}
        disabled={status !== 'idle'}
        onAmountChange={onAmountChange}
        onRadiusChange={onRadiusChange}
      />
      <Box>
        <Typography variant="body2" color="text.secondary">
          {strings.rainfall.rangeSize}
        </Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          aria-label={strings.rainfall.rangeSize}
          value={sizeM}
          onChange={(_, value: RangeSizeM | null) => {
            if (value !== null) onSizeChange(value)
          }}
        >
          {RANGE_SIZES.map((size) => (
            <ToggleButton key={size} value={size}>
              {strings.rainfall.rangeSizeValue(size)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>
      <Typography variant="subtitle2">{strings.playback.title}</Typography>
      <PlaybackControls
        status={status}
        canStart={canStart}
        speed={speed}
        onStart={() => {
          if (amountMm !== null && radiusM !== null) actions.start(amountMm, radiusM)
        }}
        onPause={() => actions.pause()}
        onResume={() => actions.resume()}
        onStep={() => actions.step()}
        onReset={() => actions.reset()}
        onSpeedChange={(value) => actions.setSpeed(value)}
      />
      {settledStep !== null && (
        <Alert severity="success" data-testid="settled">
          {strings.playback.settled(settledStep)}
        </Alert>
      )}
      {error !== null && (
        <Alert
          severity="error"
          data-testid="sim-error"
          action={
            error === 'worker' ? (
              <Button color="inherit" size="small" onClick={onReload}>
                {strings.playback.reload}
              </Button>
            ) : undefined
          }
        >
          {strings.simErrors[error]}
        </Alert>
      )}
    </Box>
  )
}
