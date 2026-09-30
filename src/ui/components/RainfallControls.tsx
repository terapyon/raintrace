import Box from '@mui/material/Box'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormHelperText from '@mui/material/FormHelperText'
import InputLabel from '@mui/material/InputLabel'
import NativeSelect from '@mui/material/NativeSelect'
import OutlinedInput from '@mui/material/OutlinedInput'
import Slider from '@mui/material/Slider'
import Switch from '@mui/material/Switch'
import { useId } from 'react'
import {
  DURATIONS_MIN,
  type DurationMin,
  INTENSITY_MM_PER_H,
  isDurationMin,
  RADIUS_MIN_M,
} from '../../state/persistedSettings'
import { strings } from '../strings'

interface Props {
  intensityText: string
  radiusText: string
  durationMin: DurationMin
  wholeRange: boolean
  maxRadiusM: number
  intensityInvalid: boolean
  radiusInvalid: boolean
  /** 開始の後はリセットするまで入力できない（spec 04 §3） */
  disabled: boolean
  onIntensityChange: (text: string) => void
  onDurationChange: (minutes: DurationMin) => void
  onWholeRangeChange: (on: boolean) => void
  onRadiusChange: (text: string) => void
}

interface NumberFieldProps {
  label: string
  value: string
  disabled: boolean
  error: boolean
  helperText: string | undefined
  inputMode: 'numeric' | 'decimal'
  onChange: (text: string) => void
}

/**
 * TextField と同じ見た目と関連づけ（label の for、説明文の aria-describedby）の入力欄。TextField は本アプリが
 * 使わない Select・Menu・Popover の実装まで静的に読み、ui のチャンクを予算の 150 KB から押し上げるので使わない
 * （tech-spec §14.2、spec 06 §5.2、RB-1 の順序）
 */
function NumberField(props: NumberFieldProps) {
  const { label, value, disabled, error, helperText, inputMode, onChange } = props
  const id = useId()
  const helperId = `${id}-helper`
  return (
    <FormControl size="small" variant="outlined" disabled={disabled} error={error}>
      <InputLabel htmlFor={id}>{label}</InputLabel>
      <OutlinedInput
        id={id}
        label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        slotProps={{
          input: {
            inputMode,
            ...(helperText === undefined ? {} : { 'aria-describedby': helperId }),
          },
        }}
      />
      {helperText === undefined ? null : (
        <FormHelperText id={helperId}>{helperText}</FormHelperText>
      )}
    </FormControl>
  )
}

/**
 * 継続時間（spec 08 §4.1）。ブラウザの select（NativeSelect）にする。MUI の Select は Menu・Popover を静的に読み、
 * ui のチャンクを押し上げる（NumberField と同じ理由。計画で決めたこと 19）。キーボードの上下の矢印でも選べる
 */
function DurationField(props: {
  value: DurationMin
  disabled: boolean
  onChange: (minutes: DurationMin) => void
}) {
  const id = useId()
  return (
    <FormControl size="small" variant="outlined" disabled={props.disabled}>
      <InputLabel htmlFor={id} shrink>
        {strings.rainfall.duration}
      </InputLabel>
      <NativeSelect
        value={props.value}
        input={<OutlinedInput label={strings.rainfall.duration} notched />}
        inputProps={{ id }}
        onChange={(event) => {
          const minutes = Number(event.target.value)
          if (isDurationMin(minutes)) props.onChange(minutes)
        }}
      >
        {DURATIONS_MIN.map((minutes) => (
          <option key={minutes} value={minutes}>
            {strings.rainfall.durationValue(minutes)}
          </option>
        ))}
      </NativeSelect>
    </FormControl>
  )
}

/**
 * 雨（spec 08 §4.1、base-spec §10）: 時間雨量（入力欄とスライダー）・継続時間（選択）・範囲全体に降らせる（スイッチ）・
 * 半径（入力欄とスライダー。範囲全体の間は無効）
 */
export function RainfallControls(props: Props) {
  const { intensityText, radiusText, durationMin, wholeRange, maxRadiusM, disabled } = props
  const sliderValue = (text: string, min: number, max: number): number => {
    const value = Number(text)
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
  }
  const radiusDisabled = disabled || wholeRange
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <NumberField
        label={strings.rainfall.intensity}
        value={intensityText}
        disabled={disabled}
        error={props.intensityInvalid}
        helperText={props.intensityInvalid ? strings.rainfall.intensityError : undefined}
        inputMode="numeric"
        onChange={props.onIntensityChange}
      />
      <Slider
        aria-label={strings.rainfall.intensitySlider}
        size="small"
        min={INTENSITY_MM_PER_H.min}
        max={INTENSITY_MM_PER_H.max}
        step={1}
        disabled={disabled}
        value={sliderValue(intensityText, INTENSITY_MM_PER_H.min, INTENSITY_MM_PER_H.max)}
        onChange={(_, value) => props.onIntensityChange(String(value))}
      />
      <DurationField value={durationMin} disabled={disabled} onChange={props.onDurationChange} />
      <FormControlLabel
        disabled={disabled}
        control={
          <Switch
            checked={wholeRange}
            onChange={(_, checked) => props.onWholeRangeChange(checked)}
          />
        }
        label={strings.rainfall.wholeRange}
      />
      <NumberField
        label={strings.rainfall.radius}
        value={radiusText}
        disabled={radiusDisabled}
        error={props.radiusInvalid}
        helperText={props.radiusInvalid ? strings.rainfall.radiusError(maxRadiusM) : undefined}
        inputMode="decimal"
        onChange={props.onRadiusChange}
      />
      <Slider
        aria-label={strings.rainfall.radiusSlider}
        size="small"
        min={RADIUS_MIN_M}
        max={maxRadiusM}
        step={1}
        disabled={radiusDisabled}
        value={sliderValue(radiusText, RADIUS_MIN_M, maxRadiusM)}
        onChange={(_, value) => props.onRadiusChange(String(value))}
      />
    </Box>
  )
}
