import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormHelperText from '@mui/material/FormHelperText'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useId, useState } from 'react'
import { useStore } from 'zustand'
import type { PlaybackSpeed } from '../../shared/protocol'
import {
  maxRadiusM,
  RANGE_SIZES,
  type RainfallSettings,
  type RangeSizeM,
} from '../../state/persistedSettings'
import type { SettingsStore } from '../../state/settingsStore'
import type { SimulationStore } from '../../state/simulationStore'
import { formatElapsed } from '../format'
import { strings } from '../strings'
import { parseIntensityMmPerH, parseRadiusM } from '../validation'
import { PlaybackControls } from './PlaybackControls'
import { RainfallControls } from './RainfallControls'

/** 再生の命令。SimulationSession がそのまま満たす */
export interface PlaybackActions {
  start(rain: RainfallSettings): void
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
 * 降雨・範囲の大きさ・再生・自動停止とエラーの知らせ。入力中の文字列はここに置き、有効な値だけを
 * 設定のストアに書く（spec 04 の計画で決めたこと 9）。範囲外の値は入力欄にエラーを出し、開始を押せなくする
 * （spec 08 §6.3）。範囲全体に降らせる間は半径を検証しない（開始に渡すのは保存値の半径。Review Focus 5）
 */
export function ControlsSection({ settings, simulation, hasTerrain, actions, onReload }: Props) {
  const rangeSizeHintId = useId()
  const sizeM = useStore(settings, (s) => s.area.sizeM)
  const durationMin = useStore(settings, (s) => s.rainfall.durationMin)
  const wholeRange = useStore(settings, (s) => s.rainfall.wholeRange)
  const status = useStore(simulation, (s) => s.status)
  const speed = useStore(simulation, (s) => s.speed)
  const error = useStore(simulation, (s) => s.error)
  const stopReason = useStore(simulation, (s) =>
    s.status === 'settled' ? (s.stats?.stopReason ?? 'settled') : null,
  )
  const stoppedAt = useStore(simulation, (s) => s.stats?.timeS ?? 0)
  const [intensityText, setIntensityText] = useState(() =>
    String(settings.getState().rainfall.intensityMmPerH),
  )
  const [radiusText, setRadiusText] = useState(() => String(settings.getState().rainfall.radiusM))
  const intensity = parseIntensityMmPerH(intensityText)
  const radiusM = parseRadiusM(radiusText, sizeM)
  const radiusOk = wholeRange || radiusM !== null
  const canStart = hasTerrain && intensity !== null && radiusOk && error !== 'worker'

  const setRainfall = (patch: Partial<RainfallSettings>): void =>
    settings.getState().setRainfall({ ...settings.getState().rainfall, ...patch })
  const onIntensityChange = (text: string): void => {
    setIntensityText(text)
    const value = parseIntensityMmPerH(text)
    if (value !== null) setRainfall({ intensityMmPerH: value })
  }
  const onRadiusChange = (text: string): void => {
    setRadiusText(text)
    const value = parseRadiusM(text, sizeM)
    if (value !== null) setRainfall({ radiusM: value })
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
        intensityText={intensityText}
        radiusText={radiusText}
        durationMin={durationMin}
        wholeRange={wholeRange}
        maxRadiusM={maxRadiusM(sizeM)}
        intensityInvalid={intensity === null}
        radiusInvalid={!wholeRange && radiusM === null}
        disabled={status !== 'idle'}
        onIntensityChange={onIntensityChange}
        onDurationChange={(minutes) => setRainfall({ durationMin: minutes })}
        onWholeRangeChange={(on) => setRainfall({ wholeRange: on })}
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
          aria-describedby={sizeM === 1000 ? rangeSizeHintId : undefined}
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
        {sizeM === 1000 && (
          <FormHelperText id={rangeSizeHintId}>
            {strings.rainfall.rangeSizeHeavyHint}
          </FormHelperText>
        )}
      </Box>
      <Typography variant="subtitle2">{strings.playback.title}</Typography>
      <PlaybackControls
        status={status}
        canStart={canStart}
        speed={speed}
        onStart={() => {
          // 有効な入力だけが設定のストアに入っているので、保存値をそのまま渡す
          if (canStart) actions.start(settings.getState().rainfall)
        }}
        onPause={() => actions.pause()}
        onResume={() => actions.resume()}
        onStep={() => actions.step()}
        onReset={() => actions.reset()}
        onSpeedChange={(value) => actions.setSpeed(value)}
      />
      {stopReason !== null && (
        <Alert severity={stopReason === 'cap' ? 'info' : 'success'} data-testid="settled">
          {stopReason === 'cap'
            ? strings.playback.cap(formatElapsed(stoppedAt))
            : strings.playback.settled(formatElapsed(stoppedAt))}
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
